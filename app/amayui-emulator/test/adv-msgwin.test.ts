/** @tier T0 @kind core @subsystem adv */

/**
 * **ADV / 消息窗状态机回归**（对应台账 `adv-flag-lifecycle` / `adv-perframe-dispatch` /
 * `adv-text-reveal-progress` / `msgwin-text-object`）。
 *
 * 背景（2026 实测）：emulator 跑到「等待输入态」时每秒执行约 60–100 万条指令。根因不是"缺个上限"，
 * 而是引擎的两条结构规则没有实现：
 *
 *  1. **`0x071` 无条件置 `effect_flags & 0x8000000`（ADV）且永不清除**。引擎只在「这段文本还在
 *     逐字显示中」时才置位，而那条路径受 `GetConfig("message:ReadTextSkip")` 门控（随包 INI = 0）。
 *     ADV 位被永久置住 ⇒ `0xC8 sleep` 的 `if (advActive) return` 让 TITLE 轮询循环里的 `sleep 1`
 *     整条失效 ⇒ 每帧吃满批上限。实测 1239 → 598000 步/秒。
 *  2. **`0x72 wait-for-input` 与 bit31 等待门未建模**。引擎 `0x72` 清完 ADV 后置
 *     `effect_flags |= 0x80000000`；主循环在该位下每帧只做 `sub_411BC0` + `Sleep(2)`，
 *     **不派发任何脚本指令** ⇒ 这才是"等待输入"的真实语义。
 *
 * 本测试锁住修正后的语义。raw 行号 = `engine/天结_unpacked.exe_utf8.c`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { Engine } from '../src/vm/engine.js';
import { Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { ENGINE_INTERNAL_OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { dec } from '../src/vm/bits.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { layoutWindow } from '../src/text/layout.js';
import { styleOfWin } from '../src/vm/handlers/msgwin.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, str, pickHoverLabel } from './harness.js';

/** 本帧 int 槽（type 0x9）—— 只有池操作数能做**写目标**，立即数不行。 */
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;


function mk(given?: Frame): { e: Engine; f: Frame; step: (op: number, args?: BinArg[]) => void } {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  // ★默认给一个"游离帧"（与 `e.curScript()` 不是同一个对象）—— 这是历史用法，很多老测试靠它；
  //   但凡是**让引擎按坐标做命中测试**（`sub_403C50` 写游标、泵读游标）的新测试，必须传
  //   `e.curScript()`（否则游标写在游离帧上、泵读的是 `e.curScript()`，两边不是同一个对象）。
  const f = given ?? new Frame();
  return {
    e,
    f,
    step: (op, args = []) => {
      const h = OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
      h!(makeCtx(e, f, instr(op, args), native, () => {}));
    },
  };
}

/**
 * **注册消息面面板**（引擎 `i094` → `sub_419230`）：置 `Engine[12957] = 1`（= `panelA[7463]`「面板已显示」）
 * + `sub_404020(panelA, 10000)`。
 *
 * ★为什么每条"等待推进"的测试都要先跑它：引擎的等待泵（`sub_411BC0` raw 20239）**整个被
 * `Engine[51828]`（= `panelA[7463]`）门控** —— 面板没显示时泵什么都不做。真实 ADV 脚本的
 * UI 例程末尾就是 `i094`（`src/SN0000.txt:117`），随后才 `wait-for-input`。
 */
function showPanel(step: (op: number, args?: BinArg[]) => void): void {
  step(0x94);
}

/**
 * **注入一次鼠标移动 + 左键按下**（引擎：`sub_4B8D50`（WM_MOUSEMOVE → `sub_403C50` 命中测试）
 * 然后 WM_LBUTTONDOWN）。
 *
 * ★必须**先移动再按下**：引擎的命中测试只在鼠标移动/面板首次显示时做，泵里不做
 * ⇒ 只 `pressMouse` 而不产生 `mouseMoved` 的话游标仍是旧的（引擎里也是这个语义）。
 */
function moveAndClick(e: Engine, x: number, y: number, btn: 0 | 1 = 0): void {
  e.input.setCursor(x, y); // 触发 onCursorMove ⇒ routes.hitTest（引擎 sub_4B8D50）
  e.input.pressMouse(btn);
}

test('0x6E show-text / 0x6F end-text-line / 0x196 display-furigana：文本内容按槽记录', () => {
  const { e, step } = mk();
  // ★真实剧本的用法（SC0330.txt:2501-2503 等 6341 处同型）：display-furigana 的 op2 **是正文的一部分**，
  //   用来把一句话从词中间切开 —— `…はぐれちゃったら` + `寂`(さび) + `しいよねー`。
  step(0x6e, [im(0), str('壁に')]);
  step(0x6e, [im(0), str('刻まれた')]); // 同一行继续追加
  step(0x196, [im(0), str('刻'), str('きざ')]); // ← 这个「刻」也要进正文
  step(0x6e, [im(0), str('んだ')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('次の行')]);
  assert.equal(e.msgwin.textOf(0), '壁に刻まれた刻んだ\n次の行');
  // ★op1=0 指**默认窗**（引擎 `if (!a2) a2 = Font[307]`；Font+1228 初值 1）
  assert.equal(e.msgwin.defaultWin, 1, '默认窗初值 = 1（引擎 Font+1228）');
  const first = e.msgwin.slot(e.msgwin.resolveWin(0)).segments[0]!;
  assert.deepEqual(first.ruby, [['刻', 'きざ']], '注音应挂在当前行');
  assert.match(first.text, /刻/, 'display-furigana 的本文词必须同时进正文（否则"汉字丢失"）');
  assert.equal(first.lineEnded, true, 'end-text-line 应断行');
  // 窗 0 自己没有内容（0 不是"窗 0"，而是"默认窗"）—— 这是 CONFIG1 能用 `show-text 0` + `i071 9` 的原因
  assert.deepEqual(e.msgwin.slot(0).segments, []);
});

test('★0x80 设默认窗后，op1=0 的文本指令落到该窗（CONFIG.txt:42 `i080 9` → CONFIG1 的 `show-text 0`）', () => {
  const { e, step } = mk();
  step(0x80, [im(9)]);
  assert.equal(e.msgwin.defaultWin, 9);
  step(0x6e, [im(0), str('サンプル')]);
  step(0x196, [im(0), str('天結'), str('あまゆ')]);
  step(0x6f, [im(0)]);
  assert.equal(e.msgwin.textOf(0), 'サンプル天結', 'op1=0 应落到窗 9（注音的本文词也进正文）');
  assert.deepEqual(e.msgwin.slot(9).segments[0]!.ruby, [['天結', 'あまゆ']]);
});

test('★0x2DE = 字体名 → 字体表下标（写回 op1；CHECKCONFIG 靠它的符号决定是否写回默认面名）', () => {
  const { e, f, step } = mk();
  // ★读的是**测试自己的帧** `f`（step 用的是 makeCtx(e, f, …)），不是 e.curScript()
  const read = (slot: number): number => dec(e.key, f.locals.int.get(slot) ?? 0) | 0;
  step(0x2de, [loc(0x40), str('ＭＳ ゴシック')]);
  assert.ok(read(0x40) >= 0, '在表内应返回 >=0');
  step(0x2de, [loc(0x41), str('存在しないフォント')]);
  assert.equal(read(0x41), -1, '不在表内应返回 -1（CHECKCONFIG 据此写回默认面名）');
  // ★查表前会剥竖排用的 '@' 前缀（引擎 raw 35149 `&a2[*a2 == 64]`）
  step(0x2de, [loc(0x42), str('@ＭＳ ゴシック')]);
  assert.ok(read(0x42) >= 0, '"@面名" 也必须能查到');
});

