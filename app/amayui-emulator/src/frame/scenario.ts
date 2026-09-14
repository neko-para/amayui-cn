/**
 * **Scenario（场景脚本）** —— 把"玩家做了什么"表达成**数据**，让两个宿主跑同一份输入编排。
 *
 * 为什么需要它（`tickets/T-0003` 的 B3 验收 3 / `T-0005` 的 B5）：
 * 修前"输入"分两套 —— Electron 由真人（DOM 事件 → `InputManager`），headless 由各链路里手写的
 * `input.setCursor(...)` 序列（且等待门走 `forceAdvance` 旁路，**根本不经过命中测试/悬停**）。
 * 于是 headless 的 `routes.cursor` 恒 −1，"悬停展开/收起侧栏"这条**对外可见行为**在 headless 里从不发生。
 *
 * 本模块只做三件事，且**不依赖任何宿主**：
 *  1. 步骤（`ScenarioStep`）：`when` 到点（帧号）或条件成立（可读 Engine 状态）时执行一次；
 *  2. 执行体拿到 `{ e, input, frame }`，用 `InputManager` 的写入接口表达输入（`setCursor`/`pressMouse`…）；
 *  3. 留下**执行日志**（哪一帧、哪一步、动了什么）—— 它既是诊断，也是 G3 回放比对的输入侧记录。
 *
 * ★与 B5 的关系：B5 会把这里扩成"可录制/可回放"（`--record` 落 JSONL、`--replay` 重放并比 digest）；
 * 本文件先把"事件 → InputManager"这条通路统一，`--record/--replay` 只需序列化 `steps` 与日志。
 */
import type { Engine } from '../vm/engine.js';
import type { InputManager } from '../vm/input.js';
import { runFrameLoop, type FrameLoopGates, type FrameLoopOptions, type FrameLoopResult } from './loop.js';
import type { FrameHost } from './host.js';
import { mergeObservers, type FrameObservation, type FrameObserver } from './observer.js';

/** 执行一个步骤时能看到/能改的东西。 */
export interface ScenarioCtx {
  e: Engine;
  input: InputManager;
  /** 当前帧号（由驱动/宿主每帧递增）。 */
  frame: number;
}

/** 一个步骤：到点或条件成立 ⇒ **执行一次**。 */
export interface ScenarioStep {
  /** 帧号（`frame >= at` 即到点）或条件（每次 apply 都判一次）。 */
  when: number | ((c: ScenarioCtx) => boolean);
  /** 做什么（只写 `InputManager`；不要碰 VM 状态）。 */
  do: (c: ScenarioCtx) => void;
  /** 日志/诊断用的一句话（会进 `Scenario.log`）。 */
  note: string;
}

/** 一次已执行的步骤记录（诊断 + 回放比对用）。 */
export interface ScenarioLogEntry {
  frame: number;
  note: string;
}

/**
 * 步骤集合。**顺序执行**：前面的步骤没执行完，后面的不会被考虑
 * （避免"同一个帧里既移动又点击"这种物理上不可能的组合被乱序执行）。
 */
export class Scenario {
  readonly steps: ScenarioStep[] = [];
  /** 已执行步骤的记录（帧号 + 说明）。 */
  readonly log: ScenarioLogEntry[] = [];
  /** 下一个待执行步骤的下标。 */
  #next = 0;

  /** 追加一步（链式）。 */
  step(s: ScenarioStep): this {
    this.steps.push(s);
    return this;
  }

  /** 追加一步"到第 n 帧执行"。 */
  at(frame: number, note: string, fn: (c: ScenarioCtx) => void): this {
    return this.step({ when: frame, note, do: fn });
  }

  /** 追加一步"条件成立时执行"（条件每次 apply 判一次）。 */
  when(note: string, cond: (c: ScenarioCtx) => boolean, fn: (c: ScenarioCtx) => void): this {
    return this.step({ when: cond, note, do: fn });
  }

  get done(): boolean {
    return this.#next >= this.steps.length;
  }

