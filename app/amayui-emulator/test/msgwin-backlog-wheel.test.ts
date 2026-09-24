/** @tier T0 @kind core @subsystem adv */

/**
 * **滚轮「文本回看」游标**（引擎 `sub_411BC0` raw 20341-20363；
 * 审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4.2 的 **#14**
 * `msgwin-backlog-cursor` 的 missing-consumer，`tickets/T-0167`）。
 *
 * ## 引擎体逐字（`v2` = 本帧输入掩码指针，`v8 = _this + 85296` = 文本对象）
 * ```c
 * if ( (*(_DWORD *)(_this + 699204) & 0x40000000) != 0 )        // 20341：★ADV 位（= CHAR_REVEAL_ACTIVE）
 * {
 *   v7 = Conf(set:WheelKeyUp);                                  // 20343：**掩码位号**（默认 3）
 *   v8 = (_DWORD *)(_this + 85296);
 *   if ( ((1 << v7) & *v2) != 0 )                               // 20345：上滚键位命中
 *   {
 *     sub_459770(v8, -1, 2);                                    // 20347：游标**后退一行**
 *     *(_DWORD *)(_this + 489816) = -1;                         // 20348：回看方向 = -1
 * LABEL_21:
 *     *(_DWORD *)(_this + 699204) |= 0x100000u;                 // 20350：置"跳读中"位（**|=**，不是赋值）
 *     sub_411560((_DWORD *)_this, aCallbackTextBi);              // 20351：跑 CALLBACK_TEXT.BIN（未建模，见下）
 *     *v2 = 0; goto LABEL_44; }                                 // 20352：消费掉这次输入
 *   if ( sub_459770(v8, 1, 2) )                                 // 20355：前进一行（★这一行**没有**键位前置判）
 *   { *(_DWORD *)(_this + 489816) = 1; goto LABEL_21; }          // 20357-20358
 *   *(_DWORD *)(_this + 489816) = 0; }                           // 20360：无回看事件
 * *v2 = 0; goto LABEL_44;                                        // 20362
 * ```
 * `sub_459770`（raw 70574-70627）就是 `src/vm/textItems.ts:320` 的 `TextItemTable.moveCursor`
 * —— 本文件钉住的正是「它**真的被产品路径调用**」这件事（修前零调用点 ⇒ 死代码）。
 *
 * ## emulator 的三处口径（照抄引擎，别"顺手修正"）
 * 1. **整个块被 `effect_flags & 0x40000000` 门控**（raw 20341）—— 那是 `CHAR_REVEAL_ACTIVE`
 *    （▼ 图标 / 逐字显现位），所以"ADV 位不在"时滚轮键什么也不做（连 `489816` 都不写）。
 * 2. **上滚那支不检查 `moveCursor` 的返回值**（raw 20347 的返回值被丢掉），只有**下滚那支**才把它
 *    当门（raw 20355 `if (sub_459770(...))`）⇒ 页表为空时"上滚"照样把 `489816` 记成 `-1` 并置跳读位。
 * 3. **raw 20355 没有 `1 << Conf(set:WheelKeyDown)` 的前置 `& *v2`**（对照 20345 是有的）——
 *    反编译里 `v7` 只在 20343 被赋过值，所以这一行实际是"上滚键没命中时试着**前进**一格"。
 *    本文件的"下滚"用例因此走的是"上滚键位不按、靠 fallthrough 前进"这条引擎原样路径。
 *
 * ## 页表夹具为什么给六页、起点两两不同（`moveCursor` 的**非对称**记账，与 `T-0095` 的记录一致）
 * `moveCursor(-1, …)` 的**当前实现**不是"走一格就停"：新游标所在页的起点若与**出发页**的起点相同
 * （raw 70616 的 `v9 !== from` 去重判据），它**不返回**而是继续往回走（实测：页起点 =
 * `[0,3,3]`、从游标 2 出发时会一路走到游标 0）。那是 `0x1D0`/`sub_459770` 自己的记账规则
 * （本文件不改它、也不靠它），但用它做断言就会把"走了几格"与"记账规则"混在一起
 * ⇒ 夹具给**起点两两不同**的页（`PAGE_STARTS`），让"后退一格/前进一格"都有唯一确定的结果。
 *
 * ## 已知缺口（明确登记）
 * `sub_411560(Engine, "CALLBACK_TEXT.BIN")`（raw 20351）**未建模** —— 它 = `sub_455000`（按名取
 * 统一文件 id）+ `sub_40FC90`（入队 + `sub_40FB60` 立即派发），而 emulator 的按名装载口
 * （`FileSource.readScriptByName`）目前唯一调用点是读档的 `CALLBACK_LOAD.BIN`（`T-0072`），
 * **没有**"装载回调脚本并把控制立刻交给它"的机制 ⇒ 这一跳不假装（可观测后果：真机上滚轮回看会
 * 弹出回看画面，emulator 里只回拨游标 + 置跳读位）。**重开条件** = 补上那条按名装载/派发口。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { ITEM_REFLOW } from '../src/vm/textItems.js';
import { CHAR_REVEAL_ACTIVE } from '../src/vm/engine.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, mkEngine } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 引擎 `Engine[122454]`（字节 489816）：**文本回卷方向**（-1 后退 / 0 无 / +1 前进）。 */
const FIELD_TEXT_REWIND = 122454;

