/**
 * **回放轨迹（trace）** —— G3 的载体：把 Electron 的一次真实运行录成"时钟 + 输入 + 逐帧 digest"，
 * 再让 headless 复现同一序列（`tickets/T-0005` 的 B5 / 设计文档 §4 的 G3）。
 *
 * ## 为什么用"录制—回放"而不是"让 Electron 变确定性"
 * Electron 的时钟是墙钟、输入是真人/`sendInputEvent`、动画要真时间（设计文档 §4）。把它变确定性
 * 等于**改产品行为**。回放把"时间"与"输入"变成**输入数据**：确定性只存在于 headless 侧。
 *
 * ## 格式（JSONL，一行一条；`--record` 写、`--replay` 读）
 * ```jsonc
 * {"kind":"header","v":1,"scenario":"gamestart","script":0,"note":"…"}
 * {"kind":"frame","f":0,"t":0,"input":{…InputSnapshot…},"digest":{…FrameDigest…}}
 * ```
 * - `t` = 该帧的**时钟**（`Engine.nowMs`）⇒ 回放的 `clock: {kind:'replay', samples}` 直接用它；
 * - `input` = 该帧**帧首**的输入状态 ⇒ 回放每帧 `restore()`（见 `InputManager.snapshot` 的说明：
 *   脚本是轮询式读输入，帧首状态足以复现整帧的每次读取）；
 * - `digest` = 该帧的对外表现（`frame/digest.ts`）⇒ 逐帧比对 `engine` 段。
 *
 * ★**只比 `engine` 段**：`host` 段（屏障次数/音频意图/缺字）本来就是"宿主义务履行量"，
 * 两宿主天然不同（设计文档 §4 的"可执行定义"）。
 */
import type { Engine } from '../vm/engine.js';
import type { InputManager, InputSnapshot } from '../vm/input.js';
import { digestFromLine, engineDigestEqual, diffEngineDigest, type FrameDigest } from './digest.js';
import { mergeObservers, type FrameObservation, type FrameObserver } from './observer.js';
import { runScenario, type ScenarioSpec } from './scenario.js';
import type { FrameHost } from './host.js';
import type { FrameLoopGates } from './loop.js';

export interface TraceHeader {
  kind: 'header';
  v: 1;
  /** Scenario 名（与 `--scenario` 的那份同名 ⇒ 两边说的是同一件事）。 */
  scenario: string;
  /** 启动脚本索引。 */
  script: number;
  /** 时钟策略（录制侧恒为 `wall`；回放侧由本文件生成 `replay`）。 */
  clock: 'wall';
  /**
   * **驱动策略**（录下来 ⇒ 回放用同一份帧纪律）。
   *
   * ★为什么必须录：`maxStepsPerFrame` 决定"一帧派发多少条"，而它直接影响帧边界
   * （批跑满就换帧）⇒ 两边不一致时帧号会整体错位。产品的值是 10000，但**不许**在回放侧
   * 用"我觉得是 10000"来假设 —— 录制值才是真源（`T-0002` 的教训：批上限是宿主策略，不是引擎语义）。
   */
  policy?: { maxStepsPerFrame?: number; gates?: FrameLoopGates };
  /** 启动前的主进程/宿主侧摘要（人看；不参与比对）。 */
  note?: string;
}

export interface TraceFrame {
  kind: 'frame';
  /** 帧号（0 起，与驱动 `FrameLoopResult.frames` 同口径）。 */
  f: number;
  /** 该帧时钟（ms）。 */
  t: number;
  input: InputSnapshot;
  digest: FrameDigest;
  /**
   * **本帧 `0x208`（纹理尺寸）的答案**（宿主给出的，按调用顺序）。
   *
   * ★为什么它也算"输入"：这个答案在录制侧依赖宿主的加载状态（IPC 异步 ⇒ 图还没到就是 0×0），
   * 而脚本拿它算源矩形/描画位置 ⇒ **它直接改变场景状态**（G3 实测：SN0000 背景的 src/dst 全不同）。
   * headless 没有纹理加载过程，"自己解析 AGF"只是对那个异步答案的近似 ⇒ 录下来、按帧喂回去。
   * 让 headless 自带解析是独立事项（`tickets/T-0005/notes.md` 的缺口）。
   */
  tex?: { slot: number; w: number; h: number }[];
}

export type TraceLine = TraceHeader | TraceFrame;

export function headerToLine(h: TraceHeader): string {
  return JSON.stringify(h);
}

export function frameToLine(f: TraceFrame): string {
  return JSON.stringify(f);
}

