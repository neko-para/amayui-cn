/**
 * **FrameDigest（逐帧对外表现记录）** —— "两个宿主是否在做同一件事"的**量具**。
 *
 * 为什么需要它（`tickets/T-0003` 的 B3 验收 4 / 设计文档 §4 的 G1/G3）：
 * 修前"headless 与 Electron 一致"只能靠人肉读代码 + 截图对照；一旦不一致，也说不清
 * "是第几帧的哪一项不同"。digest 把一帧压成**可比、可存、可 diff** 的记录：
 *  - **G1 确定性**：同一 Scenario 跑两次 ⇒ digest 序列逐字节相等；
 *  - **G3 回放等价**：Electron `--record` 落"时钟 + 输入 + digest"，headless `--replay` 复现同一序列；
 *  - 失败时 `diffEngineDigest` 直接给出"第 N 帧的 `engine.items[3].color` 不同"。
 *
 * ## 为什么 digset 由**本模块**（而不是各宿主）组装
 * 设计文档 §3 把 `digest()` 放在 `FrameHost` 上。实现时发现那样会**再造一次分叉**：
 * digest 的大部分（`script`/`gates`/`routes`/`pages`）是 **Engine** 的状态，只有场景模型在宿主里。
 * 如果让两个宿主各自拼 digest，就等于"同一件事有两份实现"——正是 `T-0008` 的 `waitFlags`
 * 镜像与 `scAnimationsDone` 口径不一致踩过的坑。
 * ⇒ 结论：**纯函数构建器在本模块**（唯一一份），宿主只提供自己那块场景模型（`FrameHost.digestState`）。
 *
 * ## 段划分（设计文档 §4 的"可执行定义"）
 * ```
 * FrameDigest = { frame, nowMs, engine: {...}, host: {...}, hash }
 * ```
 * - `engine` 段：**两宿主必须逐字段相等**（G3 比的就是它）；
 * - `host` 段：**允许不同**（屏障次数 / 音频意图数 / 字体缺字）—— 它记的是"宿主义务履行了多少"，
 *   不是游戏行为。把宿主差异混进 engine 段会让 G3 要么假绿（差异被忽略）要么永远红。
 */
import type { Engine } from '../vm/engine.js';
import { scSnapshot, type SceneSnapshot, type SnapshotItem, type SnapshotMesh, type SnapshotMsgWin } from '../renderer/sceneModel.js';
import type { SceneState } from '../renderer/scene/state.js';

/** engine 段里的"门状态"（设计文档 §3 的 `gates`）。 */
export interface DigestGates {
  waitFlags: number;
  awaitingAdvance: boolean;
  advActive: boolean;
  textRevealing: boolean;
  sleepUntil: number;
}

/** **engine 段**：两宿主必须逐字段相等。 */
export interface DigestEngine {
  /** 当前脚本名（`Frame.name`）。 */
  script: string;
  /** 当前指令下标。 */
  ip: number;
  gates: DigestGates;
  counts: SceneSnapshot['counts'];
  /** 绘制项（**求值后**，含动画插值；按 handle 排序 ⇒ 与遍历顺序无关）。 */
  items: SnapshotItem[];
  meshes: SnapshotMesh[];
  /** 消息窗文本（含逐字显现游标 `revealed`）。 */
  msgWins: SnapshotMsgWin[];
  /** 热点面板（`0x94`/悬停派发）：`cursor` = 命中游标（−1 = 未命中）。 */
  routes: { count: number; cursor: number; hover: number; shown: number };
  /** 消息页数（`e.msgwin.pages`）。 */
  pages: number;
}

/** **host 段**：允许两宿主不同（宿主义务的履行计数，不参与 G3 比较）。 */
export interface DigestHost {
  /** 纹理帧屏障等待次数（Electron 有 IPC 异步；headless 无纹理 ⇒ 恒 0）。 */
  barriers: number;
  /** 本帧累计收到的音频意图条数（`tick` 也算）。 */
  audioIntents: number;
  /** 字体/字形缺失计数（Electron 光栅化才会缺；headless 恒 0）。 */
  fontMisses: number;
}

