/**
 * **A5 的回归测试**（2026-09）：单行字段写 / 计时 / 音频设备 / 消息面。
 *
 * A5 = `0x93` `0x94` `0x97`（消息面/面板表面）+ `0xD9` `0xAD` `0x1AD` `0x1B1`（清位/秒计时器/字段写）
 *      + `0x1BC` `0x1C9`（清消息·声音字段 / 音频设备初始化）。
 * 逐条引擎实证见各 handler 注释；台账见 `docs-new/99-records/2026-09-audit/stub-reaudit-2026-09.md` §6。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { PANEL_BASE } from '../src/vm/handlers/panel.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { AudioIntent } from '../src/audio/audioEngine.js';
import { im, instr, str } from './harness.js';

const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;
const F = (k: number): number => PANEL_BASE + k;


function mk(native: NativeBridge = new StubNative(() => {}), input = new InputManager()) {
  const e = new Engine(native, input);
  const f = new Frame();
  const run = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应已实现`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  return { e, f, run, input };
}

const A5 = [0x91, 0x92, 0x93, 0x94, 0x97, 0xd9, 0xad, 0x1ad, 0x1b1, 0x1bc, 0x1c9] as const;

test('注册表棘轮：A5 的 11 条都已实现，且不在 ENGINE_INTERNAL_OPS', () => {
  for (const op of A5) {
    assert.ok(OPS.has(op) || NATIVE_OPS.has(op), `0x${op.toString(16)} 应已实现`);
    assert.equal(ENGINE_INTERNAL_OPS.has(op), false, `0x${op.toString(16)} 不得留在 stub 表`);
  }
});

test('A5 0x93：清 effect_flags 0x800000 + 复位面板游标态 + toggle 12956/12957', () => {
  const { e, run } = mk();
  e.effectFlags = 0x800000 | 0x40;
  e.routes.push(0, 0, 10, 10, 1, 2, 3, 0);
  e.routes.hitTest(5, 5);
  assert.equal(e.routes.cursor, 0);
  e.engineValues.set(12957, 1);
  run(0x93);
  assert.equal(e.effectFlags & 0x800000, 0, '清掉了 0x800000');
  assert.equal(e.effectFlags & 0x40, 0x40, '别的位不动');
  assert.equal(e.routes.cursor, -1, '`[7468]` 游标复位');
  assert.equal(e.engineValues.get(F(959)), -1);
  // ★2026-09 订正：`[258]` **就是路由表的条目数**（面板 `_this + 1032`，命中测试 `sub_403C50`
  //   raw 9819 用的就是它）⇒ `sub_403EF0` 的 `[258] = 0` = **清空路由表**。旧断言写的是
  //   "复位不清路由条目表"（源于 opcode-table 的一句笔误），实际引擎会清 —— 不清的话 UI 例程
  //   每次 `i093` + 重登记都会累积热点（实测 14→33→40），旧的全屏热点继续遮蔽新的 ⇒ 派发错 label。
  assert.equal(e.routes.count, 0, '复位会**清空**路由条目表（[258] = 条目数 = 0）');
  assert.equal(e.engineValues.get(F(258)), 0, '`[258]` 也同步写 0');
  assert.equal(e.engineValues.get(12957), 0, '12957 原为 1 ⇒ 清 0');
  // 再跑一次：12957 已 0 ⇒ 置 12956 = 1
  run(0x93);
  assert.equal(e.engineValues.get(12956), 1);
});

test('A5 0x94：置 12957 + 步长/待填充（首次初始化时按鼠标做命中测试）', () => {
  const input = new InputManager();
  input.x = 5;
  input.y = 5;
  input.hasCursor = true;
  const { e, run } = mk(new StubNative(() => {}), input);
  e.routes.push(0, 0, 10, 10, 1, 2, 3, 0);
  run(0x94);
  assert.equal(e.engineValues.get(12957), 1);
  assert.equal(e.engineValues.get(F(7465)), 1, '置"已初始化"（sub_404020 首次分支）');
  assert.equal(e.routes.cursor, 0, '首次初始化按鼠标坐标命中（GetCursorPos→sub_403C50 等价物）');
  // 第二次：只写步长 + 待填充标记（引擎 `sub_404020` 的 `[7465] != 0` 分支）
  e.routes.cursor = -1;
  run(0x94);
  assert.equal(e.engineValues.get(F(960)), 10000, '步长 = 10000');
  assert.equal(e.engineValues.get(F(7464)), 1, '待填充');
  assert.equal(e.routes.cursor, -1, '已初始化分支不再做命中测试');
  assert.equal(e.routes.pageStep, 10000, '同一份状态：`[960]` 也落在 RoutePanel 上');
});

test('A5 0x97：**把输入掩码位绑到矩形相同的那个热点**（= sub_403D10，不是"填矩形"）', () => {
  const { e, run } = mk();
  // `i090 x y w h …` 登记（矩形存成 x1=x+w, y1=y+h），随后 `i097 x y w h bit` 绑定
  run(0x90, [im(0x10), im(0x20), im(0x30), im(0x40), im(-1), im(-1), im(0x770)]);
  run(0x97, [im(0x10), im(0x20), im(0x30), im(0x40), im(3)]);
  assert.equal(e.routes.entries[0]!.keyBit, 3, '绑定掩码位 3（引擎 `[7361+i] = a3`，raw 9842）');
  // `sub_403D70`（raw 9847-9862）：该位在掩码里 ⇒ 返回该热点的 **labelC**
  assert.equal(e.routes.pickByKey(1 << 3), 0x770, '掩码含 bit3 ⇒ 键命中返回 labelC');
  assert.equal(e.routes.pickByKey(0), -1, '掩码为 0 ⇒ 不命中');
  // 矩形不完全相同 ⇒ 引擎静默什么都不做（`sub_403D10` 没有 else 分支）
  run(0x97, [im(0x11), im(0x20), im(0x30), im(0x40), im(5)]);
  assert.equal(e.routes.entries[0]!.keyBit, 3, '矩形不全等 ⇒ 不改绑定');
  // ★这不再经过 NativeBridge（旧实现转发 `native.fillPanelRect` 是语义错）
  assert.equal((e.native as unknown as { fillPanelRect?: unknown }).fillPanelRect, undefined);
});

test('A5 0x91/0x92：面板显示态（effect_flags 0x800000）+ sub_404020；0x92 另写回退 label [7467]', () => {  const { e, run } = mk();
  e.routes.push(0, 0, 10, 10, 1, 2, 3, 0);
  run(0x92, [im(7), im(0x4321)]);
  assert.equal(e.effectFlags & 0x800000, 0x800000, '置位 0x800000（raw 29560）');
  assert.equal(e.routes.fallbackLabel, 0x4321, '`[7467]` = op2（回退 label）');
  assert.equal(e.engineValues.get(F(7464)), 1, '经 sub_404020 置"待填充"');
  assert.equal(e.engineValues.get(F(960)), 7, '步长 = op1');
  // toggle：`[12956]` 非 0 ⇒ 只清 12956/12958（不发显示态）
  e.effectFlags = 0;
  e.engineValues.set(12956, 1);
  run(0x91, [im(5)]);
  assert.equal(e.effectFlags & 0x800000, 0, '关闭已发生 ⇒ 不置显示位');
  assert.equal(e.engineValues.get(12956), 0, '`[12956]` 被清 0');
  assert.equal(e.engineValues.get(12958), 0, '`[12958]` 被清 0');
});

test('0xFB + 0x100：跳转表按**输入掩码位**索引（= op1，不偏移；b∈{4,5} 也不走 mouseJump）', () => {
  const { e, run } = mk();
  const f = e.curScript(); // ★`0x100` 在**当前帧**查 labelMap（不是测试里那个 `new Frame()`）
  // ★扫描上界 = `Engine[517]`（SetKeyTotal；raw 25033-25039 的 `while (++v6 < v7)`，v7 = `[517]`）：
  //   下标 ≥ SetKeyTotal 的槽**不参与**掩码扫描（它们只能作为"默认键"被取到，见下一条测试）。
  //   真机由 `SYSTEM4.txt:86` 的 `i0fe c` 置 12；本合成引擎没跑脚本 ⇒ 是引擎默认 7（Input 构造
  //   `sub_477DD0` raw 92385）⇒ bit 7 会被上界挡掉。这里照真机设 12（本用例正好要覆盖 bit 7）。
  e.engineValues.set(517, 12);
  f.labelMap.set(0x500, 3);
  f.labelMap.set(0x511, 5);
  f.labelMap.set(0x522, 6);
  /** `run` 的变体：拿回 `StepCtx`（`jump()` 只写 `ctx._nextIp`，由 `stepOnce` 才落到 `frame.ip`）。 */
  const runCtx = (op: number, args: BinArg[]): { _nextIp: number | null } => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应已实现`);
    const ctx = makeCtx(e, f, instr(op, args), e.native, () => {});
    h!(ctx);
    return ctx;
  };
  // ★`i0fb <掩码位> <label>`：op1 **就是掩码位**（引擎 `sub_421B80` raw 30417 `_this[33*cur+107725+op1]=op2`
  //   ↔ `sub_419AF0` raw 25042 查 `_this[33*cur+107725+掩码位]` —— 中间没有 ±4）。
  //   ★2026-09 修：旧实现存到 `4+op1`，害得**鼠标左键（掩码位 4）派发到 `joy-callback 0`** 的 handler
  //   （TITLE/GAMESTART 的 `0xFB 0` 是"行确认"，会画出按钮高亮贴图 ⇒ 用户报的「切界面后按钮停在 hover 态」）。
  run(0xfb, [im(7), im(0x500)]); // 掩码位 7 = 手柄按钮 3（flush 的 `4+3`）
  run(0xfb, [im(5), im(0x511)]); // 掩码位 5 = 鼠标右
  run(0xfb, [im(4), im(0x522)]); // 掩码位 4 = 鼠标左（与"手柄按钮 0"别名）
  run(0xfb, [im(0), im(0x533)]); // 掩码位 0 = 可配置键 0 —— **绝不能**被鼠标左键命中
  assert.equal(e.input.joyJump[7], 0x500, '掩码位 7 ⇒ 存在 7');
  assert.equal(e.input.joyJump[5], 0x511, '掩码位 5 ⇒ 存在 5');
  assert.equal(e.input.joyJump[4], 0x522, '掩码位 4 ⇒ 存在 4');
  assert.equal(e.input.joyJump[0], 0x533, '掩码位 0 ⇒ 存在 0');
  // 手柄按钮 3 ⇒ 掩码位 7
  e.input.pressJoy(3);
  assert.equal(runCtx(0x100, [])._nextIp, 3, '掩码 bit7 ⇒ joyJump[7] 的目标 0x500');
  // 鼠标右键按下 ⇒ 掩码位 5；`joyJump[5]` 已登记 ⇒ 跳 0x511。
  //   ★旧实现走 `(b===4||b===5) && mouseJump!==-1 ? mouseJump : joyJump[b-4]`：
  //     mouseJump 未注册时取 `joyJump[1]`（= -1）⇒ **什么都不跳**；注册了则错跳 mouseJump。
  e.input.joyEdge = [];
  e.input.consumeEdges();
  e.input.buttons = 2; // 右键按住 ⇒ flush 出 bit5
  e.input.mouseJump = 0x999; // 注册了 mouse-callback 也不该被 0x100 用
  f.retStack.length = 0;
  assert.equal(runCtx(0x100, [])._nextIp, 5, '掩码 bit5 ⇒ joyJump[5]（不是 mouseJump、也不是 joyJump[b-4]）');
  assert.equal(e.input.mouseJump, 0x999, '0x100 不消费（也不读）mouseJump');
  // ★用户报 #1 的回归锁：鼠标**左键**（掩码位 4）必须走 `joyJump[4]`，**不能**走 `joyJump[0]`。
  e.input.joyEdge = [];
  e.input.consumeEdges();
  e.input.buttons = 1; // 左键按住 ⇒ flush 出 bit4
  f.retStack.length = 0;
  assert.equal(
    runCtx(0x100, [])._nextIp,
    6,
    '掩码 bit4（鼠标左）⇒ joyJump[4] 的目标 0x522；若跳到 0x533 说明又退回 `4+op1` 的错索引',
  );
  void run;
});

test('A5 0xD9：清 effect_flags & 0x1000（派发中时同清 95779）', () => {
  const { e, run } = mk();
  e.effectFlags = 0x1000 | 0x2000;
  run(0xd9);
  assert.equal(e.effectFlags & 0x1000, 0);
  assert.equal(e.effectFlags & 0x2000, 0x2000);
  e.engineValues.set(95779, 0x1000 | 0x8);
  run(0xd9);
  assert.equal(e.engineValues.get(95779) & 0x1000, 0x1000, '124350 == 0 ⇒ **不**清 95779 的该位');
  e.engineValues.set(124350, 1);
  e.engineValues.set(95779, 0x1000 | 0x8);
  run(0xd9);
  assert.equal(e.engineValues.get(95779), 0x8, '派发中 ⇒ 同清 95779 的该位');
});

test('A5 0xAD：秒计时器 = timeGetTime/1000（定点近似，BigInt 复刻）', () => {
  const { e, run } = mk();
  e.nowMs = 1_500; // 1.5 秒
  e.engineValues.set(5451, 42); // 「当前秒」的另一个槽
  run(0xad);
  assert.equal(e.engineValues.get(5449), 1, '1500ms ⇒ 1 秒');
  assert.equal(e.engineValues.get(5450), 42, '`[259] ← [260]`');
  e.nowMs = 12_345;
  run(0xad);
  assert.equal(e.engineValues.get(5449), 12, '12345ms ⇒ 12 秒');
  assert.equal(e.engineValues.get(5450), 42, '`[259] ← [260]`（5451 = 42 未被本指令改动）');
});

test('A5 0x1AD / 0x1B1：字段写（166963=cur、21672=op1）', () => {
  const { e, run } = mk();
  e.cur = 7;
  run(0x1ad);
  assert.equal(e.engineValues.get(166963), 7, '存档序列化用的"当前帧"记忆（语料 1100 处）');
  run(0x1b1, [im(0x1234)]);
  assert.equal(e.engineValues.get(21672), 0x1234);
});

test('A5 0x1BC：清语音通道状态位/寄存槽 + 对 3 个通道发 voice-reset', () => {
  const intents: AudioIntent[] = [];
  const native = new StubNative(() => {});
  (native as unknown as { audio?: (i: AudioIntent) => void }).audio = (i) => intents.push(i);
  const { e, run } = mk(native);
  e.engineValues.set(21315, 1);
  e.engineValues.set(21317, 1);
  e.engineValues.set(122505, 0x7001);
  e.engineValues.set(122510, 9);
  run(0x1bc);
  assert.deepEqual([e.engineValues.get(21315), e.engineValues.get(21317)], [0, 0]);
  assert.deepEqual([e.engineValues.get(122505), e.engineValues.get(122510)], [0, 0]);
  assert.deepEqual(intents, [
    { kind: 'voice-reset', ch: 0 },
    { kind: 'voice-reset', ch: 1 },
    { kind: 'voice-reset', ch: 2 },
  ]);
});

test('A5 0x1C9：音频设备初始化写 18656/18660（装载=已登记缺口，不抛）', () => {
  const { e, run } = mk();
  run(0x1c9, [im(0x5250), im(11), im(22)]);
  assert.equal(e.engineValues.get(18656), 11);
  assert.equal(e.engineValues.get(18660), 22);
});

test('A5：9 条都不写脚本操作数（与"单行字段"判据一致）', () => {
  const { e, run } = mk();
  const before = { a: 0x1234, b: 0x5678 };
  e.globals.int.set(0x300, enc(e.key, before.a));
  e.globals.int.set(0x301, enc(e.key, before.b));
  const g = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;
  for (const op of A5) {
    run(op, [g(0x300), g(0x301), g(0x302), g(0x303), g(0x304)]);
    assert.equal(dec(e.key, e.globals.int.get(0x300) ?? 0), before.a, `0x${op.toString(16)} 不应写 op1`);
    assert.equal(dec(e.key, e.globals.int.get(0x301) ?? 0), before.b, `0x${op.toString(16)} 不应写 op2`);
  }
});
