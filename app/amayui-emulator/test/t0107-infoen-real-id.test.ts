/** @tier T1 @kind core @subsystem l2d */
/**
 * `T-0107` 端到端：**INFOEN 的「角色 → L2D 资产 id」这一步在 headless 下能取到真 id**。
 *
 * ## 这条链的两端（本轮定位结论，全文见 `tickets/T-0107/changes-c107.md`）
 * ```
 * 写入端  src/EBINIT.txt:115-116（本体）+ src/$1$..$5$EBINIT.txt（扩展包）
 *         mov (global-int 527d8f) 4087   ← 0x527d8c + 3*1（角色 1，列 0 = MOC）
 *         mov (global-int 528947) 4088   ← 0x528944 + 3*1（角色 1，列 0 = MTN）
 * 消费端  src/INFOEN.txt:1568  lookup-array-2d (local-ptr 1) (global-int 527d8c) (local-int 13c7) 3 0
 *         src/INFOEN.txt:1590  lookup-array-2d (local-ptr 1) (global-int 528944) (local-int 13c7) 3 0
 * 资产端  0x4087 = BM001A.MOC（真 .MOC）；0x4088 = BM001A.MTN（真 .MTN）
 *         src/SETL2DMOC.txt:31-35（f8c46 == 4087 ⇒ i341 4087 + i345 4fa2）
 * ```
 * ⇒ 「角色号 c → 表槽 `基址 + 3c`」是**同一条公式**写/读两侧都用；角色 1（`idx = 1`）在这一版
 *   就是 `BM001A.MOC` / `BM001A.MTN`，**不依赖任何编造 id**。
 *
 * ## 为什么 `idx = 0x13c7`（5063）读到 0 —— 这是**数据事实**，不是缺陷
 * EBINIT 族一共只写了角色号 **1..998**（344 个角色，见守卫 `t0107-l2d-asset-id-table.test.ts`），
 * 而 INFOEN 那一处走到的编号是 **5063**（角色枚举里挑出来的角色号，超出写入覆盖）⇒ 该行从未被写
 * ⇒ `lookup-array-2d` 读出 0 ⇒ 脚本按 `a9d0`/`equ` 门走**静态贴图回落**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { readSys4Toc, parseSys4Toc, parseAppendIndex, resolveFileEntry } from '../src/script/alf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 找一个含 `SYS4INI.BIN` 的资源根（`raw/` 优先，其次 `install/`）。 */
function findResourceRoot(): string | null {
  for (const cand of ['raw', 'install']) {
    const dir = path.join(ROOT, cand);
    if (fs.existsSync(path.join(dir, 'SYS4INI.BIN'))) return dir;
  }
  return null;
}

const MOC_BASE = 0x527d8c;
const MTN_BASE = 0x528944;
const ROW_DWORDS = 3;
/** `lookup-array-2d` 的列 = 0（EBINIT 只写列 0；两表同构）。 */
const COL = 0;

test('T-0107 E：角色 1 的两列 id 由 EBINIT 写入 → INFOEN 的取法能取到 → 解析成真 .MOC/.MTN', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  try {
    // ① 写入端：`src/EBINIT.txt:115-116` 逐字（角色 1）
    const ebninit = fs.readFileSync(path.join(ROOT, 'src', 'EBINIT.txt'), 'utf8').split('\n');
    assert.equal(ebninit[115 - 1]!.trim(), 'mov (global-int 527d8f) 4087');
    assert.equal(ebninit[116 - 1]!.trim(), 'mov (global-int 528947) 4088');
    const mocId = 0x4087;
    const mtnId = 0x4088;

    // ② INFOEN 的取法：`token = 基址 + 3*idx + col`（idx = 1、col = 0）
    const idx = 1;
    const mocTok = MOC_BASE + ROW_DWORDS * idx + COL;
    const mtnTok = MTN_BASE + ROW_DWORDS * idx + COL;
    assert.equal(mocTok, 0x527d8f, 'INFOEN 的 MOC 取法必须落在 EBINIT 写的那一格上');
    assert.equal(mtnTok, 0x528947, 'INFOEN 的 MTN 取法必须落在 EBINIT 写的那一格上');

    // ③ 资产端：两个 id 经 **真资源根** 解析（`NodeFileSource.readById` = 引擎的统一 id 解析）
    //    ★返回 `{ name, data }`（不是裸字节）—— 名字就是 FileDB 里的真文件名。
    const moc = await src.readById(mocId);
    assert.ok(moc, '0x4087 必须能解析出文件');
    assert.equal(moc.name.toUpperCase(), 'BM001A.MOC');
    assert.equal(Buffer.from(moc.data.subarray(0, 4)).toString('latin1'), 'moc\n', '0x4087 应是 .MOC（首 4 字节 "moc"+格式字节）');
    const mtn = await src.readById(mtnId);
    assert.ok(mtn, '0x4088 必须能解析出文件');
    assert.equal(mtn.name.toUpperCase(), 'BM001A.MTN');
    assert.match(
      Buffer.from(mtn.data.subarray(0, 64)).toString('latin1'),
      /^# Live2D Animator Motion Data/,
      '0x4088 应是 .MTN（文本头 "# Live2D Animator Motion Data"）',
    );

    // ④ 消费端的下一跳：`src/SETL2DMOC.txt:31-35` 的 f8c46 == 0x4087 分支（MOC → 纹理/动作的脚本映射）
    const setl = fs.readFileSync(path.join(ROOT, 'src', 'SETL2DMOC.txt'), 'utf8').split('\n');
    assert.equal(setl[31 - 1]!.trim(), 'eq (local-int 0) (global-int f8c46) 4087');
    assert.equal(setl[33 - 1]!.trim(), 'i341 4087 (global-int f8c47)');
    assert.equal(setl[34 - 1]!.trim(), 'i345 4fa2 (global-int f8c47) 0');
    const tex = await src.readById(0x4fa2);
    assert.ok(tex, '0x4fa2（BM001A 的第 0 张纹理）必须能解析出文件');
    assert.match(tex.name.toUpperCase(), /BM001A.*\.PNG$/);
  } finally {
    await src.dispose?.();
  }
});

