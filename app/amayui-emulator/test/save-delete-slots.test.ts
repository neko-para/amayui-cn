/** @tier T1 @kind core @subsystem save */

/**
 * **`T-0153`（`src/arch/**` 子集）**：存档槽的删/写两处宿主行为与引擎体的分叉。
 *
 * | # | 对象 | 引擎体（`engine/天结_unpacked.exe_utf8.c` 行号 = raw） | 本文件锁的行为 |
 * |---|---|---|---|
 * | ⑥ | `0x1AB` 删槽 | `sub_42DFC0` raw 38462-38483：`FileName = "%s\\SAVE%2.2d.DAT"`（`sub_408A40` 给的真实存档目录）→ `DeleteFileA`；`.STH` 同；`.DAT` 失败 ⇒ 1、`.STH` 失败 ⇒ 2、都成功 ⇒ 0 | 只存在于 base（overlay 缺失）的槽**也要删掉**（否则读会回落 base ⇒ 槽"复活"） |
 * | ⑦ | `0x19E` 存档 | `sub_42D980` raw 38287-38331：`CreateFileA(...GENERIC_WRITE...)` 失败 ⇒ 错误串 + `op1 = 1`（raw 38317-38321） | 宿主没有 overlay 时**不许静默**（旧行为：一个字节没落盘却让 `0x19E` 返回 0 = "已保存"） |
 *
 * ★写路径的安全规则**保留**（`T-0018`）：`writeSaveSlot` / `writeSlotThumb` / `writeSaveData` /
 *   `saveConfig` 依旧只写 overlay，base 的字节一个都不动（见最后一个用例）。
 *   删槽是**唯一**会碰 base 的路径 —— 因为引擎的 `DeleteFileA` 作用的就是真实存档目录，
 *   而本工程的"槽是否存在" = overlay ∪ base（读会回落 base）；只删 overlay 会让被删的槽复活。
 *   被删的 base 那一份**先隔离**到 `<overlay>/SAVE/.deleted/`（字节不丢）再 unlink。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { INI_FILE, SAVE_DAT_REL } from '../src/arch/systemPaths.js';
import { slotRelPath, slotThumbRelPath } from '../src/save/saveSlot.js';
import { saveSlotFromEngine } from '../src/vm/handlers/save-slot.js';
import { instr, mkEngine } from './harness.js';

/**
 * 资源根：本文件**不读任何真资产**（只碰 system 目录里的槽文件）⇒ 给一个空目录即可。
 * ★但 `@tier` 仍必须是 **T1**：分类规则按"是否 import 语料装载器"机械判定
 *   （`test/orgRules.ts` 的 `CORPUS_LOADERS` 含 `nodeFileSource`/`systemPaths`），不是按行为。
 */
function emptyResDir(dir: string): string {
  const res = path.join(dir, 'res');
  fs.mkdirSync(res, { recursive: true });
  return res;
}

/** 被删的 base 槽隔离到哪（`<overlay>/SAVE/.deleted/<原名>`）。 */
const quarantine = (overlayDir: string, rel: string): string => path.join(overlayDir, path.dirname(rel), '.deleted', path.basename(rel));

