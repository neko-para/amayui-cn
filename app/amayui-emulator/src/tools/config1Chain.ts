/**
 * **CONFIG1 链路跑手（可复用）**：`SYSTEM4 → … → LOGO → TITLE →（点 CONFIG）→ CONFIG.BIN → CONFIG1.BIN`。
 *
 * 为什么单独成模块：E3 回归（`test/config1-chain.test.ts`）与**排查工具**
 * （`npm run diag:text`，见 `src/tools/diagText.ts`）需要**同一份**链路逻辑 ——
 * 否则"测试说对、排查工具说不对"这种漂移又要花时间分辨。
 *
 * 采样：ADV 样例窗只存在很短一段（CONFIG1 紧接着有条件的 `i301 9` 清场），
 * 所以每帧采一次样，记录"窗口还有内容"那一刻的排版结果、快照文本与**遮挡分析**。
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../arch/nodeFileSource.js';
import { resolveResourceDir } from '../arch/resourceDir.js';
import { Engine, SLEEP_GATE } from '../vm/engine.js';
import { InputManager } from '../vm/input.js';
import { loadScriptData, stepOnce, NotImplementedOp, type StepTrace } from '../vm/interpreter.js';
import { ExitScript, ScriptReset } from '../vm/ops.js';
import { readIntOperand, refFromOperand } from '../vm/operand.js';
import { readRef, refAt } from '../vm/ref.js';
import type { BinInstruction } from '../script/bin.js';
import { HeadlessScene } from '../renderer/headlessScene.js';
import { itemPivotLocal, itemScale } from '../renderer/drawItem.js';
import { DropRecorder, withNativeTap, type DroppedIntent } from '../vm/nativeTap.js';
import { parseIni, applyConfigToEngine } from '../engineConfig.js';
import { dec } from '../vm/bits.js';
import type { SnapshotMsgWin } from '../renderer/sceneModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
/** 资源根 = `install/`（汉化版）；`AMAYUI_RESOURCE_DIR=raw` 可切回原版。 */
const RESOURCE_DIR = resolveResourceDir(ROOT);
const INI = path.join(ROOT, 'app', 'amayui-emulator', 'SYS4REG.INI');

/** TITLE 菜单「CONFIG」项的命中点（由 i12e 的 baseX/baseY 数组算出：第 3 项 rect [729,885]×[543,699]）。 */
export const CONFIG_XY: [number, number] = [807, 621];

/** 与文本窗相交、且层序**高于**文本层的可绘制项（非空 ⇒ 文字会被盖住，属静默缺陷）。 */
export interface CoverInfo {
  layer: number;
  handle: number;
  dst: { x: number; y: number };
  size: { w: number; h: number };
  color: string;
}

/** 滚动条拇指的一段（上盖 / 中段 / 下盖）。 */export interface ThumbSeg {
  handle: number;
  dstX: number;
  dstY: number;
  srcW: number;
  srcH: number;
  /** 求值后的缩放（`itemScale`：无窗时 = 目标矩阵）。 */
  scaleX: number;
  scaleY: number;
  /** pivot 相对项原点的局部量（`itemPivotLocal`：pivot == 描画位置时为 0）。 */
  pivotRelX: number;
  pivotRelY: number;
}

/**
 * **CONFIG1 右侧滚动条拇指**的三段式几何（`0x1FD` 立即缩放的活证据）。
 *
 * 脚本（`src/CONFIG1.txt:2934-2971`，handle = `0x1d4c0 + 0x76c…0x778`）：
 * 上盖 `27×23` → **中段 `27×1`（源只有 1px，靠 `i1fd <obj> 100 <h*100> 100` 放大）** → 下盖 `27×24`。
 * 若 `0x1FD` 未落到渲染（或 pivot 坐标系用错），中段会退回 1px 并被挪出画面 ⇒ **只剩上下两段**。
 */
export interface ScrollThumb {
  /** 脚本里的 handle 基址（`0x1d4c0`）。 */
  base: number;
  top: ThumbSeg;
  middle: ThumbSeg;
  bottom: ThumbSeg;
}

/**
 * `0x12F` 在真实脚本里的**输入/输出快照**（E3：可见行序 = 按 `B[x]+C[x]` 升序排出的索引序）。
 *
 * 为什么要在链路里抓它：`CONFIG1` 的列表顺序完全由这条指令决定，而它的两个历史错法
 * （双重编解码 / 用"位置上的值"当键）都**不报错**、只让顺序错，
 * 且"用位置上的值"还会让顺序**依赖数组残留**（首次进入与切 tab 回来不同）。
 * 有这份真实数据就能做独立复算比对（见 `test/config1-chain.test.ts`）。
 */