test('T-0107 F：idx = 0x13c7（5063）超出 EBINIT 写入覆盖 1..998 ⇒ 两列读出 0 ⇒ 走静态回落', () => {
  const root = findResourceRoot();
  assert.ok(root, '本仓库必须有资源根（raw/ 或 install/）');
  // 用**真 FileDB** 判「写在 MOC 表上的值确实是 .MOC」——不靠字面量范围猜
  const base = parseSys4Toc(readSys4Toc(new Uint8Array(fs.readFileSync(path.join(root, 'SYS4INI.BIN')))));
  const packs: (ReturnType<typeof parseAppendIndex> | null)[] = Array.from({ length: 8 }, () => null);
  for (const f of fs.readdirSync(root)) {
    const m = /^APPEND0(\d)\.AAI$/.exec(f);
    if (m) packs[Number(m[1])] = parseAppendIndex(new Uint8Array(fs.readFileSync(path.join(root, f))));
  }
  const nameOf = (id: number): string => resolveFileEntry(id, base, packs)?.name ?? '';

  const writerScripts = ['EBINIT.txt', '$1$EBINIT.txt', '$2$EBINIT.txt', '$3$EBINIT.txt', '$4$EBINIT.txt', '$5$EBINIT.txt'];
  const written = new Set<number>();
  for (const f of writerScripts) {
    const p = path.join(ROOT, 'src', f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = /^mov \(global-int (5[0-9a-f]{5})\) ([0-9a-f]+)\s*$/.exec(line.trim());
      if (!m) continue;
      const tok = parseInt(m[1]!, 16);
      if (tok < MOC_BASE || (tok - MOC_BASE) % ROW_DWORDS !== COL) continue;
      if (!nameOf(parseInt(m[2]!, 16)).toUpperCase().endsWith('.MOC')) continue;
      written.add((tok - MOC_BASE) / ROW_DWORDS);
    }
  }
  assert.ok(written.size > 300, `EBINIT 族写入的 MOC 角色数应 >300，实测 ${written.size}`);
  const maxCh = Math.max(...written);
  assert.equal(maxCh, 998, '写入覆盖的上界 = 998（与 BM###A 号段一致）');
  const minCh = Math.min(...written);
  assert.equal(minCh, 1, '写入覆盖的下界 = 1（1-based 角色号）');
  // INFOEN 那一处走到的编号
  assert.equal(0x13c7, 5063);
  assert.ok(!written.has(0x13c7), '5063 必须不在写入覆盖内 ⇒ 表里是 0 ⇒ 静态贴图回落');
  // 同一份语料里 5063 与"角色号 1..999"不是同一口径：SETFATE 的循环上界是 0x3e8 = 1000
  const setfate = fs.readFileSync(path.join(ROOT, 'src', 'SETFATE.txt'), 'utf8');
  assert.match(setfate, /lt \(local-int 7d4\) \(local-int 0\) 3e8/, 'SETFATE 的角色号上界 = 1000');
});