  /** 每个宿主帧调一次：把"到点/条件成立"的步骤按序执行掉（每步只执行一次）。 */
  apply(c: ScenarioCtx): void {
    while (this.#next < this.steps.length) {
      const s = this.steps[this.#next]!;
      const due = typeof s.when === 'number' ? c.frame >= s.when : s.when(c);
      if (!due) return;
      s.do(c);
      this.log.push({ frame: c.frame, note: s.note });
      this.#next++;
    }
  }
}

/** 把光标移到 (x,y) 的一句糖（供步骤体用，避免到处写 `c.input.…`）。 */
export function moveTo(c: ScenarioCtx, x: number, y: number): void {
  c.input.setCursor(x, y);
}

/** 在 (x,y) 按一下左键（按下→留下"边沿"，由既有链路在后续帧释放）。 */
export function clickAt(c: ScenarioCtx, x: number, y: number): void {
  c.input.setCursor(x, y);
  c.input.pressMouse(0);
}

/** 抬起左键。 */
export function releaseAt(c: ScenarioCtx, x: number, y: number): void {
  c.input.setCursor(x, y);
  c.input.releaseMouse(0);
}

// ---------------------------------------------------------------------------
// B5：**可序列化的 Scenario**（一份定义，两个跑手）
// ---------------------------------------------------------------------------

/**
 * **时钟策略**（设计文档 §3 的 `Scenario.clock`）：
 *  - `wall`  ：真实墙钟（Electron 跑手 / 产品路径）；
 *  - `fixed` ：虚拟固定步长（headless 跑手；确定性）；
 *  - `replay`：**回放**——时钟来自录下来的逐帧采样（`--record` 的产物）⇒ 时间变成**输入数据**。
 */
export type ScenarioClock =
  | { kind: 'wall' }
  | { kind: 'fixed'; stepMs: number }
  | { kind: 'replay'; samples: number[] };

/**
 * **一条定时输入**（数据，不是回调）。
 *
 * 到点判据（三种，取先满足者）：
 *  - `atFrame`：帧号到点（两宿主同义）；
 *  - `atMs`   ：**相对起始帧时钟**的毫秒（两宿主同义：回放用录下来的采样、固定时钟用帧号×步长）；
 *  - `afterMarker`：**等某个脚本被进入**再等 `settleMs`。两种宿主对**同一个谓词**的观测方式不同：
 *    Electron 侧由跑手看日志标记（`-> SN0000.BIN`，它只有这个可观测），headless 侧由本模块看
 *    `e.curScript().name`（引擎状态）⇒ 定义只有一份，观测各按所长。
 */
export interface ScenarioEvent {
  kind: 'cursor' | 'press' | 'release' | 'wheel' | 'note';
  atFrame?: number;
  atMs?: number;
  afterMarker?: string;
  settleMs?: number;
  x?: number;
  y?: number;
  button?: 0 | 1;
  delta?: number;
  note?: string;
}

/** **一份 Scenario**（可 JSON 序列化：Electron 跑手与 headless 跑手共用同一份）。 */
export interface ScenarioSpec {
  name: string;
  /** 启动脚本索引（默认 0 = SYSTEM4.BIN）。两宿主都从"引擎启动流程"跑起。 */
  boot?: { script?: number };
  clock: ScenarioClock;
  /** 门档（缺省 = 产品档：`0x400`/sleep 等条件、等待推进走真泵）。 */
  gates?: FrameLoopGates;
  /** 每帧最多派发多少条（缺省 = 产品的 10000）。 */
  maxStepsPerFrame?: number;
  /** 本次最多跑多少帧。 */
  maxFrames?: number;
  events: ScenarioEvent[];
}

/** 把 `-> SN0000.BIN` 形式的日志标记取出脚本名（供 headless 侧按引擎状态等同一个谓词）。 */
export function markerScript(marker: string): string | null {
  const m = /([A-Za-z0-9_$]+\.BIN)/.exec(marker);
  return m ? m[1]! : null;
}

/** 执行一条数据事件（只写 `InputManager`，不碰 VM 状态）。 */
export function applyScenarioEvent(input: InputManager, ev: ScenarioEvent): void {
  const x = ev.x ?? 0;
  const y = ev.y ?? 0;
  switch (ev.kind) {
    case 'cursor':
      input.setCursor(x, y, true);
      break;
    case 'press':
      if (ev.x !== undefined) input.setCursor(x, y, true);
      input.pressMouse(ev.button ?? 0);
      break;
    case 'release':
      if (ev.x !== undefined) input.setCursor(x, y, true);
      input.releaseMouse(ev.button ?? 0);
      break;
    case 'wheel':
      if (ev.x !== undefined) input.setCursor(x, y, true);
      input.addWheel(ev.delta ?? 0);
      break;
    case 'note':
      break; // 只留痕（进 `log`），不动输入
  }
}

/** 一条已执行的事件（诊断 + 回放比对）。 */
export interface ScenarioEventLog {
  frame: number;
  nowMs: number;
  kind: string;
  note: string;
}

/**
 * **数据事件的调度器**：把 `ScenarioSpec.events` 按"到点"顺序**执行一次**。
 * 与 `Scenario`（回调式，供既有 harness 用条件驱动悬停）互补：那个表达"看引擎状态再决定做什么"，
 * 这个表达"一份可以存成 JSON 的输入编排"。
 */
export class ScenarioScheduler {
  readonly log: ScenarioEventLog[] = [];
  #next = 0;
  /** 每个事件首次满足 `afterMarker` 时的时钟（`atMs` 的相对零点也是它）。 */
  #enterMs: (number | null)[] = [];
  /** 起始帧时钟（`atMs` 的相对零点；第一帧时确定）。 */
  #t0: number | null = null;

