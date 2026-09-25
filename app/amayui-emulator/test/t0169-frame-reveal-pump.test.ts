/** @tier T0 @kind core @subsystem adv */

/**
 * **`T-0169` 判据②的守卫**：逐字显现帧（`textRevealing`）到底该做什么。
 *
 * ## 判据②的结论（读体复核，落在 `src/frame/loop.ts` 的 `text-reveal` 分支注释里）
 * 原票的框架「逐字帧不跑等待泵」**是归属错**：`serviceRevealAdvanceInput`/`serviceTextReveal`
 * 的对口是 **`sub_409400`**（主循环 raw 21176-21181 的 `0x20000000` 臂），`serviceAdv` + 恰好一条
 * `dispatch()` 的对口是 **`sub_411900`**（raw 20158-20165），`serviceAdvanceWait` 的对口是
 * **`sub_411BC0`**（raw 21224-21226）。引擎主循环尾部（raw 21176-21228）是 if/else-if/else 链
 * ⇒ 逐字位为 1 时等待泵那一臂**根本到不了**，且 `0x20000000` 在整段显现期间一直为 1
 * （只有 raw 13892/13919/13940/13964 四条收尾路径清它）⇒ **互斥是忠实的，不拆**。
 *
 * ⇒ 于是"按体补齐"的落点是 `sub_409400` 自己缺的那两支（本文件用例 1、2）与 `sub_411900`
 * 的「恰好一条指令」在体里唯一的例外（用例 3）：
 *  - 用例 1：`Engine[388212]`（`_this[97053]`）闩锁支 —— raw 13917-13930 读 / raw 13941 写；
 *  - 用例 2：三条分支的对口与"逐字帧 0 条 / 显示态帧 1 条"的机械钉法；
 *  - 用例 3：`set:CancelMesSkipOnClick == 2` 的**整帧早退**（raw 20133-20136，连那条指令都不做）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADV_ACTIVE, Engine } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, mkEngine, str } from './harness.js';

/** 引擎 `_this[97053]`（= 字节 388212）= `sub_409400` 的「贴完整页出口已消费过这一页」闩锁。 */
const FIELD_388212 = 97053;

/**
 * **造一个"两指令页 + 手动派发"的现场**（`harness.ts` 的 `mkEngine` + `makeCtx` 的薄包装；
 * 名字刻意不叫 `mk`/`mkEngine`/`makeCtx` —— 那三个是 `test/harnessScan.ts` 的棘轮口径，
 * 新增第二份 fixture 实现是违规的，见 `tickets/T-0020`）。
 */
function revealScene(ops: BinInstruction[]): { e: Engine; run: (op: number, args?: BinArg[]) => void } {
  const e = mkEngine(ops, 'REVEAL.BIN');
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 40); // 非 0 ⇒ 真逐字（0 = 同步排空）
  const f = e.curScript();
  const run = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
  };
  return { e, run };
}

/** 固定 60fps 虚拟时钟（帧号 × 一帧时长）—— 本文件的帧推进一律走共享驱动 `runFrameLoop`。 */
function tickHost(): { host: FrameHost; advance: () => void } {
  const box = { frame: 0 };
  return {
    host: { now: () => (box.frame * 1000) / 60 },
    advance: () => {
      box.frame++;
    },
  };
}

