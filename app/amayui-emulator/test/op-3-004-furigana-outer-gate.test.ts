/** @tier T1 @kind core @subsystem text */

/**
 * 审计 `op-3-004`（`tickets/T-0094`）：`0x196 display-furigana` 的**外层门**（raw 29071）+
 * 第①②路的 **MessageSpeed 节流半边**（raw 29075-29095）。
 *
 * 引擎 `sub_41FC20`（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 * ```c
 * 29055  v2 = sub_41B640((_DWORD *)_this, 2);   // op2 → 拷进栈缓冲 v20（a3 = 本行文本）
 * …      （op3 = 注音，同样拷进 v20 之后的缓冲，raw 29056-29070）
 * 29071  v7 = (*(_BYTE *)(_this + 489988) & 1) == 0;   // ★外层门：489988/4 = 下标 122497
 * 29073  if ( v7 ) {                                   //   文本块位**未置** ⇒ 第①②路
 * 29075      if ( !*(_DWORD *)(_this + 86672) || (*(_DWORD *)(_this + 699204) & 0x8000000) != 0 ) {
 * 29081          return sub_46CBF0(...);               //     MessageSpeed=0 或 ADV=1 ⇒ 同步排空
 * 29083      } else {
 * 29088          result = sub_46BE30(...);
 * 29089          if ( result ) {
 * 29093              *(_DWORD *)(_this + 699204) |= 0x20000000u;   //     节流门（= SLEEP_GATE）
 * 29095              return sub_453A60((_DWORD *)(_this + 430572), v12);  // 节拍计时器 = MessageSpeed
 * 29099  } else {                                     //   文本块位**已置**（`0x304`…`0x305` 之间）⇒ 第③路
 * 29104      result = sub_46BE30(...);
 * 29105      if ( result ) {
 * 29108          *(_DWORD *)(_this + 489988) |= 0x10000u;          //     bit16
 * 29109          *(_DWORD *)(_this + 489484) = result;             //     = msgwin.lastArg
 * ```
 * `0x304`（`sub_41A420` raw 25392 `_this[122497] = 1`）置的就是这个 bit0。
 *
 * 三具被调函数的体（`T-0094` 的证据）：
 *  - `sub_46BE30`（raw 83363-83995）= 把"本行 + 注音"排进该窗记录（raw 83918 `sub_45D120` push）；
 *    **无 Sleep / 无计时器 / 无自旋**；返回 **1** = 已排版，**0** = `*a3 == 0`（op2 空串，raw 83493-83497）
 *    ⇒ 返回值 = "本行有内容吗"。
 *  - `sub_46CBF0`（raw 83998-84010）= `Font[54630] = 1` → `sub_46BE30` → `Font[54630] = 0`
 *    → `do … while (!sub_45BE20(Font, op1))` **自旋**。⇒ 与 `sub_46BE30` 的差别**不在排版**，
 *    而在结尾"把该窗剩余行一次性泵完"（`sub_45BE20` = 行泵，raw 72172）；体内**没有 Sleep、不起计时器**。
 *  - `sub_453A60(Engine+430572, ms)`（raw 66100-66112）= MessageSpeed 节拍计时器对象
 *    （`t[5] = timeGetTime()` 起点、`t[6] = ms` 周期，`ms == 0 ⇒ 1`，raw 66108-66110）⇒ **单位 ms**。
 *    到期判定 `sub_453B60(Engine+430572)`（raw 66188-66212）：未到点返回 **-1**，到点返回 `>= 0`；
 *    主循环 raw 21176 是它的读者，清位点在 `sub_409400` 的 raw 13892/13919/13940/13964。
 *
 * emulator 的对应物（复用既有机制，不新造）：`SLEEP_GATE` + `e.sleepUntil`（与 `0x6E` raw 28380/28382、
 * `0x71` 的节流同源），放行与清位在 `src/frame/loop.ts` 的 `sleep` 分支。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { chainResourceDir } from '../src/tools/config1Chain.js';
import { parseScriptBytes, type BinInstruction, type ScriptBinary } from '../src/script/bin.js';
import { runFrameLoop } from '../src/frame/loop.js';
import { ADV_ACTIVE, SLEEP_GATE } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { im, instr, mkEngine, str } from './harness.js';

/** `message:MessageSpeed` 的测试取值（引擎 `Engine[86672]` = `Font+1376`）。 */
const SPEED = 40;

