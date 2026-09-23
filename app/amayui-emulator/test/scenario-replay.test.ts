/** @tier T0 @kind core @subsystem frame */

/**
 * **Scenario / 回放契约测试**（`tickets/T-0005` 的 B5；G1 与 G3 的**可 CI 部分**）。
 *
 * 锁四件事：
 *  1. **一份 Scenario 两个跑手同义**：`runScenario` 的时钟策略（fixed/replay）与事件调度
 *     （`atFrame`/`atMs`/`afterMarker`）在同一段脚本上给出确定、可重复的结果（G1）；
 *  2. **录制 → 回放往返**：`TraceRecorder` 落的轨迹（时钟 + 帧首输入 + digest）用 `runReplay`
 *     复现后 **engine 段逐帧相等** —— 这就是 G3 的判据，只是录制端在 CI 里换成 headless
 *     （Electron 端由 `npm run record` + `npm run replay` 在本地跑，见 `emulator.md` 的闸门清单）；
 *  3. **负向控制**：把一帧的 digest 改掉 ⇒ 回放**指名**首帧与字段（否则"相等"可能只是"没比"）；
 *  4. **帧数不符被发现**（回放比录制多跑/少跑也算不一致）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { headlessFrameHost } from '../src/renderer/headlessFrameHost.js';
import { DigestCollector } from '../src/frame/observer.js';
import { parseScenarioSpec, runScenario, ScenarioScheduler, type ScenarioSpec } from '../src/frame/scenario.js';
import { TraceRecorder, parseTrace, runReplay, traceToSpec, type TraceHeader } from '../src/frame/trace.js';
import { canonicalize } from '../src/frame/digest.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { scriptDerived } from './harness.js';

const FRAME_MS = 1000 / 60;
const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个合成脚本的引擎 + headless 宿主（不依赖语料 ⇒ 秒级、确定）。 */
function mk(ops: BinInstruction[]): { e: Engine; host: ReturnType<typeof headlessFrameHost>; scene: HeadlessScene } {
  const scene = new HeadlessScene();
  const e = new Engine(scene);
  const script: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: ops.map((o, i) => ({ ...o, index: i })),
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');
  return { e, host: headlessFrameHost(scene, () => e.nowMs), scene };
}

const pollN = (n: number, script = 'FAKE.BIN'): BinInstruction[] =>
  Array.from({ length: n }, () => ({ ...instr(0x101), name: script }));

/** 一份"跑 N 帧、按事件动输入"的 Scenario（固定步长虚拟时钟 + 每帧 1 条 ⇒ 帧号可预测）。 */
const specOf = (events: ScenarioSpec['events'] = [], maxFrames = 12): ScenarioSpec => ({
  name: 'unit',
  clock: { kind: 'fixed', stepMs: FRAME_MS },
  maxFrames,
  maxStepsPerFrame: 1, // ★合成脚本很短：不限制批上限的话第一帧就会跑完整个脚本（`script-end` 不计帧）
  events,
});

test('runScenario：固定步长时钟逐帧推进，digest 序列确定（G1）', async () => {
  const a = mk(pollN(40));
  const b = mk(pollN(40));
  const ca = new DigestCollector();
  const cb = new DigestCollector();
  const spec = specOf([
    { kind: 'cursor', atFrame: 3, x: 100, y: 200 },
    { kind: 'press', atFrame: 6, x: 100, y: 200, button: 0 },
  ]);
  const ra = await runScenario({ e: a.e, host: a.host, spec, observer: ca });
  const rb = await runScenario({ e: b.e, host: b.host, spec, observer: cb });
  assert.equal(ra.frames, rb.frames);
  assert.deepEqual(ca.hashes(), cb.hashes(), '同一 Scenario 两次跑 ⇒ digest 逐帧相同');
  // 时钟确实按 stepMs 走（而不是墙钟）：第 5 帧 = 5×16.67（**不舍入**：这一项是回放的时钟输入）
  assert.equal(ca.digests[5]!.nowMs, 5 * FRAME_MS);
  // 事件在指定的帧生效（光标位置进 digest 前的输入状态 → 由引擎可见状态体现；这里断言调度日志）
  assert.deepEqual(
    ca.digests.map((d) => d.frame),
    Array.from({ length: ra.frames }, (_, i) => i),
  );
});

test('ScenarioScheduler：atMs 相对起始时钟、afterMarker 等"该脚本被进入"（同一谓词的两种观测）', () => {
  const { e } = mk(pollN(5));
  const input = new Engine(new HeadlessScene()).input;
  const s = new ScenarioScheduler(
    specOf([{ kind: 'note', afterMarker: '-> SN0000.BIN', settleMs: 50, note: 'a' }, { kind: 'note', atMs: 200, note: 'b' }]),
  );
  s.applyAt(input, e, 0, 1000); // t0 = 1000
  assert.equal(s.log.length, 0, '脚本还没进来 ⇒ 不执行');
  e.curScript().name = 'SN0000.BIN';
  s.applyAt(input, e, 1, 1020);
  assert.equal(s.log.length, 0, '刚进来但 settle 未到');
  s.applyAt(input, e, 2, 1080);
  assert.equal(s.log.length, 1, 'settle 到了 ⇒ 执行 afterMarker 那条');
  s.applyAt(input, e, 3, 1200);
  assert.equal(s.log.length, 2, 'atMs 200（相对 1000）到点 ⇒ 执行第二条');
  assert.deepEqual(s.log.map((l) => l.note), ['a', 'b']);
});

