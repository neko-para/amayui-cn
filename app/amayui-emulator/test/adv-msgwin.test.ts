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
import { Engine } from '../src/vm/engine.js';
import { Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const str = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;

function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}

function mk(): { e: Engine; step: (op: number, args?: BinArg[]) => void } {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  return {
    e,
    step: (op, args = []) => {
      const h = OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
      h!(makeCtx(e, f, instr(op, args), native, () => {}));
    },
  };
}

test('0x6E show-text / 0x6F end-text-line / 0x196 display-furigana：文本内容按槽记录', () => {
  const { e, step } = mk();
  step(0x6e, [im(0), str('壁に')]);
  step(0x6e, [im(0), str('刻まれた')]); // 同一行继续追加
  step(0x196, [im(0), str('刻'), str('きざ')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('次の行')]);
  assert.equal(e.msgwin.textOf(0), '壁に刻まれた\n次の行');
  const first = e.msgwin.slot(0).segments[0]!;
  assert.deepEqual(first.ruby, [['刻', 'きざ']], '注音应挂在当前行');
  assert.equal(first.lineEnded, true, 'end-text-line 应断行');
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
