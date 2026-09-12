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
import { ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { dec } from '../src/vm/bits.js';
import { revealInterval } from '../src/vm/msgwin.js';
import { layoutWindow } from '../src/text/layout.js';
import { styleOfWin } from '../src/vm/handlers/msgwin.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const str = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;
/** 本帧 int 槽（type 0x9）—— 只有池操作数能做**写目标**，立即数不行。 */
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;

function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}

function mk(): { e: Engine; f: Frame; step: (op: number, args?: BinArg[]) => void } {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
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
    fill: '#ffffff',
    outline: '#000000',
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

test('等待推进门：无输入时不放行；有鼠标按下沿时放行并清位', () => {
  const { e, step } = mk();
  step(0x72, [im(0)]);
  assert.equal(e.serviceAdvanceWait(), false, '无输入 ⇒ 不推进（脚本挂起）');
  assert.equal(e.awaitingAdvance, true, '门保持');
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  assert.equal(e.serviceAdvanceWait(), true, '有左键按下沿 ⇒ 放行');
  assert.equal(e.awaitingAdvance, false);
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
    { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, a: r.labelNext, b: r.labelPrev, c: r.labelKey },
    { x0: 0, y0: 0, x1: 500, y1: 720, a: 0x1078, b: 0x10a4, c: 0x10b4 },
    '引擎 sub_403B30 用 (x, y, x+w, y+h) 作矩形，三个 label 分别进 [259]/[359]/[459]',
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

test('★等待推进门：点中热点 → 跳到该热点的 labelC（引擎 sub_411BC0 的真实路径）', () => {
  const { e } = mk();
  // 造一个带 labelMap 的帧：label 0x10b4 → 指令下标 7
  const f = e.curScript();
  f.labelMap.set(0x10b4, 7);
  OPS.get(0x090)!(
    makeCtx(e, f, instr(0x090, [im(0), im(0), im(500), im(720), im(0x1078), im(0x10a4), im(0x10b4)]), e.native, () => {}),
  );
  OPS.get(0x072)!(makeCtx(e, f, instr(0x072, [im(0)]), e.native, () => {}));
  assert.equal(e.awaitingAdvance, true);
  e.input.setCursor(100, 100); // 落在全屏热点内
  e.input.pressMouse(0);
  assert.equal(e.serviceAdvanceWait(), true, '点到热点 ⇒ 推进');
  assert.equal(e.awaitingAdvance, false);
  assert.equal(f.ip, 7, 'ip 应被重定位到热点 labelC 对应的指令');
});

test('headless forceAdvance：无输入源时确定性跳到第一个热点 label', () => {
  const { e } = mk();
  const f = e.curScript();
  f.labelMap.set(0x22, 5);
  OPS.get(0x090)!(makeCtx(e, f, instr(0x090, [im(0), im(0), im(1), im(1), im(1), im(2), im(0x22)]), e.native, () => {}));
  OPS.get(0x072)!(makeCtx(e, f, instr(0x072, [im(0)]), e.native, () => {}));
  assert.equal(e.forceAdvance(), 0x22);
  assert.equal(f.ip, 5);
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
 * ★速度定律（2026-09 修正）：
 *   引擎的一步 = **一行**（`sub_45BE20`），节拍 = `message:MessageSpeed`，
 *   且节拍门 `sub_453B60` 把下限压在一帧 ⇒ **整段耗时 = 行数 × max(MessageSpeed, 一帧)**。
 *   重写侧一步 = 一个**字**（逐字可见），但按预算连续推进 ⇒ 总时长与引擎一致。
 *   ⇒ 旋钮语义：`MessageSpeed` **越大越慢**，`5` 时很快（一行一帧内出完），`0` = 立即全显。
 */
test('★逐字显现速度定律：MessageSpeed 越大越慢，=5 很快、=0 立即；总时长 = 行数 × max(speed, 一帧)', () => {
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

  // ① MessageSpeed=5（随包 SYS4REG.INI 的值）：1 行 ⇒ 一帧内整行出完（引擎也是"一行一帧"）
  const eFast = page(5);
  eFast.serviceTextReveal(FRAME);
  assert.equal(eFast.msgwin.revealedOf(9), 5, 'MessageSpeed=5 ⇒ 一帧内整行显示完（原版就是这么快）');
  assert.equal(eFast.textRevealing, false);

  // ② 越大越慢：100ms 的整段时长 ≈ 100ms（本条 1 行）⇒ 约 6 帧；25ms ⇒ 约 2 帧
  const eMid = page(25);
  const midFrames = framesToFinish(eMid);
  const eSlow = page(100);
  const slowFrames = framesToFinish(eSlow);
  assert.ok(slowFrames > midFrames, `越大越慢：100ms(${slowFrames} 帧) 应慢于 25ms(${midFrames} 帧)`);
  // 100ms 一行 ⇒ 每帧推进 ≈ 5 × 16.7/100 ≈ 0.83 字 ⇒ 逐字可见
  const eSlow2 = page(100);
  eSlow2.serviceTextReveal(FRAME);
  assert.equal(eSlow2.msgwin.revealedOf(9), 0, '100ms：第一帧还不到一个字（0.83 字，留到下一帧）');
  eSlow2.serviceTextReveal(2 * FRAME);
  assert.equal(eSlow2.msgwin.revealedOf(9), 1, '100ms：第二帧出第 1 个字');
  assert.equal(eSlow2.textRevealing, true);

  // ③ MessageSpeed = 0 ⇒ 一次性显示完（引擎走同步排空 sub_46CBF0）
  const e0 = page(0);
  assert.equal(e0.msgwin.revealedOf(9), 5, 'MessageSpeed=0 ⇒ 立即显示完');
  assert.equal(e0.textRevealing, false);

  // ④ 多行页：总时长 = 行数 × 节拍（引擎每帧补一行）
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
  assert.equal(
    st.budgetMs,
    revealInterval(5) * laid.lines.length,
    `预算 = 行数(${laid.lines.length}) × max(speed, 一帧)`,
  );
  assert.equal(laid.glyphCount, 5);

  // ⑤ 点击先补完这一页（引擎 raw 20025-20030），再放行
  const { e: eClick, step: stepClick } = mk();
  eClick.engineValues.set(21668, 100);
  stepClick(0x80, [im(9)]);
  stepClick(0x6e, [im(0), str('あいうえお')]);
  stepClick(0x72, [im(9)]);
  eClick.serviceTextReveal(2 * FRAME);
  assert.ok(eClick.msgwin.revealedOf(9) < 5, '慢速下应还在逐字');
  eClick.input.setCursor(10, 10);
  eClick.input.pressMouse(0);
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

test('★0x1D2（文本项属性记录表 push）：已注册、不抛错、不回写操作数', () => {
  // 背景（2026 实测 `.tmp/amayui-emulator.log:2215`）：用户在 CONFIG.BIN 命中 0x1D2 被暂停并手工跳过。
  // 它在全库出现 42760 次（最常用的未注册 opcode）；引擎体只往 `Font+3364` 的 72B 记录向量 push
  // 一条 `{win=默认窗, +20=op2, +24=op1}`，**不回写操作数** ⇒ 归 ENGINE_INTERNAL_OPS（宿主无消费者）。
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const h = ENGINE_INTERNAL_OPS.get(0x1d2);
  assert.ok(h, '0x1D2 应在 ENGINE_INTERNAL_OPS 里（否则命中即硬报错，CONFIG.BIN 会停住）');
  // 写目标槽（type 0x9 池操作数）：no-op 不应改动它
  f.locals[5] = 12345;
  const fieldsBefore = e.engineValues.size;
  h!(makeCtx(e, f, instr(0x1d2, [loc(5), im(0)]), native, () => {}));
  assert.equal(f.locals[5], 12345, '0x1D2 不回写操作数（引擎只 push 到 Font 侧记录表）');
  assert.equal(e.engineValues.size, fieldsBefore, '0x1D2 不写引擎字段');
});