test('★文本进入渲染模型与快照：窗 9 的排版结果可在报告里看到（此前"文字不可观测"）', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  // 引擎默认档：30px 白字 + 黑投影（Font+1372=1、+1384/+1388=2）
  step(0x075, [im(30)]);
  step(0x076, [im(0xffffff)]); // 填充色（COLORREF → RGB）
  step(0x077, [im(0x000000)]);
  step(0x078, [im(1)]); // 描边档：单向投影
  step(0x1a4, [im(2), im(2)]); // dx=op1, dy=op2
  step(0x80, [im(9)]);
  step(0x70, [im(9), im(824), im(120), im(324), im(570)]);
  step(0x79, [im(9), im(0), im(0)]);
  step(0x6e, [im(0), str('サンプル')]);
  step(0x196, [im(0), str('天結'), str('あまゆ')]);
  step(0x6f, [im(0)]);

  const frame = native.scene.msgWins.get(9);
  assert.ok(frame, '窗 9 应有排版结果');
  assert.equal(frame.lines.length, 1, '横排、放得下 ⇒ 1 行');
  assert.equal(frame.lines[0]!.text, 'サンプル天結');
  assert.deepEqual(frame.style.main, {
    family: 'Amayui CN',
    size: 30,
    weight: 400,
    // ★文字偏灰 = **覆盖率 α 合成**（tickets/T-0042，2026-09）：样式里保留脚本原色（纯白），
    //   压暗由 raster 的 `globalAlpha = TEXT_FILL_ALPHA(225/255)` over 描边 复现。
    fill: '#ffffff',
    outline: '#000000',
    // ★抗锯齿（`Font+1352`）：配置门推导为 0，但**实测像素只可能来自覆盖率路径** ⇒ 取 true（T-0042）。
    antiAlias: true,
  });
  assert.equal(frame.style.outlineMode, 1);
  assert.equal(frame.style.outlineDx, 2);
  assert.equal(frame.style.outlineDy, 2);
  assert.deepEqual({ x: frame.style.x, y: frame.style.y, w: frame.style.w, h: frame.style.h }, { x: 324, y: 570, w: 824, h: 120 });

  // 显现游标：全部显示（S4 起接 message:MessageSpeed 的逐字推进）
  assert.equal(frame.glyphCount, 6);

  // ★快照里能看见文字 —— 这正是"把隐性变显性"要的效果
  const txt = native.snapshotText();
  assert.match(txt, /text win=9 rect=\(324,570,824,120\) 横排/);
  assert.match(txt, /サンプル天結/);

  // 清场：0x301 清掉该窗
  step(0x301, [im(9)]);
  assert.equal(native.scene.msgWins.has(9), false);
});

test('★0x71 不再无条件置 ADV：默认（ReadTextSkip=0）不置位', () => {
  const { e, step } = mk();
  assert.equal(e.advActive, false);
  step(0x71, [im(1)]); // 消息窗槽号（argc=1）
  assert.equal(e.advActive, false, '非逐字显示路径下 0x71 置位必须为假（引擎受 message:ReadTextSkip 门控）');
  assert.equal(e.msgwin.lastArg, 1);
});

test('0x71 在跳读/自动模式（97050≠0）下保留显示态并置 ADV', () => {
  const { e, step } = mk();
  step(0x88, [im(1)]); // message-mode：1415 = 97050 = 1
  assert.equal(e.advActive, false, '0x88 本身只设 122368');
  step(0x71, [im(1)]);
  assert.equal(e.advActive, true, '跳读模式下 0x71 保留显示态（引擎 LABEL_10）');
  step(0x88, [im(0)]);
  assert.equal(e.advActive, false, '0x88 置 0 清 ADV');
});

test('0x1CA SetConfig(message:ReadTextSkip)：运行期覆盖门控生效', () => {
  const { e, step } = mk();
  step(0x1ca, [im(1)]); // 打开「逐字显示」门
  assert.equal(e.msgwin.readTextSkip, 1);
  step(0x6e, [im(0), str('まだ表示中')]);
  assert.equal(e.advActive, true, '门打开且文本刚写入 ⇒ 本帧仍在显示中 ⇒ ADV 置位');
  // 下一帧 ADV 服务：逐字显示收尾 ⇒ 清显示态与 ADV（位不会永久卡住）
  assert.equal(e.serviceAdv(), false);
  assert.equal(e.advActive, false, '一帧后服务应清掉 ADV');
});

test('★0x72 wait-for-input：结束一页并置等待推进门（bit31），不派发脚本', () => {
  const { e, step } = mk();
  step(0x6e, [im(0), str('こんにちは')]);
  step(0x6f, [im(0)]);
  assert.equal(e.awaitingAdvance, false);
  step(0x72, [im(0)]);
  assert.equal(e.awaitingAdvance, true, 'wait-for-input 应置 effect_flags bit31');
  assert.equal(e.msgwin.pages, 1, '应记一页');
  assert.equal(e.advActive, false, 'ADV 应保持清除');
});

/**
 * ★★**重跑门指令不得把整页文字重放**（`tickets/T-0016`，用户实测：ADV 页右侧悬停 ⇒ 中间文字不断重放、页不推进）★★
 *
 * 机制：等待推进泵派发的**悬停 label 带返回点**（引擎 `sub_405360(Engine, -3)`，raw 20328-20332）
 * ⇒ label 体的 `ret` **正好回到门指令重跑**（见 `route-dispatch.test.ts` 判据③）。
 * 引擎的 `0x72` 尾段（raw 28539-28555）只做三件事：查字格数（`sub_45A940(..., -1, 107705)`）、
 * 置等待门（bit31）、武装 ▼（bit30 + `Engine[107704]=0` + 重启节拍）—— **文字游标 `win+132` 由
 * `sub_45BE20` 泵推进、由 `0x71`/`sub_45EC60` 复位，`0x72` 一概不动**。
 * 所以"重跑门指令"必须幂等：既不能重启显现（否则整页重放），也不能重复记页。
 */
test('★重跑 0x72（悬停 ret 回到门指令）不得重启已显完的逐字显现', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 50); // message:MessageSpeed = 50ms（否则 0 ⇒ 同步排空、看不见逐字）
  step(0x6e, [im(8), str('こんにちは世界')]); // 文本入队（内容版本 +1）
  step(0x72, [im(8)]); // 门指令：武装并开始逐字
  let shown = e.msgwin.revealedOf(8);
  assert.equal(shown, 0, '刚武装 ⇒ 一个字都还没贴出');

  // 推进显现到结束（一帧一个字；节拍取 0 ⇒ 下限一帧）
  let t = e.nowMs + 1000;
  for (let i = 0; i < 200 && e.msgwin.isRevealing(8); i++, t += 1000) e.msgwin.tickRevealWin(8, t, 0);
  shown = e.msgwin.revealedOf(8);
  assert.equal(e.msgwin.isRevealing(8), false, '显现应已结束');
  assert.ok(shown > 0, `显现必须真的推进过（实际 ${shown}）`);

  // ★重跑门指令（悬停 label 的 ret 就是这样回来的）——不得重放
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), shown, '★重跑门指令不得把文字从头重放（修前会回到 0）');

  // 正对照一：新一页（0x71 清场 + 新文本）必须重新逐字
  step(0x71, [im(8)]);
  step(0x6e, [im(8), str('次のページ')]);
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 0, '新一页的内容版本变了 ⇒ 必须重新武装逐字');

  // 正对照二：同一页里再来一条 show-text（内容变了）也必须重新逐字
  let t2 = e.nowMs + 1000;
  for (let i = 0; i < 200 && e.msgwin.isRevealing(8); i++, t2 += 1000) e.msgwin.tickRevealWin(8, t2, 0);
  step(0x6e, [im(8), str('追加')]);
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 0, '文本变了 ⇒ 重新逐字（内容版本判据不能把新内容也挡掉）');
});

/**
 * ★★**逐字显现期间的点击 = 立刻把整页贴完（且不推进页面）**（`tickets/T-0033`，用户实测：
 * 「快速多次点击 ⇒ 要等第一句逐字完成才播第二句」）★★
 *
 * 引擎 `sub_409400` 的第二半（raw 13931-13946）是**逐字期间的输入出口**：
 * 消费刷取掩码 → 左键（`mask & 0x10`）/滚轮键位/下滚 ⇒ 清 `0x20000000`、置 `Engine[388212] = 1`、
 * **自旋 `sub_45BE20(Font, 当前窗)` 到整页贴完**、把掩码清 0（这次点击被消费）。
 * 它**不清 bit31**（等待门仍在 ⇒ 页不推进）也**不动 bit30**（用普通泵而非 `sub_45A940(..., -2, 0)` ⇒ ▼ 继续闪）。
 */
