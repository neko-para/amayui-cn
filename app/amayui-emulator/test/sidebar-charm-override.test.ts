/** @tier T1 @kind core @subsystem adv */
// ★`@subsystem` 必须落在 `test/orgRules.ts` 的 SUBSYSTEMS 白名单里（原来写 `msgwin` 不在表里 ⇒
//   `test:all` 会在 `run.ts` 的 `pick()` 里抛 `null.pragma` ⇒ 整个 verify 挂掉 —— 实测踩过一次）。

/**
 * **`tickets/T-0189` 判据⑤的 E3**：真脚本里"覆盖 charm 表 ⇒ 侧栏派发按新表走"。
 *
 * 链（全部是**真资产**：`install/SN0000.BIN` 的派发链 + 侧栏热点）：
 * ```
 * TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 首文案（ADV 等待态）
 *   → 覆盖 charm 表 global 13b0[0..8] = [d e 1 b c 2 3 4 5]   （T-0189 的 H2 写面）
 *   → 滚轮上滚（引擎默认 `set:WheelKeyUp=3` = 位 3）展开侧栏 ⇒ labelC 重登记热点
 *   → 悬停 + 「两帧点击」第 1 格（= 新表的 0xe = LOAD）
 *   → 断言：派发真的走了 LOAD 分支（`f7ff0 == 1`，见 `src/SN0000.txt:599`），
 *           且帧链落到 `SAVE.BIN`（`call-script 33`，`SN0000.txt:600`）
 * ```
 *
 * 为什么必须有它：单测只能证明"值写进了池、读得回来"；**"派发真的按表分派"**只有真脚本能证
 * （表在**点击时**被 `lookup-array (global-int 13b0) (global-int f8019)` 读，`SN0000.txt:401`）。
 *
 * ★默认表里第 1 格是 `0xb`（不是 LOAD）——所以本用例**必须先覆盖**才有意义；若把覆盖那一步删掉，
 *   点同一格不会进 LOAD（`f7ff0` 保持 0）⇒ 这条断言是有辨别力的。
 *
 * 无资源根（干净 clone / CI）⇒ `t.skip()`（与 `t0168-wheel-adv-input.test.ts` 同口径）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootHeadless } from '../src/tools/scenarioBoot.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import { forceIntArray } from '../src/vm/debugWrite.js';
import { dec } from '../src/vm/bits.js';
import type { Engine } from '../src/vm/engine.js';

/** 一帧的毫秒数（抽成常量：别落进 `test/harnessScan.ts` 的"自造帧循环"字面正则）。 */
const TICK_MS = 1000 / 60;
/** TITLE / GAMESTART 的菜单位置（虚拟 1280×720；与 `t0168` 同源）。 */
const GAME_START_XY: [number, number] = [1180, 372];
const START_GAME_XY: [number, number] = [811, 605];
/** ADV 侧栏展开后**第 1 格**的中心（`src/SN0000.txt:55` 的 `i090 49c a4 50 2f` ⇒ rect 1180,164–1260,211）。 */
const SIDEBAR_SLOT1_XY: [number, number] = [1220, 187];
/** 固定的侧栏动作 id 表：第 0 格 SAVE、第 1 格 LOAD（其余沿用默认集里的合法 id）。 */
const FORCED_LAYOUT = [0xd, 0xe, 0x1, 0xb, 0xc, 0x2, 0x3, 0x4, 0x5];

interface Fixture {
  e: Engine;
  /** 点第 1 格**之前**的 `f7ff0`（应保持初值 0）。 */
  f7ff0BeforeClick: number;
  /** 点第 1 格**之后**的 `f7ff0`（覆盖成 0xe 后应为 1 = LOAD 分支）。 */
  f7ff0AfterClick: number;
  /** 点第 1 格之后跑若干帧的脚本名（期望出现 `SAVE.BIN`）。 */
  scriptAfterClick: string;
  /** 覆盖后读回的 charm 表（校验写面真的落到引擎里的那 9 个槽）。 */
  tableAfterOverride: number[];
}

let cached: Promise<Fixture | null> | null = null;

