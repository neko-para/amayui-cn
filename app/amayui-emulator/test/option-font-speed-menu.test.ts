/**
 * **四项用户实测问题的回归**（2026-09）：
 *
 * | # | 现象 | 根因 | 守卫 |
 * |---|---|---|---|
 * | 1 | 设置里改「显示速度」，ADV 文字出现速度几乎不变 | 显现预算按"**行数** × 节拍"算，而引擎一步 = **一个字**（`sub_45BE20` 的 24B 记录是逐字 push 的）⇒ 整段快了"每行字数"倍，滑条 1..99ms/字 被压成 ~50..300ms/页 | `0x1B5` + `budgetMs` = 字数 × 节拍 |
 * | 2 | 控制面板说 `i05b` 是缺口，可它"就是 `ne`、已实现" | 面板行只有助记符：`i0b5`（0x0B5 = DsPlaySound 音轨）被读成 `0x05B`（`ne`，确实已实现） | 0x5B 归 OPS / 0x0B5 归 engine-internal；面板行首带 `0x0b5` |
 * | 3 | 面板说 `menuBind`/`menuReset` 没实现 | 菜单表是 **VM 状态**（`Engine.menuMap`），宿主本无需实现；多余的 `c.native.*` 通知被闸门 A 记成"意图被丢弃" | 0xA1/0xA2/0xA3 语义 + 宿主不再被通知 |
 * | 4 | 打开字体设置：中间没有列表，滚动条中间段漂到左边 | `0x2DC`（字体数）走通用配置 getter ⇒ 恒 0 ⇒ 选择器 `count==0 ⇒ exit`；`$1$SELFONT.txt:78` 还拿它当**除数** ⇒ 除零、滚动条几何 NaN | `0x2DC`/`0x2DD` 与 `0x2DE` 共用同一张字体表 |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/stubNative.js';
import { DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';
import { ENGINE_FONT_LIST } from '../src/text/fontSet.js';
import { REVEAL_FRAME_MS } from '../src/vm/msgwin.js';
import { dec } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const gstr = (v: number): BinArg => ({ type: 5, raw: v }) as unknown as BinArg;
const lit = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;
const locInt = (i: number): BinArg => ({ type: 9, raw: i }) as unknown as BinArg;
const locStr = (i: number): BinArg => ({ type: 0xb, raw: i }) as unknown as BinArg;
const instr = (op: number, args: BinArg[]): BinInstruction =>
  ({ opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 建一个引擎 + 直接以 handler 执行一条指令（与 engine-config.test.ts 同口径）。 */