/** 造一对临时 base/overlay，并把 seed 写进 base 侧（模拟"真游戏那份"）。 */
function tempPair(seed: Record<string, Uint8Array | string> = {}): {
  dir: string;
  baseDir: string;
  overlayDir: string;
  src: NodeFileSource;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amayui-t0153-${process.pid}-`));
  const baseDir = path.join(dir, 'game');
  const overlayDir = path.join(dir, 'game.overlay');
  fs.mkdirSync(baseDir, { recursive: true });
  for (const [rel, data] of Object.entries(seed)) {
    const p = path.join(baseDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return {
    dir,
    baseDir,
    overlayDir,
    src: new NodeFileSource({
      resourceDir: emptyResDir(dir),
      system: { baseDir, overlayDir },
      log: () => {},
    }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** 往 overlay 侧写一份槽文件（模拟"本工程自己存的那一份"）。 */
function seedOverlay(overlayDir: string, rel: string, data: Uint8Array | string): void {
  const p = path.join(overlayDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

/** `0x1AB` 的结果码映射（= `src/vm/handlers/save-slot.ts` 的三态）。
 *  ★引擎的**覆盖顺序**（raw 38477-38481）：`v4 = !DeleteFileA(.DAT)` ⇒ 1，**随后** `if (!DeleteFileA(.STH)) v4 = 2;`
 *  ⇒ `.STH` 的失败码**覆盖** `.DAT` 的 ⇒ **两份都失败时是 2，不是 1**（2026-09-24 主 agent 读体订正：
 *  旧映射 `r.dat ? (r.sth ? 0 : 2) : 1` 在"两份都失败"这一格给 1，与体不符）。 */
const op1Of = (r: { dat: boolean; sth: boolean }): number => (r.sth ? (r.dat ? 0 : 1) : 2);

// ---------------------------------------------------------------------------
// ⑥ `0x1AB`：删哪个目录里的那一份
// ---------------------------------------------------------------------------

test('★0x1AB：只存在于 base（overlay 缺失）的槽 —— .DAT 删得掉、.STH 不在 ⇒ 返回 2（引擎同码）', async () => {
  const p = tempPair({ [slotRelPath(2)]: 'BASE-DAT-02' });
  try {
    const r = await p.src.deleteSaveSlot(2);
    assert.deepEqual(r, { dat: true, sth: false }, '★`.DAT` 必须删掉（引擎的 DeleteFileA 打的是真实存档目录）');
    assert.equal(op1Of(r), 2, '引擎：`.DAT` 成功、`.STH` 失败 ⇒ 2（raw 38477-38481）');
    assert.equal(fs.existsSync(path.join(p.baseDir, slotRelPath(2))), false, 'base 的那一份真的没了');
    assert.equal(await p.src.readSaveSlot(2), null, '★删完不许"从 base 复活"（旧实现返回 1 且读得到）');
  } finally {
    p.cleanup();
  }
});

test('★0x1AB：两侧都有 ⇒ 两侧都删（引擎只有一个真实目录 ⇒ 读到的"那一份"必须真的消失）', async () => {
  const p = tempPair({ [slotRelPath(3)]: 'BASE-DAT-03', [slotThumbRelPath(3)]: 'BASE-STH-03' });
  try {
    seedOverlay(p.overlayDir, slotRelPath(3), 'OURS-DAT-03');
    seedOverlay(p.overlayDir, slotThumbRelPath(3), 'OURS-STH-03');
    const r = await p.src.deleteSaveSlot(3);
    assert.deepEqual(r, { dat: true, sth: true }, '两个文件都删成功 ⇒ 引擎返回 0');
    assert.equal(op1Of(r), 0);
    assert.equal(fs.existsSync(path.join(p.baseDir, slotRelPath(3))), false, 'base `.DAT` 也删');
    assert.equal(fs.existsSync(path.join(p.baseDir, slotThumbRelPath(3))), false, 'base `.STH` 也删');
    assert.equal(fs.existsSync(path.join(p.overlayDir, slotRelPath(3))), false, 'overlay `.DAT` 删');
    assert.equal(fs.existsSync(path.join(p.overlayDir, slotThumbRelPath(3))), false, 'overlay `.STH` 删');
    assert.equal(await p.src.readSaveSlot(3), null, '读不到（否则槽会复活成 base 的旧内容）');
    assert.equal(await p.src.readSlotThumb(3), null);
  } finally {
    p.cleanup();
  }
});

test('★0x1AB：两侧都没有 ⇒ 两个 false，且 `.STH` 的失败码覆盖 `.DAT` ⇒ **2**', async () => {
  const p = tempPair();
  try {
    const r = await p.src.deleteSaveSlot(7);
    assert.deepEqual(r, { dat: false, sth: false });
    assert.equal(
      op1Of(r),
      2,
      '★引擎：`v4 = !DeleteFileA(.DAT)` = 1 → 再 `if (!DeleteFileA(.STH)) v4 = 2;` ⇒ **2**（raw 38477-38481；旧断言写 1 是错的）',
    );
  } finally {
    p.cleanup();
  }
});

test('★0x1AB：base 的那一份**先隔离**再删（`SAVE/.deleted/`，字节不丢 —— T-0018 的"真存档不损坏"）', async () => {
  const p = tempPair({ [slotRelPath(2)]: 'BASE-DAT-02' });
  try {
    await p.src.deleteSaveSlot(2);
    const q = quarantine(p.overlayDir, slotRelPath(2));
    assert.ok(fs.existsSync(q), `★被删的 base 槽必须先落到隔离区：${q}`);
    assert.equal(fs.readFileSync(q, 'utf8'), 'BASE-DAT-02', '隔离的是原字节（可人工复原）');
    assert.equal(fs.existsSync(path.join(p.baseDir, slotRelPath(2))), false, '原件仍然被删（引擎语义）');
  } finally {
    p.cleanup();
  }
});

// ---------------------------------------------------------------------------
// ⑦ `0x19E`：没有 overlay ⇒ 显式失败（不许静默 no-op）
// ---------------------------------------------------------------------------

test('★0x19E：宿主没配 system ⇒ `writeSaveSlot` 必须显式失败（旧行为静默 return，一个字节都没落盘）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amayui-t0153-${process.pid}-`));
  try {
    const src = new NodeFileSource({ resourceDir: emptyResDir(dir) }); // 刻意不给 system（测试/链路工具的用法）
    await assert.rejects(
      () => src.writeSaveSlot(1, new Uint8Array([1, 2, 3])),
      /没有配置系统存档目录/,
      '★不许静默：调用方要能看见"这次保存根本没落盘"',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★0x19E：端到端 —— 无处可写时结果码必须非 0（引擎 raw 38317-38321 返回 1）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amayui-t0153-${process.pid}-`));
  try {
    const e = mkEngine([instr(0x1a7, [])]);
    e.fileSource = new NodeFileSource({ resourceDir: emptyResDir(dir) }); // 无 system ⇒ `0x19E` 写不下去
    const code = await saveSlotFromEngine(e, 3);
    assert.notEqual(code, 0, '★旧行为：静默 no-op ⇒ 返回 0（"已保存"）而磁盘上一个字节都没有');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 写路径的安全规则（T-0018）仍然保留：只写 overlay，base 一个字节不动
// ---------------------------------------------------------------------------

test('★写路径（0x19E/0x1AE/SAVE.DAT/INI）仍然不碰 base —— 只有删槽会碰它', async () => {
  const p = tempPair({
    [INI_FILE]: '[display]\r\nScreenMode=1\r\n[sound]\r\nMusic=2\r\n',
    [SAVE_DAT_REL]: 'REAL-SAVE-DAT',
    [slotRelPath(4)]: 'BASE-DAT-04',
    [slotThumbRelPath(4)]: 'BASE-STH-04',
  });
  try {
    const before = (rel: string): string => fs.readFileSync(path.join(p.baseDir, rel), 'utf8');
    await p.src.writeSaveSlot(4, new Uint8Array([9, 9, 9, 9]));
    await p.src.writeSlotThumb(4, new Uint8Array([8, 8]));
    await p.src.writeSaveData(new Uint8Array([7, 7]));
    await p.src.saveConfig('[display]\r\nScreenMode=0\r\n[sound]\r\nMusic=2\r\n');
    assert.equal(before(slotRelPath(4)), 'BASE-DAT-04', '★base 的槽字节一个都不能变');
    assert.equal(before(slotThumbRelPath(4)), 'BASE-STH-04');
    assert.equal(before(SAVE_DAT_REL), 'REAL-SAVE-DAT');
    assert.match(before(INI_FILE), /ScreenMode=1/, '★base 的配置一个键都不能变');
    // 写完之后读命中的是 overlay 那份（写确实生效了）
    assert.equal((await p.src.readSaveSlot(4))?.length, 4);
    assert.equal(fs.readFileSync(path.join(p.overlayDir, slotRelPath(4)), 'utf8'), '\t\t\t\t');
  } finally {
    p.cleanup();
  }
});