export interface FrameDigest {
  /** 帧号（0 起，与驱动 `FrameLoopResult.frames` 同口径）。 */
  frame: number;
  /** 本帧时钟（ms）。 */
  nowMs: number;
  engine: DigestEngine;
  host: DigestHost;
  /** `engine` 段的短哈希（8 hex）—— 快速比对用；相等 ⇒ 引擎段逐字段相等。 */
  hash: string;
}

/** 宿主要交出来的两块：场景模型 + 宿主计数。 */
export interface DigestSource {
  /** 本宿主的场景模型（与另一宿主共用 `scene/ops.ts` 的同一份语义）。 */
  digestState(): SceneState;
  /** 宿主义务计数（可选；缺省全 0）。 */
  digestHostCounters?(): DigestHost;
}

/** 构建 digest 需要的一切（都是驱动/观察者已经持有的东西）。 */
export interface BuildDigestArgs {
  e: Engine;
  /** 场景模型（`host.digestState()` 的返回值）。 */
  scene: SceneState;
  frame: number;
  nowMs: number;
  host?: DigestHost;
}

const ZERO_HOST: DigestHost = { barriers: 0, audioIntents: 0, fontMisses: 0 };

/**
 * 从 Engine + 场景模型构建一帧的 digest（**纯函数**，不读宿主私有字段、不写任何状态）。
 *
 * ★`scSnapshot(scene, nowMs)` 会**求值**动画窗（与"画出来"同一份函数）⇒ digest 记的是
 * "这一帧长什么样"，而不是"脚本写了什么"（后者是 `report.ts` 的职责，两者互补）。
 */
export function buildFrameDigest(args: BuildDigestArgs): FrameDigest {
  const { e, scene, frame, nowMs } = args;
  const snap = scSnapshot(scene, nowMs);
  const f = e.curScript();
  const engine: DigestEngine = {
    script: f.name,
    ip: f.ip,
    gates: {
      waitFlags: e.waitFlags,
      awaitingAdvance: e.awaitingAdvance,
      advActive: e.advActive,
      textRevealing: e.textRevealing,
      sleepUntil: Math.round(e.sleepUntil),
    },
    counts: snap.counts,
    items: snap.drawItems,
    meshes: snap.meshes,
    msgWins: snap.msgWins,
    routes: { count: e.routes.count, cursor: e.routes.cursor, hover: e.routes.hover, shown: e.routes.shown },
    pages: e.msgwin.pages,
  };
  return {
    frame,
    // ★**不做舍入**：这一项同时是回放的**时钟输入**（`TraceFrame.t`）。舍入到 3 位小数会让回放
    //   拿到与录制差 ≤0.0005ms 的时钟，而颜色的插值在舍入边界上会差 1/255 —— 实测（G3）：
    //   9000 帧里有 2 帧因这一项而"假红"。JSON 的双精度往返是精确的，保留原值即可。
    nowMs,
    engine,
    host: args.host ? { ...args.host } : { ...ZERO_HOST },
    hash: hashEngine(engine),
  };
}

// ---------------------------------------------------------------------------
// 规范化序列化 + 短哈希
// ---------------------------------------------------------------------------

/**
 * 规范化 JSON：键按字典序、数字统一成十进制、`undefined` 丢弃。
 * 为什么不能直接用 `JSON.stringify(engine)`：对象字面量的键序依赖**构造代码的书写顺序**
 * ⇒ 同一次重构挪一个字段就会让所有历史 digest 变红（假红），G1/G3 就失去意义。
 */
export function canonicalize(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null';
    return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(o[k])).join(',') + '}';
  }
  return 'null';
}

/** FNV-1a 32 位（8 hex）—— 只要稳定，不需要密码学强度。 */
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** `engine` 段的短哈希。 */
export function hashEngine(engine: DigestEngine): string {
  return fnv1a32(canonicalize(engine));
}

/** 两帧的 **engine 段**是否逐字段相等（G3 的判据；`host` 段不参与）。 */
export function engineDigestEqual(a: FrameDigest, b: FrameDigest): boolean {
  return canonicalize(a.engine) === canonicalize(b.engine);
}

// ---------------------------------------------------------------------------
// diff（失败时定位到"哪一项不同"）
// ---------------------------------------------------------------------------

/**
 * 逐字段对比两帧的 engine 段，返回可读差异列表（空 = 相等）。
 *
 * 大数组（items/meshes/msgWins）按**元素下标**给出前若干条差异，避免刷屏；
 * `items` 与 `meshes` 的比较按 handle 对齐（两张表都是按 handle 排序的 ⇒ 下标即可）。
 */