  constructor(private readonly spec: ScenarioSpec) {}

  get done(): boolean {
    return this.#next >= this.spec.events.length;
  }

  /** 每个宿主帧调一次（帧初、每帧服务之前）。 */
  applyAt(input: InputManager, e: Engine, frameIndex: number, nowMs: number): void {
    if (this.#t0 === null) this.#t0 = nowMs;
    while (this.#next < this.spec.events.length) {
      const i = this.#next;
      const ev = this.spec.events[i]!;
      if (!this.#isDue(ev, i, e, frameIndex, nowMs)) return;
      applyScenarioEvent(input, ev);
      this.log.push({ frame: frameIndex, nowMs, kind: ev.kind, note: ev.note ?? ev.kind });
      this.#next++;
    }
  }

  #isDue(ev: ScenarioEvent, i: number, e: Engine, frameIndex: number, nowMs: number): boolean {
    if (ev.atFrame !== undefined && frameIndex >= ev.atFrame) return true;
    if (ev.afterMarker !== undefined) {
      const want = markerScript(ev.afterMarker);
      const here = e.curScript().name;
      const hit = want !== null && (here === want || here.startsWith(want.replace(/\.BIN$/i, '')));
      if (hit && this.#enterMs[i] == null) this.#enterMs[i] = nowMs;
      const enter = this.#enterMs[i];
      if (enter == null) return false;
      if (nowMs - enter < (ev.settleMs ?? 0)) return false;
      return true;
    }
    if (ev.atMs !== undefined) return nowMs - (this.#t0 ?? nowMs) >= ev.atMs;
    return true; // 既没给时间也没给标记 ⇒ 立即可执行（按顺序排队）
  }
}

/** 产品档的引擎每帧批上限（与 `session.ts` 的 `SAFETY_PER_FRAME` 同源；这里避免循环依赖）。 */
const PRODUCT_SAFETY_PER_FRAME = 10000;

export interface ScenarioRunOptions {
  e: Engine;
  host: FrameHost;
  spec: ScenarioSpec;
  observer?: FrameObserver;
  /**
   * 帧初回调（时钟已定、`ScenarioSpec.events` 尚未执行）——
   * **回放**用它把录下来的"本帧输入快照"摆回去（见 `frame/trace.ts` 的 `runReplay`）。
   */
  onFrameStart?: (o: { frameIndex: number; nowMs: number; e: Engine }) => void;
  /** 覆盖驱动的其它档（缺省取 `spec`，再缺省取产品档）。 */
  overrides?: Partial<FrameLoopOptions>;
}

/**
 * **跑一份 Scenario**（`tickets/T-0005` 的 B5）—— Electron 跑手与 headless 跑手**只有宿主不同**：
 * 时钟由 `spec.clock` 决定（墙钟/固定/回放），输入由 `spec.events` 决定（或回放的逐帧快照），
 * 帧序/门/批全在 `runFrameLoop`（唯一一份）。
 *
 * 返回值 = 驱动的 `FrameLoopResult`（`stopReason` 让调用方还原各自的语义）。
 */
export async function runScenario(o: ScenarioRunOptions): Promise<FrameLoopResult> {
  const { e, spec } = o;
  const samples = spec.clock.kind === 'replay' ? spec.clock.samples : null;
  const stepMs = spec.clock.kind === 'fixed' ? spec.clock.stepMs : 0;
  /** 已跑完的帧数（时钟与调度的帧号都取它；帧末由 `onFrameEnd` 更新）。 */
  let frames = 0;
  const nowAt = (frameIndex: number): number => {
    if (samples) return samples[Math.min(frameIndex, samples.length - 1)] ?? 0;
    if (spec.clock.kind === 'fixed') return frameIndex * stepMs;
    return o.host.now();
  };
  const scheduler = new ScenarioScheduler(spec);
  const mine: FrameObserver = {
    onFrameStart: (ob: FrameObservation) => {
      o.onFrameStart?.({ frameIndex: ob.frameIndex, nowMs: ob.nowMs, e: ob.e });
      scheduler.applyAt(ob.e.input, ob.e, ob.frameIndex, ob.nowMs);
    },
    onFrameEnd: (ob: FrameObservation) => {
      frames = ob.frames;
    },
  };
  const observer = o.observer ? mergeObservers(mine, o.observer) : mine;
  const base: FrameLoopOptions = {
    gates: spec.gates ?? { anim: 'wait', sleep: 'wait', advance: 'pump' },
    advFrame: true,
    advErrors: 'stop',
    maxStepsPerFrame: spec.maxStepsPerFrame ?? PRODUCT_SAFETY_PER_FRAME,
    present: 'needsRender',
    audio: 'host',
    ...(spec.maxFrames !== undefined ? { maxFrames: spec.maxFrames } : {}),
    ...o.overrides,
    observer,
  };
  return await runFrameLoop(e, wrapHostClock(o.host, () => nowAt(frames)), base);
}

/** 用"本帧时钟"包一层宿主（其余能力原样转发；缺的能力不凭空造出来）。 */
export function wrapHostClock(host: FrameHost, now: () => number): FrameHost {
  const out: FrameHost = { now };
  if (host.yield) out.yield = () => host.yield!();
  if (host.advanceModel) out.advanceModel = (t) => host.advanceModel!(t);
  if (host.present) out.present = () => host.present!();
  if (host.needsRender) out.needsRender = () => host.needsRender!();
  if (host.poolPending) out.poolPending = () => host.poolPending!();
  if (host.texturesIdle) out.texturesIdle = () => host.texturesIdle!();
  if (host.audio) out.audio = (i) => host.audio!(i);
  if (host.digestState) out.digestState = () => host.digestState!();
  if (host.digestHostCounters) out.digestHostCounters = () => host.digestHostCounters!();
  return out;
}

/** 从 JSON 文本解析一份 `ScenarioSpec`（两宿主共用；坏文件必须抛）。 */
export function parseScenarioSpec(text: string): ScenarioSpec {
  const o = JSON.parse(text) as Partial<ScenarioSpec>;
  if (typeof o.name !== 'string' || !o.name) throw new Error('ScenarioSpec.name 缺失');
  if (!o.clock || typeof o.clock !== 'object') throw new Error('ScenarioSpec.clock 缺失');
  const clock = o.clock as ScenarioClock;
  if (clock.kind === 'fixed' && typeof clock.stepMs !== 'number') throw new Error('clock.fixed 需要 stepMs');
  if (clock.kind === 'replay' && !Array.isArray(clock.samples)) throw new Error('clock.replay 需要 samples[]');
  if (clock.kind !== 'wall' && clock.kind !== 'fixed' && clock.kind !== 'replay') {
    throw new Error(`clock.kind 非法：${String((clock as { kind?: unknown }).kind)}`);
  }
  if (!Array.isArray(o.events)) throw new Error('ScenarioSpec.events 必须是数组');
  return {
    name: o.name,
    ...(o.boot ? { boot: o.boot } : {}),
    clock,
    ...(o.gates ? { gates: o.gates } : {}),
    ...(o.maxStepsPerFrame !== undefined ? { maxStepsPerFrame: o.maxStepsPerFrame } : {}),
    ...(o.maxFrames !== undefined ? { maxFrames: o.maxFrames } : {}),
    events: o.events,
  };
}