/**
 * 页起点夹具（**两两不同**）。
 *
 * ★为什么要这么造：`moveCursor` 的去重基准是**出发页的 `start`**（raw 70589），而夹具里几页共用同一个
 * `start` 时（例如一页只有一条记录、起点连续相同），"后退一格"到底落在哪一页取决于中间那些同值页
 * —— 那是 `0x1D0`/`sub_459770` 自己的记账规则，与本处要钉的"泵真的调了它"无关
 * ⇒ 夹具给**两两不同的起点**，让方向断言唯一确定。
 * 第 0 页的 `0` 还是引擎 `while (v6)` 的哨兵（raw 70657）⇒ 它只能当"最旧那一页"。
 */
const PAGE_STARTS = [0, 3, 4, 5, 6, 7];

/**
 * 一套 ADV 现场：面板已显示（raw 20239 的 `Engine[51828]`）+ 等待门已置（bit31）+
 * 回看页表 `PAGE_STARTS`（游标初值 = 末页）。
 */
function mkScene(): {
  e: ReturnType<typeof mkEngine>;
  step: (op: number, args?: BinArg[]) => void;
} {
  const ops = Array.from({ length: 11 }, () => instr(0x72, [im(0)]));
  const e = mkEngine(ops, 'ADV.BIN');
  const step = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
  };
  const geometry = [im(0), im(640), im(120), im(0), im(500)];
  step(0x94); // 面板已显示
  // `0x70`（窗几何）末尾会 push 回看页（raw 73181-73191），`0x1D2` push 文本记录；
  // 页起点 = push 时刻的记录条数（raw 73183）⇒ 交替推进两条计数轴即可精确造出 PAGE_STARTS。
  step(0x70, geometry); // 页 0：start = 0
  for (const key of [1, 2, 3]) step(0x1d2, [im(key), im(key * 10)]); // 记录 → 3
  step(0x70, geometry); // 页 1：start = 3
  for (const [i, key] of [4, 5, 6, 7].entries()) {
    step(0x1d2, [im(key), im(key * 10)]); // 记录 +1
    step(0x70, geometry); // 页 i+2：start = 4/5/6/7
  }
  assert.deepEqual(
    e.textItems.pages.map((p) => p.start),
    PAGE_STARTS,
    '前置：页起点 = push 时刻的记录条数（raw 73183 `v17[1] = v15`）',
  );
  assert.equal(e.textItems.cursor, PAGE_STARTS.length - 1, '前置：游标在末页（`pushPage` 把双游标都指向新末项）');
  assert.equal(e.textItems.records.length, 7, '前置：七条文本记录');
  step(0x72, [im(0)]); // 等待门 bit31
  assert.equal(e.awaitingAdvance, true, '前置：等待门必须已置（否则泵不跑）');
  return { e, step };
}

