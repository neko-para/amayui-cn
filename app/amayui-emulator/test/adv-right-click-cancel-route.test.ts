/** @tier T0 @kind core @subsystem adv */

/**
 * **等待泵的右键「取消 / 跳读」路由**（引擎 `sub_411BC0` raw 20365-20374；
 * 审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4.2 的 **#1**
 * `adv-advance-route-table`，`tickets/T-0167`）。
 *
 * ## 引擎体逐字（`v2` = 本帧输入掩码指针）
 * ```c
 * if ( (*(_BYTE *)v2 & 0x20) == 0 ) { …悬停/推进/滚轮… }
 * v6 = *(_DWORD *)(_this + 383104);                              // 20365：当前帧号
 * *v2 = 0;                                                       // 20366：消费掉这次输入
 * if ( *(_DWORD *)(_this + 4 * v6 + 489488) == -1 ) return;      // 20367-20368：★本帧没注册 ⇒ 直接 return
 * *(_DWORD *)(_this + 489808) = *(_DWORD *)(_this + 699204) | 0x6000000;  // 20369
 * *(_DWORD *)(_this + 699204) = 0;                               // 20370：清**整个** effect_flags
 * *(_DWORD *)(_this + 489812) = (…383128 − …383124) >> 2;        // 20371：本帧指令条数
 * *(_DWORD *)(_this + 430712) = *(_DWORD *)(_this + 120*v6 + 383184);      // 20372：本帧脚本身份
 * *(_DWORD *)(_this + 120*v6 + 383128) = …383124 + 4 * *(_DWORD *)(…489488);  // 20373-20374：★改写帧 ip
 * ```
 * `489488 + 4*cur` 就是 `0xCC`（`mouse-callback`，raw 30322 `_this[107664] = sub_41BF50(_this, 2)`）
 * 注册的 **mouseJump label**（dword 偏移）—— emulator 侧即 `InputManager.mouseJump`。
 *
 * ## 修前 / 修后（本文件的判据）
 * 修前 emulator 只有「右击 ⇒ 整段悬停/推进被跳过」那半句（`hoverDispatchAllowed()` 里的
 * `mask & 0x20`）⇒ **ip 不变、`effect_flags` 不清**。修后：
 *  - 注册过 mouseJump ⇒ 帧 ip **改写**到该 label、`effect_flags` 清 0、
 *    `redisplayMode` 记 `flags | 0x6000000`、`redisplayScriptId` 记本帧脚本身份；
 *  - 未注册（`-1`）⇒ **什么都不变**（ip/effect_flags/两个引擎格都不动）。
 *
 * ★`489808`/`430712` 复用 `ENGINE_FIELD.redisplayMode`(122452) / `ENGINE_FIELD.redisplayScriptId`(107678)
 * —— 与 `0x199`（重显示）/`0x7C`（local-ret）是**引擎里同一批格子**（raw 20369-20372 与
 * raw 20872-20876 的 `0x4000000` 分支逐字同形）⇒ 那两个既有读者对右键取消天然成立。
 * `489812`（= `ENGINE_FIELD.redisplayReturn`(122453)）**有意不写**：它要求"回调脚本跑完那一刻的
 * dword 偏移"，而 emulator 不装载 `CALLBACK_TEXT.BIN` ⇒ 写了会把 ip 还原到错的地方。见
 * `engine.ts` 的 `#cancelRoute` 注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { ADVANCE_GATE, CHAR_REVEAL_ACTIVE } from '../src/vm/engine.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, mkEngine } from './harness.js';

/**
 * 本帧的 `0xCC`（mouse-callback）注册 —— raw 30317-30325。
 *
 * `slot`（op1）= `0xCD` 的推进间隔（`sub_453A60` 写 `Engine+107447[6]`，`tickets/T-0047`），
 * `jump`（op2）= 本帧 mouseJump label 的 **dword 偏移**（raw 30322 `_this[107664] = 读 op2`）。
 */
function registerMouseCallback(e: ReturnType<typeof mkEngine>, slot: number, jump: number): void {
  const h = OPS.get(0xcc);
  assert.ok(h, '0xCC（mouse-callback）必须已注册');
  h!(makeCtx(e, e.curScript(), instr(0xcc, [im(slot), im(jump)]), e.native, () => {}));
}

/**
 * 建一帧 ADV 现场（**用 `harness.ts` 的 `mkEngine`**）：11 条 `i72`（`wait-for-input`）、
 * 面板已显示（`0x94` ⇒ raw 20239 的 `Engine[51828]` 门）、等待门已置（bit31），
 * 并把 label `0x2140` 手工挂到第 4 条指令上（`0xCC` 的 mouseJump 表项指向它）。
 *
 * ★不叫 `mk`/`makeCtx`/`mkEngine`：那四个名字是 `test/harnessScan.ts` 的扫描口径
 * （`tickets/T-0020` 的棘轮基线），本项目**不许新增**自造变体 —— 本函数只是 `mkEngine` +
 * `step()` 的薄包装，不是第二份 fixture 实现。
 */
