/**
 * **`0x400` 等待门的真值**（`tickets/T-0024`）：`sub_407E20` = **池挂起位** + **`0x238` 装载的等待计时器**。
 *
 * 为什么单独锁它：在 `T-0024` 之前，emulator 的门判据是"扫动画窗"的**猜测口径**（先是窗 0，
 * 后是"5 窗 / 窗 0"两选一），于是序章 `src/SN0000.txt:1048` 的 `wait` 要么被 80 000 ms 慢推钉死 80 s、
 * 要么只能靠"恰好只看颜色窗"蒙对。引擎的真值（raw 如下）与"扫几个窗"无关：
 *
 * ```
 * sub_407E20(_this = 池基 322832)                       // raw 12762-12786
 *   dur = _this[11631]                                  // = Scene+46524 = Engine[92339] ← 0x238 写
 *   if (!dur) return _this[11629];                      // 没装计时器 ⇒ 只看池挂起位（Scene+46516）
 *   if (!_this[11630]) _this[11630] = _this[11625];     // 起点（46520 = Engine[92338]）← 现在
 *   if (now > start + dur || _this[11628] == 1) {       // 到期 / 强制冻结（46512）
 *       start = 0; dur = 0; return _this[11629];
 *   }
 *   return 1;                                           // ★未到点 ⇒ 一律"还在等"
 * ```
 *
 * 主循环（raw 21109-21152）：`if (sub_407E20(pool) || v95) { …玩家可跳过…; 本帧不派发 } else { 清 0x400 }`。
 * 池挂起位（`Scene+46516`）的口径见 `scPoolPending`（raw 117843-117844：`+720` bit0 的元素被排除）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { headlessFrameHost } from '../src/renderer/headlessFrameHost.js';
import { scAnimationsPending } from '../src/renderer/sceneModel.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个装了合成脚本的引擎（`instr` 列表 + 自动 index）。 */
function mk(ops: BinInstruction[], native: StubNative | HeadlessScene): Engine {
  const e = new Engine(native);
  const script: ScriptBinary = {
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
  return e;
}

// ---------------------------------------------------------------------------
// ① `sub_407E20` 的逐行语义（`0x238` 计时器）
// ---------------------------------------------------------------------------

test('T-0024：`0x238 v` 装载计时器 ⇒ 未到点门不放行，到点即放行（raw 12762-12786）', () => {
  const e = new Engine(new StubNative(() => {}));
  e.waitFlags |= 0x400; // = `0x21C wait`
  e.gateWaitMs = 100; // = `i238 64`（Engine[92339]）
  e.gateWaitStart = 0; // = `0x238` 同时把起点清零（Engine[92338]）

  assert.equal(e.serviceWaitGate(1000), false, '第一帧：起点被锁存 ⇒ 未到点 ⇒ 不放行');
  assert.equal(e.gateWaitStart, 1000, '起点 = 现在（raw 12774-12775）');
  assert.equal(e.serviceWaitGate(1099), false, '99 ms：仍在窗内');
  assert.equal(e.serviceWaitGate(1100), false, '★恰好 start+dur：raw 12776 是 `>` 而不是 `>=` ⇒ 仍未到点');
  assert.equal(e.serviceWaitGate(1101), true, '101 ms：到期 ⇒ 放行');
  assert.equal(e.gateWaitMs, 0, '到期时两格清零（raw 12778-12779）⇒ 下次不再生效');
  assert.equal(e.gateWaitStart, 0, '起点同样清零');
});

test('T-0024：没装计时器时，门只看池挂起位（`scenePending` = Scene+46516）', () => {
  const e = new Engine(new StubNative(() => {}));
  assert.equal(e.serviceWaitGate(5), true, '池空闲、没计时器 ⇒ 放行');
  e.scenePending = true;
  assert.equal(e.serviceWaitGate(5), false, '池挂着 ⇒ 不放行（raw 12783）');
});

test('T-0024：强制冻结（`sub_407EA0`）让计时器立刻到期、池挂起位失效', () => {
  const e = new Engine(new StubNative(() => {}));
  e.gateWaitMs = 10_000;
  e.gateWaitStart = 100;
  e.scenePending = true;
  assert.equal(e.serviceWaitGate(200), false, '10 s 计时器没到点');
  e.skipWaitGate(); // = 主循环 raw 21135（玩家跳过） / raw 21161（ADV 分支每帧）
  assert.equal(e.sceneFreeze, true, '置强制冻结（raw 12796）');
  assert.equal(e.gateWaitMs, 0, '顺带清掉等待计时器（raw 12797-12798）');
  assert.equal(e.gateWaitStart, 0);
  assert.equal(e.serviceWaitGate(200), false, '★冻结还没被"下一遍绘制"消费 ⇒ 池挂起位仍为 1（引擎 raw 130428 才清零）');
  e.scenePending = false; // 下一遍绘制：冻结 ⇒ 所有窗立刻算结束（raw 134941）⇒ 不再置位
  assert.equal(e.serviceWaitGate(200), true, '⇒ 放行');
});

// ---------------------------------------------------------------------------
// ② 场景级：80 000 ms 慢推不影响门的放行时刻（`i242 … 1` 把它排除出池挂起位）
// ---------------------------------------------------------------------------

/** 背景纹理 id（= `src/SN0000.txt:1042-1045` 的 `f8023` 在序章里解析出的绘制项，这里直接用常数）。 */
const SCENE_H = 0x19258;

/**
 * 合成脚本：`[i242 <h> 1]` + `i238 100` + `wait` + 一条普通指令（门放行后必然派发到它 = 脚本尾）。
 * `withExclude` = 是否照序章那样写 `i242 <h> 1`（`DrawItem+720` bit0 ⇒ 本项不参与池挂起位）。
 */
function gateScript(withExclude: boolean): BinInstruction[] {
  return [
    ...(withExclude ? [instr(0x242, [im(SCENE_H), im(1)])] : []),
    instr(0x238, [im(100)]),
    instr(0x21c), // wait：置 0x400
    instr(0x101), // 门放行后的那条（脚本尾）
  ];
}

/** 跑一次：一个 80 000 ms 慢推的背景 + `i238 100` + `wait`，虚拟时钟每帧 +1000/60。 */
async function runGate(withExclude: boolean) {
  const scene = new HeadlessScene({});
  const e = mk(gateScript(withExclude), scene);
  // = `src/SN0000.txt:1043`：`i220 (global-int f8023) 0 13880 (local-int 0) (local-int 1) 0`
  scene.configureDrawItem({ handle: SCENE_H, layer: 1, tex: 1, srcX: 0, srcY: 0, srcW: 10, srcH: 10, dstX: 0, dstY: 0 });
  scene.setTranslationAnim(SCENE_H, 0, 0x13880, 0, 1, 0); // dur = 80 000 ms

  const box = { clock: 0 };
  const host = headlessFrameHost(scene, () => box.clock);
  const bitAtFrameEnd: number[] = [];
  const clockAtFrameEnd: number[] = [];
  const opts: FrameLoopOptions = {
    gates: { anim: 'wait', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 60, // = 1 s 虚拟时钟
    present: 'needsRender',
    audio: 'never',
    onFrameEnd: () => {
      bitAtFrameEnd.push(e.waitFlags & 0x400 ? 1 : 0);
      clockAtFrameEnd.push(box.clock);
      box.clock += 1000 / 60;
    },
  };
  const r = await runFrameLoop(e, host, opts);
  return { e, scene, r, bitAtFrameEnd, clockAtFrameEnd, finalClock: box.clock };
}

test('T-0024：`i238 100` + `wait` ⇒ 门在计时器到期后放行（80 000 ms 慢推不参与）', async () => {
  const { e, scene, r, bitAtFrameEnd, clockAtFrameEnd, finalClock } = await runGate(true);

  assert.equal(r.stopReason, 'script-end', '门必须放行，否则脚本永远到不了尾');
  assert.equal(r.steps, 4, 'i242 + i238 + wait + 尾指令');
  assert.equal(e.gateWaitMs, 0, '放行时计时器两格已清零（raw 12778-12779）');

  const release = bitAtFrameEnd.indexOf(0);
  assert.notEqual(release, -1, '0x400 位必须被清掉（门放行）');
  assert.ok(clockAtFrameEnd[release]! >= 100, `放行不得早于 100 ms 计时器（实际 ${clockAtFrameEnd[release]}ms）`);
  assert.ok(clockAtFrameEnd[release]! < 1000, `放行不得拖到"等动画"（实际 ${clockAtFrameEnd[release]}ms，慢推要 80 000 ms）`);

  // ★关键对照：慢推**本身还在跑**（合成口径为真）⇒ 门之所以开，是因为 `i242` 把它排除出池挂起位，
  //   而不是"门的窗口范围恰好不含平移窗"。
  assert.equal(scAnimationsPending(scene.scene, finalClock), true, '80 000 ms 慢推仍在跑（只是不参与门）');
});

test('T-0024：同一个慢推，**不写** `i242 … 1` ⇒ 池挂起位把门钉住（对照）', async () => {
  const { e, r, bitAtFrameEnd } = await runGate(false);
  assert.equal(r.stopReason, 'cap', '60 帧（1 s）内出不去：慢推还要 80 s');
  assert.equal(r.steps, 2, '只派发了 i238 + wait（门一直没放行）');
  assert.equal(bitAtFrameEnd.every((b) => b === 1), true, '0x400 位一直在（门不放行）');
  assert.equal(e.scenePending, true, '池挂起位为 1 —— 这就是门不放行的原因（引擎 raw 117843-117844）');
});

test('T-0024：证据锚点 —— 序章的慢推确实被 `i242 … 1` 排除（源码棘轮）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'SN0000.txt'),
    'utf8',
  );
  assert.match(src, /i220 \(global-int f8023\) 0 13880[^\n]*\n[^\n]*\ni242 \(global-int f8023\) 1/, '序章的 80 000 ms 慢推之后必须紧跟 `i242 f8023 1`');
});