/**
 * 把"滚轮键位"配成某个掩码位（引擎 `1 << Conf(set:WheelKeyUp/Down)` —— 配的是**位号**，
 * 不是按钮序号），并把 ↑（VK 38，运行期 VK→位表给掩码位 0）按住当"滚轮键"。
 *
 * 键盘是唯一能造"任意掩码位"的注入源（`InputManager.pressKey` 走运行期表，`tickets/T-0163`）。
 */
function armWheelKey(e: ReturnType<typeof mkEngine>, upBit: number, downBit: number): void {
  const cfg = { values: new Map<string, number>(), sections: [] as string[], order: new Map<string, string[]>() };
  cfg.values.set('set:wheelkeyup', upBit);
  cfg.values.set('set:wheelkeydown', downBit);
  e.config = cfg as never;
  assert.equal(e.input.pressKey(38), true, '前置：VK 38（↑）命中运行期 VK→位表 ⇒ 掩码位 0');
  assert.ok((e.input.keysHeld & 1) !== 0, '前置：↑ 的按住态落在掩码位 0');
}

test('★上滚键位按下 ⇒ `TextItemTable.moveCursor` 真的被调用（游标后退）+ `489816 = -1` + 置 0x100000（raw 20345-20352）', () => {
  const { e } = mkScene();
  armWheelKey(e, 0, 7); // 上滚键位 = bit0（按住）⇒ 命中 raw 20345 那一支
  e.effectFlags |= CHAR_REVEAL_ACTIVE; // raw 20341 的门（ADV 位）
  e.textItems.cursor = 4; // 从页 4 出发：后退一格 = 页 3（起点两两不同 ⇒ 唯一确定）
  const flagsBefore = e.effectFlags | 0;
  assert.equal(e.serviceAdvanceWait(), true, '回看被消费 ⇒ 本帧算"处理过一次推进"');
  assert.equal(e.textItems.cursor, 3, '★`sub_459770(v8, -1, 2)`（raw 20347）：游标后退一行');
  assert.equal(e.engineValues.get(FIELD_TEXT_REWIND), -1, '★raw 20348：Engine[489816] = -1（回看方向）');
  assert.equal(
    e.effectFlags & 0x100000,
    0x100000,
    '★raw 20350：`|= 0x100000`（跳读中位）—— `advancePressed`（raw 20265）拿它当门',
  );
  assert.equal(e.effectFlags & flagsBefore, flagsBefore, '★是 `|=` 不是赋值：原有位必须都保住');
  // ★`*v2 = 0`（raw 20352）在 emulator 里 = 把这次输入从**待处理**里拿掉。引擎那格 `*v2` 是
  //   WndProc 的挂起位累加器（不是"物理键还按着"）⇒ **按住态本身不清**（清它反而是发明语义）。
  assert.equal(e.input.keyEdge, 0, 'raw 20352 的 `*v2 = 0` ⇒ 按下沿被消费');
  assert.equal(e.input.mouseEdge, 0, 'raw 20352 的 `*v2 = 0` ⇒ 鼠标按下沿也一并清');
  assert.equal(
    e.input.flushPending(),
    0,
    '★复核：下一次刷掩码（泵每帧的 `sub_478090`）时这次滚轮键**不再出现**（"消费掉这次输入"的落点）',
  );
});