test('★逐字期间点击：立刻整页贴完、不推进、消费该次点击、不清 bit30（T-0033）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 50); // message:MessageSpeed = 50ms（否则 0 ⇒ 同步排空，看不见逐字）
  showPanel(step); // 等待泵被 Engine[51828] 门控 ⇒ 先显示面板
  step(0x6e, [im(0), str('こんにちは世界')]);
  step(0x72, [im(0)]); // 逐字开始 + 置等待门
  const w = e.msgwin.resolveWin(0);
  const st = e.msgwin.reveal.get(w)!;
  assert.equal(e.textRevealing, true, '应在逐字中');
  assert.equal(e.awaitingAdvance, true, '等待门已置（页还没结束）');
  assert.ok(st.total > 3, `文本应有多字（实际 ${st.total}）`);
  assert.ok(st.shown < st.total, `刚开始 ⇒ 未显完（${st.shown}/${st.total}）`);

  // ① 逐字期间点一次左键
  moveAndClick(e, 10, 10);
  assert.equal(e.serviceRevealAdvanceInput(), true, '逐字期间的左键应由「贴完整页」出口消费');
  assert.equal(e.msgwin.reveal.get(w)!.shown, st.total, '★文本立即整页贴完');
  assert.equal(e.textRevealing, false, '不再逐字');
  assert.equal(e.awaitingAdvance, true, '★等待门仍在 ⇒ 页**不推进**');
  assert.notEqual((e.effectFlags & 0x40000000) >>> 0, 0, '★不清 bit30（▼ 继续闪；与 finishCharReveal 区分）');
  // ② 这次点击已被消费 ⇒ 紧随其后的等待泵不得把它当推进
  assert.equal(e.serviceAdvanceWait(), false, '★同一次点击不得顺带推进一页');
  assert.equal(e.awaitingAdvance, true, '页仍在等待玩家的**下一次**点击');

  // ③ 再点一次 ⇒ 才推进（没有热点 ⇒ 引擎走"窗内推进文本"，不动脚本 ip）
  moveAndClick(e, 10, 10);
  assert.equal(e.serviceAdvanceWait(), true, '第二次点击才被等待泵处理');
});

test('★逐字期间右键不生效、滚轮上滚不生效（引擎只认 mask&0x10 + 滚轮键位 + 下滚）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 50);
  step(0x6e, [im(0), str('こんにちは世界')]);
  step(0x72, [im(0)]);
  assert.equal(e.textRevealing, true);

  moveAndClick(e, 10, 10, 1); // 右键
  assert.equal(e.serviceRevealAdvanceInput(), false, '右键在逐字期间什么都不做（等待泵才是 0x50）');
  assert.equal(e.textRevealing, true, '仍在逐字');

  e.input.addWheel(120); // 上滚（引擎单位：一格 ±120，上滚为正）
  assert.equal(e.serviceRevealAdvanceInput(), false, '上滚不贴完');
  assert.equal(e.textRevealing, true, '仍在逐字');

  e.input.addWheel(-120); // 下滚
  assert.equal(e.serviceRevealAdvanceInput(), true, '下滚应贴完整页');
  assert.equal(e.textRevealing, false);
});

test('等待推进门：无输入时不放行；有鼠标按下沿时放行并清位', () => {
  const { e, step } = mk();
  showPanel(step); // ★引擎等待泵被 `Engine[51828]`（panelA[7463]）门控，先显示面板
  step(0x72, [im(0)]);
  assert.equal(e.serviceAdvanceWait(), false, '无输入 ⇒ 不推进（脚本挂起）');
  assert.equal(e.awaitingAdvance, true, '门保持');
  // ★鼠标移动（`sub_4B8D50` → `sub_403C50` 命中测试）——没有热点 ⇒ 游标 -1 ⇒ 走"窗内推进文本"
  moveAndClick(e, 10, 10);
  assert.equal(e.serviceAdvanceWait(), true, '有左键按下沿 ⇒ 放行');
  assert.equal(e.awaitingAdvance, false);
});

/**
 * ★★**按住左键不得每帧推进**（`tickets/T-0027`）★★
 *
 * 引擎的等待推进泵 `sub_411BC0`（raw 20238）用的是**消费刷** `sub_478090`（吸取挂起事件、读后清零），
 * 其调用链 `sub_477130`/`sub_477280`/`sub_4774F0`/`sub_477C30` 里**没有** `sub_477150`
 * （鼠标左右键的实时按住态）⇒ **一次按下只推进一页**。
 * ADV 分支 `sub_411900`（raw 20111）才用实时刷 `sub_4780D0`。
 *
 * 用户实测症状（macOS + jp 资源）：ADV 里一次普通单击就快进很多页文案，按住更是停不下来。
 * 根因 = emulator 只有一把 `flush()`（把 `buttons` 按住态也 OR 进掩码），等待泵吃它 ⇒ 按住期间每帧放行。
 */
test('★等待推进门只吃「挂起事件」：按住左键不放也只推进一页（sub_478090 ≠ sub_4780D0）', () => {
  const { e, step } = mk();
  showPanel(step);
  step(0x72, [im(0)]);
  moveAndClick(e, 10, 10); // setCursor + pressMouse(0)：**按下后不松**
  let advanced = 0;
  for (let frame = 0; frame < 10; frame++) {
    if (e.awaitingAdvance && e.serviceAdvanceWait()) advanced++;
    // 引擎里点击 label 末尾 `ret` 后**重跑门指令**（adv-advance-route-table ②）⇒ 每帧重新挂起
    step(0x72, [im(0)]);
  }
  assert.equal(advanced, 1, '★按住 10 帧只应推进 1 页（旧实现在这里会放行 10 次 ⇒ 一次点击快进多页）');
});

test('★等待推进门：down+up 落在同一帧也不丢（消费刷保留按下沿，但要恰好推进一次）', () => {
  const { e, step } = mk();
  showPanel(step);
  step(0x72, [im(0)]);
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  e.input.releaseMouse(0); // 快速点击：up 在泵看到之前就到了
  assert.equal(e.serviceAdvanceWait(), true, '同一帧的快速点击不得整次丢弃');
  assert.equal(e.awaitingAdvance, false);
  let advanced = 0;
  for (let frame = 0; frame < 5; frame++) {
    if (e.awaitingAdvance && e.serviceAdvanceWait()) advanced++;
    step(0x72, [im(0)]);
  }
  assert.equal(advanced, 0, '按下沿已被消费 ⇒ 后续帧不得再放行');
});

test('★ADV 分支仍吃「实时按住态」（sub_4780D0）：set:CancelMesSkipOnClick 下按住 ⇒ 三态机进 stage2', () => {
  const { e, step } = mk();
  e.config = {
    values: new Map([['set:cancelmesskiponclick', '1']]), // parseIni 存小写键（CFG 常量保留引擎原始大小写）
    sections: [],
    order: new Map(),
  } as unknown as Engine['config'];
  step(0x71, [im(1)]); // 置 ADV
  e.msgwin.skipMode = 1;
  e.msgwin.showing = 1; // 让 serviceAdv 不停在"显示完"那一支
  e.input.consumeEdges();
  e.input.buttons = 0; // 未按住
  e.serviceAdv();
  assert.equal(e.msgwin.cancelStage, 1, '未按住 ⇒ stage1');
  e.input.buttons = 1; // ★只置"按住态"，没有任何新按下沿
  e.serviceAdv();
  assert.equal(e.msgwin.cancelStage, 2, '★仍按住（实时刷）⇒ stage2 —— 若 serviceAdv 改用消费刷会永远停在 stage1');
});