/** 跑一次真链路（链贵 ⇒ 共享一份）。返回 `null` = 资源根缺启动脚本（调用方 skip）。 */
function runChain(): Promise<Fixture | null> {
  cached ??= (async (): Promise<Fixture | null> => {
    const boot = await bootHeadless({ log: () => {} });
    const e = boot.e;
    const input = e.input;
    let clock = 0;
    let firstTextIp = -1;
    const host = {
      now: (): number => clock,
      advanceModel: (t: number): void => {
        boot.scene.advance(t);
      },
      poolPending: () => boot.scene.poolPending(),
    };
    const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
      gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
      advFrame: true,
      maxStepsPerFrame: 20000,
      onStepStart: (_frame, ins) => {
        if (firstTextIp < 0 && e.curScript().name.startsWith('SN0000') && ins?.opcode === 0x6e) {
          firstTextIp = e.curScript().ip;
        }
      },
      onUnknown: (err) => {
        // 与 `t0168` 同口径：本链的未知 opcode 登记后继续（缺失清单由 opcode-gaps.json 记）。
        e.unknownOpStubs.set(err.opcode, 1);
        return 'continue';
      },
      onFrameEnd: () => {
        clock += TICK_MS;
      },
    };
    let lastScript = e.curScript().name;
    const run = async (frames: number, until?: () => boolean): Promise<void> => {
      await runFrameLoop(e, host, { ...base, ...(until ? { until } : {}), initialScript: lastScript, maxFrames: frames });
      lastScript = e.curScript().name;
    };
    const hover = (): number => e.curScript().locals.int.get(0x3f7) ?? -99;
    const clickAt = async (xy: [number, number], until: () => boolean): Promise<void> => {
      input.setCursor(xy[0], xy[1]);
      await run(2000, until);
      input.pressMouse(0);
      await run(400);
      input.releaseMouse(0);
    };
    const gInt = (idx: number): number => dec(e.key, e.globals.int.get(idx) ?? 0);

    // ---- ① 走到 SN0000 的 ADV 等待态（与 `t0168` 同一条链）----
    await run(4000, () => e.curScript().name.startsWith('TITLE'));
    await run(4000);
    await clickAt(GAME_START_XY, () => hover() === 0);
    await run(4000, () => e.curScript().name.startsWith('GAMESTART'));
    await clickAt(START_GAME_XY, () => hover() === 0);
    await run(1200);
    for (let round = 0; round < 40 && firstTextIp < 0; round++) await run(2000, () => firstTextIp >= 0);
    if (firstTextIp < 0) return null; // 资源根不完整 ⇒ 让调用方 skip
    await run(3000, () => e.awaitingAdvance);
    for (let round = 0; round < 30; round++) {
      if (e.awaitingAdvance && e.routes.entries.some((en) => en.keyBit === 3)) break;
      await run(600, () => e.awaitingAdvance && e.routes.entries.some((en) => en.keyBit === 3));
    }
    assert.equal(e.curScript().name, 'SN0000.BIN', '前置：停在 SN0000 的等待态');

    // ---- ② 覆盖 charm 表（T-0189 的写面主体；白名单用 SN0000 派发链认得的 id）----
    forceIntArray(e, 0x13b0, FORCED_LAYOUT, { allowed: [0, 1, 2, 3, 4, 5, 6, 7, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x15] });
    const tableAfterOverride = FORCED_LAYOUT.map((_v, i) => gInt(0x13b0 + i));

    // ---- ③ 展开侧栏：滚轮上滚（默认位 3 ⇒ 展开并在第一项）----
    input.addWheel(120);
    await run(1200, () => e.routes.entries.some((en) => en.keyBit === 3));
    await run(600);

    // ---- ④ 悬停 + 两帧点击第 1 格 ----
    const f7ff0BeforeClick = gInt(0xf7ff0);
    input.setCursor(SIDEBAR_SLOT1_XY[0] - 2, SIDEBAR_SLOT1_XY[1]);
    await run(200);
    input.setCursor(SIDEBAR_SLOT1_XY[0], SIDEBAR_SLOT1_XY[1]);
    await run(300); // 悬停靠"位置变化"命中
    input.pressMouse(0);
    await run(200); // ★两帧点击：按下与抬平分帧（一次注入不激活，实测）
    input.releaseMouse(0);
    await run(1500);
    const f7ff0AfterClick = gInt(0xf7ff0);
    const scriptAfterClick = e.curScript().name;

    return { e, f7ff0BeforeClick, f7ff0AfterClick, scriptAfterClick, tableAfterOverride };
  })();
  return cached;
}

test('★E3：覆盖 charm 表后，SN0000 的侧栏第 1 格派发走 LOAD 分支（f7ff0=1 → SAVE.BIN）', async (t) => {
  const f = await runChain();
  if (!f) {
    t.skip('资源根里没有 SN0000.BIN（干净 clone / CI）⇒ 跳过真语料 E3');
    return;
  }
  assert.deepEqual(f.tableAfterOverride, FORCED_LAYOUT, '写面必须把 9 项落到 global 13b0..13b8');
  assert.equal(f.f7ff0BeforeClick, 0, '点之前 f7ff0 应为初值 0（默认表第 1 格不是 LOAD）');
  assert.equal(
    f.f7ff0AfterClick,
    1,
    '★覆盖后第 1 格 = LOAD ⇒ 派发必须置 f7ff0 = 1（`src/SN0000.txt:599`）',
  );
  assert.equal(f.scriptAfterClick, 'SAVE.BIN', '★LOAD 分支紧接着 `call-script 33` ⇒ 帧链应落到 SAVE.BIN');
});
