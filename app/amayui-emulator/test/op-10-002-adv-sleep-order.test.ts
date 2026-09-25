/** @tier T0 @kind core @subsystem adv */

/**
 * 审计 `op-10-002`：`0x6E` 的 MessageSpeed 节流**只在 ADV 位未置时**才装门，且帧循环里
 * **ADV 分支必须排在 `sleep` 门之前**。
 *
 * 引擎 `sub_41EB20`（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 * ```c
 * _this[174801] |= 0x8000000u;                     // 28358：LABEL_10/跳读路径刚置 ADV
 * LABEL_11:
 * if ( !_this[21668] || (_this[174801] & 0x8000000) != 0 ) {   // 28361
 *     … return sub_46CBF0(_this + 21324, v9, v12, 0, v15);     // 28368：同步排空
 * } else {
 *     result = sub_46BE30(...);                                // 28375
 *     if ( result ) {
 *         _this[174801] |= 0x20000000u;                        // 28380
 *         return sub_453A60(_this + 107643, v7);               // 28382：计时器
 *     }
 * }
 * ```
 * `sub_46CBF0` 真身 raw 83999-84009 只有 `sub_46BE30` + `while(!sub_45BE20)` 自旋 —— **无 Sleep**。
 *
 * 主循环次序（同文件）：
 * ```c
 * 21109  if ((v35 & 0x400) == 0) break;      // 动画等待门
 * 21154  if ((v35 & 0x40) == 0) break;       // 阶梯门
 * 21158  if ((v35 & 0x8000000) == 0) break;  // ★ADV 循环：sub_411900 + 池冻结 + Sleep(0)
 * 21176  if ((v35 & 0x20000000) != 0) { sub_409400(_this); … }   // ★MessageSpeed 节流/逐字泵
 * ```
 * ⇒ ADV 位清掉之前**走不到** `0x20000000` 那一支。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFrameLoop, type FrameBranch } from '../src/frame/loop.js';
import { ADV_ACTIVE, SLEEP_GATE } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, mkEngine, str } from './harness.js';

/** `message:MessageSpeed` 的测试取值（引擎 `Engine[21668]`）。 */
const SPEED = 40;

