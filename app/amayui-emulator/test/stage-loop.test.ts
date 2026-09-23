/** @tier T1 @kind core @subsystem frame */

/**
 * **阶梯动画调度器（`0xD3` / `0xD4` / `0xD5`）守卫** —— 语义与 raw 锚点见 `src/vm/stageLoop.ts`。
 *
 * 覆盖四层：
 *  1. **状态模型**：时刻累计、`cursor`/`index`、起表/清表、"派发次数 = 条目数 − 1"、未到点不消费；
 *  2. **到点判定与"落后"入口**：`now - t0 >= t` 才派发；下一条也已过期 ⇒ 走 `op4`（`tail`）；
 *  3. **帧循环接线**：`0x40` 门置位时本帧不派发、到点后按 label 派发、脚本体 `ret` 回到 `i0d5`；
 *  4. **E3 真语料**：`SAVE.BIN` 的 `label_0000706c` 段（`i0d3`+`i0d4`×2+`i0d5`）实测派发次数与耗时，
 *     外加 `src/SAVE.txt` 的源码形态棘轮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { STAGE_GATE, StageLoop } from '../src/vm/stageLoop.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { dec } from '../src/vm/bits.js';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { parseScriptBytes, type BinArg, type BinInstruction, type ScriptBinary } from '../src/script/bin.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;

/** 一条合成指令。 */
interface Op {
  op: number;
  args: BinArg[];
}

/**
 * 造一个装了**合成脚本**的引擎：`index` 按真实步长（`1 + 2*argc` 个 dword）累加，并建好
 * `dwordToInstr` —— 这两样是 `ret`（弹 dword 偏移）与 label（= dword 偏移）能对上的前提。
 */
function mkScript(ops: Op[], native: StubNative = new StubNative(() => {})): Engine {
  const instructions: BinInstruction[] = [];
  let dword = 0;
  for (const o of ops) {
    instructions.push({
      opcode: o.op,
      name: `i${o.op.toString(16)}`,
      argc: o.args.length,
      args: o.args,
      byteOffset: 0,
      index: dword,
    } as unknown as BinInstruction);
    dword += 1 + 2 * o.args.length;
  }
  const dwordToInstr: number[] = [];
  instructions.forEach((ins, i) => {
    for (let d = 0; d < 1 + 2 * ins.argc; d++) dwordToInstr[ins.index + d] = i;
  });
  const script: ScriptBinary = {
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions,
    labelTargets: new Set<number>(),
    dwordToInstr,
    raw: new Uint8Array(0),
  };
  const e = new Engine(native);
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');
  return e;
}

/** 合成脚本：`i0d3` + `i0d4`×2 + `i0d5` + 两条"表跑完后"的哨兵 + 脚本体/收尾体。 */
const D3 = 0xd3;
const D4 = 0xd4;
const D5 = 0xd5;
const NOOP = 0x1a7; // comment（实现表里的纯 no-op）
const ABORT = 0x1; // abort：把"表跑完后落进脚本体"这件事挡住（终止整轮）
const ADD = 0x50;
const RET = 0x5;

/**
 * 骨架的 dword 布局（label 必须写**真实**的 dword 偏移；步长 = `1 + 2*argc`）：
 * ```
 * 1 dword   [0] i0d3
 * 9 dwords  [1] i0d4 step count body tail
 * 9 dwords  [10] i0d4 step count body tail
 * 3 dwords  [19] i0d5 -1
 * 1 dword   [22] i1a7      ← 表跑完后脚本应该落在这里
 * 1 dword   [23] abort     ← 收尾（否则会**落进**下面的脚本体，把计数搅乱）
 * 7 dwords  [24] body: add local0 local0 1
 * 1 dword   [31] ret
 * 7 dwords  [32] tail: add local1 local1 1
 * 1 dword   [39] ret
 * ```
 */
const LAYOUT = { d3: 0, d4a: 1, d4b: 10, d5: 19, after1: 22, abort: 23, body: 24, tail: 32 } as const;

/** 按上面的布局造脚本；`step`/`counts` 可变。 */
function stageScript(step: number, counts: [number, number]): Op[] {
  return [
    { op: D3, args: [] },
    { op: D4, args: [im(step), im(counts[0]), im(LAYOUT.body), im(LAYOUT.tail)] },
    { op: D4, args: [im(step), im(counts[1]), im(LAYOUT.tail), im(LAYOUT.tail)] },
    { op: D5, args: [im(-1)] },
    { op: NOOP, args: [] },
    { op: ABORT, args: [] },
    { op: ADD, args: [loc(0), loc(0), im(1)] },
    { op: RET, args: [] },
    { op: ADD, args: [loc(1), loc(1), im(1)] },
    { op: RET, args: [] },
  ];
}