test('op-3-004：`0x304` 置位后 `0x196` 走引擎第③路（raw 29099-29109）', async () => {
  const e = mkEngine([instr(0x304, []), instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 40); // MessageSpeed ≠ 0（第③路不看它）
  await stepOnce(e); // 0x304 → `Engine[122497] = 1`
  assert.equal(e.msgwin.flags & 1, 1, '0x304 置 bit0（raw 25392）');
  await stepOnce(e); // 0x196
  assert.equal(e.msgwin.flags & 0x10000, 0x10000, '★第③路 raw 29108：`_this[489988] |= 0x10000`');
  assert.equal(e.waitFlags & SLEEP_GATE, 0, '第③路不装节流门（raw 29099-29111 里没有 0x20000000）');
  assert.equal(e.msgwin.lastArg, 1, 'raw 29109：`_this[489484] = op1`（= msgwin.lastArg）');
  assert.deepEqual(
    e.msgwin.slot(1).segments.map((s) => [s.text, s.ruby]),
    [['天結', [['天結', 'あまゆ']]]],
    '入队照旧（注音 + 本文词进正文）',
  );
});

test('op-3-004：文本块位未置时 `0x196` **不得**写 bit16（外层门的另一半）', async () => {
  const e = mkEngine([instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  await stepOnce(e);
  assert.equal(e.msgwin.flags & 1, 0, '没有 0x304 ⇒ bit0 = 0（`v7` 为真）');
  assert.equal(e.msgwin.flags & 0x10000, 0, '★bit16 只由第③路写（raw 29108）');
  assert.equal(e.msgwin.lastArg, 1, 'raw 29077/29094/29109：三条出口都写 `_this[489484] = op1`');
});

// ---------------------------------------------------------------------------
// 第①②路的 MessageSpeed 节流半边（`T-0094` 正向断言）
// ---------------------------------------------------------------------------

test('op-3-004 ★缺口棘轮（正向）：MessageSpeed≠0 且 ADV 未置 ⇒ 第①②路必装节流门 + `0x20000000`（raw 29075/29093/29095）', async () => {
  const e = mkEngine([instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, SPEED);
  e.nowMs = 1000;
  await stepOnce(e);
  assert.equal(e.advActive, false, 'ADV 未置 ⇒ 引擎走 raw 29083 的 else 支（不是同步排空支）');
  assert.equal(e.msgwin.flags & 1, 0, 'bit0 未置 ⇒ 第①②路');
  assert.equal(e.waitFlags & SLEEP_GATE, SLEEP_GATE, '★raw 29093：`effect_flags |= 0x20000000` ⇒ 必须装 SLEEP_GATE');
  assert.equal(e.sleepUntil, 1000 + SPEED, '★raw 29095：`sub_453A60(Engine+430572, MessageSpeed)` ⇒ 到期 = now + MessageSpeed ms');
  assert.equal(e.advActive, false, '注音本身不置 ADV（`sub_46BE30` 不碰 0x8000000）');
  assert.equal(e.msgwin.flags & 0x10000, 0, 'bit16 仍只由第③路写');
});

test('op-3-004：ADV 位已置 ⇒ 第①②路**不装**节流门（raw 29075 的第二个析取项 ⇒ raw 29081 `sub_46CBF0`）', async () => {
  const e = mkEngine([instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, SPEED);
  e.nowMs = 1000;
  e.msgwin.skipMode = 1; // 让 `0x6E` 那条路的 `advanceReveal` 会保留显示态；这里直接置位更直白
  e.effectFlags |= ADV_ACTIVE;
  await stepOnce(e);
  assert.equal(e.advActive, true, '前提：ADV 已置');
  assert.equal(e.waitFlags & SLEEP_GATE, 0, '★ADV 已置 ⇒ 同步排空支，不得装 `0x20000000`');
  assert.equal(e.sleepUntil, 0, '也不得装计时器（`sub_453A60` 只在 raw 29095）');
  assert.equal(e.msgwin.lastArg, 1, '出口照旧写 lastArg');
});

test('op-3-004：MessageSpeed = 0 ⇒ 第①②路**不装**门（raw 29075 的第一个析取项 ⇒ 同步排空）', async () => {
  const e = mkEngine([instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  e.nowMs = 1000;
  await stepOnce(e);
  assert.equal(e.advActive, false, '前提：ADV 未置（这一支靠 MessageSpeed=0 短路）');
  assert.equal(e.waitFlags & SLEEP_GATE, 0, 'MessageSpeed == 0 ⇒ `sub_46CBF0`，不装门');
  assert.equal(e.sleepUntil, 0, '不起计时器');
});

// ---------------------------------------------------------------------------
// E3：真实脚本 `CONFIG1.BIN`（编译产物，含 `display-furigana`）跑一遍
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** 语料事实（`T-0094` 的规模计数，防"语料 i196 = 0"那条订正被回退）。 */
test('op-3-004 E3：`display-furigana` 在 `src/*.txt` 里有 6341 处（不是 0）', () => {
  const dir = path.join(ROOT, 'src');
  let hits = 0;
  let files = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.txt')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    let i = 0;
    let n = 0;
    while ((i = text.indexOf('display-furigana', i)) !== -1) {
      n++;
      i += 'display-furigana'.length;
    }
    if (n) files++;
    hits += n;
  }
  assert.equal(hits, 6341, '助记符字面量 `i196` 是 0 处，但名字形式 `display-furigana` 是 6341 处');
  assert.ok(files > 1, `分布在多个脚本里（实际 ${files} 个文件）`);
});

/**
 * 从真 `install/CONFIG1.BIN` 里取出**注音那一段**的指令（帧内下标序），两段：
 *  - `warmup` = 注音前那一条（真产物里是 `0x71 message-show 9`，raw 29071 那个外层门的"上下文"）；
 *  - `ops`    = 注音本身 + 紧跟其后的一条（`0x196` + `0x6E show-text`）。
 *
 * 真产物事实（`CONFIG1.BIN`，2378 条指令，`0x196` 恰好 1 处，帧内下标 2131）：
 * ```
 * 12663  0x8F …
 * 12666  0x71 9
 * 12669  0x196 0 "天俟" "天俟"       ← 汉化产物：`display-furigana 0 @"天结" @"天结"` 的 cp932 占位
 * 12676  0x6E 0 "神俣ＳＡＭＰＬＥ"   ← `show-text 0 @"神缘ＳＡＭＰＬＥ"`
 * 12681  0x6F 0
 * ```
 * `argc = 3` ⇒ 只有 `op1/op2/op3`，没有 `op4`（与 `scripts/asm/opcodes.json` 一致）。
 */
async function config1FuriganaOps(): Promise<{ warmup: BinInstruction; ops: BinInstruction[]; at: number }> {
  const src = new NodeFileSource({ resourceDir: chainResourceDir() });
  // ★`readByName` = 名字 → 条目 → **松散文件优先**：与链路跑手同一条读取路径。
  const boot = await src.readByName('CONFIG1.BIN');
  assert.ok(boot, 'install/CONFIG1.BIN 应可读（缺产物时先 `cd scripts && node translate.js assemble CONFIG1`）');
  const at = parseScriptBytes(boot.data).instructions.findIndex((x) => x.opcode === 0x196);
  assert.notEqual(at, -1, 'CONFIG1.BIN 里应有 `0x196`（汉化产物：`display-furigana 0 @"天结" @"天结"`）');
  const e = mkEngine([]);
  loadScriptData(e, boot.data, boot.name);
  const all = e.curScript().script!.instructions;
  return { warmup: all[at - 1]!, ops: [all[at]!, all[at + 1]!], at };
}

/**
 * **E3 场景级**：把真 `CONFIG1.BIN` 的那段序列放进帧循环，**虚拟时钟**每帧 +1000/60。
 *
 * `repeat` = 把"注音 + `show-text`"这对指令重复多少遍（> 1 用来放大每处的节拍差 ——
 * 单处只差 1 帧，会被帧粒度掩住；10 处就一眼看得出）。
 * 只开 `sleep` 门 ⇒ 帧循环只可能停在 `sleep` 那一条（`src/frame/loop.ts`）。
 */
async function runRealFuriganaUnderFrameLoop(
  speed: number,
  repeat: number,
): Promise<{ dispatched: { op: number; clock: number; frame: number }[]; clocks: number[] }> {
  const { warmup, ops } = await config1FuriganaOps();
  const pair: BinInstruction[] = [];
  for (let k = 0; k < repeat; k++) pair.push(ops[0]!, ops[1]!);
  const e = mkEngine([]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, speed);
  const script: ScriptBinary = {
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    ipTables: [[], [], []],
    instructions: [warmup, ...pair].map((o, i) => ({ ...o, index: i })),
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), script, 'REAL-FURIGANA.BIN');

  let clock = 0;
  let frame = 0;
  /** ★用 `onStepStart` 捕获**即将派发**的那条（`onStep` 里读 `e.currentOpcode` 会错位一条）。 */
  let pendingOp = -1;
  const dispatched: { op: number; clock: number; frame: number }[] = [];
  const clocks: number[] = [];
  await runFrameLoop(
    e,
    { now: () => clock },
    {
      gates: { anim: 'ignore', sleep: 'wait', advance: 'ignore' },
      services: { winReveal: false, charGrid: false },
      advFrame: false,
      maxStepsPerFrame: 100,
      maxFrames: 400,
      onFrameStart: (_ms, fr) => {
        frame = fr;
      },
      onStepStart: (_f, ins) => {
        pendingOp = ins?.opcode ?? -1;
      },
      onStep: () => dispatched.push({ op: pendingOp, clock, frame }),
      onFrameEnd: () => {
        clocks.push(clock);
        clock += 1000 / 60;
      },
    },
  );
  return { dispatched, clocks };
}

test('op-3-004 E3：真产物那对指令进了帧循环（`0x71` → 注音 → `show-text`，顺序不变）', async () => {
  const { dispatched } = await runRealFuriganaUnderFrameLoop(SPEED, 1);
  assert.deepEqual(dispatched.map((d) => d.op), [0x71, 0x196, 0x6e], '★三条都派发到了（顺序不变）');
  assert.equal(dispatched[1]!.clock, 0, '注音在虚帧 0 就派发了（它自己不等待）');
  assert.ok(
    dispatched[2]!.clock >= SPEED,
    `★场景级不变量：注音之后那条必须等满 MessageSpeed；实际 ${dispatched[2]!.clock}ms（引擎 raw 29093/29095 + 主循环 raw 21176）`,
  );
});

test('op-3-004 E3 ★节拍代价随 MessageSpeed 线性增长（10 处注音 ⇒ 场景级可观测的“少等一拍”）', async () => {
  const N = 10;
  const slow = await runRealFuriganaUnderFrameLoop(SPEED, N);
  const fast = await runRealFuriganaUnderFrameLoop(0, N);

  assert.deepEqual(
    slow.dispatched.map((d) => d.op),
    [0x71, ...Array.from({ length: N }, () => [0x196, 0x6e]).flat()],
    '★真产物的那对指令按序全部派发（没有丢步、没有卡死）',
  );
  assert.deepEqual(fast.dispatched.map((d) => d.op), slow.dispatched.map((d) => d.op), '两边的指令序列相同');

  const fastEnd = fast.dispatched.at(-1)!;
  assert.equal(fastEnd.frame, 0, 'MessageSpeed=0 ⇒ raw 29075 第一个析取项 ⇒ 全部落在第 0 帧（不等待）');
  assert.equal(fastEnd.clock, 0, '对照：整段一次跑完，虚拟时钟没动');

  const slowEnd = slow.dispatched.at(-1)!;
  assert.equal(slowEnd.op, 0x6e, '最后派发的是 `show-text`');
  // 每条 `show-text` 都排在一条注音之后 ⇒ 每条都要等 MessageSpeed
  const furs = slow.dispatched.filter((d) => d.op === 0x196);
  const shows = slow.dispatched.filter((d) => d.op === 0x6e);
  const deltas = shows.map((d, k) => d.clock - furs[k]!.clock);
  assert.equal(deltas.length, N, `应有 ${N} 条 show-text`);
  const frameMs = 1000 / 60;
  /**
   * ★`tickets/T-0099`：**到点当帧派发**之后，每处的代价必须是 `ceil(MessageSpeed / 帧长)` 帧
   * —— 40ms 档 = **3 帧 = 50ms**（引擎量级）。修前是"本帧只清门、下一帧才派发" ⇒ 4 帧 = 66.7ms。
   * 判据写成**双向**：
   *  - 上界 `ceil(SPEED/frameMs) * frameMs`（≈50ms）⇒ 多等一帧就红（这就是本票要修的那一帧）；
   *  - 下界同值 ⇒ **不许提前派发**（门没到点就派发 = 放宽门/丢节拍，比多等一帧更糟）。
   * 两界相等 ⇒ 40ms 档下 Δ 只能是 50ms（浮点容差 0.01）。
   */
  const wantFrames = Math.ceil(SPEED / frameMs);
  const wantDelta = wantFrames * frameMs;
  assert.equal(
    deltas.every((x) => Math.abs(x - wantDelta) < 0.01),
    true,
    `★每处必须恰好等 ${wantFrames} 帧（=${Math.round(wantDelta)}ms，引擎量级；修前 4 帧 = 66.7ms）；实际 Δ=${deltas.map((x) => Math.round(x)).join(',')}ms`,
  );
  assert.equal(
    deltas.every((x) => x >= SPEED),
    true,
    `★反向断言：任何一处都不得短于 MessageSpeed=${SPEED}ms（不许为了对齐帧而放宽门）`,
  );
  /**
   * ★场景级判据（这才是"每处少等一拍"的量化）：慢速那一段在**虚拟时钟**上花掉的时间
   * ≥ `N × MessageSpeed`，而 MessageSpeed=0 时是 **0 ms**。**修复前（不装门）两者都是 0**。
   */
  assert.ok(
    slowEnd.clock >= N * SPEED,
    `★慢速整段至少花掉 N×MessageSpeed=${N * SPEED}ms；实际 ${Math.round(slowEnd.clock)}ms`,
  );
  assert.ok(
    slowEnd.clock - fastEnd.clock >= N * SPEED,
    `★场景级差异 = ${Math.round(slowEnd.clock - fastEnd.clock)}ms（修复前这一项 = 0）`,
  );
  assert.equal(slow.clocks.length > fast.clocks.length, true, '慢速那次必须多花帧');
});

