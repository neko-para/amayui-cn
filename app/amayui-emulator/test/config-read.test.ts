/**
 * **配置读取指令族**回归：读引擎配置键 → **写回脚本操作数**。
 *
 * 为什么单独测：这类 handler 的**唯一副作用就是回写操作数**，被当 no-op 跳过时脚本不报错、只读到旧值
 * —— 正是「闸门 B」针对的静默错误。实测 CONFIG1（设置界面）路径上有 7 条这种指令（`0xC5/0xC7/0x1B8/
 * 0x2CC/0x2E6/0x2EA/0x194`），全部曾走 no-op。
 *
 * 引擎实证（raw 行号见 `src/vm/handlers/config-read.ts` 表）：
 *  - `0xC5` sub_42E540：op1 选 0..4 → `sound:Volume0..4` → **op2**
 *  - `0xC7` sub_42E670：op1 选 1..4 → `sound:Music`(≥0→1)/`SE`/`Voice`/`Movie`（非 0→1）→ **op2**
 *  - `0x1B8` sub_42D2F0：op1 选 0/1 → `message:AutoMessageTime0/1` → **op2**
 *  - `0x2CC` sub_4309E0：`message:AdvanceMesOnWheel` → **op1**
 *  - `0x2E6` sub_431110：op1 选 0/1 → `message:AutoMessagePitch0/1` → **op2**
 *  - `0x2EA` sub_4311B0：`message:AutoMessageOption` → **op1**
 *  - `0x194` sub_42CF10：`op1 = (op2 == op3)`（`sub_401540` = std::string::compare 语义）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { parseIni } from '../src/engineConfig.js';
import { dec } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

/** 与随包 `SYS4REG.INI` 的 `[message]`/`[sound]` 段一致的最小配置。 */
const INI = `[sound]
Volume0=80
Volume1=60
Volume1x=0
SE=1
Voice=1
Music=1
Movie=0
[message]
MessageSpeed=5
MesWinAlpha=8
AutoMessageTime0=500
AutoMessageTime1=2000
AutoMessagePitch0=0
AutoMessagePitch1=3
AutoMessageOption=1
ReadTextSkip=0
AdvanceMesOnWheel=0
`;

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
/** 目标操作数必须是**可写**类型：local-int = 0x9。 */
const li = (raw: number): BinArg => ({ type: 0x9, raw }) as unknown as BinArg;
const str = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;
const gstr = (raw: number): BinArg => ({ type: 5, raw }) as unknown as BinArg;
/** local-string = 0x2（引擎的"字符串字面量"就用它携带 `str`）。 */
const lstr = (raw: number): BinArg => ({ type: 0x2, raw }) as unknown as BinArg;

function mk(): { e: Engine; f: Frame; step: (op: number, args?: BinArg[]) => void } {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  e.config = parseIni(INI);
  const f = new Frame();
  const step = (op: number, args: BinArg[] = []): void => {
    const instr = { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr, native, () => {}));
  };
  return { e, f, step };
}

/** 读到 local-int 槽的解码值。 */
const rd = (e: Engine, f: Frame, i: number): number => dec(e.key, f.locals.int.get(i) ?? 0);

test('0x2CC / 0x2EA：无选择器，读固定键写回 op1', () => {
  const { e, f, step } = mk();
  step(0x2cc, [li(0x10)]);
  assert.equal(rd(e, f, 0x10), 0, 'message:AdvanceMesOnWheel = 0');
  step(0x2ea, [li(0x11)]);
  assert.equal(rd(e, f, 0x11), 1, 'message:AutoMessageOption = 1');
});

test('0xC5：op1 选 0..4 → sound:VolumeN 写回 op2；越界选择器不写', () => {
  const { e, f, step } = mk();
  step(0xc5, [im(0), li(0x20)]);
  assert.equal(rd(e, f, 0x20), 80, 'Volume0');
  step(0xc5, [im(1), li(0x21)]);
  assert.equal(rd(e, f, 0x21), 60, 'Volume1');
  // 越界：引擎走报错分支（不写），emulator 不写 ⇒ 槽保持旧值
  step(0xc5, [im(9), li(0x22)]);
  assert.equal(rd(e, f, 0x22), 0, '越界不写（槽保持初值 0）');
});

test('0xC7：sound:SE/Voice/Movie 布尔化后写回 op2', () => {
  const { e, f, step } = mk();
  step(0xc7, [im(2), li(0x30)]);
  assert.equal(rd(e, f, 0x30), 1, 'sound:SE=1 → 1');
  step(0xc7, [im(4), li(0x31)]);
  assert.equal(rd(e, f, 0x31), 0, 'sound:Movie=0 → 0');
});

test('0x1B8 / 0x2E6：op1 选 0/1 → AutoMessageTime/Pitch 写回 op2', () => {
  const { e, f, step } = mk();
  step(0x1b8, [im(0), li(0x40)]);
  assert.equal(rd(e, f, 0x40), 500);
  step(0x1b8, [im(1), li(0x41)]);
  assert.equal(rd(e, f, 0x41), 2000);
  step(0x2e6, [im(0), li(0x42)]);
  assert.equal(rd(e, f, 0x42), 0);
  step(0x2e6, [im(1), li(0x43)]);
  assert.equal(rd(e, f, 0x43), 3);
});

test('★0x194：字符串相等判定写回 op1（CONFIG1 用它判断字体名有没有变）', () => {
  const { e, f, step } = mk();
  e.globals.str.set(0xd5d, 'Noto Sans');
  step(0x194, [li(0x50), gstr(0xd5d), str('Noto Sans')]);
  assert.equal(rd(e, f, 0x50), 1, '相同 ⇒ 1');
  step(0x194, [li(0x51), gstr(0xd5d), str('Other Font')]);
  assert.equal(rd(e, f, 0x51), 0, '不同 ⇒ 0');
});

test('无配置（e.config = null）时全部按缺省 0 写回，绝不抛错', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  for (const op of [0x2cc, 0x2ea]) {
    OPS.get(op)!(makeCtx(e, f, { opcode: op, name: 'x', argc: 1, args: [li(0x60)], byteOffset: 0, index: 0 } as unknown as BinInstruction, native, () => {}));
  }
  assert.equal(rd(e, f, 0x60), 0);
});