export interface Sort12fDump {
  /** 元素个数（`op4`）。 */
  n: number;
  /** 排序结果：索引数组 A（DEC 视角）。 */
  a: number[];
  /** 主键数组 B（按索引取值）。 */
  b: number[];
  /** 次键数组 C（按索引取值）。 */
  c: number[];
}

/**
 * **CONFIG1 设置列表的一行**（`CONFIG1.txt:2509-2520` 的可见行循环）。
 * 每行的三种图元各自成一条 handle 家族（基址 `0x1d4c0`）：
 *  - `+0x3e8+i` 行背景带 `832×40 @(320, 100+50i)`（槽 193）；
 *  - `+0x3fc+i` 数值/控件贴片 `80×30 @(332, y+5)`，**源 Y = (type−1)×31** ⇒ 源 Y < 0 就等于"这行没有描述符"；
 *  - `+0x410+i` 帮助图标 `40×40 @(285, y)`（槽 193）。
 *
 * ★`type` 来自"可见行序表"（`0x12F` 三数组排序的结果）→ 只有排序正确时每行才拿得到自己的描述符；
 * 排序一错，除第 0 行外全部读成 0 ⇒ 源 Y = −31（越界）⇒ 数值/◀▶ 控件**只有第一行画得出来**。
 */
export interface ConfigRow {
  i: number;
  /** 数值贴片（`+0x3fc+i`）的源矩形；`srcY < 0` ⇒ 该行描述符为 0（排序/搬运出错）。 */
  value: { handle: number; srcX: number; srcY: number; srcW: number; srcH: number; dstX: number; dstY: number };
  /** 该行是否画了行背景带。 */
  hasBand: boolean;
  /** 该行画了几个"控件贴片"（◀▶ / ON-OFF 那一族，handle 基址 `+0x514`/`+0x5dc`）。 */
  controls: number;
}

export interface ChainResult {
  script: string;
  unimplemented: string[];
  text: string;
  ruby: string[][];
  pane: number | undefined;
  msgField: number | undefined;
  /** ADV 样例窗的**排版结果**（内容对之外，位置/层序/字号/竖排/注音也要对）。 */
  sampleWin: SnapshotMsgWin | null;
  /** 采样那一刻的报告文本（快照里现在能看见文字）。 */
  snapshotText: string;
  /** 采样那一刻、层序高于文本层且与文本框相交的图元（**必须为空**）。 */
  coveredBy: CoverInfo[];
  /** 采样那一刻的绘制项总数 / 可绘制数（诊断）。 */
  itemCounts: { drawItems: number; drawable: number };
  /**
   * `0x300` 消息预览的**循环演示**证据（`CONFIG.txt:171 i300 9 1 3e8`）：
   * 该窗闸门状态 + 之后若干帧的"已显示字数"序列。
   *
   * 引擎语义（`sub_409400` 第一循环 raw 13838-13888）：整段贴出 → 记完成时刻 → 过 op3 ms
   * 清绘制项并把 `win+132` 归零（**闸门位仍为 1**）⇒ 下一帧从头再贴一遍，**无限循环**。
   * 因此序列里应当看到 `<全部>` → `0`（清场）→ 重新递增。
   */
  gateLoop: { enabled: boolean; autoHideMs: number; shown: number[] } | null;
  /** CONFIG1 右侧滚动条拇指的三段式几何（见 `ScrollThumb`）；没跑到那段时 null。 */
  scrollThumb: ScrollThumb | null;
  /** CONFIG1 设置列表的可见行（见 `ConfigRow`）—— `0x12F` 排序正确性的活证据。 */
  configRows: ConfigRow[];
  /** `0x204` 直绘进纹理槽的文本（每槽条数 + 抽样 + 全部文本）；CONFIG1 应当是槽 196 上的一串行文本。 */
  slotText: { slot: number; count: number; sample: string; texts: string[] }[];
  /** 最近一次 `0x12F` 的输入/输出（列表顺序的正确性判据，见 `Sort12fDump`）。 */
  sort12f: Sort12fDump | null;
  /** 宿主未实现、调用被丢弃的 native 方法（仅 `recordDrops: true` 时给出）。 */
  drops?: DroppedIntent[];
  /** 每帧的文本窗诊断行（`diag:text` 用）。 */
  trace: string[];
}

