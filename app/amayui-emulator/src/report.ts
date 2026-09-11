/**
 * **场景执行报告**（`npm run report -- …`）：在 Node 里跑一段真实脚本，产出「这场景到底发生了什么」的结构化报告。
 *
 * 为什么需要它：`traceAll` 是全局开关、一开刷屏、只给人看；而定位渲染问题时最需要的恰恰是
 * 「**这个场景跑了哪些 op、各多少次、带什么实参、最终模型长什么样、哪些意图被丢弃了**」。
 *
 * 产出（默认写到 `.tmp/`）：
 *  - `<name>.jsonl`  每执行一条指令一行 JSON（可用 `--ops` 白名单收窄）→ 可被脚本化分析；
 *  - `<name>.json`   汇总：per-op 计数 / 能力缺口 / 丢弃的意图 / 纹理槽表 / CG 记录 / 引擎字段 / 最终快照；
 *  - `<name>.txt`    人可读的模型快照（快照回归里真正被 diff 的东西）。
 *
 * 设计要点：
 *  - **确定性时钟**：`--frame-ms` 每遇到一个"帧指令"（`0x1F4`/`0x20C`/`0x23C`）就把虚拟时钟推进固定毫秒，
 *    并驱动一次场景窗推进。这样同一条脚本跑两次的报告**逐字节一致**，可以直接进仓库做回归；
 *  - **无 Electron**：宿主是 `HeadlessScene`（共用 `sceneModel.ts` 语义），并用 `withNativeTap` 把
 *    "宿主没实现的调用"记成事件 ⇒ 缺口清单是**跑出来的**，不是猜的。
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from './arch/nodeFileSource.js';
import { Engine } from './vm/engine.js';
import { loadScriptData, stepOnce, NotImplementedOp, type StepTrace } from './vm/interpreter.js';
import { ExitScript, ScriptReset } from './vm/ops.js';
import { DropRecorder, withNativeTap } from './vm/nativeTap.js';
import { HeadlessScene } from './renderer/headlessScene.js';
import type { NativeBridge } from './vm/native.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DEFAULT_RAW = path.join(REPO_ROOT, 'raw');
const OUT_DIR = path.join(REPO_ROOT, '.tmp');

/** 一帧的"指令"：引擎的帧时钟/刷新/停靠锁。遇到它们 ⇒ 推进一次虚拟时钟 + 驱动一次场景窗。 */
const FRAME_OPS = new Set([0x1f4, 0x20c, 0x23c]);

export interface ReportOptions {
  /** 起始脚本索引（0 = SYSTEM4.BIN）。 */
  script: number;
  /** 最多执行多少条指令。 */
  steps: number;
  /** 输出名（不含扩展名），默认 `scene-report`。 */
  name?: string;
  /** 只把这些 opcode 写进 JSONL（空 = 全部）。十进制或 0x 前缀。 */
  ops?: number[];
  /** 每"帧"推进的毫秒数（默认 16）。设 0 = 时钟恒 0（不推进动画窗）。 */
  frameMs?: number;
  /** 每帧最多跑多少条指令（防一条脚本里没有帧指令时报告跑飞）。 */
  maxStepsPerFrame?: number;
  /** raw 目录。 */
  rawDir?: string;
  /** 是否解析图像尺寸（`0x208` getter 用；需要 AGF 解码器）。 */
  resolveImages?: boolean;
  /** 是否把 JSONL/JSON 写到磁盘（测试里设 false 只取内存结果）。 */
  write?: boolean;
  /** 日志回调。 */
  onLog?: (m: string) => void;
}

