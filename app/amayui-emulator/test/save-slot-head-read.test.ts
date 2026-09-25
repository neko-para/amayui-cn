/** @tier T0 @kind core @subsystem save */
/**
 * **`0x1A0` 只读槽头**（`tickets/T-0180`）的守卫。
 *
 * 为什么守这条：引擎在这一格是 `CreateFileA` + `ReadFile(..., 0x124)` —— **固定 292 字节**
 * （`sub_438120`，raw 45115）；而这条指令在 LOAD 画面**一帧内会被问 100~120 次**。
 * 走整份 `.DAT`（1~1.5MB）时实测一帧 **4.8s**（帧 #2503：`0x1a0` ×120 = 4758ms）——
 * 就是用户报的"切页卡 4 秒"。
 *
 * 守两件事（分开守，因为它们在两层）：
 *  ① **行为**（本文件的 3 条）：`OverlayDir.readPrefix` 只读前 N 字节、与整份读的前 N 字节**逐字节相同**、
 *     短文件**不补齐**、命中优先级与 `read()` 一致；
 *  ② **接线**（最后 1 条棘轮）：四条通道（web 路由 / webBridge / preload+ipc / ipcFileSource）
 *     与 `0x1A0` 的优先/回退都必须在 —— 少一条，某个形态就会**静默退回整份读**，
 *     那种回归不会让任何东西变红，只会让卡顿悄悄回来。
 *
 * ★本文件`@tier T0`（纯合成：自己造文件），所以**不许 import 语料装载器**（`test/orgRules.ts` 的 R2）；
 *   行为断言只用 `OverlayDir`（它不碰资源根，也不需要真存档）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OverlayDir } from '../src/arch/overlay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.resolve(HERE, '..');
const REPO = path.resolve(EMU, '..', '..');

/** 引擎固定读的头长（`ReadFile(..., 0x124)`；与 `saveData.SAVE_HEADER_BYTES` 同值）。 */
const HEAD = 292;

/** 造一个一次性 base/overlay（`.tmp/` 是 gitignore 的草稿区）。 */
function sandbox(tag: string): { baseDir: string; overlayDir: string; dir: string } {
  const root = path.join(REPO, '.tmp');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, `t0180-head-${tag}-`));
  const baseDir = path.join(dir, 'base');
  const overlayDir = path.join(dir, 'overlay');
  fs.mkdirSync(path.join(baseDir, 'SAVE'), { recursive: true });
  fs.mkdirSync(path.join(overlayDir, 'SAVE'), { recursive: true });
  return { baseDir, overlayDir, dir };
}

/** 槽相对路径的字面量（`slotRelPath` 的产物形状；`path.normalize` 两种分隔符都收）。 */
const REL = 'SAVE/SAVE07.DAT';

test('★只读头：与整份读的前 N 字节逐字节相同，且真的只读那么长', async () => {
  const sb = sandbox('big');
  try {
    const body = Buffer.alloc(1234);
    for (let i = 0; i < body.length; i++) body[i] = i & 0xff;
    fs.writeFileSync(path.join(sb.baseDir, 'SAVE', 'SAVE07.DAT'), body);

    const ov = new OverlayDir({ baseDir: sb.baseDir, overlayDir: sb.overlayDir });
    const full = await ov.read(REL);
    const head = await ov.readPrefix(REL, HEAD);
    assert.ok(full && head, '两条读都该命中');
    assert.equal(full!.data.length, 1234, '整份读 = 文件长度');
    assert.equal(head!.data.length, HEAD, '只读头 = 292 字节（不是整份）');
    assert.deepEqual(
      [...head!.data],
      [...full!.data.slice(0, HEAD)],
      '只读头必须与整份读的前 292 字节**逐字节相同**（否则判据会变）',
    );
    assert.equal(head!.side, 'base', '命中的是哪一侧也要照实报');

    const more = await ov.readPrefix(REL, 500);
    assert.equal(more!.data.length, 500, '显式要 500 字节 ⇒ 就只读 500');
  } finally {
    fs.rmSync(sb.dir, { recursive: true, force: true });
  }
});

test('★短文件不补齐（引擎判据是"必须恰好 292 字节"），没有该文件返回 null', async () => {
  const sb = sandbox('short');
  try {
    fs.writeFileSync(path.join(sb.baseDir, 'SAVE', 'SAVE09.DAT'), Buffer.alloc(100, 7));
    const ov = new OverlayDir({ baseDir: sb.baseDir, overlayDir: sb.overlayDir });
    const head = await ov.readPrefix('SAVE/SAVE09.DAT', HEAD);
    assert.equal(head!.data.length, 100, '文件只有 100 字节 ⇒ 返回 100（补齐会把坏文件伪装成好文件）');
    assert.equal(await ov.readPrefix('SAVE/SAVE08.DAT', HEAD), null, '没有该文件 ⇒ null（调用方落成 op1 = 1）');
  } finally {
    fs.rmSync(sb.dir, { recursive: true, force: true });
  }
});

test('★overlay 优先：两侧都有时，只读头也必须读 overlay 那一份', async () => {
  const sb = sandbox('ovl');
  try {
    fs.writeFileSync(path.join(sb.baseDir, 'SAVE', 'SAVE05.DAT'), Buffer.alloc(400, 0x11));
    fs.writeFileSync(path.join(sb.overlayDir, 'SAVE', 'SAVE05.DAT'), Buffer.alloc(400, 0x22));
    const ov = new OverlayDir({ baseDir: sb.baseDir, overlayDir: sb.overlayDir });
    const head = await ov.readPrefix('SAVE/SAVE05.DAT', 16);
    assert.deepEqual([...head!.data], new Array(16).fill(0x22), '读的必须是 overlay 那份（与 read() 同优先级）');
    assert.equal(head!.side, 'overlay');
  } finally {
    fs.rmSync(sb.dir, { recursive: true, force: true });
  }
});

test('★接线棘轮：四条通道 + `0x1A0` 的优先/回退都要在（缺一条就静默退回整份读）', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(EMU, rel), 'utf8');
  assert.match(read('src/web/host.ts'), /case 'read-save-slot-head'/, 'web 宿主要有这条路（DSH 形态唯一的路）');
  assert.match(read('src/renderer/webBridge.ts'), /readSaveSlotHead:/, 'web 桥要暴露它');
  assert.match(read('electron/preload.ts'), /read-save-slot-head/, 'Electron preload 要有这条通道');
  assert.match(read('electron/ipc/files.ts'), /read-save-slot-head/, 'Electron 主进程要有这个 handler');
  assert.match(read('src/renderer/ipcFileSource.ts'), /async readSaveSlotHead\(/, '渲染侧 FileSource 要实现它');
  assert.match(read('src/arch/fileSource.ts'), /readSaveSlotHead\?\(/, 'FileSource 接口要声明它（可选缝）');
  assert.match(read('src/host/service.ts'), /async readSaveSlotHead\(/, 'HostService 要转发它');

  const handler = read('src/vm/handlers/save-slot.ts');
  assert.match(
    handler,
    /fs\.readSaveSlotHead\s*\n?\s*\?\s*await fs\.readSaveSlotHead\(slot, SAVE_HEADER_BYTES\)/,
    '0x1a0 要**优先**只读头',
  );
  assert.match(handler, /:\s*await fs\.readSaveSlot\(slot\)/, '并保留"没有该缝时退回整份读"');
});