/** 解析一份 trace；坏行**抛**（回放文件坏了必须立刻知道，不许静默跳过）。 */
export function parseTrace(text: string): { header: TraceHeader | null; frames: TraceFrame[] } {
  const frames: TraceFrame[] = [];
  let header: TraceHeader | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const o = JSON.parse(line) as TraceLine;
    if (o.kind === 'header') {
      header = o;
    } else if (o.kind === 'frame') {
      if (typeof o.f !== 'number' || typeof o.t !== 'number' || !o.input || !o.digest) {
        throw new Error(`trace frame 行缺字段（f/t/input/digest）：${line.slice(0, 120)}`);
      }
      frames.push(o);
    } else {
      throw new Error(`trace 行 kind 非法：${line.slice(0, 120)}`);
    }
  }
  return { header, frames };
}

// ---------------------------------------------------------------------------
// 录制（Electron / headless 通用：只依赖注入的 `write`）
// ---------------------------------------------------------------------------

export interface TraceRecorderOptions {
  scenario: string;
  script: number;
  /** 落盘一行（Electron：`window.api.appendReplayLine`；Node：直接追加文件）。 */
  write: (line: string) => void;
  /** 驱动策略（会写进头，回放侧照用；见 `TraceHeader.policy`）。 */
  policy?: { maxStepsPerFrame?: number; gates?: FrameLoopGates };
  /** 取走"本帧 `0x208` 的答案"（宿主侧；见 `TraceFrame.tex`）。不给 = 不录纹理尺寸。 */
  drainTextureSizes?: () => { slot: number; w: number; h: number }[] | undefined;
  note?: string;
}

/**
 * **录制观察者**：帧首取输入快照、帧末落一条 `frame` 行。
 *
 * ★为什么帧首取输入：这一帧的所有读取（`0x101`/`0x108`/`0x109`/`0x10D`/`0xCD`）看到的都是这份状态，
 * 而它们大多是**读时消费**（边沿/保持位/滚轮）⇒ 只有帧首状态能整帧复现（见 `InputManager.snapshot`）。
 */
export class TraceRecorder implements FrameObserver {
  /** 要 digest（每条 frame 行都要带一份）。 */
  readonly wantsDigest = true;
  readonly header: TraceHeader;
  frames = 0;

  #input: InputSnapshot | null = null;

  constructor(private readonly opt: TraceRecorderOptions) {
    this.header = {
      kind: 'header',
      v: 1,
      scenario: opt.scenario,
      script: opt.script,
      clock: 'wall',
      ...(opt.policy ? { policy: opt.policy } : {}),
      ...(opt.note ? { note: opt.note } : {}),
    };
  }

  /** 写头（在开始跑之前调用一次）。 */
  start(): void {
    this.opt.write(headerToLine(this.header));
  }

  onFrameStart(o: FrameObservation): void {
    this.#input = o.e.input.snapshot();
  }