test('★sub_409400 的 Engine[388212] 闩锁支（raw 13917-13930 读 / raw 13941 写）：点击贴完后中途再武装 ⇒ 一次贴完', () => {
  const { e, run } = revealScene([
    instr(0x6e, [im(0), str('ABCDEFGH')]),
    instr(0x72, [im(0)]),
  ]);
  run(0x6e, [im(0), str('ABCDEFGH')]);
  run(0x72, [im(0)]); // 武装逐字（`beginReveal` + bit30 + 等待门）
  assert.equal(e.textRevealing, true, '前置：逐字必须已武装，否则下面三条断言无意义');
  const w = e.msgwin.resolveWin(e.msgwin.lastArg);
  assert.equal(e.msgwin.reveal.get(w)?.shown, 0, '前置：还没显字');
  assert.equal(e.engineValues.get(FIELD_388212) ?? 0, 0, '前置：闩锁初值 0（`0x6E`/`0x72` 的 raw 28557 清它）');

  // 逐字期间点击 ⇒ 贴完整页（raw 13940-13945）**并置闩锁**（raw 13941 `Engine[388212] = 1`）
  e.input.pressMouse(0);
  assert.equal(e.serviceRevealAdvanceInput(), true, '点击被"贴完整页"出口消费');
  assert.equal(e.engineValues.get(FIELD_388212), 1, '★raw 13941：`Engine[388212] = 1`（跨帧闩锁）');
  assert.equal(e.msgwin.reveal.get(w)?.active, false, '本页已贴完（自旋 `sub_45BE20` 的等价物）');

  // 真实触发场景 = `0x196 display-furigana` 在同一句里续写（raw 29093 置 `0x20000000`，但**不**清 97053）
  // ⇒ 摹拟它重新武装显现（`0x6E`/`0x72` 会清闩锁，所以这里直接调 `beginReveal`）。
  const now = e.nowMs;
  e.msgwin.beginReveal(w, 8, now, 40);
  assert.equal(e.textRevealing, true, '前置：闩锁还在时又武装了一页');

  // 泵的一次调用（raw 13917-13930）：清闩锁 + **一次贴完**（不是"推一个字"）
  e.serviceTextReveal(now);
  assert.equal(e.engineValues.get(FIELD_388212) ?? 0, 0, '★raw 13919：闩锁被泵消费（只走一次）');
  assert.equal(e.msgwin.reveal.get(w)?.shown, 8, '★raw 13920 的 `while (!sub_45BE20(...))`：一帧贴完整页');
  assert.equal(e.textRevealing, false, '贴完后不再"显现中"');

  // ★负对照（判别力）：闩锁为 0 时同一调用**只推一个字** ⇒ 上面那两条不是"本来就一帧贴完"
  const { e: e2, run: run2 } = revealScene([
    instr(0x6e, [im(0), str('ABCDEFGH')]),
    instr(0x72, [im(0)]),
  ]);
  run2(0x6e, [im(0), str('ABCDEFGH')]);
  run2(0x72, [im(0)]);
  const w2 = e2.msgwin.resolveWin(e2.msgwin.lastArg);
  assert.equal(e2.engineValues.get(FIELD_388212) ?? 0, 0, '负对照：闩锁为 0');
  e2.serviceTextReveal(e2.nowMs + 1000); // 给足节拍（40ms/字）也只是**推一个字**
  assert.equal(e2.msgwin.reveal.get(w2)?.shown, 1, '· 无闩锁 ⇒ 一次调用只推一个字（不补拍）');
});

