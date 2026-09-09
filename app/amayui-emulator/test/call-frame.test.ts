/** call-frame (0x8) / load-frame (0x6) 帧调用往返测试。
 *  依据引擎 sub_41C900 (0x8)：切到「已预装帧」op1，调用方 ip 前进、callRet=caller、目标帧 caller=caller/ip=0；被调帧 exit 返回调用帧。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import type { BinInstruction, BinArg, ScriptBinary } from '../src/script/bin.js';

const im = (raw: number): BinArg => ({ type: 0x0, raw });
const instr = (opcode: number, args: BinArg[]): BinInstruction => ({ opcode, name: 'x', argc: args.length, args, byteOffset: 0, index: 0 });
const mkScript = (instructions: BinInstruction[]): ScriptBinary => ({
  signature: 'SYS0000', isVer5: false, headerLen: 0, localVars: [0, 0, 0, 0, 0, 0],
  subHeaderLength: 0, tables: [], instructions, labelTargets: new Set(), raw: new Uint8Array(0),
});

test('load-frame(0x6)→call-frame(0x8)→exit：切到预装帧执行、exit 返回调用帧并推进', async () => {
  const e = new Engine(new StubNative());
  // frame0 调用方：call-frame 1；然后 mov (local-int 0) 99（返回后的标记）
  loadScriptIntoFrame(e.frames[0]!, mkScript([instr(0x8, [im(1)]), instr(0x55, [{ type: 0x9, raw: 0 }, im(99)])]), 'CALLER.BIN');
  // frame1 预装帧：exit（调用完即返回调用方）
  loadScriptIntoFrame(e.frames[1]!, mkScript([instr(0x2, [])]), 'TARGET.BIN');
  e.cur = 0;

  // 0x8 call-frame → 切到 frame1
  const t1 = await stepOnce(e);
  assert.equal(t1.opcode, 0x8, 'step1 应执行 call-frame(0x8)');
  assert.equal(e.cur, 1, 'call-frame 后 cur 应切到目标帧 1');
  assert.equal(e.frames[0].ip, 1, '调用方帧0 应已推进到 call-frame 之后（返回后继续）');
  assert.equal(e.frames[1].caller, 0, '目标帧 caller 应为调用方 cur=0');
  assert.equal(e.frames[1].ip, 0, '目标帧应从 ip0 执行');

  // 0x2 exit → 目标帧返回调用帧
  const t2 = await stepOnce(e);
  assert.equal(t2.opcode, 0x2, 'step2 应执行 exit(0x2)');
  assert.equal(e.cur, 0, 'exit 后 cur 应回到调用方帧0');
  assert.equal(e.frames[0].ip, 1, '调用方帧0 应在 call-frame 之后（=1）继续');

  // 返回后再执行标记 op（mov）—— 验证调用方真的继续下来
  const t3 = await stepOnce(e);
  assert.equal(t3.opcode, 0x55, 'step3 应执行调用方的下一指令(mov)');
  assert.equal(e.frames[0].ip, 2, 'mov 之后 ip 前进到 2');
});

test('call-frame(0x8) 未预装帧 → 抛错', async () => {
  const e = new Engine(new StubNative());
  loadScriptIntoFrame(e.frames[0]!, mkScript([instr(0x8, [im(2)])]), 'CALLER.BIN');
  e.cur = 0;
  await assert.rejects(stepOnce(e), /未预装脚本/, '未预装帧应抛错');
});