test('op-10-002：ADV 位已置时 `0x6E` **不装** MessageSpeed 门（raw 28361 的同步排空支 / raw 28368）', async () => {
  const e = mkEngine([instr(0x6e, [im(1), str('あ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, SPEED);
  // ★2026-09 订正（`T-0151`）：修前这里只置 `97050`（`skipMode`）就指望 `0x6E` 置 ADV ——
  //   那是把引擎"门开时查不到内容 ⇒ 跳读位**保持** 122455"（raw 28352）接到了**门关闭**的路上。
  //   体里门关时 `97050` 不参与（raw 28339-28343）。⇒ 要架出"ADV 已置"必须走**真实置位路径**：
  //   打开 `message:ReadTextSkip` 门（门开 + 本指令就是新消息 ⇒ raw 28442-28443 置 ADV）。
  e.msgwin.readTextSkip = 1; // 门开（等价于脚本 `i1ca 1`）
  e.msgwin.skipMode = 1; // 引擎 `97050` ≠ 0（`0x88 message-mode`）
  await stepOnce(e);
  assert.equal(e.advActive, true, '`0x6E` 走了置 ADV 的那条路（raw 28442-28443）');
  assert.equal(e.waitFlags & SLEEP_GATE, 0, '★ADV 已置 ⇒ 走 `sub_46CBF0`，不得装 `0x20000000`');
  assert.equal(e.sleepUntil, 0, '也不得装计时器（`sub_453A60` 只在 raw 28382）');
});

test('op-10-002：ADV 未置（`message:ReadTextSkip` = 0）时照旧装门（raw 28380/28382 的 else 支）', async () => {
  const e = mkEngine([instr(0x6e, [im(1), str('あ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, SPEED);
  e.nowMs = 1000;
  await stepOnce(e);
  assert.equal(e.advActive, false, 'ReadTextSkip=0 ⇒ 不置 ADV');
  assert.equal(e.waitFlags & SLEEP_GATE, SLEEP_GATE, '非 ADV 且 MessageSpeed > 0 ⇒ 装 `0x20000000`');
  assert.equal(e.sleepUntil, 1000 + SPEED, '计时器 = now + MessageSpeed（`sub_453A60` 的等价物）');
});

test('op-10-002：MessageSpeed = 0 时两支都不装门（raw 28361 的第一个析取项）', async () => {
  const e = mkEngine([instr(0x6e, [im(1), str('あ')])]);
  // 不设 messageSpeed ⇒ messageSpeedOf = 0
  await stepOnce(e);
  assert.equal(e.waitFlags & SLEEP_GATE, 0);
  assert.equal(e.sleepUntil, 0);
});

/**
 * ★2026-09-25 订正（`T-0151` 收尾复查；红 `['adv','sleep']` vs 期望 `['adv','adv']`）——**前提被取代**：
 *
 * 本用例的**主张**（"ADV 分支排在 sleep 门之前"）没错，错的是它把主张与**载荷**绑在了一起：
 * 旧的单一子例用 `0x101`（`poll-input`）当"每帧恰好 1 条"的载荷，并断言两帧都走 ADV。
 * 而 `0x101` 的体**自己就清 ADV 位**：`sub_419CC0` raw **25077** `_this[174801] &= ~0x8000000u;`
 * —— 这一行此前在 emulator 里**没实现**，所以旧期望才成立；`T-0158` 的 owner 按体补上之后，
 * 第 1 帧派发 `0x101` ⇒ ADV 位被清 ⇒ 第 2 轮不再进 ADV 循环（raw 21158），而落到
 * `if ((v35 & 0x20000000) != 0) { sub_409400(_this); … }`（raw **21176**）⇒ 门序列必然是
 * `['adv','sleep']`。**这正是引擎的行为**，不是回退。
 *
 * ⇒ 最小 retarget（保留主张、保留全部锚点串、并把真值钉得更强）：拆两个子例 ——
 *  ① **次序证明**用**惰性载荷** `0x1a7`（= `op_comment`，`CONTROL_OPS` 里的纯 no-op，body `() => undefined`）
 *     ⇒ 两帧都必须 `adv`（`SLEEP_GATE` 已置且 `sleepUntil` 远未到点，仍被 ADV 抢先就是本主张的定义）；
 *  ② **同一场景 + `0x101`** ⇒ 钉 `['adv','sleep']` 与"第 1 帧仍是 ADV"（次序）+"ADV 被 `0x101` 清掉"
 *     （raw 25077 的因果）。两条合起来比旧断言强：旧断言只钉了 `['adv','adv']`，无法区分
 *     "次序对" 与 "载荷没副作用"。
 */
test('op-10-002：ADV 位与 SLEEP_GATE 同时置位 ⇒ 帧循环先服务 ADV（引擎 raw 21158 早于 raw 21176）', async () => {
  /** 两帧、每帧 1 条载荷；返回门序列、帧数与引擎态。 */
  const runPair = async (op: number) => {
    const e = mkEngine([instr(op, []), instr(op, [])]);
    e.effectFlags |= ADV_ACTIVE | SLEEP_GATE;
    e.sleepUntil = 1_000_000; // 远未到点：若被 sleep 门拦住，两帧都空转
    e.msgwin.skipMode = 1; // 让 `serviceAdv` 的收尾判定保留 ADV（raw 20144 的 `!(mask & 0x40)` 反例）
    e.msgwin.skipMirror = 1;
    let clock = 0;
    const gates: FrameBranch[] = [];
    const r = await runFrameLoop(
      e,
      { now: () => clock },
      {
        gates: { anim: 'ignore', sleep: 'wait', advance: 'ignore' },
        services: { winReveal: false, charGrid: false },
        advFrame: true,
        maxStepsPerFrame: 1,
        maxFrames: 2,
        onGate: (b) => gates.push(b),
        onFrameEnd: () => {
          clock += 1000 / 60;
        },
      },
    );
    return { e, gates, steps: r.steps };
  };

  // ① 次序证明（惰性载荷：`0x1a7` = `op_comment`，不碰 ADV / 输入 / 消息窗）
  const inert = await runPair(0x1a7);
  assert.deepEqual(inert.gates, ['adv', 'adv'], '★两帧都必须走 ADV 分支（修前走 sleep ⇒ 空等 MessageSpeed）');
  assert.equal(inert.steps, 2, 'ADV 分支每帧派发恰好 1 条');
  assert.notEqual(inert.e.effectFlags & ADV_ACTIVE, 0, '前提复核：惰性载荷下 ADV 位两帧都还在');

  // ② 同一场景 + `0x101`：体里清 `0x8000000`（raw 25077）⇒ 第 2 帧落到 sleep（raw 21176）
  const poll = await runPair(0x101);
  assert.deepEqual(
    poll.gates,
    ['adv', 'sleep'],
    '★`0x101` 自清 ADV（sub_419CC0 raw 25077）⇒ 第 2 轮不再进 ADV 循环（raw 21158）、改走 raw 21176',
  );
  assert.equal(poll.e.advActive, false, '`0x101` 执行后 `effect_flags & 0x8000000 == 0`（raw 25077）');
  assert.equal(poll.steps, 1, '第 2 帧在 sleep 门里空等（`sleepUntil` 远未到点）⇒ 只派发 1 条');
});

test('op-10-002：没有 ADV 时 sleep 门照旧生效（改动没有把 sleep 门整个绕掉）', async () => {
  const e = mkEngine([instr(0x101, []), instr(0x101, [])]);
  e.effectFlags |= SLEEP_GATE;
  e.sleepUntil = 1_000_000;
  let clock = 0;
  const gates: FrameBranch[] = [];
  const r = await runFrameLoop(
    e,
    { now: () => clock },
    {
      gates: { anim: 'ignore', sleep: 'wait', advance: 'ignore' },
      services: { winReveal: false, charGrid: false },
      advFrame: true,
      maxStepsPerFrame: 1,
      maxFrames: 2,
      onGate: (b) => gates.push(b),
      onFrameEnd: () => {
        clock += 1000 / 60;
      },
    },
  );
  assert.deepEqual(gates, ['sleep', 'sleep'], 'ADV 未置 ⇒ 仍由 sleep 门拦住');
  assert.equal(r.steps, 0, '门没到点 ⇒ 一条都不派发');
});