test('parseScenarioSpec：坏 spec 必须抛（不许静默用默认值）', () => {
  assert.throws(() => parseScenarioSpec('{}'), /name/);
  assert.throws(() => parseScenarioSpec('{"name":"x"}'), /clock/);
  assert.throws(() => parseScenarioSpec('{"name":"x","clock":{"kind":"nope"},"events":[]}'), /kind/);
  assert.throws(() => parseScenarioSpec('{"name":"x","clock":{"kind":"replay"},"events":[]}'), /samples/);
  assert.throws(() => parseScenarioSpec('{"name":"x","clock":{"kind":"wall"}}'), /events/);
  const ok = parseScenarioSpec('{"name":"x","clock":{"kind":"wall"},"events":[]}');
  assert.equal(ok.name, 'x');
});

test('★录制 → 回放往返：engine 段逐帧相等（G3 判据的可 CI 部分）', async () => {
  const frames: string[] = [];
  const spec = specOf([
    { kind: 'cursor', atFrame: 2, x: 50, y: 60 },
    { kind: 'press', atFrame: 4, x: 50, y: 60, button: 0 },
    { kind: 'release', atFrame: 6, x: 50, y: 60, button: 0 },
    { kind: 'wheel', atFrame: 8, x: 30, y: 30, delta: 120 },
  ]);
  // ---- 录制（headless 端；Electron 端同一份 TraceRecorder）----
  {
    const { e, host } = mk(pollN(40));
    const rec = new TraceRecorder({
      scenario: spec.name,
      script: 0,
      write: (l) => frames.push(l),
      policy: { maxStepsPerFrame: spec.maxStepsPerFrame },
    });
    rec.start();
    await runScenario({ e, host, spec, observer: rec });
    assert.ok(rec.frames > 8, `应录到 8 帧以上（实录 ${rec.frames}）`);
  }
  const trace = parseTrace(frames.join('\n'));
  assert.equal(trace.header?.scenario, 'unit');

  // ---- 回放（新引擎、新宿主；只有时钟与输入来自轨迹）----
  {
    const { e, host } = mk(pollN(40));
    const r = await runReplay({ e, host, header: trace.header, frames: trace.frames });
    assert.ok(r.ok, `回放必须逐帧相等；首帧差异=${r.firstDiffFrame} ${JSON.stringify(r.firstDiff)}`);
    assert.equal(r.firstDiffFrame, -1);
    assert.ok(r.counts.replayed >= r.counts.recorded);
  }
});

test('★负向控制：改掉一帧的 digest ⇒ 回放指名首帧与该帧的字段', async () => {
  const frames: string[] = [];
  const spec = specOf([{ kind: 'cursor', atFrame: 2, x: 50, y: 60 }]);
  {
    const { e, host } = mk(pollN(20));
    const rec = new TraceRecorder({
      scenario: spec.name,
      script: 0,
      write: (l) => frames.push(l),
      policy: { maxStepsPerFrame: spec.maxStepsPerFrame },
    });
    rec.start();
    await runScenario({ e, host, spec, observer: rec });
  }
  const trace = parseTrace(frames.join('\n'));
  // 篡改第 5 帧的 ip（engine 段字段）
  const victim = trace.frames[5]!;
  victim.digest = { ...victim.digest, engine: { ...victim.digest.engine, ip: victim.digest.engine.ip + 7 } };
  const { e, host } = mk(pollN(20));
  const r = await runReplay({ e, host, header: trace.header, frames: trace.frames });
  assert.equal(r.firstDiffFrame, 5, '必须恰好指到被改的那一帧');
  assert.ok(r.firstDiff.some((s) => s.startsWith('ip:')), `diff 必须指名字段：${JSON.stringify(r.firstDiff)}`);
});

test('★帧数不符被发现：回放**少跑**（策略不一致导致提前收场）⇒ 不算通过', async () => {
  const frames: string[] = [];
  {
    const { e, host } = mk(pollN(30));
    const rec = new TraceRecorder({
      scenario: 'unit',
      script: 0,
      write: (l) => frames.push(l),
      policy: { maxStepsPerFrame: 1 }, // 每帧 1 条 ⇒ 30 条脚本跑满 20 帧
    });
    rec.start();
    await runScenario({ e, host, spec: specOf([], 20), observer: rec });
    assert.ok(rec.frames >= 15, `录制帧数应足够（实录 ${rec.frames}）`);
  }
  const trace = parseTrace(frames.join('\n'));
  // 篡改头里的策略：批上限放大 ⇒ 回放第一帧就把脚本跑完 ⇒ 帧数远少于录制。
  const badHeader = { ...trace.header!, policy: { maxStepsPerFrame: 10000 } };
  const { e, host } = mk(pollN(30));
  const r = await runReplay({ e, host, header: badHeader, frames: trace.frames });
  assert.ok(r.counts.replayed < r.counts.recorded, `回放帧数应少于录制（${r.counts.replayed} vs ${r.counts.recorded}）`);
  assert.equal(r.ok, false, '帧数不符必须算不一致');
});

test('traceToSpec：时钟取样来自轨迹；帧数与采样一一对应', () => {
  const header: TraceHeader = { kind: 'header', v: 1, scenario: 'x', script: 0, clock: 'wall' };
  const spec = traceToSpec(header, [
    { kind: 'frame', f: 0, t: 10, input: {} as never, digest: { frame: 0, nowMs: 10, engine: {} as never, host: {} as never, hash: 'a' } },
    { kind: 'frame', f: 1, t: 26, input: {} as never, digest: { frame: 1, nowMs: 26, engine: {} as never, host: {} as never, hash: 'b' } },
  ]);
  assert.deepEqual(spec.clock, { kind: 'replay', samples: [10, 26] });
  assert.equal(spec.name, 'x');
  assert.equal(canonicalize(spec.events), '[]');
});
