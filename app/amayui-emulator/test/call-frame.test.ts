/** call-frame (0x8) / load-frame (0x6) 帧调用往返测试。
 *  依据引擎 sub_41C900 (0x8)：切到「已预装帧」op1，调用方 ip 前进、callRet=caller、目标帧 caller=caller/ip=0；被调帧 exit 返回调用帧。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import type { BinInstruction, BinArg, ScriptBinary } from '../src/script/bin.js';
import { dec } from '../src/vm/bits.js';

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

/**
 * ★**帧局部池的生命周期**：一次脚本载入 = 一次新调用。
 *
 * 引擎 `sub_40ED40`（loadScriptFrame）读脚本后**建局部池并把 `local_int` 填 `enc_zero`**
 * ⇒ 帧槽被复用（脚本 `exit` 后被 `call-script` 再次调回来最典型）时，
 * **看不见上一次调用留下的局部量**。
 *
 * 现场（2026 实测）：「设置界面第一页滚到底 → 切左侧分类」时，
 * `CONFIG1` 的滚动起点 `local5620` 从上一页带过来（6），而新一页最大起点只有 3
 * ⇒ 拇指顶算到轨道外，**滚动条溢出轨道**。全局池不在清理之列（"上次选的分类"就存在全局）。
 *
 * 同时锁住另一半：`call-frame`(0x8) 跑的是**已预装**帧、不会再载入 ⇒ 局部量照旧保留。
 */
test('★脚本载入会重建帧局部池（不泄漏上一次调用）；但已预装帧被 call-frame 反复调用时保留', async () => {
  const e = new Engine(new StubNative());
  const f0 = e.frames[0]!;
  /** 局部 int 池里存的是 ENC 位模式（写侧 ENC / 读侧 DEC），断言一律走 `dec`。 */
  const lv = (f: typeof f0, slot: number): number => dec(e.key, f.locals.int.get(slot) ?? 0);
  // 第一次"调用"：写入局部量 + 全局量
  loadScriptIntoFrame(f0, mkScript([instr(0x55, [{ type: 0x9, raw: 7 }, im(42)])]), 'A.BIN');
  await stepOnce(e);
  assert.equal(lv(f0, 7), 42, '本帧局部量已写入');
  e.globals.int.set(7, 42);

  // 第二次载入（同一个帧槽）⇒ 局部池必须重建
  loadScriptIntoFrame(f0, mkScript([instr(0x55, [{ type: 0x9, raw: 8 }, im(1)])]), 'B.BIN');
  assert.equal(f0.locals.int.size, 0, '载入后局部池应为空（引擎：建池 + enc_zero）');
  assert.equal(e.globals.int.get(7), 42, '全局池是跨脚本状态，**不得**被清');

  // call-frame 的语义不受影响：预装帧被反复调用时，期间写的局部量保留
  loadScriptIntoFrame(e.frames[1]!, mkScript([instr(0x55, [{ type: 0x9, raw: 9 }, im(7)]), instr(0x2, [])]), 'T.BIN');
  loadScriptIntoFrame(f0, mkScript([instr(0x8, [im(1)])]), 'CALLER.BIN');
  e.cur = 0;
  await stepOnce(e); // call-frame → frame1
  await stepOnce(e); // frame1: mov local9 = 7
  assert.equal(lv(e.frames[1]!, 9), 7, '固定帧内的局部量写入生效');
  await stepOnce(e); // frame1: exit → 回 frame0
  assert.equal(e.cur, 0, 'exit 返回调用方');
  e.cur = 1; // 再次"调用"同一预装帧（engine 语义：call-frame 不重建池）
  e.frames[1]!.ip = 0;
  await stepOnce(e);
  assert.equal(lv(e.frames[1]!, 9), 7, '固定帧被反复调用时局部量保留（未重新载入 ⇒ 不建池）');
});
