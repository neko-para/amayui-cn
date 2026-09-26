/** @tier T0 @kind tool @subsystem vm */

/**
 * **调试写面的守卫**（`tickets/T-0189` 判据⑤）：`set-global` / `set-array` 的解析与落值口径。
 *
 * 为什么必须有：写面一旦把口径搞错（不 ENC / 写错池 / 顺手持久化），**症状是"脚本读到垃圾"或
 * "玩家存档被测试污染"**，两者都不会报错 —— 只有守卫能挡住。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dec, enc } from '../src/vm/bits.js';
import { forceIntArray, setGlobalInt, setGlobalIntArray, type WriteGlobalsEngineLike } from '../src/vm/debugWrite.js';
import { parseDebugCommand } from '../src/vm/debugCommand.js';

/** 具名假引擎：写面只需要 `key` + `globals.int`。 */
function fakeEngine(key = 0x1234_5678): WriteGlobalsEngineLike {
  return { key, globals: { int: new Map() } };
}

test('★setGlobalInt 按 ENC 写：池里不是裸值，但读侧（DEC）拿到原值', () => {
  const e = fakeEngine();
  const r = setGlobalInt(e, 0x13b0, 14);
  assert.equal(r.index, 0x13b0);
  assert.equal(r.value, 14);
  assert.equal(r.prev, 0, '没写过的槽 ⇒ 前值按 0 报');
  assert.equal(e.globals.int.get(0x13b0), enc(e.key, 14), '池里必须是 ENC(key, 14)');
  assert.notEqual(e.globals.int.get(0x13b0), 14, '★不许塞裸值（脚本读侧一律 DEC）');
  assert.equal(dec(e.key, e.globals.int.get(0x13b0)!), 14, 'DEC 回来必须等于原值');
});

test('★setGlobalInt 报**解码后**的前值（与查询侧同口径）', () => {
  const e = fakeEngine();
  e.globals.int.set(0x13b1, enc(e.key, 11));
  const r = setGlobalInt(e, 0x13b1, 14);
  assert.equal(r.prev, 11, '前值必须是解码值 11，不是 ENC 位模式');
  assert.equal(dec(e.key, e.globals.int.get(0x13b1)!), 14);
});

test('★setGlobalIntArray = 写 base+index（数组在 emulator 里就是一段连续全局槽）', () => {
  const e = fakeEngine();
  const r = setGlobalIntArray(e, 0x13b0, 1, 0xe);
  assert.equal(r.index, 0x13b1);
  assert.equal(dec(e.key, e.globals.int.get(0x13b1)!), 14);
});

test('★forceIntArray 一次写死整张表（侧栏用例的入口；表"不存在"= 池里没写过 ⇒ 直接写即建）', () => {
  const e = fakeEngine();
  const layout = [0xd, 0xe, 1, 0xb, 0xc, 2, 3, 4, 5];
  const rs = forceIntArray(e, 0x13b0, layout);
  assert.equal(rs.length, 9);
  const read = layout.map((_, i) => dec(e.key, e.globals.int.get(0x13b0 + i) ?? 0));
  assert.deepEqual(read, layout, '9 项按顺序落在 13b0..13b8');
});

test('★白名单：越界的表值**拒绝写入**（不是静默写进去）', () => {
  const e = fakeEngine();
  const allowed = [0, 1, 2, 3, 4, 5, 6, 7, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x15]; // SN0000 派发链认得的 id
  assert.doesNotThrow(() => forceIntArray(e, 0x13b0, [0xd, 0xe], { allowed }));
  assert.throws(() => forceIntArray(e, 0x13b0, [0xd, 0x99], { allowed }), /不在白名单里/);
  assert.throws(() => forceIntArray(e, 0x13b0, [1.5], { allowed }), /必须是整数/);
  // ★拒绝时必须**什么都没写**（先校验后落值）——否则会留下半张表
  const e2 = fakeEngine();
  assert.throws(() => forceIntArray(e2, 0x13b0, [0xd, 0x99], { allowed }));
  assert.equal(e2.globals.int.size, 0, '校验失败 ⇒ 一个槽都不许动');
});

test('★写面不碰 SAVE.DAT：不出现 stringIndexTable / onSaveDataChanged（源码棘轮，只看代码不看注释）', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/vm/debugWrite.ts', import.meta.url), 'utf8');
  // ★先剥注释：本文件的**文档**里正面提到"不写回 SAVE.DAT"，棘轮要卡的是**代码**里不许出现它们。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/stringIndexTable|onSaveDataChanged|saveData/i.test(code), '写面不许触碰持久化面（只改运行期内存）');
});

test('★非法下标：抛错（不静默写错槽）', () => {
  const e = fakeEngine();
  assert.throws(() => setGlobalInt(e, -1, 1), /下标必须是非负整数/);
  assert.throws(() => setGlobalInt(e, 1.5, 1), /下标必须是非负整数/);
  assert.throws(() => setGlobalIntArray(e, 0x13b0, -2, 1), /元素下标必须是非负整数/);
});

// ---- 命令解析（`debugCommand.ts`）----

test('set-global：三种数字口径（0x… / 含 a-f / 纯十进制）', () => {
  assert.deepEqual(parseDebugCommand('set-global 13b0 1'), { a: 'set-global', index: 0x13b0, value: 1 });
  assert.deepEqual(parseDebugCommand('set-global 0x13b0 0x0e'), { a: 'set-global', index: 0x13b0, value: 14 });
  assert.deepEqual(parseDebugCommand('set-global 13b0 e'), { a: 'set-global', index: 0x13b0, value: 14 });
  assert.deepEqual(parseDebugCommand('set-global a9ce 1'), { a: 'set-global', index: 0xa9ce, value: 1 });
});

test('set-array：基址 + 元素下标 + 值', () => {
  assert.deepEqual(parseDebugCommand('set-array 13b0 1 e'), { a: 'set-array', base: 0x13b0, index: 1, value: 14 });
  assert.deepEqual(parseDebugCommand('set-array 0x13b0 0 0xd'), { a: 'set-array', base: 0x13b0, index: 0, value: 13 });
});

test('★非法输入走"当查询回报"（不抛错、不崩），且带用法', () => {
  for (const bad of ['set-global', 'set-global 13b0', 'set-global zz 1', 'set-global 13b0 zz', 'set-array 13b0 1', 'set-array zz 1 e', 'set-array 13b0 -1 e']) {
    const act = parseDebugCommand(bad);
    assert.equal(act?.a, 'query', `${bad} 应回报 query`);
    assert.match((act as { text: string }).text, /set-(global|array)：/, `${bad} 的回报要带用法`);
  }
});