/** 局部 int 是 ENC 存的，读断言要解回来。 */
const localInt = (e: Engine, slot: number): number => dec(e.key, e.curScript().locals.int.get(slot) ?? 0);

/** 跑一次合成脚本：虚拟时钟每帧 +`frameMs`。 */
async function runStage(e: Engine, frameMs: number, opts: Partial<FrameLoopOptions> = {}) {
  const box = { clock: 0, gates: 0 };
  const host: FrameHost = { now: () => box.clock };
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 200,
    present: 'never',
    audio: 'never',
    onFrameEnd: () => {
      box.gates++;
      box.clock += frameMs;
    },
    ...opts,
  });
  return { r, clock: box.clock, frames: box.gates };
}

// ---------------------------------------------------------------------------
// 1) 状态模型
// ---------------------------------------------------------------------------

test('0xD3/0xD4/0xD5：时刻**累计**、写游标 = 条目数 − 1、表被清干净（raw 36668 / 38838 / 36689）', () => {
  const s = new StageLoop();
  s.add(16, 30, 0x70c8, 0x70d4); // SAVE.txt:1645 的形态
  s.add(1, 2, 0x70d4, 0x70d4); // SAVE.txt:1646
  assert.equal(s.entries.length, 32, '30 + 2 条');
  assert.equal(s.cursor, 31, '写游标 = 条目数 − 1（引擎 `_this[107672]`）');
  assert.equal(s.entries[0]!.t, 16, '第一条 = 0 + step（表为空时基准是 0）');
  assert.equal(s.entries[29]!.t, 480, '30 × 16');
  assert.equal(s.entries[30]!.t, 481, '★跨 i0d4 继续累计（不是重新从 0 起）');
  assert.equal(s.entries[31]!.t, 482);
  assert.equal(s.entries[0]!.body, 0x70c8);
  assert.equal(s.entries[30]!.body, 0x70d4, '第二段的 op3');

  s.index = 5;
  s.reset(); // = i0d3
  assert.deepEqual(
    { n: s.entries.length, cursor: s.cursor, index: s.index, exit: s.exitLabel },
    { n: 0, cursor: -1, index: 0, exit: -1 },
    'i0d3 清空全部（含 exitLabel）',
  );

  // count <= 0 ⇒ 不加（引擎的 while 在 `v20 >= result` 时立刻退出）
  s.add(16, 0, 1, 2);
  s.add(16, -3, 1, 2);
  assert.equal(s.entries.length, 0);
  assert.equal(s.cursor, -1);
});

test('0xD5：`index < cursor` 才等；**派发次数 = 条目数 − 1**（最后一条是收尾哨兵）', () => {
  const s = new StageLoop();
  s.add(10, 3, 100, 200); // t = 10,20,30 ⇒ cursor = 2
  s.begin(0, -1, 0, 7, 5);
  assert.equal(s.shouldWait(), true, 'i0d5 第一次：0 < 2 ⇒ 置门、不前进');

  s.nextStep(10); // 派发第 1 条
  assert.equal(s.shouldWait(), true, '1 < 2 ⇒ 继续等');
  s.nextStep(20); // 派发第 2 条
  assert.equal(s.shouldWait(), false, '★2 < 2 为假 ⇒ 脚本往下走：第 3 条**永远不会被派发**');

  // 单条目 ⇒ 连门都不置（引擎 `0 < 0` 为假 ⇒ `95805 = 3`，脚本直接落下去）
  const one = new StageLoop();
  one.add(10, 1, 1, 2);
  one.begin(0, -1, 0, 7, 5);
  assert.equal(one.shouldWait(), false, 'cursor = 0 ⇒ 不等（这就是语料里最后写 `i0d4 1 2` 的原因）');

  // 空表：连 `i0d4` 都没有
  const none = new StageLoop();
  none.begin(0, -1, 0, 7, 5);
  assert.equal(none.shouldWait(), false, 'cursor = -1 ⇒ 不等');
});

test('调度判定：`now - t0 >= t` 才算到点；未到点**不消费**条目（引擎 `Sleep(v6)` 后 return）', () => {
  const s = new StageLoop();
  s.add(10, 2, 100, 200);
  s.begin(1000, -1, 0, 7, 5); // t0 = 1000

  assert.equal(s.nextStep(1009), null, '9 ms：未到点');
  assert.equal(s.index, 0, '★未到点不消费（否则会整条整条地丢）');
  assert.deepEqual(s.nextStep(1010), { index: 0, label: 100, behind: false }, '恰好到点 ⇒ 派发 op3');
  assert.deepEqual(s.nextStep(1020), { index: 1, label: 100, behind: false }, '→ 派发第二条（同一对 label）');
  assert.equal(s.nextStep(9999), null, '表已空 ⇒ null');
});