test('ADV 每帧服务：未显示完判定成立时清掉 ADV（位不会永久卡住）', () => {
  const { e, step } = mk();
  step(0x88, [im(1)]);
  step(0x71, [im(1)]);
  assert.equal(e.advActive, true);
  // 跳读模式关掉 ⇒ 显示态不再保留 ⇒ 每帧服务应清 ADV
  step(0x88, [im(0)]);
  e.msgwin.showing = 0;
  e.msgwin.alt = 0;
  const still = e.serviceAdv();
  assert.equal(still, false, 'serviceAdv 应报告 ADV 已清');
  assert.equal(e.advActive, false);
});

test('0xFA poll-msg-advance 已注册且不抛错（此前未注册 ⇒ 命中即硬报错）', () => {
  const { e, step } = mk();
  assert.ok(OPS.has(0xfa), '0xFA 必须注册');
  step(0xfa, []); // 不应抛 NotImplementedOp
  assert.equal(e.awaitingAdvance, true, '收尾后进入等待推进门');
});

test('★0x090 登记点击热点：矩形按宽高给，内部存 x1/y1，标签取 op5/op6/op7', () => {
  const { e, step } = mk();
  step(0x090, [im(0), im(0), im(500), im(720), im(0x1078), im(0x10a4), im(0x10b4)]);
  assert.equal(e.routes.count, 1);
  const r = e.routes.entries[0]!;
  assert.deepEqual(
    { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, a: r.labelEnter, b: r.labelLeave, c: r.labelClick },
    { x0: 0, y0: 0, x1: 500, y1: 720, a: 0x1078, b: 0x10a4, c: 0x10b4 },
    '引擎 sub_403B30 用 (x, y, x+w, y+h) 作矩形，三个 label 分别进 [259]（进入）/ [359]（离开）/ [459]（点击/键命中）',
  );
});

test('热点表：命中测试设游标；表满 100 时抛错（引擎同样抛 ShowMessage）', () => {
  const { e, step } = mk();
  step(0x090, [im(10), im(20), im(100), im(50), im(1), im(2), im(3)]);
  assert.equal(e.routes.hitTest(50, 30), 0, '矩形内应命中');
  assert.equal(e.routes.cursor, 0);
  assert.equal(e.routes.hitTest(999, 999), -1, '矩形外应不命中');
  assert.equal(e.routes.cursor, -1);
  for (let i = e.routes.count; i < 100; i++) step(0x090, [im(0), im(0), im(1), im(1), im(1), im(2), im(3)]);
  assert.throws(() => step(0x090, [im(0), im(0), im(1), im(1), im(1), im(2), im(3)]), /热点表已满/);
});

test('★等待推进门：**右键不派发 label**（推进分支的 mask 判据是 `& 0x10` = 鼠标左；右键只"处理输入"）', () => {
  const e0 = new Engine(new StubNative(() => {}));
  const { e, step } = mk(e0.curScript());
  const f = e.curScript();
  f.labelMap.set(0x1078, 3);
  f.labelMap.set(0x10a4, 5);
  f.labelMap.set(0x10b4, 7);
  f.script = { instructions: Array.from({ length: 12 }, () => instr(0x72, [im(0)])) } as never;
  showPanel(step);
  OPS.get(0x090)!(
    makeCtx(e, f, instr(0x090, [im(0), im(0), im(500), im(720), im(0x1078), im(0x10a4), im(0x10b4)]), e.native, () => {}),
  );
  step(0x72, [im(0)]);
  const ipAtGate = f.ip;
  moveAndClick(e, 100, 100, 1); // 右键（掩码 bit5）
  // 引擎 raw 20315：`(mask & 0x20) == 0` 为**假**（右键按下）⇒ 整段"悬停/推进"被跳过，走 20365 的
  // 「取消/跳读」通路（`Engine[489488]`，由 `0x7C` 登记；emulator 未实现 0x7C ⇒ 该格恒 -1 ⇒ 无操作）。
  // ⇒ 右键**既不派发 label、也不动 ip**。
  assert.equal(e.serviceAdvanceWait(), false, '右键 ⇒ 泵不做"悬停/推进"（走 20365 那条独立通路）');
  assert.equal(f.ip, ipAtGate, 'ip 不动（旧实现把右键当"反向推进 labelPrev"，引擎里没有这条）');
  assert.equal(f.retStack.length, 0, '没有压返回点（没派发任何 label）');
  assert.equal(e.awaitingAdvance, true, '门保持（脚本仍挂起）');
});

/**
 * ★2026-09（用户实测"ADV 界面右侧的侧边栏菜单无条件展示"）：**悬停派发**此前完全没实现。
 *
 * 引擎 `sub_403E70`（raw 9918-9955）不是"点击专用"，而是**按游标变化**发 label 的两段式状态机：
 * 游标从 A 移到 B ⇒ 本帧发 **A 的 labelB（离开）**、置 `[7466]=1`；下一帧发 **B 的 labelA（进入）**。
 * 调用点是等待泵 `sub_411BC0`（raw 20322-20337）每帧一次 ⇒ 脚本里靠热点做的悬停 UI 才会响应
 * （`SN0000.txt:63/74` 的热点 labelA = 展开侧边栏、`:66` 全屏热点 labelA = 收起）。
 */
// ★2026-09-23（`tickets/T-0129`）：本文件原有三组「路由」用例已**删除** —— 它们与
//   `test/route-dispatch.test.ts` 的判据①②④重复，而后者用**真 `stepOnce`**、返回点精确到
//   `gateDword === 17`，并多断 `hitDone`/`hover`/`ret` 回门/文本不变：
//     · 点中热点 → labelC        ← route-dispatch 判据②（`test/route-dispatch.test.ts:133`）
//     · 0x93 清空路由表          ← route-dispatch 判据④（`:200`，还多断 `hover`/`hitDone`）
//     · 悬停两段式 enter/leave   ← route-dispatch 判据①（`:111`，含"一次只给一个 label"+稳定性）
//   ★保留下面这条「悬停**判定**阶段不改 ip」：`pickHoverLabel` 是纯判定，`route-dispatch` 只测了
//     泵的**派发**路径 ⇒ 这条断言没有替身（删了会真丢覆盖）。

test('★悬停不得推进页面：wait-for-input 挂起时 pickHoverLabel 只给 label，不动 ip/等待门', () => {
  const { e } = mk();
  const f = e.curScript();
  f.labelMap.set(0xaa, 3);
  f.labelMap.set(0xbb, 5);
  OPS.get(0x090)!(makeCtx(e, f, instr(0x090, [im(0), im(0), im(100), im(100), im(0xaa), im(0xbb), im(0xcc)]), e.native, () => {}));
  OPS.get(0x072)!(makeCtx(e, f, instr(0x072, [im(0)]), e.native, () => {}));
  const ipBefore = f.ip;
  e.input.setCursor(50, 50); // 鼠标移动 ⇒ 命中测试（引擎 sub_4B8D50）
  assert.equal(pickHoverLabel(e), 0xaa);
  assert.equal(f.ip, ipBefore, '判定阶段绝不改 ip（label 由泵当**带返回点的子程序**派发）');
  assert.equal(e.awaitingAdvance, true, '悬停判定本身不清等待门（清位在泵的派发点 raw 20334）');
});

test('headless forceAdvance：无输入源时确定性跳到第一个热点的 labelC（不压返回点，与 baseline 同路）', () => {
  const { e } = mk();
  const f = e.curScript();
  f.labelMap.set(0x22, 5);
  f.script = { instructions: [instr(0x90, []), instr(0x72, [im(0)]), ...Array.from({ length: 10 }, () => instr(0x72, [im(0)]))] } as never;
  OPS.get(0x090)!(makeCtx(e, f, instr(0x090, [im(0), im(0), im(1), im(1), im(1), im(2), im(0x22)]), e.native, () => {}));
  OPS.get(0x072)!(makeCtx(e, f, instr(0x072, [im(0)]), e.native, () => {}));
  assert.equal(e.forceAdvance(), 0x22);
  assert.equal(f.ip, 5);
  // ★headless 不压返回点：见 `Engine.forceAdvance` 的说明（压了会让 SN0000 跳过 ADV 暗幕的装配，
  //   `test/mesh-vertex-quad.test.ts` 的 E3 因此变红）。
  assert.equal(f.retStack.length, 0, 'headless 放行不压返回点');
  assert.equal(e.awaitingAdvance, false);
});

