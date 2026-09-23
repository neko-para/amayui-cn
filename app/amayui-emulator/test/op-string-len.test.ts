/** @tier T0 @kind core @subsystem ops */

/**
 * 字符串长度族（`tickets/T-0076` 的 B3 批次）：
 *
 * | opcode | 引擎体 | 语义 |
 * |---|---|---|
 * | `0x2C5` | `sub_430900` raw 40063-40071 | `op1 = strlen(op2)` —— **字节**长（SJIS：ASCII/半角片假名 1、其余 2） |
 * | `0x2C6` | `sub_430940` raw 40073-40084 | `op1 = _mbstrlen(op2)` —— **字符**数 |
 * | `0x1A6` | `sub_42D110` raw 37974-37982 | `op1 = strlen(op2) >> 1`（halve-strlen；语料 217 处/215 脚本，此前零注册） |
 *
 * ★订正记录：`0x2C5` 与 `0x2C6` 此前共用同一个 handler（`s.length` = 字符数）⇒ **`0x2C5` 对日文串一律偏小一半**；
 *   现在按体分开（`sjisByteLength` vs `.length`）。纯 ASCII 下两者相同，所以过去的用例看不出来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const T_GLOBAL_INT = 0x3;
// 立即字符串：type 0x2（local-string）带 str 字段 —— 与 	est/harness.ts 的 str() 同形

/** 造一条「`op1` = global-int 槽 0x40；`op2` = 立即字符串」的指令（与 0x2C5/0x2C6/0x1A6 的形状一致）。 */
async function run(op: number, text: string): Promise<number> {
  const e = new Engine(new StubNative(() => {}), new InputManager());
  e.key = 0x12345678;
  const instr: BinInstruction = {
    opcode: op,
    name: `i${op.toString(16)}`,
    argc: 2,
    args: [
      { type: T_GLOBAL_INT, raw: 0x40 },
      { type: 0x2 /* TYPE_LOCAL_STRING：立即串走 str 字段，见 harness 的 str() */, raw: 0, str: text },
    ] as unknown as BinArg[],
    byteOffset: 0x3c,
    index: 0,
  };
  const sc: ScriptBinary = {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  e.globals.int.set(0x40, enc(e.key, 0));
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', `0x${op.toString(16)} 应已实现`);
  return dec(e.key, e.globals.int.get(0x40) ?? 0);
}

test('0x2C5 = strlen（**字节**口径）：ASCII 与 SJIS 日文分叉', async () => {
  assert.equal(await run(0x2c5, 'ABC'), 3);
  assert.equal(await run(0x2c5, 'あいう'), 6, 'SJIS 日文 2 字节/字 ⇒ 字节长 6（不是字符数 3）');
  assert.equal(await run(0x2c5, 'aあ'), 3, '混合：1 + 2');
  assert.equal(await run(0x2c5, 'ｱｲ'), 2, '半角片假名 1 字节/字');
  assert.equal(await run(0x2c5, ''), 0);
});

test('0x2C6 = _mbstrlen（字符数）：与 0x2C5 成对、口径不同', async () => {
  assert.equal(await run(0x2c6, 'ABC'), 3);
  assert.equal(await run(0x2c6, 'あいう'), 3, '字符数 3');
  assert.equal(await run(0x2c6, 'aあ'), 2);
  assert.equal(await run(0x2c6, ''), 0);
});

test('★0x1A6 halve-strlen = strlen(op2) >> 1（语料 217 处/215 脚本，此前零注册 ⇒ 命中即硬停）', async () => {
  assert.equal(await run(0x1a6, 'ABCD'), 2, 'ASCII：4 字节 >> 1 = 2');
  assert.equal(await run(0x1a6, 'あいう'), 3, 'SJIS：6 字节 >> 1 = 3（= 字符数）');
  assert.equal(await run(0x1a6, 'aあ'), 1, '3 >> 1 = 1（截断）');
  assert.equal(await run(0x1a6, ''), 0);
});