test('"落后"入口：下一条也已过期 ⇒ 走 `op4`（引擎 raw 13656-13658 的 `v8`）', () => {
  const s = new StageLoop();
  s.add(10, 2, 100, 200);
  s.begin(0, -1, 0, 7, 5);
  // elapsed = 25：本条 t=10 已过，下一条 t=20 **也**已过 ⇒ behind
  assert.deepEqual(s.nextStep(25), { index: 0, label: 200, behind: true }, '落后 ⇒ 走 op4');

  const s2 = new StageLoop();
  s2.add(10, 2, 100, 200);
  s2.begin(0, -1, 0, 7, 5);
  assert.deepEqual(s2.nextStep(10), { index: 0, label: 100, behind: false }, '不落后（20 - 10 > 0）⇒ 走 op3');

  // 最后一条没有"下一条" ⇒ 永远不算落后
  const s3 = new StageLoop();
  s3.add(10, 1, 100, 200);
  s3.begin(0, -1, 0, 7, 5);
  assert.deepEqual(s3.nextStep(999), { index: 0, label: 100, behind: false }, '没有下一条 ⇒ behind 恒 false');
});

test('脚本身份守卫：起表后脚本被换掉 ⇒ 放弃时间表（引擎 `Depth が不正です` raw 13660-13669）', () => {
  const s = new StageLoop();
  s.add(10, 2, 100, 200);
  s.begin(0, -1, 3, 0x5250, 5);
  assert.equal(s.ownedBy(3, 0x5250), true);
  assert.equal(s.ownedBy(4, 0x5250), false, '帧号变了');
  assert.equal(s.ownedBy(3, 0x5251), false, '脚本身份变了');
});

// ---------------------------------------------------------------------------
// 2) 帧循环接线
// ---------------------------------------------------------------------------

test('帧循环：`i0d5` 置 `0x40` 门 ⇒ 本帧不派发；到点后派发 label，体 `ret` 回到 `i0d5` 再判', async () => {
  // step=40ms ≫ 16ms 帧 ⇒ 每条都在自己的帧里到点（不触发"落后"），
  // 派发 4 条 = 条目数(5) − 1：前 3 条走第一段的 op3（body），第 4 条走第二段的 op3（= tail 标签）。
  const e = mkScript(stageScript(40, [3, 2]));
  const { r, frames } = await runStage(e, 16);

  assert.equal(r.stopReason, 'exit', '表跑完后脚本继续往下走（落到收尾 abort）');
  assert.equal(localInt(e, 0), 3, '★派发 4 次里的前 3 次走 body');
  assert.equal(localInt(e, 1), 1, '第 4 次走第二段登记的 op3（= tail 标签）');
  assert.equal(e.stage.entries.length, 5);
  assert.equal(e.stage.index, 4, '5 个条目只消费 4 个（★派发次数 = 条目数 − 1）');
  assert.equal(e.waitFlags & STAGE_GATE, 0, '收工时门已清（否则脚本会被永久钉住）');
  assert.ok(frames >= 4, `时间表必须**摊在多帧**上（实际 ${frames} 帧）`);
});

test('帧循环：时钟粒度粗于 step ⇒ 下一条也已过期 ⇒ 走 `op4`（"落后"入口，catch-up）', async () => {
  const e = mkScript(stageScript(10, [3, 2]));
  const { r, clock } = await runStage(e, 100); // 每帧 +100ms ≫ step=10
  assert.equal(r.stopReason, 'exit');
  assert.equal(localInt(e, 1), 4, '★全部走 op4（落后）');
  assert.equal(localInt(e, 0), 0, '一次 op3 都没走');
  assert.ok(clock <= 600, `落后的时间表应当很快追上（实际 ${clock}ms）`);
});