test('消息窗对象表：0x212 / 0x213 / 0x25D 写同一对象的三个字段组', () => {
  const { e, step } = mk();
  step(0x212, [im(3), im(0x11)]);
  step(0x213, [im(3), im(0x22), im(0x23)]);
  step(0x25d, [im(3), im(0x44), im(0x45)]);
  const o = e.msgwin.objects.get(3)!;
  assert.deepEqual(
    { f100: o.f100, f104: o.f104, f108: o.f108, f276: o.f276, f280: o.f280 },
    { f100: 0x11, f104: 0x22, f108: 0x23, f276: 0x44, f280: 0x45 },
  );
});

test('0x301 清对象项时同时清布局标志 +132（sub_404F80 的那一步）', () => {
  const { e, step } = mk();
  step(0x213, [im(2), im(1), im(2)]);
  e.msgwin.object(2).f132 = 7;
  step(0x301, [im(2)]);
  assert.equal(e.msgwin.objects.get(2)!.f132, 0);
  assert.equal(e.engineValues.get(2 + 122486), 0);
});

/**
 * ★速度定律（2026-09 二次修正 —— 上一次把"一步"误当成**一行**）：
 *   引擎的一步 = **一个字**：`sub_45BE20` 每次调用只推一个 24B 记录，而那个向量是**逐字** push 的
 *   （`sub_46BE30` 里 `sub_455ED0(…, String, …)` 画一个字、紧接着 `sub_45D120(win+44, rec)`；
 *   `rec[0]` 只有注音记录为 1 ⇒ `while (rec[0])` 那层循环只是把注音跟在本字后面一起贴）。
 *   节拍 = `message:MessageSpeed`（GDI 路径 `Sleep(MessageSpeed)` raw 13954；D3D 路径 `sub_453B60`），
 *   且节拍门把下限压在一帧 ⇒ **整段耗时 = 字数 × max(MessageSpeed, 一帧)**。
 *   ⇒ 旋钮语义：`MessageSpeed` = **每字毫秒**，越大越慢；`0` = 立即全显。
 *
 *   （旧实现按"行数 × 节拍"算预算 ⇒ 整段快了"每行字数"倍，设置里的「显示速度」滑条几乎看不出效果
 *    —— 用户实测"文字出现的速度几乎没有变"。见 `test/option-font-speed-menu.test.ts`。）
 */
test('★逐字显现速度定律：MessageSpeed = **每字**毫秒（总时长 = 字数 × max(speed, 一帧)）', () => {
  const FRAME = 1000 / 60;

  /** 造一个 1 行 5 字的页并启动显现，返回引擎。 */
  const page = (speed: number): Engine => {
    const { e, step } = mk();
    e.engineValues.set(21668, speed);
    step(0x80, [im(9)]);
    step(0x71, [im(9)]);
    step(0x6e, [im(0), str('あいうえお')]); // 5 字、1 行
    step(0x72, [im(9)]);
    return e;
  };
  /** 用固定帧时钟推进直到显完，返回用掉的帧数。 */
  const framesToFinish = (e: Engine, cap = 200): number => {
    let t = 0;
    for (let i = 1; i <= cap; i++) {
      t += FRAME;
      e.serviceTextReveal(t);
      if (!e.textRevealing) return i;
    }
    return cap;
  };

  // ① MessageSpeed=5（随包 SYS4REG.INI 的值）⇒ 一个字最多一帧（引擎的 Sleep(5) 同样被帧率地板住）
  const eFast = page(5);
  eFast.serviceTextReveal(FRAME);
  assert.equal(eFast.msgwin.revealedOf(9), 1, 'MessageSpeed=5 ⇒ 一帧一个字（不是"一帧整行"）');
  assert.equal(eFast.textRevealing, true);
  const fastFrames = framesToFinish(eFast);
  assert.ok(fastFrames >= 3 && fastFrames <= 6, `5 字 × max(5ms, 一帧) ≈ 5 帧（实际 ${fastFrames}）`);

  // ② 越大越慢：5 字 × 25ms = 125ms（≈8 帧）；5 字 × 100ms = 500ms（≈30 帧）
  const eMid = page(25);
  const midFrames = framesToFinish(eMid);
  const eSlow = page(100);
  const slowFrames = framesToFinish(eSlow);
  assert.ok(slowFrames > midFrames * 3, `越大越慢：100ms(${slowFrames} 帧) 应远慢于 25ms(${midFrames} 帧)`);
  // 100ms/字 ⇒ 第一个字要等满 100ms（约第 6 帧）
  const eSlow2 = page(100);
  eSlow2.serviceTextReveal(FRAME);
  assert.equal(eSlow2.msgwin.revealedOf(9), 0, '100ms/字：第一帧还不到一个字');
  eSlow2.serviceTextReveal(6 * FRAME);
  assert.equal(eSlow2.msgwin.revealedOf(9), 1, '100ms/字：第 6 帧出第 1 个字');
  assert.equal(eSlow2.textRevealing, true);

  // ③ MessageSpeed = 0 ⇒ 一次性显示完（引擎走同步排空 sub_46CBF0）
  const e0 = page(0);
  assert.equal(e0.msgwin.revealedOf(9), 5, 'MessageSpeed=0 ⇒ 立即显示完');
  assert.equal(e0.textRevealing, false);

  // ④ 预算 = **字数** × 节拍（与折成几行无关）
  const { e: eLines, step: stepLines } = mk();
  eLines.engineValues.set(21668, 5);
  stepLines(0x80, [im(9)]);
  stepLines(0x71, [im(9)]);
  stepLines(0x70, [im(9), im(60), im(720), im(0), im(0)]); // 窄窗 ⇒ 5 字要折成多行
  stepLines(0x6e, [im(0), str('あいうえお')]);
  stepLines(0x72, [im(9)]);
  const st = eLines.msgwin.reveal.get(9)!;
  const laid = layoutWindow(9, { style: styleOfWin(eLines, 9), segments: eLines.msgwin.slot(9).segments });
  assert.ok(laid.lines.length > 1, `窄窗应折成多行（实际 ${laid.lines.length} 行）`);
  // 2026-09：节拍是逐字的（intervalMs = max(speed, 一帧)），整段 = 字数 × 节拍；一次推进一个字。
  // ★2026-09-23（`tickets/T-0125`）：原来这两条写的是 `st.intervalMs === revealInterval(5)` 与
  //   `st.intervalMs * n === revealInterval(5) * n` —— **镜像 + 恒真**（拿实现用的那个函数去断
  //   实现自己的输出，第二条还只是第一条乘同一个数）。换成**具体数**：
  assert.equal(st.intervalMs, 1000 / 60, 'MessageSpeed=5 < 一帧 ⇒ 节拍被"一帧"地板住（16.67ms/字）');
  assert.equal(
    st.intervalMs * laid.glyphCount,
    (1000 / 60) * 5,
    `整段 = 字数(5) × 一帧 16.67ms（行数 ${laid.lines.length} 不参与）`,
  );
  assert.equal(laid.glyphCount, 5);

  // ⑤ 点击先补完这一页（引擎 raw 20025-20030），再放行
  const { e: eClick, step: stepClick } = mk();
  eClick.engineValues.set(21668, 100);
  showPanel(stepClick); // ★等待泵被 Engine[51828]（panelA[7463]）门控
  stepClick(0x80, [im(9)]);
  stepClick(0x6e, [im(0), str('あいうえお')]);
  stepClick(0x72, [im(9)]);
  eClick.serviceTextReveal(2 * FRAME);
  assert.ok(eClick.msgwin.revealedOf(9) < 5, '慢速下应还在逐字');
  moveAndClick(eClick, 10, 10);
  assert.equal(eClick.serviceAdvanceWait(), true, '点击应放行等待门');
  assert.equal(eClick.msgwin.revealedOf(9), 5, '放行前先补完整段');
  assert.equal(eClick.awaitingAdvance, false);
});

