/** save/load-int(0x1A2/0x1A3) + save/load-string(0x1A9/0x1AA) + ADV/消息激活态(0x8000000) 单元测试。
 *  语义依据：opcode-table.md 0x1A2(sub_434F60)/0x1A3(sub_42DF40)（`_this+5452` 表）、0x1A9(sub_434FE0)/0x1AA(sub_433A70)（`_this+5472` 表）、0x071/0x088/0x19B/0x19C（effect_flags 0x8000000）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { enc } from '../src/vm/bits.js';
import { readIntOperand, readStringOperand } from '../src/vm/operand.js';
import type { BinInstruction, BinArg } from '../src/script/bin.js';

function instr(opcode: number, args: BinArg[]): BinInstruction {
  return { opcode, name: 'x', argc: args.length, args, byteOffset: 0, index: 0 };
}
/** 立即 int 操作数。 */
const im = (raw: number): BinArg => ({ type: 0x0, raw });
/** 全局 int 操作数（可写的值槽）。 */
const gin = (raw: number): BinArg => ({ type: 0x3, raw });
/** 全局 string 操作数。 */
const gs = (raw: number): BinArg => ({ type: 0x5, raw });
/** 局部 string 指针操作数（type 0xe = 14）。 */
const lsp = (raw: number): BinArg => ({ type: 0xe, raw });
/** 复制引擎 wsprintfA("%c%8.8x", 3, idx) 的查询键。 */
const sk = (idx: number): string => '\x03' + ((idx >>> 0).toString(16).padStart(8, '0'));
const sk5 = (idx: number): string => '\x05' + ((idx >>> 0).toString(16).padStart(8, '0'));

test('save-int(0x1A2)/load-int(0x1A3)：0x1A2 登记 → 0x1A3 查表写回 op1；未命中写 0', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]) => makeCtx(e, f, instr(op, args), native, () => {});

  // 全局 int 槽 7 置值 5（raw = enc(0,5)）
  e.globals.int.set(7, enc(0, 5));
  // 0x1A2：登记 值=5 到 sk(槽号=7)——键由"操作数自身 index"构成，不是存量值
  OPS.get(0x1a2)!(step(0x1a2, [gin(7)]));
  assert.equal(e.stringIndexTable.get(sk(7)), 5, '0x1A2 应把值登记到 sk(槽号=7)');
  assert.equal(e.stringIndexTable.get(sk(enc(0, 5))), undefined, '键不是由存量值构成');

  // 0x1A3：同槽查表 → 命中 5，写回 op1 → 槽值仍 5
  OPS.get(0x1a3)!(step(0x1a3, [gin(7)]));
  assert.equal(readIntOperand(e, f, instr(0x1a3, [gin(7)]), 1), 5, '0x1A3 同槽应命中表值 5');

  // 未命中：槽 8 置 9（未登记）→ 0x1A3 写 0
  e.globals.int.set(8, enc(0, 9));
  OPS.get(0x1a3)!(step(0x1a3, [gin(8)]));
  assert.equal(readIntOperand(e, f, instr(0x1a3, [gin(8)]), 1), 0, '0x1A3 未命中应写 0');
});

test('save/load-int 真实用法：0x1A3 读 → 改 → 0x1A2 写回，跨周期持久（SC5450 计数循环）', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]) => makeCtx(e, f, instr(op, args), native, () => {});
  const read = (n: number) => readIntOperand(e, f, instr(0x1a3, [gin(n)]), 1);

  e.globals.int.set(8, enc(0, 0)); // 槽 8 初值 0
  for (let i = 0; i < 3; i++) {
    // 0x1A3：槽8 = table[sk(8)] ?? 0
    OPS.get(0x1a3)!(step(0x1a3, [gin(8)]));
    let v = read(8); // 脚本里的 add/mod（这里直接算）
    v = (v + 1) % 10;
    e.globals.int.set(8, enc(0, v));
    // 0x1A2：table[sk(8)] = 槽8
    OPS.get(0x1a2)!(step(0x1a2, [gin(8)]));
  }
  // 3 轮后：1,2,3 —— 值跨周期被表记住（第 2/3 轮 0x1A3 读到的是上一轮 0x1A2 写入的值）
  assert.equal(e.stringIndexTable.get(sk(8)), 3, '0x1A2 应在第 3 轮登记 3');
  assert.equal(read(8), 3, '0x1A3 下轮起按 sk(8) 取回 3');
});

test('advActive(0x8000000)：由 0x071/0x088/0x19B/0x19C 置/清', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]) => makeCtx(e, f, instr(op, args), native, () => {});

  assert.equal(e.advActive, false, '初始 ADV 未激活');
  // 0x19C 进入（无消息字段 97050/122455/124331=0）→ 清位（仍是未激活）
  OPS.get(0x19c)!(step(0x19c, []));
  assert.equal(e.advActive, false);
  // 0x088 消息模式 op1=1 → 置 97050=1；adv 仍未激活（仅设 122368）
  OPS.get(0x088)!(step(0x088, [im(1)]));
  assert.equal(e.advActive, false);
  // 0x19C 再进入 → 97050=1 → 置 ADV
  OPS.get(0x19c)!(step(0x19c, []));
  assert.equal(e.advActive, true, '97050=1 时 0x19C 置 ADV');
  // 0x19B 退出 → 清 ADV
  OPS.get(0x19b)!(step(0x19b, []));
  assert.equal(e.advActive, false);
  // 0x071 显示消息 → 置 ADV
  OPS.get(0x071)!(step(0x071, [im(0)]));
  assert.equal(e.advActive, true, '0x071 显示消息置 ADV');
  // 0x088 消息模式 op1=0 → 清 ADV
  OPS.get(0x088)!(step(0x088, [im(0)]));
  assert.equal(e.advActive, false, '0x088 置 0 清 ADV');
});

test('save-string(0x1A9) / load-string(0x1AA)：str→str 表（global-string 与 local-string-ptr 8/14）', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]) => makeCtx(e, f, instr(op, args), native, () => {});
  const get = (a: BinArg) => readStringOperand(e, f, instr(0x1aa, [a]), 1);

  // global-string 20 置 "hello"
  e.globals.str.set(20, 'hello');
  // save-string：登记 stringTable[key5(20)] = "hello"
  OPS.get(0x1a9)!(step(0x1a9, [gs(20)]));
  assert.equal(e.stringTable.get(sk5(20)), 'hello', '0x1A9 应把字符串登记到 sk5(20)');
  // load-string 同槽取回
  OPS.get(0x1aa)!(step(0x1aa, [gs(20)]));
  assert.equal(get(gs(20)), 'hello', '0x1AA 应取回登记串');
  // 未命中槽 → 写空串
  OPS.get(0x1aa)!(step(0x1aa, [gs(21)]));
  assert.equal(get(gs(21)), '', '0x1AA 未命中应写空串');

  // local-string-ptr 0 →（局部串池 5，存 "world"）
  f.locals.strPtr.set(0, { scope: 'local', kind: 'str', index: 5, stride: 28 });
  f.locals.str.set(5, 'world');
  OPS.get(0x1a9)!(step(0x1a9, [lsp(0)]));
  assert.equal(e.stringTable.get(sk5(5)), 'world', '0x1A9 local-string-ptr 应按所指串池下标登记');
  OPS.get(0x1aa)!(step(0x1aa, [lsp(0)]));
  assert.equal(get(lsp(0)), 'world', '0x1AA local-string-ptr 应取回登记串');
});
