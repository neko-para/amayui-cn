/**
 * `T-0025` 守卫：`src/arch/agfSize.ts`（headless 自带的 AGF 尺寸解析）必须与
 * `scripts/agf/format.js` 的完整解码器 `decodeAgfRgba` **在真文件上逐值一致**。
 *
 * ## 为什么需要这条守卫（而不是"只信自己"）
 * `src/` 因为 `tsconfig.json` 的 `rootDir: "src"` **不能** import 仓库根下的 `scripts/agf/format.js`
 * ⇒ 尺寸那一段逻辑是**移植**过来的（ACGF 头 + 无头 plan 扫描 + 评分）。移植就会漂移，
 * 所以这里把共享解码器当 oracle：同一份真文件，两条路的 `(w,h)` 必须相同。
 *
 * 覆盖两类容器（实测分布：id 0x4c00..0x5400 的 .AGF 里 ACGF 843 / 无头 14）：
 *  - ACGF：一把常见 id（`SO000`/`SO004`/`TITLE` 用到的那些）；
 *  - **无头**：探针里实测到的那几个（`BG006AA`/`SAKURA1`/`SO022A-C` 等）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { agfSizeOf } from '../src/arch/agfSize.js';
import { bootHeadless } from '../src/tools/scenarioBoot.js';
// ★共享实现（测试文件可以跨目录 import；`src/` 不行 —— 见本文件头的说明）
import { decodeAgfRgba } from '../../../scripts/agf/format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

function findResourceRoot(): string | null {
  for (const cand of ['raw', 'install']) {
    const dir = path.join(ROOT, cand);
    if (fs.existsSync(path.join(dir, 'SYS4INI.BIN'))) return dir;
  }
  return null;
}

/** ACGF 样例（都是本作真实用到的 **AGF** id；★L2D 的 0x4f9a/0x4f9b 是 PNG，不走 AGF 通路）+ 无头样例（探针实测）。 */
const ACGF_IDS = [0x5191, 0x525e, 0x525f, 0x5260, 0x5272, 0x5245, 0x5246, 0x51e2, 0x5190];
const NOHEAD_IDS = [0x4e00, 0x4f75, 0x513b, 0x513c, 0x513f];

test('★T-0025：`agfSizeOf` 与共享解码器 `decodeAgfRgba` 在真 AGF 上逐值一致（ACGF + 无头两类）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真资产用例）');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const rows: string[] = [];
  let checked = 0;
  for (const id of [...ACGF_IDS, ...NOHEAD_IDS]) {
    const r = await src.readById(id);
    if (!r) {
      rows.push(`0x${id.toString(16)} 取不到（跳过）`);
      continue;
    }
    const mine = agfSizeOf(r.data);
    const oracle = decodeAgfRgba(r.data, () => {});
    assert.ok(oracle, `oracle 应能解 0x${id.toString(16)}（${r.name}）`);
    assert.ok(mine, `★0x${id.toString(16)}（${r.name}）：agfSizeOf 应给出尺寸（oracle = ${oracle.width}x${oracle.height}）`);
    assert.equal(mine!.w, oracle!.width, `★0x${id.toString(16)}（${r.name}）宽必须与 oracle 一致`);
    assert.equal(mine!.h, oracle!.height, `★0x${id.toString(16)}（${r.name}）高必须与 oracle 一致`);
    rows.push(`0x${id.toString(16)} ${r.name} ${mine!.w}x${mine!.h}`);
    checked++;
  }
  assert.ok(checked >= 10, `至少要有 10 个真文件被对照（实得 ${checked}）：\n${rows.join('\n')}`);
  // 无头那几个必须真的被覆盖到（否则这条守卫会"看起来绿"）
  const noheadHit = NOHEAD_IDS.filter((id) => rows.some((r) => r.startsWith(`0x${id.toString(16)} `)));
  assert.ok(noheadHit.length > 0, `无头样例至少要有一个存在于本机资源里（实得 ${noheadHit.length}）`);
  await src.dispose?.();
});

test('★T-0025：非 AGF（magic 既不是 ACGF 也不是全 0）⇒ `null`（不许伪造尺寸）', () => {
  const notAgf = new Uint8Array(64);
  notAgf.set([0x53, 0x59, 0x53, 0x34], 0); // 'SYS4'
  assert.equal(agfSizeOf(notAgf), null, '非 AGF 必须返回 null');
  assert.equal(agfSizeOf(new Uint8Array(8)), null, '太短必须返回 null');
});

test('★T-0025：只喂**头部切片**时必须给 `total`（无头 plan 的边界校验要用真实文件大小）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  // 无头样例（`BG050ABL.AGF`）：只给 64 KB 头 + 真实 total ⇒ 必须仍解析出与 oracle 相同的尺寸。
  // ★这条是**回归守卫**：`agfSizeOf(bytes)` 用切片长度当 fileSize 时，plan 的
  //   `bodyHdrPos + hdr + pak <= fileSize` 会被否掉 ⇒ 返回 null（实测踩过）。
  const r = await src.readById(0xb37);
  assert.ok(r, '应能读到 0xb37（BG050ABL.AGF）');
  const cut = r!.data.subarray(0, 65536);
  const oracle = decodeAgfRgba(r!.data, () => {});
  assert.ok(oracle, 'oracle 应能解 0xb37');
  assert.equal(
    agfSizeOf(cut),
    null,
    '切片长度当 fileSize ⇒ 无头 plan 全被否掉（这条断言把"为什么必须传 total"钉住）',
  );
  assert.deepEqual(
    agfSizeOf(cut, r!.data.length),
    { w: oracle!.width, h: oracle!.height },
    '★给上真实 total ⇒ 同一段切片必须解析出与 oracle 相同的尺寸',
  );

  // headless 宿主侧的同一条路（`readHeaderSync` → `agfSizeOf(data, total)`）
  const head = (src as unknown as {
    readHeaderSync?: (id: number, maxBytes?: number) => { name: string; data: Uint8Array; total: number } | null;
  }).readHeaderSync?.(0xb37);
  assert.ok(head, 'NodeFileSource 应实现 readHeaderSync（T-0025 的同步尺寸缝）');
  assert.equal(head!.total, r!.data.length, 'readHeaderSync 必须回传真实文件大小');
  assert.deepEqual(agfSizeOf(head!.data, head!.total), { w: oracle!.width, h: oracle!.height });
  await src.dispose?.();
});

test('★T-0025（判据 ①）：headless 宿主**不开录制**也能答 `0x208` —— 绑定后同步给出真实 AGF 尺寸', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过');
    return;
  }
  // ★这一条走的是**产品装配**（`bootHeadless` 会给 HeadlessScene 接上 `sizeSource`），
  //   而不是手工 new 一个场景 ⇒ 保证"默认就自带解析"这条判据不被装配处的改动悄悄破坏。
  const boot = await bootHeadless({ script: 0, audio: false, log: () => {} });
  const scene = boot.scene as unknown as {
    bindTexture: (imgid: number, slot: number) => void;
    getTextureSize: (slot: number) => { w: number; h: number };
  };
  scene.bindTexture(0xb37, 4); // BG050ABL.AGF（**无头**容器）
  assert.deepEqual(scene.getTextureSize(4), { w: 2048, h: 1152 }, '★无头 AGF：绑定后同步答真实尺寸');
  scene.bindTexture(0x5272, 4); // SO004.AGF（ACGF）
  assert.deepEqual(scene.getTextureSize(4), { w: 1664, h: 1536 }, 'ACGF：同样同步答真实尺寸');
  await boot.src.dispose?.();
});
