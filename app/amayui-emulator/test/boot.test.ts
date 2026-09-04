/** 管线级测试：NodeFileSource(异步代理) -> SYS4450 解析 -> 解释器逐条执行 -> 未实现 opcode 硬报错。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'raw');

test('装载 index 0 = SYSTEM4.BIN：comment/dev_ukn 逐条执行，0x2F6 归类引擎内部插桩', async () => {
  const src = new NodeFileSource({ rawDir: RAW_DIR });
  const e = new Engine(new StubNative());
  e.fileSource = src;

  const boot = await src.readScript(0);
  assert.ok(boot, '应解析出索引 0');
  assert.equal(boot.name, 'SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);
  assert.equal(e.curScript().script!.instructions.length, 545, 'SYSTEM4(松散) 应 545 条指令');

  const t1 = await stepOnce(e);
  assert.equal(t1.name, 'comment');
  const t2 = await stepOnce(e);
  assert.equal(t2.name, 'dev_ukn');
  // 0x2F6 已归类为"引擎内部/子系统"（插桩跳过），不再抛未实现
  const t3 = await stepOnce(e);
  assert.equal(t3.opcode, 0x2f6);
  assert.equal(t3.handlerKind, 'engine-internal');

  await src.dispose?.();
});

test('resolveIndex: 0x5264 -> TITLE.BIN；0 -> SYSTEM4.BIN', async () => {
  const src = new NodeFileSource({ rawDir: RAW_DIR });
  const s0 = await src.readScript(0);
  assert.equal(s0?.name, 'SYSTEM4.BIN');
  const title = await src.readScript(0x5264);
  assert.equal(title?.name, 'TITLE.BIN');
  await src.dispose?.();
});