test('★0x1B5 设消息速度（字段 + 注册表）：CONFIG 速度滑条走这条，不是 0x74', () => {
  const { e, step } = mk();
  e.config = { values: new Map([['message:messagespeed', 5]]), sections: [], order: new Map() };
  step(0x1b5, [im(25)]);
  assert.equal(e.engineValues.get(21668), 25, '写字段（= Font+1376）');
  assert.equal(e.config.values.get('message:messagespeed'), 25, '同时写配置注册表');
  // 显现节拍读的就是这个字段
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('あいう')]);
  step(0x72, [im(9)]);
  assert.equal(e.msgwin.reveal.get(9)?.nextAt, 25, '节拍 = 25ms（刚设的值）');

  // 0x74 只写字段、**不**写注册表（脚本拿它做"这一段立即显示"）
  step(0x1b5, [im(25)]);
  step(0x74, [im(0)]);
  assert.equal(e.engineValues.get(21668), 0);
  assert.equal(e.config.values.get('message:messagespeed'), 25, '0x74 不得改注册表');
});

/**
 * ★2026-09 用户实测："切换背景时（转场）ADV 文字应该消失，但被保留了"。
 *
 * 引擎里屏幕上的字**就是** Scene 的 DrawItem（正文行 id = 行号 + `win+104`，`0x213` 登记；
 * 另一组在 `win+276`，`0x25D` 登记）。脚本清字的手段就是 `0x1F7 detach-texture <base> <count>`：
 * `$1$SC0330.txt` 整个文件 0 次 `i071`/`i301`，换场只做 `detach-texture 19a28 1f4`
 * （`$1$SC0330.txt:18117-18119`，44 处 `call label_000407c0` 调起；`SN0000.txt:3799/3814` 同理）。
 * emulator 的文本另有载体（`msgWins`）⇒ 必须按区间判"这窗的图元被删光了 ⇒ 字也消失"。
 */