test('★下滚键位按下（走上滚键未命中的 fallthrough）⇒ 游标前进 + `489816 = +1`（raw 20355-20358）', () => {
  const { e } = mkScene();
  armWheelKey(e, 7, 0); // "上滚键位" = bit7（不按）⇒ 落到 raw 20355 那一支
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  e.textItems.cursor = 0; // 从页 0 出发：前进一格 = 页 1（唯一确定）
  assert.equal(e.serviceAdvanceWait(), true);
  assert.equal(e.textItems.cursor, 1, '★raw 20355：`sub_459770(v8, 1, 2)` ⇒ 前进一行');
  assert.equal(e.engineValues.get(FIELD_TEXT_REWIND), 1, '★raw 20357：`489816 = +1`');
  assert.equal(e.effectFlags & 0x100000, 0x100000, 'raw 20350：同样置跳读位（`goto LABEL_21`）');
});

test('★页表走不动 ⇒ `489816 = 0` 且**不置** 0x100000（raw 20355 的假分支 + 20360）', () => {
  const { e } = mkScene();
  armWheelKey(e, 7, 0); // 上滚键不按 ⇒ raw 20355 那支
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  assert.equal(e.textItems.cursor, PAGE_STARTS.length - 1, '前置：末页');
  assert.equal(e.textItems.moveCursor(1, ITEM_REFLOW), 0, '（直接复核）末页再前进 ⇒ 撞 LIVE 哨兵 ⇒ 0');
  assert.equal(e.serviceAdvanceWait(), false, '没走动 ⇒ 本帧不算"处理过一次推进"');
  assert.equal(e.engineValues.get(FIELD_TEXT_REWIND), 0, '★raw 20360：`489816 = 0`（无回看事件）');
  assert.equal(e.effectFlags & 0x100000, 0, '★没走动 ⇒ 到不了 LABEL_21 ⇒ 不置跳读位');
  assert.equal(
    e.textItems.cursor,
    PAGE_STARTS.length - 1,
    '游标仍在末页（`moveCursor` 的失败路径把游标退回末项，raw 70603）',
  );
});

test('ADV 位（`effect_flags & 0x40000000`）不在 ⇒ 滚轮键**什么也不做**（raw 20341 的门）', () => {
  const { e } = mkScene();
  armWheelKey(e, 0, 7);
  e.effectFlags &= ~CHAR_REVEAL_ACTIVE; // ★清掉 raw 20341 的门（等待门 bit31 仍在）
  assert.equal(e.awaitingAdvance, true, '前置：等待门仍在 ⇒ 泵仍会跑');
  const cursorBefore = e.textItems.cursor;
  e.serviceAdvanceWait();
  assert.equal(e.textItems.cursor, cursorBefore, '★ADV 位不在 ⇒ 游标不动');
  assert.equal(
    e.engineValues.get(FIELD_TEXT_REWIND),
    undefined,
    '★连 489816 都不写（整块在 raw 20341 的 `if` 里；门外只有 20362 的 `*v2 = 0`）',
  );
  assert.equal(e.effectFlags & 0x100000, 0, '跳读位不置');
});

test('★它是 `TextItemTable.moveCursor` 的**唯一产品消费者**：引擎体里那句 `sub_459770(v8, ∓1, 2)` 必须留在 ADV 泵里', () => {
  // 源码棘轮：审计把这条 finding 定性为 "missing-consumer（零调用点）"，
  // 所以判据不能只靠行为（行为可以被别处实现），必须同时钉住"泵里真的调了 moveCursor"。
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'vm', 'engine.ts'), 'utf8');
  assert.match(
    src,
    /moveCursor\(-1,\s*ITEM_REFLOW\)/,
    '引擎 raw 20347 的 `sub_459770(v8, -1, 2)` 必须在 ADV 泵里（-1 = 后退一行，第 3 实参 2 = ITEM_REFLOW）',
  );
  assert.match(
    src,
    /moveCursor\(1,\s*ITEM_REFLOW\)/,
    '引擎 raw 20355 的 `sub_459770(v8, 1, 2)` 必须在 ADV 泵里（+1 = 前进一行）',
  );
});