function mk(native = new StubNative(() => {})): {
  e: Engine;
  /** 执行一条指令；返回 ctx（`_nextIp` = 控制流转移，`null` = 顺序推进）。 */
  run: (op: number, args: BinArg[]) => { _nextIp: number | null };
} {
  const e = new Engine(native, new InputManager());
  const f = e.curScript();
  return {
    e,
    run: (op, args) => {
      const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应已注册`);
      const ctx = makeCtx(e, f, instr(op, args), e.native, () => {});
      h!(ctx);
      return ctx;
    },
  };
}

/** 读本帧 `local-int` 槽（引擎侧存 DEC 编码值）。 */
const intAt = (e: Engine, f: { locals: { int: Map<number, number> } }, i: number): number =>
  dec(e.key, f.locals.int.get(i) ?? 0);

// ---------------------------------------------------------------------------
// 4) 字体选择器：0x2DC / 0x2DD / 0x2DE 必须共用同一张表
// ---------------------------------------------------------------------------

test('★0x2DC 可选字体数量：返回表长度，且**永不为 0**（引擎空表用 -1；SELFONT 拿它当除数）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  run(0x2dc, [locInt(0x410)]);
  const n = intAt(e, f, 0x410);
  assert.equal(n, ENGINE_FONT_LIST.length, '数量 = ENGINE_FONT_LIST 的长度');
  assert.ok(n > 0, 'SELFONT.txt:78 的 div 分母（count）不能是 0');
  assert.notEqual(n, 0, '引擎在空表时返回 -1、绝不返回 0（否则脚本除零）');
});

test('★0x2DD <串> <下标>：下标 → 字体名；越界/负数 → 空串', () => {
  const { e, run } = mk();
  const f = e.curScript();
  for (const [i, name] of ENGINE_FONT_LIST.entries()) {
    run(0x2dd, [locStr(0), im(i)]);
    assert.equal(f.locals.str.get(0), name, `下标 ${i}`);
  }
  run(0x2dd, [locStr(0), im(ENGINE_FONT_LIST.length)]);
  assert.equal(f.locals.str.get(0), '', '越界 ⇒ 空串（引擎 byte_51EA3C）');
  run(0x2dd, [locStr(0), im(-1)]);
  assert.equal(f.locals.str.get(0), '', '负数 ⇒ 空串');
});

test('★三条字体指令共用一张表：0x2DE(0x2DD(i)) == i（选择器写回的名字必须查得回来）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  for (let i = 0; i < ENGINE_FONT_LIST.length; i++) {
    run(0x2dd, [locStr(0), im(i)]);
    const name = f.locals.str.get(0)!;
    run(0x2de, [locInt(1), lit(name)]);
    assert.equal(intAt(e, f, 1), i, `${name} 的下标应回到 ${i}`);
  }
});

test('字体表里必须有汉化随包面名 `Amayui CN`（否则玩家选不到它）', () => {
  assert.ok(ENGINE_FONT_LIST.includes('Amayui CN'));
});

// ---------------------------------------------------------------------------
// 2) 0x5B(`ne`) 与 0x0B5(`DsPlaySound`) 的分类不许混
// ---------------------------------------------------------------------------

test('★0x5B = ne：在 OPS（implemented），**不可能**出现在「被忽略/能力缺口」里', () => {
  assert.equal(OPS.has(0x5b), true, '0x5B 必须走真实现');
  assert.equal(ENGINE_INTERNAL_OPS.has(0x5b), false, '0x5B 不在引擎内部插桩表');
  assert.notEqual(NATIVE_OPS.has(0x5b), true);
  assert.equal(ENGINE_INTERNAL_OPS.has(0xb5), true, '0x0B5（DsPlaySound 音轨）才是无音频子系统的插桩项');
  assert.equal(OPS.has(0xb5), false);
});

test('ne 的语义：0x5B 写回 0/1（顺手守住"比较族没被插桩掉"）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  run(0x55, [locInt(0), im(7)]); // mov
  run(0x5b, [locInt(1), locInt(0), im(8)]);
  assert.equal(intAt(e, f, 1), 1, '7 != 8 ⇒ 1');
  run(0x5b, [locInt(1), locInt(0), im(7)]);
  assert.equal(intAt(e, f, 1), 0, '7 != 7 ⇒ 0');
});

// ---------------------------------------------------------------------------
// 3) 菜单派发：A1 复位 / A2 登记 / A3 查表跳转（纯 VM 状态，不经宿主）
// ---------------------------------------------------------------------------

test('★0xA1/0xA2/0xA3：登记 → 查表跳转；未命中 → 回退 label；复位后回退', () => {
  const { e, run } = mk();
  const f = e.curScript();
  // 造一个带 label 的假脚本：指令 index 即 label 值（loadScriptIntoFrame 的同一口径）
  const mkInstr = (label: number): BinInstruction =>
    ({ opcode: 0, name: 'nop', argc: 0, args: [], byteOffset: 0, index: label }) as unknown as BinInstruction;
  f.script = {
    signature: 'MENUTEST', subHeaderLength: 0, tables: [], instructions: [mkInstr(0x100), mkInstr(0x200), mkInstr(0x300)],
    labelTargets: new Set<number>(), raw: new Uint8Array(0),
  } as never;
  f.labelMap.set(0x100, 0);
  f.labelMap.set(0x200, 1);
  f.labelMap.set(0x300, 2);

  run(0xa2, [im(3), im(0x200)]); // 登记 key="3" → label 0x200
  const hit = run(0xa3, [im(3), im(0x300)]); // 命中 ⇒ 跳到 0x200（而不是回退 0x300）
  assert.equal(hit._nextIp, 1, '命中登记项 ⇒ 跳到 label 0x200 的位置（指令下标 1）');

  const miss = run(0xa3, [im(9), im(0x100)]); // 未命中 ⇒ 回退 label
  assert.equal(miss._nextIp, 0, '未命中 ⇒ 跳到 op2 的回退 label');

  run(0xa1, []); // 复位
  assert.equal(e.menuMap.size, 0, '0xA1 清空菜单表');
  const after = run(0xa3, [im(3), im(0x100)]);
  assert.equal(after._nextIp, 0, '复位后同一 key 走回退 label');
});

test('★菜单指令不再被记成"宿主未实现的意图"（假缺口）：闸门 A 计数为 0', () => {
  const rec = new DropRecorder();
  const native = withNativeTap(new StubNative(() => {}), rec);
  // 0x4 系列不做断言，只确认"菜单相关的三个 opcode 一个都不上报"
  const { run } = mk(native as unknown as Engine2['native']);
  run(0xa1, []);
  run(0xa2, [im(1), im(0x10)]);
  assert.equal(rec.count(), 0, `不该有被丢弃的 native 意图（实际：${rec.list().map((d) => d.method).join(',')}）`);
});

// ---------------------------------------------------------------------------
// 1) 消息速度：显现预算 = 字数 × max(节拍, 一帧)
// ---------------------------------------------------------------------------

test('★0x1B5 设消息速度：写字段 `Engine[21668]` **且** 写配置 `message:MessageSpeed`', () => {
  const { e, run } = mk();
  run(0x1b5, [im(25)]);
  assert.equal(e.engineValues.get(21668), 25);
  assert.equal(e.config?.values.get('message:messagespeed'), 25);
});

test('★显现预算按**字**算（引擎一步 = 一个字）：speed=99 × 42 字 ⇒ 4158ms，speed=1 被一帧地板住', () => {
  const e = new Engine(new StubNative(() => {}));
  const st99 = e.msgwin.beginReveal(0, 42, 0, 99);
  assert.equal(st99.budgetMs, 99 * 42, '99ms/字 × 42 字');
  const st1 = e.msgwin.beginReveal(0, 42, 0, 1);
  assert.equal(st1.budgetMs, Math.max(1, REVEAL_FRAME_MS) * 42, '1ms 被"一帧"地板住（引擎 Sleep 也受帧率限制）');
  const st0 = e.msgwin.beginReveal(0, 42, 0, 0);
  assert.equal(st0.active, false, 'speed=0 ⇒ 立即显示完（引擎同步排空分支）');
});

test('★逐字显现：99ms/字 时每约 99ms 只多一个字（旧实现按"行"算 ⇒ 一帧内跳好几行）', () => {
  const e = new Engine(new StubNative(() => {}));
  e.msgwin.beginReveal(0, 10, 0, 99);
  const seen: number[] = [];
  for (const t of [50, 100, 200, 300, 500, 990]) seen.push(e.msgwin.tickRevealWin(0, t, 99) ? 1 : 0);
  // 到 100ms ⇒ 1 字；200ms ⇒ 2 字；300 ⇒ 3；500 ⇒ 5；990 ⇒ 10（完）
  assert.deepEqual(seen, [0, 1, 1, 1, 1, 1], '每次 tick 都有推进（至 990ms 收尾）');
  const st = e.msgwin.reveal.get(0)!;
  assert.equal(st.shown, 10, '990ms 时 10 个字全部显示');
  assert.equal(st.active, false);
});

test('★可观察性回归：速度 1..99ms/字 的整段时长跨度必须是"每字节拍"级（不是"每行"）', () => {
  const e = new Engine(new StubNative(() => {}));
  const span = (speed: number): number => e.msgwin.beginReveal(0, 40, 0, speed).budgetMs ?? 0;
  const fast = span(1);
  const slow = span(99);
  assert.ok(slow / fast > 5, `99ms 与 1ms 的时长比应远大于 5（旧实现只有 ~6×；实际 ${(slow / fast).toFixed(1)}×）`);
  assert.equal(slow, 3960, '40 字 × 99ms');
});

