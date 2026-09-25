/** @tier T1 @kind core @subsystem save */

/**
 * **「源槽只有 `.STH`」的复制路径**（`tickets/T-0175` ④；出处 `tickets/T-0159` §4.2）。
 *
 * 为什么要有这个文件：`T-0159` 报过 `src/arch/nodeFileSource.ts` 的 `copySaveSlot` 里有一道
 * `if (d) writeSaveSlot(...)` 的门 —— 那道门会让「源槽只有 `.STH`、没有 `.DAT`」时**整条 `.STH` 也不复制**，
 * 而引擎的 `0x1AC` 是**两次独立的 `CopyFileA`**（`sub_42E0A0` raw 38498-38512：`.DAT` 一次、`.STH` 一次，
 * 结果是"两次各自的成败"）。现盘实现已是两条独立写，但**没有任何断言钉住它** ⇒ 这个文件就是那条断言。
 *
 * 判据口径与引擎一致：返回值 `{dat, sth}` 表示**源侧各自存在与否**（= 两次 `CopyFileA` 的成败），
 * 目标侧的落盘用文件系统直接核。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { slotRelPath, slotThumbRelPath } from '../src/save/saveSlot.js';

/** 造一套隔离的 base / overlay / 资源根（资源根本测试用不到内容，只求不报错）。 */
function mkRoots(): { baseDir: string; overlayDir: string; res: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-copyslot-'));
  const baseDir = path.join(root, 'base');
  const overlayDir = path.join(root, 'overlay');
  const res = path.join(root, 'res');
  for (const d of [path.join(baseDir, 'SAVE'), path.join(overlayDir, 'SAVE'), res]) fs.mkdirSync(d, { recursive: true });
  return { baseDir, overlayDir, res };
}

const bytes = (n: number): Uint8Array => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff));
const at = (dir: string, rel: string): string => path.join(dir, rel);
const readIf = (p: string): Uint8Array | null => (fs.existsSync(p) ? fs.readFileSync(p) : null);

test('★copySaveSlot：源槽只有 .STH ⇒ 目标槽也必须拿到 .STH（不许被「源没有 .DAT」连带门掉）', async () => {
  const { baseDir, overlayDir, res } = mkRoots();
  fs.writeFileSync(at(baseDir, slotThumbRelPath(1)), bytes(64));
  const src = new NodeFileSource({ resourceDir: res, system: { baseDir, overlayDir } });
  const r = await src.copySaveSlot(1, 2);
  assert.deepEqual(r, { dat: false, sth: true }, '返回值 = 源侧各自存在与否（引擎两次 CopyFileA 的成败）');
  const got = readIf(at(overlayDir, slotThumbRelPath(2)));
  assert.ok(got !== null, '★目标槽的 .STH 必须真的写出来 —— 这就是 T-0175 ④ 的判据');
  assert.equal(got!.length, 64, '逐字节长度一致');
  assert.equal(readIf(at(overlayDir, slotRelPath(2))), null, '源没有 .DAT ⇒ 目标也不该凭空多出 .DAT');
});

test('★copySaveSlot：源槽只有 .DAT ⇒ 目标拿到 .DAT，且不凭空造 .STH', async () => {
  const { baseDir, overlayDir, res } = mkRoots();
  fs.writeFileSync(at(baseDir, slotRelPath(1)), bytes(96));
  const src = new NodeFileSource({ resourceDir: res, system: { baseDir, overlayDir } });
  const r = await src.copySaveSlot(1, 2);
  assert.deepEqual(r, { dat: true, sth: false });
  assert.ok(readIf(at(overlayDir, slotRelPath(2))) !== null, '目标槽的 .DAT 必须写出来');
  assert.equal(readIf(at(overlayDir, slotThumbRelPath(2))), null, '源没有 .STH ⇒ 不凭空造缩略图');
});

test('★copySaveSlot：两份都在 ⇒ 两份都复制且逐字节相同（对照：不是"只复制了一份"）', async () => {
  const { baseDir, overlayDir, res } = mkRoots();
  const d = bytes(128);
  const t = bytes(32);
  fs.writeFileSync(at(baseDir, slotRelPath(3)), d);
  fs.writeFileSync(at(baseDir, slotThumbRelPath(3)), t);
  const src = new NodeFileSource({ resourceDir: res, system: { baseDir, overlayDir } });
  const r = await src.copySaveSlot(3, 4);
  assert.deepEqual(r, { dat: true, sth: true });
  assert.deepEqual([...readIf(at(overlayDir, slotRelPath(4)))!], [...d], '.DAT 逐字节相同');
  assert.deepEqual([...readIf(at(overlayDir, slotThumbRelPath(4)))!], [...t], '.STH 逐字节相同');
});

test('★copySaveSlot：两份都没有 ⇒ {false,false}，且两处都不落文件（不许造空文件）', async () => {
  const { baseDir, overlayDir, res } = mkRoots();
  const src = new NodeFileSource({ resourceDir: res, system: { baseDir, overlayDir } });
  const r = await src.copySaveSlot(5, 6);
  assert.deepEqual(r, { dat: false, sth: false });
  assert.equal(readIf(at(overlayDir, slotRelPath(6))), null);
  assert.equal(readIf(at(overlayDir, slotThumbRelPath(6))), null);
});