export interface SceneReport {
  meta: {
    script: string;
    steps: number;
    clockMs: number;
    frames: number;
    stopReason: string;
    opFilter: string[];
    /**
     * **等待推进门自动放行次数**（headless 无输入源）。
     * 引擎在 `wait-for-input` 后会挂起等玩家推进；报告里改为"确定性自动推进"（每次等待放行 1 帧），
     * 否则脚本永不前进、报告会跑飞。该计数 = 剧本里被跳过的"等玩家点击"次数。
     */
    advanceWaits: number;
  };
  /** opcode → { name, count }（十六进制 key，升序）。 */
  opCounts: Record<string, { name: string; count: number }>;
  /** 被当作 no-op 跳过、但收到非平凡实参的 opcode（**能力缺口**）。 */
  gaps: { opcode: string; name: string; count: number; sample: string[] }[];
  /** 宿主未实现、调用被静默丢弃的 native 方法（**闸门 A**）。 */
  droppedIntents: { method: string; count: number; sample: string; opcodes: string[]; why: string }[];
  /** headless 宿主自己声明的语义缺口（如程序化纹理尺寸未知）。 */
  headlessGaps: { what: string; count: number; sample: string }[];
  /** 纹理槽绑定表（槽 ← set-texture 的 imgid）。 */
  slots: { slot: number; imgid: number; procedural: boolean }[];
  /** CG 数字条记录（0x2DA 登记）。 */
  cgDigits: { n: number; rec: number[] }[];
  /** 引擎字段（稀疏 `_this[K]`；只导出我们真的写过的）。 */
  engineFields: { field: number; hex: string; value: number }[];
  /** 未在 OPS/NATIVE/ENGINE_INTERNAL 中登记、被用户桩跳过的 opcode。 */
  skippedUnknown: string[];
  snapshot: ReturnType<HeadlessScene['snapshot']>;
}