test('★0x1F7 删掉某窗的正文区间 ⇒ 该窗文字随之消失（转场不得残留旧文案）', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op); // 0x1F7 是 native 表里的（经 NativeBridge 落到宿主）
    assert.ok(h, `0x${op.toString(16)} 应在 OPS/NATIVE_OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  // SYSTEM4.txt:57-58/69 的真实注册：win1 = 注音[104300,104303) + 正文[105000,105500)；win8 共用正文区间
  step(0x25d, [im(1), im(0x1976c), im(3)]);
  step(0x213, [im(1), im(0x19a28), im(0x1f4)]);
  step(0x213, [im(8), im(0x19a28), im(0x1f4)]);
  step(0x80, [im(1)]);
  step(0x71, [im(1)]);
  step(0x6e, [im(0), str('メッセージ')]);
  step(0x80, [im(8)]);
  step(0x71, [im(8)]);
  step(0x6e, [im(0), str('メッセージ')]);
  assert.ok(native.scene.msgWins.has(1) && native.scene.msgWins.has(8), '两个窗都先有字');

  // ① 换场：删正文区间 ⇒ 两个窗的字都该消失
  step(0x1f7, [im(0x19a28), im(0x1f4)]);
  assert.equal(native.scene.msgWins.has(1), false, 'win1 的正文区间被删 ⇒ 字消失');
  assert.equal(native.scene.msgWins.has(8), false, 'win8 与 win1 共用区间 ⇒ 一起消失');
  assert.doesNotMatch(native.snapshotText(), /text win=1\b/, '快照里也不该再有该窗');

  // ② 反例：删一个与任何窗都无关的区间，不得误清
  step(0x80, [im(1)]);
  step(0x71, [im(1)]);
  step(0x6e, [im(0), str('メッセージ')]);
  step(0x1f7, [im(0x19708), im(6)]); // $1$SC0330.txt:18006 那条（与窗区间不相交）
  assert.equal(native.scene.msgWins.has(1), true, '不相交的区间删除不得清窗');

  // ③ 注音区间（`0x25D` 那组）同样生效
  step(0x1f7, [im(0x1976c), im(3)]);
  assert.equal(native.scene.msgWins.has(1), false, 'win1 的注音区间被删也 ⇒ 字消失');
});

test('★0x1F6 清绘制容器：文本窗必须一起清（否则回主界面后文字又画上去）', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  step(0x80, [im(9)]);
  step(0x71, [im(9)]); // ★真实页序：先 0x71 清场，再写文本
  step(0x6e, [im(0), str('メッセージ')]);
  assert.equal(native.scene.msgWins.get(9)?.glyphCount, 5, '先有文本窗');
  step(0x1f6, []); // clearDrawContainer
  assert.equal(native.scene.msgWins.size, 0, '0x1F6 必须连文本窗一起清');
  assert.doesNotMatch(native.snapshotText(), /text win=9/, '清场后快照里也不该再有该窗');
});

/**
 * ★2026 实测症状的回归闸（`CONFIG.BIN` 进/出设置）：
 *   「首次进入设置文案直接显示；退出后在主界面逐字显示；再次进入显示两行；再退出两行逐字显示」。
 *
 * 根因：`0x71`（`sub_45EC60`）**没有清空该窗的文本记录** ⇒ 上一屏的样例文案留在槽里，
 * 退出时的 `i071 9` 把它当新消息 **从 0 开始逐字显现**（`[text] win=9 … 已显示=1`），
 * 再次进入时又追加一行（`2 行 38 字`）。
 * 修复后：每次 `0x71` 都清空 ⇒ 退出无残留、再进仍是 1 行。
 */
test('★0x71 开始一段新消息：清该窗文本记录（CONFIG 进出设置不得累积行数/不得重放旧文案）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 25); // message:MessageSpeed（$1$INITREGMES `i1b5 19` = 25ms）
  /** CONFIG.txt:171-179 的样例文案块：i300 9 1 3e8 → i071 9 → 注音+正文+断行。 */
  const sampleBlock = (): void => {
    step(0x300, [im(9), im(1), im(0x3e8)]);
    step(0x71, [im(9)]);
    step(0x196, [im(0), str('天结'), str('天结')]);
    step(0x6e, [im(0), str('神缘ＳＡＭＰＬＥ')]);
    step(0x6f, [im(0)]);
  };
  step(0x80, [im(9)]); // CONFIG.txt:42 `i080 9`
  sampleBlock(); // 首次进入设置
  assert.equal(e.msgwin.slot(9).segments.length, 1, '首次进入：样例 1 行');
  assert.equal(e.msgwin.isRevealing(9), false, '样例文案直接显示（无显现状态）');

  // 退出设置：CONFIG.txt label_00000f6c 的 `i300 9 0 0` + `i071 9`
  step(0x300, [im(9), im(0), im(0)]);
  step(0x71, [im(9)]);
  assert.deepEqual(e.msgwin.slot(9).segments, [], '退出时必须清空窗 9（否则旧文案在主界面重放）');
  assert.equal(e.msgwin.isRevealing(9), false, '清空后不得留下显现状态');
  assert.equal(e.textRevealing, false);

  sampleBlock(); // 再次进入设置
  assert.equal(e.msgwin.slot(9).segments.length, 1, '再次进入仍是 1 行（历史错误：残留 + 新行 = 2 行）');
  assert.equal(e.msgwin.textOf(0), '天结神缘ＳＡＭＰＬＥ');

  // 再退出：同样不得残留
  step(0x71, [im(9)]);
  assert.deepEqual(e.msgwin.slot(9).segments, []);
});

test('★0x1D2（文本项记录表 push）：OPS 真实现、push 一条记录、不回写操作数', () => {
  // 背景：0x1D2 在全库出现 42760 次（最高频的原本未实现指令）。2026-09 起与读取端
  // 0x1D3/0x1D4/0x2F3 一起**成对转真实现**（见 `handlers/text-items.ts` + `../vm/textItems.ts`）：
  // 引擎体 `if (!Engine[97055]) sub_45EFA0(Font, 0, op1, op2)` ⇒ 往 `Font+3364` 的 72B 记录表
  // push `{win=默认窗, +24=op1, +20=op2}`，**不回写操作数**。
  const { e, step } = mk();
  const h = OPS.get(0x1d2);
  assert.ok(h, '0x1D2 应在 OPS 里（曾是 ENGINE_INTERNAL_OPS；读取端没它就没数据）');
  assert.equal(ENGINE_INTERNAL_OPS.has(0x1d2), false, '不得同时留在 ENGINE_INTERNAL_OPS（两表不相交）');
  // 写目标槽（type 0x9 池操作数）：push 不应改动它
  // ★`tickets/T-0101` 的 D5：默认窗的**唯一真源**是 `msgwin.defaultWin`（= 引擎 `Font+1228`，
  //   初值 1、raw 78899）；`engineValues[21631]` 已不再参与（此前这里 set 它，属双真源时代的写法）。
  e.msgwin.defaultWin = 8; // 默认窗 = 8
  step(0x1d2, [im(0x1234), im(0x5678)]);
  assert.equal(e.textItems.records.length, 1, '0x1D2 应 push 一条记录');
  assert.deepEqual(
    { win: e.textItems.records[0]!.win, v24: e.textItems.records[0]!.v24, v20: e.textItems.records[0]!.v20 },
    { win: 8, v24: 0x1234, v20: 0x5678 },
    '记录字段：win=默认窗、+24=op1、+20=op2',
  );
  // ★i1bb 0 期间不记账（引擎 `if (!Engine[97055])`）
  step(0x1bb, [im(0)]);
  step(0x1d2, [im(1), im(2)]);
  assert.equal(e.textItems.records.length, 1, 'i1bb 0 后不得再记账');
  step(0x1bb, [im(1)]);
  step(0x1d2, [im(3), im(4)]);
  assert.equal(e.textItems.records.length, 2, 'i1bb 1 后恢复记账');
});

// ---------------------------------------------------------------------------
// `tickets/T-0151`（审计 P1 批 · 消息窗）：`0x1b6`/`0x1b7` · `0x260` · `0xfa`
// ---------------------------------------------------------------------------

/** 最小配置（`parseIni` 存**小写键**；见本文件前面那条 `set:cancelmesskiponclick` 的写法）。 */
function cfgOf(pairs: Record<string, string>): Engine['config'] {
  return { values: new Map(Object.entries(pairs)), sections: [], order: new Map() } as unknown as Engine['config'];
}

/**
 * ★审计 §4.1 P1 `op-4`/`op-5`（`0x1b6`/`0x1b7`）：`Engine[97052]` 的**消费端**。
 *
 * 引擎的读点之一 = `0x72 wait-for-input` 尾段（raw 28556-28586）：`v7 = (Engine[97052] == 0)`、
 * `Engine[97053] = 0`，非 0 时按"该窗行数 − 1 − 行基准"算出自动翻页时长并
 * `sub_453A60(Engine+107545, max(100, 时长))` 起节拍。
 *
 * 守卫三件事：① 不为 0 时**必须**武装（三格 = `[2]=1` / `[5]=now` / `[6]=时长`）；
 * ② 时长的算术逐项对上（4 行 − 1 − 基准 1 = 2 ⇒ `2 × Pitch1(250) + Time1(1000) = 1500`）；
 * ③ 为 0 时**不得**武装（否则等于把 97052 当恒真）。
 * 修前 `Engine[97052]` 除整表 `clear()` 外无任何读取点 ⇒ 这个测试在修前必红（键全 undefined）。
 */
test('★T-0151：`0x72` 尾段的共存块消费 `Engine[97052]` ⇒ 起自动翻页节拍（raw 28556-28586）', () => {
  const { e, step } = mk();
  e.config = cfgOf({
    'message:automessagepitch1': '250',
    'message:automessagetime1': '1000',
  });
  e.engineValues.set(ENGINE_FIELD.autoMessageBaseline, 1); // = `i2e9 1`（0x2E9 写的"行基准"）
  // 该窗 4 行文本（3 个 end-text-line ⇒ 4 行）
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('一')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('二')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('三')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('四')]);
  e.nowMs = 4242;

  step(0x72, [im(9)]); // 97052 == 0 ⇒ 不武装
  assert.equal(e.engineValues.get(107545 + 6), undefined, '共存标志为 0 时不得武装自动翻页计时器');

  step(0x1b7, [im(1)]); // 置共存标志
  step(0x72, [im(9)]);
  assert.equal(e.engineValues.get(107545 + 2), 1, '`sub_453A60` 的 `t[2] = 1`（周期序号）');
  assert.equal(e.engineValues.get(107545 + 5), 4242, '`t[5] = timeGetTime()`（起点 = 现在）');
  assert.equal(
    e.engineValues.get(107545 + 6),
    1500,
    '(行数 4 − 1 − 基准 1) × Pitch1(250) + Time1(1000) = 1500（raw 28579-28585）',
  );
  assert.equal(e.engineValues.get(97053), 0, 'raw 28557：`Engine[97053] = 0`');

  // 下限 100ms（raw 28583-28584）：基准大于行数 ⇒ 负数也要抬到 100
  e.engineValues.set(ENGINE_FIELD.autoMessageBaseline, 9);
  step(0x72, [im(9)]);
  assert.equal(e.engineValues.get(107545 + 6), 100, '`if (v10 <= 100) v10 = 100`');
});

test('★T-0151：自动翻页的两组参数按 `Engine[122501]`（语音忙碌）二选一，且受 AutoMessageOption 门控', () => {
  const { e, step } = mk();
  e.config = cfgOf({
    'message:automessageoption': '1',
    'message:automessagepitch0': '10',
    'message:automessagetime0': '5000',
    'message:automessagepitch1': '250',
    'message:automessagetime1': '1000',
  });
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('一')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('二')]); // 2 行
  step(0x1b7, [im(1)]);
  e.engineValues.set(122501, 1); // 有语音在播 ⇒ Pitch0/Time0
  step(0x72, [im(9)]);
  assert.equal(e.engineValues.get(107545 + 6), 5010, '(2−1−0) × Pitch0(10) + Time0(5000)');
  // 门关（AutoMessageOption bit0 = 0）⇒ 不武装
  e.engineValues.set(107545 + 6, 0);
  e.config = cfgOf({
    'message:automessageoption': '0',
    'message:automessagepitch0': '10',
    'message:automessagetime0': '5000',
  });
  step(0x72, [im(9)]);
  assert.equal(e.engineValues.get(107545 + 6), 0, 'AutoMessageOption bit0 = 0 时不得武装（raw 28563-28564）');
  // 门开 ⇒ 武装
  e.config = cfgOf({
    'message:automessageoption': '1',
    'message:automessagepitch0': '10',
    'message:automessagetime0': '5000',
  });
  step(0x72, [im(9)]);
  assert.equal(e.engineValues.get(107545 + 6), 5010, '门开 ⇒ 按 Pitch0/Time0 武装');
  e.engineValues.set(122501, 0); // 没有语音 ⇒ Pitch1/Time1（配置缺项 ⇒ 0 ⇒ 抬到下限 100）
  step(0x72, [im(9)]);
  assert.equal(e.engineValues.get(107545 + 6), 100, '缺 Pitch1/Time1 ⇒ 0 ⇒ 下限 100');
});

/**
 * ★审计 §4.1 P3 `op-225`（`0x260` 的**写入归属错**）：这四个值是 **Font 级全局**字段
 * （`Font+235112..+235124` = `_this[80102..80105]`），不是逐窗字段。
 *
 * 守卫：写完之后**换默认窗**（`i080 9`）再读 —— 值必须还在（旧实现写在"写入时刻 defaultWin 的
 * geom 对象"上 ⇒ 换默认窗后归到别的窗名下、新窗读到 0）。同时核发布链：`0x6E` 入队快照
 * 必须把 `vPad` 一起带进 `MsgWinInput.style`。
 */
test('★T-0151：`0x260` 的四个值是 Font 级（换默认窗不丢），并进样式快照', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  step(0x80, [im(1)]); // 先默认窗 = 1
  step(0x260, [im(2), im(0), im(2), im(2)]); // 语料固定形态 `i260 2 0 2 2`
  assert.deepEqual(e.msgwin.font.vPad, { x: 2, dw: 0, y: 2, dh: 2 }, 'Font+235112/116/120/124 = op1/op2/op3/op4');
  step(0x80, [im(9)]); // ★换默认窗
  assert.deepEqual(
    e.msgwin.font.vPad,
    { x: 2, dw: 0, y: 2, dh: 2 },
    'Font 级字段不随默认窗改嫁（旧实现写在 geom(defaultWin) 上 ⇒ 这里读到 0）',
  );
  // 发布链：入队快照 + 样式
  step(0x6e, [im(0), str('あ')]);
  const sent = native.scene.msgWins.get(9);
  assert.ok(sent, '窗 9 应已发布');
  assert.deepEqual(sent.style.vPad, { x: 2, dw: 0, y: 2, dh: 2 }, '竖排内边距随样式快照发布给宿主');
  assert.deepEqual(
    e.msgwin.slot(9).fontStyle?.vPad,
    { x: 2, dw: 0, y: 2, dh: 2 },
    'FontStyleSnapshot 里也要有（与 vertical 同层，按入队时刻钉住）',
  );
});

/**
 * ★审计 §4.1 P2 `op-130`（`0xfa` 的 approximation）：raw 24981-24986
 * `sub_478090(Engine+258, Engine+174802); Engine[174801] |= 0x80000000; Engine[174802] = 0;`
 * —— 消费刷把掩码写进那一格之后**当帧清零**。emulator 的对应格 = `InputManager.inputMask`
 * （唯二写者 = `flushPending`/`flushHeld`，进输入快照）⇒ 必须跟着清。
 */
test('★T-0151：`0xfa` 清掉刚被消费刷吸取的掩码格（raw 24985 的 `Engine[174802] = 0`）', () => {
  const { e, step } = mk();
  e.input.pressKey(38); // 按下沿（默认表：VK38 = ↑ ⇒ 掩码位 0）
  step(0xfa, []);
  assert.equal(e.input.inputMask, 0, '0xFA 出口必须把掩码格清零（修前留着 flushHeld 写进去的值）');
  assert.equal(e.awaitingAdvance, true, '顺带置等待门（raw 24984）');
});

test('★T-0151：`0x1b6`/`0x1b7` 的读回语义（置位 / 清零 / 语料的读-减-写回习语）', () => {
  const { e, f, step } = mk();
  const read = (slot: number): number => dec(e.key, f.locals.int.get(slot) ?? 0) | 0;
  step(0x1b6, [loc(0)]); // 初始 0
  assert.equal(read(0), 0, '未置位时读回 0');
  step(0x1b7, [im(1)]);
  step(0x1b6, [loc(0)]);
  assert.equal(read(0), 1, '`i1b7 1` 之后读回 1（`Engine[97052] = (op1 != 0)`）');
  // 语料 334 处的固定习语：`i1b6 <g>` / `sub <g> 1 <g>` / `i1b7 <g>` ⇒ 值 1 变 0
  step(0x1b6, [loc(1)]);
  step(0x1b7, [loc(1)]); // 这里 loc(1) 未经 sub ⇒ 写回 (1 != 0) = 1（等价于习语里的"还没减到 0"）
  step(0x1b6, [loc(0)]);
  assert.equal(read(0), 1, '未减到 0 时习语写回 1');
  step(0x1b7, [im(0)]); // = `i1b7 0`
  step(0x1b6, [loc(0)]);
  assert.equal(read(0), 0, '`i1b7 0` 清位');
});

/**
 * ★★审计 §4.1 P1 `op-4`/`op-5`（`tickets/T-0151`）：`Engine[97052]` 的**行为消费端**
 * = 等待泵 `sub_411BC0` 的 `LABEL_44` 自动翻页块（raw 20376-20461）。
 *
 * 引擎：`if (!Engine[97052]) return;` 是整块的**唯一门**；门内每帧按「该窗行数 − 1 − 行基准」
 * 起 `Engine[430180]` 计时器，`sub_453AF0` 到期 ⇒ 清等待门（bit31）+ `sub_4051A0` +
 * `sub_48E870/sub_48EB30`（**页内推进，不动 ip**）⇒ 「`i1b7 1` ⇒ ADV 页自己往下走」。
 *
 * 守卫：置 97052、让等待门挂着、把时钟推过计时器周期 ⇒ ① 等待门被清（自动翻页发生了）；
 * ② 周期序号 `t[2]` 从 1 变 2（计时器周期性重复）；③ 97052 = 0 时同样的时钟**什么都不发生**。
 */
test('★T-0151：等待泵的自动翻页块（`sub_411BC0` LABEL_44）：97052 置位 ⇒ 到期自动翻页', () => {
  const { e, step } = mk();
  e.config = cfgOf({ 'message:automessagepitch1': '50', 'message:automessagetime1': '200' });
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('一')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('二')]); // 该窗 2 行
  e.nowMs = 1000;
  step(0x1b7, [im(1)]); // 置 97052（共存消息 / 自动翻页模式）
  step(0x72, [im(9)]); // 武装：ms = (2−1−0)×50 + 200 = 250
  assert.equal(e.engineValues.get(107545 + 6), 250, '节拍 = Pitch1×行数 + Time1');
  e.msgwin.showing = 1; // 让"自动翻页"有可观察的收尾
  e.awaitingAdvance = true; // 等待门挂着（引擎只在 bit31 分支调 `sub_411BC0`）

  // 未到期：什么都不该发生
  e.nowMs = 1100;
  e.serviceAdvanceWait();
  assert.equal(e.awaitingAdvance, true, '未到期 ⇒ 等待门保留');

  // 到期：自动翻页
  e.nowMs = 1250;
  const handled = e.serviceAdvanceWait();
  assert.equal(handled, false, '这一帧没有输入被处理（是自动翻页，不是玩家推进）');
  assert.equal(e.awaitingAdvance, false, '★到期 ⇒ 清等待门（raw 20432）＝ 这一页自己往下走了');
  assert.equal(e.msgwin.showing, 0, '页内推进的收尾（raw 20434-20443 的 `sub_48EB30` 语义）');
  assert.equal(e.engineValues.get(107545 + 2), 2, '周期序号推进（`sub_453AF0` raw 66184）');
  assert.equal(e.engineValues.get(107545 + 5), 1000, '起点没被改写（`sub_453BD0` 只在停表时重臂）');

  // 对照：97052 = 0 ⇒ 同一个时钟下等待门**不动**（门是整块唯一的门）
  step(0x1b7, [im(0)]);
  e.awaitingAdvance = true;
  e.nowMs = 2000;
  e.serviceAdvanceWait();
  assert.equal(e.awaitingAdvance, true, '97052 = 0 ⇒ 自动翻页块整块不跑（raw 20376）');
});

test('★T-0151：自动翻页表被"文本回卷态"停住（raw 20378-20383 `sub_453BC0`）', () => {
  const { e, step } = mk();
  e.config = cfgOf({ 'message:automessagepitch1': '50', 'message:automessagetime1': '200' });
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('一')]);
  e.nowMs = 0;
  step(0x1b7, [im(1)]);
  step(0x72, [im(9)]);
  e.engineValues.set(122454, 1); // 玩家正在文本回卷（`Engine[489816] != 0`）
  e.awaitingAdvance = true;
  e.nowMs = 10_000; // 远远超过周期
  e.serviceAdvanceWait();
  assert.equal(e.awaitingAdvance, true, '回卷中 ⇒ 停表（t[4] = 1）⇒ 到期判定返回 -1、不自动翻页');
  assert.equal(e.engineValues.get(107545 + 4), 1, '`sub_453BC0`：t[4] = 1');
  // 回卷结束 ⇒ `sub_453BD0` 重臂（t[4] = 0），再过一拍就自动翻页
  e.engineValues.set(122454, 0);
  e.nowMs = 10_050;
  e.serviceAdvanceWait();
  assert.equal(e.engineValues.get(107545 + 4), 0, '`sub_453BD0`：t[4] = 0（重臂）');
  assert.equal(e.engineValues.get(107545 + 5), 10_050, '重臂时起点 = 现在');
  e.nowMs = 10_300;
  e.serviceAdvanceWait();
  assert.equal(e.awaitingAdvance, false, '重臂后再到点 ⇒ 自动翻页');
});