test('★判据②的分支对口：逐字帧（= sub_409400）一条指令都不派发；显示态帧（= sub_411900）恰好 1 条', async () => {
  // 两个**确定性的单帧**现场（比"跑一串脚本看分支序列"稳）：逐字帧与显示态帧各跑一帧、数指令条数。
  const host: FrameHost = { now: () => 0 };
  const opt: FrameLoopOptions = {
    gates: { anim: 'ignore', sleep: 'wait', advance: 'pump', stage: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: true,
    maxStepsPerFrame: 4,
    maxFrames: 1,
    present: 'never',
  };

  // ---- 显示态帧（`effect_flags & 0x8000000`）= 引擎 `sub_411900`：恰好 1 条（raw 20161-20165） ----
  const adv = mkEngine(
    [instr(0x6e, [im(0), str('A')]), instr(0x6e, [im(0), str('B')]), instr(0x6e, [im(0), str('C')])],
    'ADVFRAME.BIN',
  );
  adv.effectFlags |= ADV_ACTIVE;
  let advSteps = 0;
  let advBranch = '';
  await runFrameLoop(adv, host, {
    ...opt,
    onGate: (b) => {
      advBranch = b;
    },
    onStep: () => {
      advSteps++;
    },
  });
  assert.equal(advBranch, 'adv', '★ADV 位在 ⇒ 走 adv 分支（= sub_411900，raw 21158-21160）');
  assert.equal(advSteps, 1, '★raw 20161-20165：显示态每轮**恰好派发 1 条**指令');

  // ---- 逐字帧（`textRevealing`）= 引擎 `sub_409400`（raw 21176-21181 的 0x20000000 臂）：0 条 ----
  const rev = mkEngine(
    [instr(0x6e, [im(0), str('ABCDEFGH')]), instr(0x6e, [im(0), str('I')]), instr(0x6e, [im(0), str('J')])],
    'REVFRAME.BIN',
  );
  const w = rev.msgwin.resolveWin(0);
  rev.msgwin.beginReveal(w, 8, 0, 40); // 逐字中
  rev.awaitingAdvance = true; // ★同时把等待门也立起来：逐字臂必须**先**被选中（引擎里它排在 bit31 之前）
  assert.equal(rev.textRevealing, true, '前置：逐字必须真的在跑');
  let revSteps = 0;
  let revBranch = '';
  await runFrameLoop(rev, host, {
    ...opt,
    onGate: (b) => {
      revBranch = b;
    },
    onStep: () => {
      revSteps++;
    },
  });
  assert.equal(revBranch, 'text-reveal', '★逐字中 ⇒ text-reveal 分支（= sub_409400），不是 advance 分支（= sub_411BC0）');
  assert.equal(
    revSteps,
    0,
    '★逐字帧**一条指令都不派发**：引擎在 raw 21176-21181 的「0x20000000」臂里只跑泵，LABEL_215（raw 21217）到不了',
  );
});

test('★sub_411900 取消消息键三态机（raw 20115-20143）：按下消费掩码位 / 到 2 时 eatAllInput / == 2 整帧早退', async () => {
  const cfgOf = (v: string): Engine['config'] =>
    ({ values: new Map([['set:cancelmesskiponclick', v]]), sections: [], order: new Map() }) as unknown as Engine['config'];

  // ---- 三态机的"四拍"（raw 20117-20141 逐拍） ----
  const { e, run } = revealScene([instr(0x71, [im(1)])]);
  e.config = cfgOf('2');
  run(0x1ca, [im(1)]); // 打开 `message:ReadTextSkip` ⇒ 下一步的 `0x71` 才置 ADV（raw 28442-28443）
  run(0x71, [im(1)]);
  e.msgwin.showing = 1;
  e.msgwin.skipMode = 1; // 让 `serviceAdv` 不停在"显示完"那一支（与 adv-msgwin 同法）
  e.input.buttons = 0;
  assert.equal(e.serviceAdv(), true, '空闲帧：ADV 仍在');
  assert.equal(e.msgwin.cancelStage, 1, '★raw 20141：位为 **0** 的那一帧走 0 ⇒ 1（不是按下那帧）');
  e.input.buttons = 1; // 按住（无新按下沿；实时刷 sub_4780D0 才看得到）
  assert.equal(e.serviceAdv(), true, '按住帧：ADV 仍在');
  assert.equal(e.msgwin.cancelStage, 2, '★raw 20121-20122：只有 stage 1 才升 2');
  assert.equal(
    e.input.inputMask & 0x10,
    0,
    '★raw 20120 `*v2 &= ~0x10u`：按下那一帧就把这一位从掩码格（`input.inputMask`）里拿掉',
  );
  e.input.buttons = 0; // 松开
  assert.equal(e.serviceAdv(), false, '★raw 20126-20129：2 ⇒ 0 那一帧清 ADV');
  assert.equal(e.msgwin.cancelStage, 0);
  assert.equal(e.msgwin.readTextSkip, 0, '★raw 20131-20132：`Engine[97050] = 0` + `SetConfig("message:ReadTextSkip", 0)`');

  // ---- == 2 的整帧早退（raw 20133-20136）：连"那一条指令"都不做 ----
  const e2 = mkEngine([instr(0x6e, [im(0), str('A')]), instr(0x6e, [im(0), str('B')]), instr(0x6e, [im(0), str('C')])], 'CANCEL.BIN');
  e2.config = cfgOf('2');
  e2.effectFlags |= ADV_ACTIVE; // ADV 位在 ⇒ 帧循环选 adv 分支（= sub_411900）
  e2.msgwin.cancelStage = 2; // 上一帧按住过
  e2.input.buttons = 0; // 本帧已松开 ⇒ 走 2 ⇒ 0 那一支
  const { host, advance } = tickHost();
  let steps = 0;
  let branch = '';
  await runFrameLoop(e2, host, {
    gates: { anim: 'ignore', sleep: 'wait', advance: 'pump', stage: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: true,
    maxFrames: 1,
    onGate: (b) => {
      branch = b;
    },
    onStep: () => {
      steps++;
    },
    onFrameEnd: () => advance(),
  });
  assert.equal(branch, 'adv', '前置：本帧必须走 adv 分支（= sub_411900）');
  assert.equal(e2.advFrameAborted, true, '★raw 20136：`GetConfig(...) == 2` ⇒ 整帧早退（交给帧驱动）');
  assert.equal(steps, 0, '★raw 20136 的 `return` 在 raw 20161 之前 ⇒ **本帧那条指令不派发**');

  // ---- 负对照：键值 1（非 2）时**不早退**，同一帧照常派发 1 条 ----
  const e3 = mkEngine([instr(0x6e, [im(0), str('A')]), instr(0x6e, [im(0), str('B')])], 'CANCEL1.BIN');
  e3.config = cfgOf('1');
  e3.effectFlags |= ADV_ACTIVE;
  e3.msgwin.cancelStage = 2;
  e3.input.buttons = 0;
  const h3 = tickHost();
  let steps3 = 0;
  await runFrameLoop(e3, h3.host, {
    gates: { anim: 'ignore', sleep: 'wait', advance: 'pump', stage: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: true,
    maxFrames: 1,
    onStep: () => {
      steps3++;
    },
    onFrameEnd: () => h3.advance(),
  });
  assert.equal(e3.advFrameAborted, false, '负对照：键值 1 ⇒ 不早退');
  assert.equal(steps3, 1, '负对照：照常派发恰好 1 条');
});

/** 反谎报：本文件钉住的三个泵名必须仍在 `Engine` 上（防止有人"合并"掉某个泵）。 */
test('★本文件钉住的三个泵名仍是 Engine 的公开服务', () => {
  const e = mkEngine([]);
  for (const m of ['serviceRevealAdvanceInput', 'serviceTextReveal', 'serviceAdvanceWait'] as const) {
    assert.equal(typeof e[m], 'function', `Engine.${m} 必须是函数（判据②的分支对口靠它）`);
  }
});