  onPresent(o: FrameObservation & { digest: FrameDigest }): void {
    if (!this.#input) return;
    this.frames++;
    // ★纹理尺寸的答案也属于"这一帧的宿主输入"（见 `TraceFrame.tex`）；在帧末取走 ⇒ 一条只属于一帧。
    const tex = this.opt.drainTextureSizes?.();
    this.opt.write(
      frameToLine({
        kind: 'frame',
        f: o.digest.frame,
        t: o.digest.nowMs,
        input: this.#input,
        digest: o.digest,
        ...(tex && tex.length > 0 ? { tex } : {}),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 回放（headless）
// ---------------------------------------------------------------------------

/** 一份 trace → 一份 Scenario（时钟 = 录下来的采样；输入由每帧快照恢复，故 `events` 为空）。 */
export function traceToSpec(header: TraceHeader | null, frames: TraceFrame[], name = 'replay'): ScenarioSpec {
  return {
    name: header?.scenario ?? name,
    ...(header ? { boot: { script: header.script } } : {}),
    clock: { kind: 'replay', samples: frames.map((f) => f.t) },
    // ★驱动策略照抄录制侧（批上限决定帧边界；用"默认值"会让帧号整体错位）。
    ...(header?.policy?.maxStepsPerFrame !== undefined ? { maxStepsPerFrame: header.policy.maxStepsPerFrame } : {}),
    ...(header?.policy?.gates ? { gates: header.policy.gates } : {}),
    maxFrames: Math.max(1, frames.length + 8), // 多给几帧：让"回放比录制多跑/少跑"也能被发现
    events: [],
  };
}

export interface ReplayResult {
  /** 回放产出（帧数可能与录制不同 ⇒ 见 `counts`）。 */
  digests: FrameDigest[];
  /** 逐帧比对结果。 */
  compared: number;
  /** 第一条不一致的帧号（`-1` = 已比对的帧全等）。 */
  firstDiffFrame: number;
  /** 不一致的帧号列表（最多留 20 条，够定位）。 */
  diffFrames: number[];
  /** 每帧不一致的具体字段（只在 `firstDiffFrame` 那帧收集）。 */
  firstDiff: string[];
  /** 录制帧数 / 回放帧数。 */
  counts: { recorded: number; replayed: number };
  /**
   * **回放比录制多跑了几帧**（不算失败：录制只是"录到那时为止"，多出来的帧没有被比对的依据）。
   * 它仍然是有用信息：说明两边的停止点不同（例如策略不一致）。
   */
  extraFrames: number;
  /** 是否算通过（判据的唯一实现 ⇒ CLI 与测试用同一口径）。 */
  ok: boolean;
}

/**
 * **回放一份 trace**：同一份 Scenario 定义 + 录下来的时钟与输入 ⇒ 复现同一 digest 序列。
 *
 * `host` 由调用方给（headless 用 `headlessFrameHost(scene)`）——本函数不碰宿主实现，
 * 因此它对"两个宿主"是同一段代码（这正是 G3 想说的：**跑的是同一件事**）。
 */
export async function runReplay(o: {
  e: Engine;
  host: FrameHost;
  header: TraceHeader | null;
  frames: TraceFrame[];
  /** 额外观察者（可选）。 */
  observer?: FrameObserver;
  /** 每帧的 digest 收集（默认只比不存）。 */
  onDigest?: (d: FrameDigest) => void;
  /**
   * **帧初恢复"宿主输入"**（输入快照总是恢复；这里给调用方补别的宿主输入）。
   * 目前唯一的用例：把录下来的 `0x208` 答案喂回 headless 宿主（`TraceFrame.tex`）。
   */
  restoreHostInput?: (rec: TraceFrame | undefined, e: Engine) => void;
}): Promise<ReplayResult> {
  const spec = traceToSpec(o.header, o.frames);
  const digests: FrameDigest[] = [];
  const byFrame = new Map<number, TraceFrame>();
  for (const f of o.frames) byFrame.set(f.f, f);

  const input: InputManager = o.e.input;
  const collector: FrameObserver = {
    wantsDigest: true,
    onPresent: (ob) => {
      const d = ob.digest;
      digests.push(d);
      o.onDigest?.(d);
    },
  };

  await runScenario({
    e: o.e,
    host: o.host,
    spec,
    observer: o.observer ? mergeObservers(collector, o.observer) : collector,
    onFrameStart: ({ frameIndex, e }) => {
      const rec = byFrame.get(frameIndex);
      // ★帧首恢复输入：录制里没有这一帧（回放跑多了）就保持上一帧状态（并在结果里记为帧数不符）。
      if (rec) input.restore(rec.input);
      o.restoreHostInput?.(rec, e);
    },
  });

  const compared = Math.min(o.frames.length, digests.length);
  let firstDiffFrame = -1;
  let firstDiff: string[] = [];
  const diffFrames: number[] = [];
  for (let i = 0; i < compared; i++) {
    const rec = o.frames[i]!;
    const got = digests[i]!;
    if (rec.f !== got.frame || !engineDigestEqual(rec.digest, got)) {
      if (firstDiffFrame < 0) {
        firstDiffFrame = rec.f;
        firstDiff =
          rec.f === got.frame
            ? diffEngineDigest(rec.digest, got)
            : [`帧号错位：录制 f=${rec.f}，回放 f=${got.frame}`];
      }
      if (diffFrames.length < 20) diffFrames.push(rec.f);
    }
  }
  if (firstDiffFrame < 0 && o.frames.length !== digests.length) {
    // 回放**少跑**了帧 ⇒ 两边停止点不同（策略/状态分叉）⇒ 不一致；
    // 回放**多跑**了帧 ⇒ 只报告（录制本来就可能提前结束），不算失败。
    if (digests.length < o.frames.length) firstDiffFrame = compared;
  }
  const extraFrames = Math.max(0, digests.length - o.frames.length);
  return {
    digests,
    compared,
    firstDiffFrame,
    diffFrames,
    firstDiff,
    counts: { recorded: o.frames.length, replayed: digests.length },
    extraFrames,
    ok: firstDiffFrame < 0 && digests.length >= o.frames.length,
  };
}