export interface ChainOptions {
  /** 只跑这么多次 `stepOnce`（保底，默认不限）。 */
  maxFrames?: number;
  /**
   * 每条被执行指令的回调（盘点用，见 `src/tools/opInventory.ts`）。
   * 默认关 —— 单次链路有数十万条指令，留一个 no-op 调用也要花时间。
   */
  onStep?: (t: StepTrace) => void;
  /** 用 `withNativeTap` 记录"脚本想调、宿主没实现"的方法（默认关；开了才付 Proxy 的代价）。 */
  recordDrops?: boolean;
}

export async function runConfig1Chain(opt: ChainOptions = {}): Promise<ChainResult> {
  const src = new NodeFileSource({ resourceDir: RESOURCE_DIR });
  const input = new InputManager();
  const scene = new HeadlessScene({});
  // 归因用：DropRecorder 需要"当前 opcode"，而 Engine 在 native 之后才建 ⇒ 用可变持有者打破循环。
  let engineRef: Engine | null = null;
  const drops = new DropRecorder(() => engineRef?.currentOpcode ?? 0);
  const e = new Engine(opt.recordDrops ? withNativeTap(scene, drops) : scene, input);
  const native = scene;
  engineRef = e;
  e.fileSource = src;
  e.config = parseIni(fs.readFileSync(INI, 'utf8'));
  applyConfigToEngine(e.config, e.engineValues);
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  const unimplemented: string[] = [];
  let clock = 0;
  // ★样例窗只存在很短一段（CONFIG1 紧接着有条件的 `i301 9` 清场）⇒ 在跑的过程中采样
  let sampleWin: SnapshotMsgWin | null = null;
  let sampleText = '';
  let coveredBy: CoverInfo[] = [];
  const trace: string[] = [];
  const maxFrames = opt.maxFrames ?? Number.POSITIVE_INFINITY;
  /** 最近一次 `0x12F` 的输入/输出（CONFIG1 的列表顺序由它决定）。 */
  let sort12f: Sort12fDump | null = null;
  /** 单步 + 可选的盘点回调（`onStep` 关闭时与直接 `stepOnce` 等价）。 */
  const stepAll = async (): Promise<void> => {
    const f = e.curScript();
    const instr = f.script?.instructions[f.ip];
    const t = await stepOnce(e);
    opt.onStep?.(t);
    if (instr && t.opcode === 0x12f) sort12f = captureSort12f(e, instr);
  };
  const sampleNow = (): void => {
    const f = native.scene.msgWins.get(9);
    // ★`0x300` 闸门会让样例"贴出 → 停留 op3 ms → 消失 → 再来一遍"**循环**：
    //   只在**整段贴出**的那一帧采样，否则采到的是循环中途（revealed=0）的态。
    const fullyShown = f ? f.revealed < 0 || f.revealed >= f.glyphCount : false;
    if (f && f.glyphCount > 0 && (fullyShown || !sampleWin)) {
      sampleWin = native.snapshot().msgWins.find((w) => w.win === 9) ?? sampleWin;
      // 快照文本也要在"窗口还有内容"的那一刻取（CONFIG1 紧接着有条件的 `i301 9` 清场）
      sampleText = native.snapshotText();
      // ★"文字会不会被盖住"不变量：与文本框相交且层序更高的可绘制项必须为空
      const layer = f.style.itemId > 0 ? f.style.itemId : 20 + 9;
      coveredBy = native
        .snapshot()
        .drawItems.filter(
          (d) =>
            d.drawable &&
            d.layer > layer &&
            parseInt(d.color.slice(1, 3), 16) > 0 &&
            d.dst.x <= f.style.x + f.style.w &&
            d.dst.x + d.src.w >= f.style.x &&
            d.dst.y <= f.style.y + f.style.h &&
            d.dst.y + d.src.h >= f.style.y,
        )
        .map((d) => ({ layer: d.layer, handle: d.handle, dst: d.dst, size: { w: d.src.w, h: d.src.h }, color: d.color }));
      trace.push(
        `[采样] ${native.scene.msgWins.size} 个文本窗；窗 9：层序=${layer} 行=${f.lines.length} 字=${f.glyphCount} ` +
          `竖排=${f.style.vertical} 遮挡项=${coveredBy.length}`,
      );
      trace.push(
        `[采样] 窗9 层序=${layer} 图元=${native.scene.drawItems.size} 文本窗=${native.scene.msgWins.size}` +
          (coveredBy.length ? ` ★被 ${coveredBy.length} 个更高层图元遮挡` : ''),
      );
    }
  };
  /**
   * 跑到 `until()` 为真或达到帧上限。
   * ★不要用「固定跑 N 帧」——那会在已经到达目标后继续空转，把测试拖到几十秒。
   */
  const run = async (frames: number, until?: () => boolean): Promise<number> => {
    const cap = Math.min(frames, maxFrames);
    for (let i = 0; i < cap; i++) {
      if (until?.()) return i;
      e.nowMs = clock;
      // ★`0x300` 每窗「逐行贴出」闸门（CONFIG 消息预览的循环演示）——引擎主循环每帧都跑
      e.serviceWinReveal(e.nowMs);
      if (e.waitFlags & 0x400) e.waitFlags &= ~0x400;
      else if (e.waitFlags & SLEEP_GATE) {
        if (clock >= e.sleepUntil) e.waitFlags &= ~SLEEP_GATE;
      } else if (e.textRevealing) e.serviceTextReveal(e.nowMs);
      else if (e.awaitingAdvance) e.forceAdvance();
      else if (e.advActive) {
        e.serviceAdv();
        try {
          await stepAll();
        } catch {
          /* ADV 分支的异常按"本帧无进展"处理 */
        }
      } else {
        for (let k = 0; k < 5000; k++) {
          const f = e.curScript();
          if (!f.script || f.ip >= f.script.instructions.length) return i;
          try {
            await stepAll();
          } catch (err) {
            if (err instanceof ExitScript || err instanceof ScriptReset) return i;
            if (err instanceof NotImplementedOp) {
              // ★不登记用户桩：未实现 opcode 必须让测试失败，而不是被静默放行
              uninplementedPush(unimplemented, err);
              return i;
            }
            throw err;
          }
          if (e.waitFlags & (0x400 | SLEEP_GATE) || e.awaitingAdvance) break;
        }
      }
      sampleNow();
      clock += 1000 / 60;
    }
    return maxFrames;
  };

  const onTitle = () => e.curScript().name.startsWith('TITLE');
  const onConfig1 = () => e.curScript().name.startsWith('CONFIG1');
  // 启动 → LOGO → TITLE。★帧上限只是兜底：`until` 命中即返回（实测到 TITLE 只需 ~20 帧，
  //   但 TITLE 的 `sleep 1` 让步使 1 帧≈1 条指令，所以补一段固定帧让它把菜单/hover 状态初始化完）。
  assert.ok((await run(4000, onTitle)) < 4000, '应在帧上限内到达 TITLE');
  assert.ok(onTitle(), `应停在 TITLE，实际 ${e.curScript().name}`);
  await run(4000); // TITLE 初始化（与 title-exit.test.ts 同口径）
  const hover = (): number => dec(e.key, e.curScript().locals.int.get(0x3f7) ?? 0);
  input.setCursor(...CONFIG_XY);
  await run(2000, () => hover() === 3);
  assert.equal(hover(), 3, '悬停点应命中 TITLE 菜单第 3 项（CONFIG）');
  input.pressMouse(0);
  await run(400); // 按住期间让 VM 轮询到
  input.releaseMouse(0);
  await run(4000, onConfig1); // CONFIG.BIN → CONFIG1.BIN
  assert.ok(onConfig1(), `应进入 CONFIG1，实际 ${e.curScript().name}`);
  // CONFIG1 里继续跑到"ADV 样例窗口"被执行（文本槽被写入）
  await run(4000, () => e.msgwin.slots.size > 0);
  // ★`CONFIG.txt:171 i300 9 1 3e8` 让这个样例窗走闸门泵：先跑到整段贴出（采样才有意义），
  //   再跑一段观察**循环**（贴出 → 停留 1000ms → 清场 → 重新贴出）。
  await run(600, () => {
    const r = e.msgwin.revealedOf(9);
    return r < 0 || r >= 19;
  });
  const gate = e.msgwin.gates.get(9);
  const shownSeq: number[] = [];
  for (let i = 0; i < 90; i++) {
    await run(1);
    const r = e.msgwin.revealedOf(9);
    shownSeq.push(r < 0 ? 19 : r);
  }
  const gateLoop = { enabled: gate?.enabled === true, autoHideMs: gate?.autoHideMs ?? 0, shown: shownSeq };

  // ★滚动条拇指（`0x1FD` 的回归不变量）：三段式几何必须首尾相接。
  const scrollThumb = collectScrollThumb(e, native);
  // ★设置列表的可见行（`0x12F` 排序正确性的回归不变量）+ 直绘进槽的文本（`0x204`）
  const configRows = collectConfigRows(native);
  const slotText = [...native.scene.slotText.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, list]) => ({
      slot,
      count: list.length,
      sample: list[0]?.text ?? '',
      texts: list.map((t) => t.text),
    }));

  const m = e.msgwin;
  const out = {
    script: e.curScript().name,
    unimplemented,
    text: m.textOf(0),
    ruby: m.slot(m.resolveWin(0)).segments.flatMap((s) => s.ruby) as unknown as string[][],
    pane: e.engineValues.get(21631),
    msgField: e.engineValues.get(80101),
    sampleWin,
    snapshotText: sampleText,
    coveredBy,
    itemCounts: { drawItems: native.scene.drawItems.size, drawable: [...native.scene.drawItems.values()].filter((i) => (i.flags & 1) !== 0).length },
    gateLoop,
    scrollThumb,
    configRows,
    slotText,
    sort12f,
    ...(opt.recordDrops ? { drops: drops.list() } : {}),
    trace,
  };
  await src.dispose?.();
  return out;
}