function advPumpScene(registerJump: number | null): {
  e: ReturnType<typeof mkEngine>;
  step: (op: number, args?: BinArg[]) => void;
} {
  const ops = Array.from({ length: 11 }, () => instr(0x72, [im(0)]));
  const e = mkEngine(ops, 'ADV.BIN');
  const f = e.curScript();
  const LABEL = 0x2140;
  f.labelMap.set(LABEL, 4);
  if (registerJump !== null) registerMouseCallback(e, 0x10, registerJump);
  const step = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
  };
  step(0x94); // 面板已显示（raw 20239 的 Engine[51828] 门）
  step(0x72, [im(0)]); // 置等待门 bit31
  assert.equal(e.awaitingAdvance, true, '前置：等待门必须已置（否则泵不跑）');
  return { e, step };
}

test('★右键（掩码 bit5）在 0xCC 注册过 mouseJump 时**改写帧 ip** + 清整个 effect_flags（raw 20369-20374）', () => {
  const LABEL = 0x2140;
  const { e } = advPumpScene(LABEL);
  const f = e.curScript();
  const ipAtGate = f.ip;
  // 右键按下：掩码 bit5（`sub_477150` 的右键位）
  e.input.pressMouse(1);
  const saved = (ADVANCE_GATE | CHAR_REVEAL_ACTIVE | 0x8) >>> 0;
  e.effectFlags = saved | 0;
  // 同一次还能看到轮询得到的掩码
  assert.equal(
    e.serviceAdvanceWait(),
    false,
    '右键取消路由 raw 20368/20374 都不落 LABEL_44 ⇒ 不算"处理过一次推进"',
  );
  assert.equal(f.ip, f.labelMap.get(LABEL), '★raw 20373-20374：帧 ip 必须被改写到该 label');
  assert.notEqual(f.ip, ipAtGate, '前置：ip 确实变了（不是"本来就在那儿"）');
  assert.equal(e.effectFlags, 0, '★raw 20370：清**整个** effect_flags');
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayMode) ?? 0,
    (saved | 0x6000000) | 0,
    '★raw 20369：489808（= 122452 redisplayMode）= 旧 flags | 0x6000000',
  );
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayScriptId),
    f.scriptId,
    '★raw 20372：430712（= 107678 redisplayScriptId）= 本帧脚本身份（`0x7C` 的深度校验读它）',
  );
  assert.equal(
    e.awaitingAdvance,
    false,
    '★等待门 bit31 是 `effect_flags` 的**位** ⇒ raw 20370 清整个 flags 时它一起没了；' +
      '引擎靠回调脚本末尾的 `0x7C`（raw 25810 `effect_flags = 489808 & 0xFDFFFFFF`）把它恢复回来',
  );
  assert.equal(f.retStack.length, 0, '★引擎这里是**直接改写 ip**（不是 sub_405360 调用形态）⇒ 不压返回点');
  assert.equal(e.input.keysHeld | e.input.keyEdge, 0, '（前置校验）本用例只注入了鼠标');
});

test('★未注册 mouseJump（表项 -1）⇒ **什么都不变**（引擎 raw 20367-20368 直接 return）', () => {
  const { e } = advPumpScene(null);
  const f = e.curScript();
  // 显式走一次 `0xCC -1`：引擎 raw 30322 原样写 -1 ⇒ 与"从未注册"同值
  registerMouseCallback(e, 0x10, -1);
  assert.equal(e.input.mouseJump, -1, '前置：mouseJump 必须是 -1');
  const ipAtGate = f.ip;
  const flags = (ADVANCE_GATE | CHAR_REVEAL_ACTIVE) | 0;
  e.effectFlags = flags;
  e.input.pressMouse(1);
  assert.equal(e.serviceAdvanceWait(), false);
  assert.equal(f.ip, ipAtGate, '★ip 不动');
  assert.equal(e.effectFlags, flags, '★effect_flags 不动（不清）');
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayMode),
    undefined,
    '★redisplayMode（489808）不被写',
  );
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayScriptId),
    undefined,
    '★redisplayScriptId（430712）不被写',
  );
  assert.equal(e.awaitingAdvance, true, '门保持');
});

test('右键分支排在滚轮块**之后**：ADV 位在 + 滚轮键同时按下时，右键仍然照 raw 20365 收口', () => {
  // 把"滚轮键位"配成鼠标**右键**的掩码位（bit5），制造"raw 20315 的门 + 20341 的滚轮块同时命中"
  // 的极端输入。引擎 raw 20315-20321 的分支结构保证：右键时**永远**走 20365，滚轮块（20341）到不了。
  const cfg = { values: new Map<string, number>(), sections: [] as string[], order: new Map<string, string[]>() };
  const LABEL = 0x2140;
  const { e } = advPumpScene(LABEL);
  e.config = cfg as never;
  cfg.values.set('set:wheelkeyup', 5); // `1 << 5` = 鼠标右键的掩码位
  const f = e.curScript();
  e.effectFlags |= CHAR_REVEAL_ACTIVE; // ADV 位在 ⇒ raw 20341 的滚轮块**本来会进**
  e.input.pressMouse(1); // 掩码 bit5：既是右键，又是"上滚键位"
  assert.equal(e.serviceAdvanceWait(), false);
  assert.equal(f.ip, f.labelMap.get(LABEL), '★右键那一支赢：ip 照 raw 20373-20374 被改写');
  assert.equal(e.effectFlags, 0, '★整个 effect_flags 被清（含 CHAR_REVEAL_ACTIVE / ADVANCE_GATE）');
  assert.equal(
    e.effectFlags & 0x100000,
    0,
    '★滚轮回卷块（20341-20363）没跑 ⇒ 不置"跳读中"位（它在 20350 才置）',
  );
});
