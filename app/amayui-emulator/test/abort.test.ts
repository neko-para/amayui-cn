/** 0x1 abort (sub_418E60)：程序中止。抛 ExitScript（程序退出信号）；渲染窗捕获后关闭主窗口，headless 捕获后停执行。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, ExitScript } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import type { BinInstruction } from '../src/script/bin.js';

const abortInstr: BinInstruction = { opcode: 0x1, name: 'abort', argc: 0, args: [], byteOffset: 0, index: 0 };

test('0x1 abort：抛 ExitScript（程序退出信号）', () => {
  const e = new Engine(new StubNative(() => {}));
  const f = new Frame();
  const ctx = makeCtx(e, f, abortInstr, new StubNative(() => {}), () => {});
  assert.throws(() => OPS.get(0x1)!(ctx), ExitScript);
});