/**
 * 抓一次 `0x12F`（`i12f A B C n`）的输入/输出：按三个指针操作数取基址，读回 A/B/C 的**解码值**。
 * 只在链路里出现一次（CONFIG1 建可见项表时），所以"最后一次"就是那一次。
 */
function captureSort12f(e: Engine, instr: BinInstruction): Sort12fDump | null {
  try {
    const frame = e.curScript();
    const a = refFromOperand(e, frame, instr, 1);
    const b = refFromOperand(e, frame, instr, 2);
    const cc = refFromOperand(e, frame, instr, 3);
    const n = readIntOperand(e, frame, instr, 4);
    if (n <= 0 || n > 4096) return null;
    const dump = (r: ReturnType<typeof refFromOperand>): number[] =>
      Array.from({ length: n }, (_, i) => readRef(e, frame, refAt(r, i)));
    return { n, a: dump(a), b: dump(b), c: dump(cc) };
  } catch {
    return null; // 诊断用：取不到就算了，不影响链路
  }
}

/** 取滚动条拇指三段（`CONFIG1.txt:2934-2971` 的 handle 布局：`0x1d4c0 + 0x76c / 0x776 / 0x777 / 0x778`）。 */
function collectScrollThumb(e: Engine, native: HeadlessScene): ScrollThumb | null {
  const base = 0x1d4c0;
  const seg = (off: number): ThumbSeg | null => {
    const it = native.scene.drawItems.get(base + off);
    if (!it) return null;
    const sc = itemScale(it, e.nowMs);
    const pv = itemPivotLocal(it);
    return {
      handle: it.handle,
      dstX: it.posX,
      dstY: it.posY,
      srcW: it.srcW,
      srcH: it.srcH,
      scaleX: sc.x,
      scaleY: sc.y,
      pivotRelX: pv.x,
      pivotRelY: pv.y,
    };
  };
  const top = seg(0x776);
  const middle = seg(0x777);
  const bottom = seg(0x778);
  if (!top || !middle || !bottom) return null;
  return { base, top, middle, bottom };
}