/** 执行一次场景并产出报告（纯函数式：不写盘，除非 `write !== false`）。 */
export async function runSceneReport(opt: ReportOptions): Promise<{ report: SceneReport; jsonl: string[]; snapshotText: string }> {
  const rawDir = opt.rawDir ?? DEFAULT_RAW;
  const name = opt.name ?? 'scene-report';
  const frameMs = opt.frameMs ?? 16;
  const maxStepsPerFrame = opt.maxStepsPerFrame ?? 4096;
  const src = new NodeFileSource({ rawDir });

  // 图像尺寸解析（可选）：动态载入仓库根的 AGF 解码器；失败则退回"未解析"（并记缺口）。
  let imageSize: ((imgid: number) => { w: number; h: number } | null) | undefined;
  if (opt.resolveImages) {
    try {
      const mod = (await import(path.join(REPO_ROOT, 'scripts', 'agf', 'format.js'))) as {
        decodeAgfRgba?: (b: Uint8Array) => { width: number; height: number } | null;
      };
      if (mod.decodeAgfRgba) {
        const decode = mod.decodeAgfRgba.bind(mod);
        imageSize = (imgid: number) => {
          // 同步解析不可行（readById 是异步）⇒ 这里退化为"未解析"，由 CLI 预热缓存后替换。
          void decode;
          void imgid;
          return null;
        };
      }
    } catch {
      /* 解码器不可用 ⇒ 走"未解析"路径并记缺口 */
    }
  }

  const headless = new HeadlessScene({ imageSize, ...(opt.onLog ? { onLog: opt.onLog } : {}) });
  const engineRef: { e?: Engine } = {};
  const drops = new DropRecorder(() => engineRef.e?.currentOpcode ?? 0);
  const native: NativeBridge = withNativeTap(headless as object, drops) as NativeBridge;
  const e = new Engine(native);
  engineRef.e = e;
  e.fileSource = src;

  const boot = await src.readScript(opt.script);
  if (!boot) throw new Error(`无法装载脚本索引 ${opt.script}`);
  loadScriptData(e, boot.data, boot.name);

  const opFilter = opt.ops && opt.ops.length > 0 ? new Set(opt.ops) : null;
  const opCounts = new Map<number, { name: string; count: number }>();
  const gaps = new Map<number, { name: string; count: number; sample: string[] }>();
  const jsonl: string[] = [];
  let steps = 0;
  let frames = 0;
  let clock = 0;
  let stopReason = 'steps-limit';
  let stepsThisFrame = 0;
  let advanceWaits = 0;

  while (steps < opt.steps) {
    const f = e.curScript();
    if (!f.script || f.ip >= f.script.instructions.length) {
      stopReason = 'script-end';
      break;
    }
    e.nowMs = clock;
    // ★帧循环服务（与 renderer session 同构，见 src/vm/engine.ts 的 serviceAdv/serviceAdvanceWait）：
    //  1) 等待推进门：headless 无输入源 ⇒ 确定性放行 1 帧（计数），期间不派发指令；
    //  2) ADV 分支：先跑每帧服务（输入泵 + 「未显示完」判定，可能清掉 ADV 位）；
    //  3) `0x300` 每窗「逐行贴出」闸门（CONFIG 消息预览的循环演示）——引擎主循环每帧都跑。
    e.serviceWinReveal(clock);
    // ★逐字显现：按确定性时钟推进（与 renderer session 的 `text-reveal` 分支同构）
    if (e.textRevealing) {
      e.serviceTextReveal(clock);
      frames++;
      clock += frameMs;
      headless.advance(clock);
      continue;
    }
    if (e.awaitingAdvance) {
      advanceWaits++;
      e.forceAdvance(); // 走热点路由：跳到该热点的 label（与真实点击同一路径）
      frames++;
      clock += frameMs;
      headless.advance(clock);
      continue;
    }
    const advFrame = e.advActive;
    if (advFrame) e.serviceAdv();
    let t: StepTrace;
    try {
      t = await stepOnce(e);
    } catch (err) {
      if (err instanceof ExitScript) { stopReason = 'exit-script'; break; }
      if (err instanceof ScriptReset) { stopReason = 'reset'; break; }
      if (err instanceof NotImplementedOp) { stopReason = `unimplemented 0x${err.opcode.toString(16)}`; break; }
      stopReason = `error: ${(err as Error).message}`;
      break;
    }
    steps++;
    const hex = `0x${t.opcode.toString(16)}`;
    const c = opCounts.get(t.opcode);
    if (c) c.count++;
    else opCounts.set(t.opcode, { name: t.name, count: 1 });
    if (t.gap) {
      const g = gaps.get(t.opcode);
      if (g) { g.count++; g.sample = t.gap.operands; }
      else gaps.set(t.opcode, { name: t.name, count: 1, sample: t.gap.operands });
    }
    if (opFilter === null || opFilter.has(t.opcode)) {
      jsonl.push(
        JSON.stringify({
          step: steps,
          script: t.script,
          ip: t.ip,
          op: hex,
          name: t.name,
          kind: t.handlerKind,
          operands: t.operands,
          ...(t.gap ? { gap: true } : {}),
          clock,
        }),
      );
    }

    // 帧边界：推进虚拟时钟 + 驱动一次场景窗（确定性）。
    // ADV 分支下引擎是"每帧恰好 1 条"，因此该分支的每条指令都算一帧。
    if (FRAME_OPS.has(t.opcode) || advFrame) {
      frames++;
      stepsThisFrame = 0;
      clock += frameMs;
      headless.advance(clock);
    } else if (++stepsThisFrame > maxStepsPerFrame) {
      // 脚本里长时间没有帧指令（或死循环）⇒ 仍按帧推进，避免动画窗永远不前进
      frames++;
      stepsThisFrame = 0;
      clock += frameMs;
      headless.advance(clock);
    }
  }
  headless.advance(clock);

  const report: SceneReport = {
    meta: {
      script: boot.name,
      steps,
      clockMs: clock,
      frames,
      stopReason,
      opFilter: opFilter ? [...opFilter].map((o) => `0x${o.toString(16)}`) : [],
      advanceWaits,
    },
    opCounts: Object.fromEntries(
      [...opCounts].sort((a, b) => a[0] - b[0]).map(([op, v]) => [`0x${op.toString(16)}`, v]),
    ),
    gaps: [...gaps]
      .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
      .map(([op, v]) => ({ opcode: `0x${op.toString(16)}`, name: v.name, count: v.count, sample: v.sample })),
    droppedIntents: drops.list(),
    headlessGaps: [...headless.unmodeled].sort((a, b) => b.count - a.count),
    slots: headless.slotTable(),
    cgDigits: [...e.cgDigits].sort((a, b) => a[0] - b[0]).map(([n, rec]) => ({ n, rec })),
    engineFields: [...e.engineValues]
      .filter(([k]) => k >= 0)
      .sort((a, b) => a[0] - b[0])
      .map(([field, value]) => ({ field, hex: `0x${field.toString(16)}`, value })),
    skippedUnknown: [...e.unknownOpStubs.keys()].sort((a, b) => a - b).map((o) => `0x${o.toString(16)}`),
    snapshot: headless.snapshot(),
  };
  const snapshotText = headless.snapshotText();

  if (opt.write !== false) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `${name}.jsonl`), jsonl.join('\n') + (jsonl.length ? '\n' : ''));
    fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_DIR, `${name}.txt`), snapshotText);
  }
  await src.dispose?.();
  return { report, jsonl, snapshotText };
}