test('帧循环：`gates.stage === "ignore"` ⇒ 不做时间判定，每帧推进一步（headless/tracer 档）', async () => {
  const e = mkScript(stageScript(10, [3, 2]));
  const { r } = await runStage(e, 0, { gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore', stage: 'ignore' } });
  assert.equal(r.stopReason, 'exit', '零时钟下也必须能跑完（否则会永远卡在门上）');
  assert.equal(localInt(e, 0), 3);
  assert.equal(localInt(e, 1), 1);
});

// ---------------------------------------------------------------------------
// 3) E3：真语料
// ---------------------------------------------------------------------------

test('★E3：SAVE.BIN 的 label_0000706c 段 —— 32 条时间表派发 31 次、耗时 ~481 ms 摊在多帧上', async (t) => {
  const bin = path.join(resolveResourceDir(REPO), 'SAVE.BIN');
  if (!fs.existsSync(bin)) {
    t.skip(`本机没有 ${bin}`);
    return;
  }
  const script = parseScriptBytes(new Uint8Array(fs.readFileSync(bin)));
  const at = (dword: number): number => {
    const i = script.instructions.findIndex((x) => x.index === dword);
    assert.notEqual(i, -1, `dword 偏移 ${dword} 应是一条指令的起点`);
    return i;
  };
  // `src/SAVE.txt:1643-1648` 的 label_0000706c：i0d3 / i0d4 / i0d4 / i0d5 / ret
  const i0d3 = at(7180);
  assert.equal(script.instructions[i0d3]!.opcode, 0xd3, 'dword 7180 应是 i0d3');
  const i0d5 = at(7199);
  assert.equal(script.instructions[i0d5]!.opcode, 0xd5, 'dword 7199 应是 i0d5');
  const afterRet = at(7203); // i0d5 之后那条 ret(7202) 的下一条 = label_000070c8（脚本体入口）
  const i0d4a = script.instructions[i0d3 + 1]!;
  assert.equal(i0d4a.opcode, 0xd4);
  assert.deepEqual(
    i0d4a.args.map((a) => a.raw),
    [0x10, 0x1e, 0x1c23, 0x1c26],
    'op3/op4 是 label（dword 7203/7206 ⇒ 文件偏移 0x70c8/0x70d4）',
  );
  assert.deepEqual(
    script.instructions[i0d3 + 2]!.args.map((a) => a.raw),
    [1, 2, 0x1c26, 0x1c26],
    '★收尾哨兵：`i0d4 1 2 label_000070d4 label_000070d4`',
  );

  const e = mkScript([]);
  loadScriptIntoFrame(e.curScript(), script, 'SAVE.BIN', 0x0);
  e.curScript().ip = i0d3; // 直接落到 `call label_0000706c` 的目标（省掉整个存档 UI 链路）
  const box = { clock: 0 };
  const host: FrameHost = { now: () => box.clock };
  let lastFrameStart = -1;
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 500,
    present: 'never',
    audio: 'never',
    onFrameStart: (now) => {
      lastFrameStart = now;
    },
    // 收工点：`i0d5` 之后那条 `ret` 执行完、落回脚本体入口（= 时间表已跑完且脚本已越过 i0d5）
    stopAfterStep: (tr, eng) => tr.opcode === RET && eng.curScript().ip === afterRet,
    onFrameEnd: () => {
      box.clock += 16;
    },
  });
  assert.equal(r.stopReason, 'step-stop', `应停在"越过 i0d5"那一刻（实际 ${r.stopReason}: ${String(r.error ?? '')}）`);
  // ★局部槽号在 `.txt` 里是**十六进制**：`add (local-int 210) …` = 槽 0x210 = 528。
  assert.equal(localInt(e, 0x210), 31, '★`add (local-int 210) (local-int 210) 1` 共 31 次 = 32 条目 − 1');
  assert.equal(e.stage.entries.length, 32);
  assert.equal(e.stage.index, 31);
  assert.ok(lastFrameStart >= 481, `最后一条的到期时刻是 481 ms（实际 ${lastFrameStart}ms）`);
  assert.ok(lastFrameStart <= 600, `不得远超时间表（实际 ${lastFrameStart}ms）`);
  assert.ok(r.frames >= 25, `★31 次派发必须摊在多帧（实际 ${r.frames} 帧）—— 塌成一帧就是实现错了`);
});

test('★E3：`src/SAVE.txt` 的形态棘轮（i0d3 / i0d4 / i0d4 / i0d5 连续 5 行）', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'SAVE.txt'), 'utf8');
  assert.match(
    src,
    /i0d3\s*\ni0d4 10 1e label_000070c8 label_000070d4\s*\ni0d4 1 2 label_000070d4 label_000070d4\s*\ni0d5 ffffffff/,
    'SAVE.txt:1644-1647 的存档动画时间表',
  );
});

test('注册表：0xD3/0xD4/0xD5 都是 `implemented`（不再是"仅映射"）', () => {
  for (const op of [0xd3, 0xd4, 0xd5]) assert.ok(OPS.has(op), `0x${op.toString(16)} 应在 OPS 里`);
});