export function diffEngineDigest(a: FrameDigest, b: FrameDigest, maxEntries = 6): string[] {
  const out: string[] = [];
  const push = (s: string): void => {
    if (out.length < maxEntries) out.push(s);
  };
  const ea = a.engine;
  const eb = b.engine;
  if (a.frame !== b.frame) push(`frame: ${a.frame} vs ${b.frame}`);
  if (a.nowMs !== b.nowMs) push(`nowMs: ${a.nowMs} vs ${b.nowMs}`);
  for (const k of ['script', 'ip', 'pages'] as const) {
    if (ea[k] !== eb[k]) push(`${k}: ${JSON.stringify(ea[k])} vs ${JSON.stringify(eb[k])}`);
  }
  for (const k of Object.keys(ea.gates) as (keyof DigestGates)[]) {
    if (ea.gates[k] !== eb.gates[k]) push(`gates.${k}: ${String(ea.gates[k])} vs ${String(eb.gates[k])}`);
  }
  for (const k of Object.keys(ea.routes) as (keyof DigestEngine['routes'])[]) {
    if (ea.routes[k] !== eb.routes[k]) push(`routes.${k}: ${ea.routes[k]} vs ${eb.routes[k]}`);
  }
  for (const k of Object.keys(ea.counts) as (keyof SceneSnapshot['counts'])[]) {
    if (ea.counts[k] !== eb.counts[k]) push(`counts.${k}: ${ea.counts[k]} vs ${eb.counts[k]}`);
  }
  const lenDiff = (name: string, x: unknown[], y: unknown[]): boolean => {
    if (x.length !== y.length) {
      push(`${name}.length: ${x.length} vs ${y.length}`);
      return true;
    }
    return false;
  };
  const sameLenItems = !lenDiff('items', ea.items, eb.items);
  if (sameLenItems) {
    for (let i = 0; i < ea.items.length; i++) {
      const s1 = canonicalize(ea.items[i]);
      const s2 = canonicalize(eb.items[i]);
      if (s1 !== s2) push(`items[${i}] handle=0x${ea.items[i]!.handle.toString(16)}: ${s1} vs ${s2}`);
    }
  }
  const sameLenMeshes = !lenDiff('meshes', ea.meshes, eb.meshes);
  if (sameLenMeshes) {
    for (let i = 0; i < ea.meshes.length; i++) {
      const s1 = canonicalize(ea.meshes[i]);
      const s2 = canonicalize(eb.meshes[i]);
      if (s1 !== s2) push(`meshes[${i}] handle=0x${ea.meshes[i]!.handle.toString(16)}: ${s1} vs ${s2}`);
    }
  }
  const sameLenWins = !lenDiff('msgWins', ea.msgWins, eb.msgWins);
  if (sameLenWins) {
    for (let i = 0; i < ea.msgWins.length; i++) {
      const s1 = canonicalize(ea.msgWins[i]);
      const s2 = canonicalize(eb.msgWins[i]);
      if (s1 !== s2) push(`msgWins[${i}] win=${ea.msgWins[i]!.win}: ${s1} vs ${s2}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSONL（`--record` / `--replay` 的落盘格式）
// ---------------------------------------------------------------------------

/** 一行 digest（紧凑 JSON；键序固定 ⇒ 文件可按行 diff）。 */
export function digestToLine(d: FrameDigest): string {
  return JSON.stringify({ f: d.frame, t: d.nowMs, h: d.hash, e: d.engine, host: d.host });
}

/** 解析一行 digest；格式不对 ⇒ 抛（不要静默跳过：回放文件坏了必须立刻知道）。 */
export function digestFromLine(line: string): FrameDigest {
  const o = JSON.parse(line) as { f?: number; t?: number; h?: string; e?: DigestEngine; host?: DigestHost };
  if (typeof o.f !== 'number' || typeof o.e !== 'object' || o.e === null || typeof o.h !== 'string') {
    throw new Error(`digest 行格式不对（缺 f/e/h）：${line.slice(0, 120)}`);
  }
  return { frame: o.f, nowMs: o.t ?? 0, hash: o.h, engine: o.e, host: o.host ?? { ...ZERO_HOST } };
}