/** 人可读的一行摘要（CLI 与测试都用它）。 */
export function summarizeReport(r: SceneReport): string {
  const L: string[] = [];
  L.push(`脚本 ${r.meta.script}：执行 ${r.meta.steps} 条指令 / ${r.meta.frames} 帧 / 时钟 ${r.meta.clockMs}ms（${r.meta.stopReason}）`);
  if (r.meta.advanceWaits > 0) L.push(`等待推进门自动放行 ${r.meta.advanceWaits} 次（headless 无输入源 ⇒ 确定性放行）`);
  L.push(`命中 opcode ${Object.keys(r.opCounts).length} 种；模型：drawItems=${r.snapshot.counts.drawItems} meshes=${r.snapshot.counts.meshes} 可见=${r.snapshot.counts.visibleItems} 播放中=${r.snapshot.counts.pendingItems}`);
  L.push(`纹理槽绑定 ${r.slots.length} 个；CG 数字条记录 ${r.cgDigits.length} 条`);
  L.push(`★ 能力缺口（被忽略但收到实参）${r.gaps.length} 种：` + (r.gaps.slice(0, 12).map((g) => `${g.name}×${g.count}`).join(' ') || '无'));
  L.push(`★ 意图被丢弃（宿主未实现的 native）${r.droppedIntents.length} 种：` + (r.droppedIntents.slice(0, 12).map((d) => `${d.method}×${d.count}`).join(' ') || '无'));
  L.push(`★ headless 语义缺口 ${r.headlessGaps.length} 种：` + (r.headlessGaps.slice(0, 8).map((g) => `${g.what}×${g.count}`).join(' ') || '无'));
  return L.join('\n');
}

// ---- CLI ----

function parseOps(s: string | undefined): number[] | undefined {
  if (!s) return undefined;
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x.startsWith('0x') || x.startsWith('0X') ? x : `0x${x}`))
    .filter((n) => Number.isFinite(n));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const opts: ReportOptions = {
    script: Number(arg('script') ?? 0),
    steps: Number(arg('steps') ?? 200_000),
    name: arg('name') ?? 'scene-report',
    frameMs: Number(arg('frame-ms') ?? 16),
    write: true,
    resolveImages: argv.includes('--resolve-images'),
  };
  const ops = parseOps(arg('ops'));
  if (ops) opts.ops = ops;
  const raw = arg('raw');
  if (raw) opts.rawDir = raw;

  console.log(`[report] script=${opts.script} steps=${opts.steps} frame-ms=${opts.frameMs} ops=${arg('ops') ?? '全部'}`);
  const { report } = await runSceneReport(opts);
  console.log('\n' + summarizeReport(report));
  console.log(`\n[report] 已写出 .tmp/${opts.name}.json / .jsonl / .txt`);
}

// 仅在直接执行时跑 CLI（被 import 时不跑）
if (process.argv[1] && path.resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === fileURLToPath(import.meta.url).replace(/\.(ts|js)$/, '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