/**
 * 取设置列表的可见行（`CONFIG1.txt:2509-2520` 的每行三种图元）：
 * 行背景 `+0x3e8+i`、数值贴片 `+0x3fc+i`、控件贴片 `+0x514/+0x528/+0x5dc/+0x5f0 +i`。
 * 行数不写死：以"实际存在的数值贴片"为准（脚本用 `local5622` 决定画几行）。
 */
function collectConfigRows(native: HeadlessScene): ConfigRow[] {
  const base = 0x1d4c0;
  const rows: ConfigRow[] = [];
  for (let i = 0; i < 32; i++) {
    const v = native.scene.drawItems.get(base + 0x3fc + i);
    if (!v) break;
    let controls = 0;
    for (const off of [0x514, 0x528, 0x5dc, 0x5f0]) if (native.scene.drawItems.has(base + off + i)) controls++;
    rows.push({
      i,
      value: { handle: v.handle, srcX: v.srcX, srcY: v.srcY, srcW: v.srcW, srcH: v.srcH, dstX: v.posX, dstY: v.posY },
      hasBand: native.scene.drawItems.has(base + 0x3e8 + i),
      controls,
    });
  }
  return rows;
}

function uninplementedPush(list: string[], err: NotImplementedOp): void {
  list.push(`0x${err.opcode.toString(16)} ${err.name} @${err.scriptName}`);
}

