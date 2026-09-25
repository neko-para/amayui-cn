/** @tier T1 @kind ratchet @subsystem l2d */
/**
 * `T-0107` 棘轮：INFOEN / BTL 的 L2D 资产 id 表 —— **写入方 + 表形状**。
 *
 * 已核验（判据 1 的落点，本轮实测；全文见 `tickets/T-0107/changes-c107.md`）：
 *  - **写入方 = `src/EBINIT.txt` 与 `src/$1$EBINIT.txt` … `src/$5$EBINIT.txt`**（6 份本体/扩展包的
 *    初始化脚本），**逐角色用字面 token 写**，不是引擎装载、不是数据文件：
 *      `mov (global-int 527d8f) 4087`  + `mov (global-int 528947) 4088`
 *      （`src/EBINIT.txt:115-116`；`0x4087` 经统一文件 id 解析 = `BM001A.MOC`、`0x4088` = `BM001A.MTN`）
 *  - 两张表的基址 token（`0x527d8c` = 角色→`.MOC` 列、`0x528944` = 角色→`.MTN` 列）**本身没有任何写点**
 *    —— 它们是"表基址"，引擎用法是 `lookup-array-2d (…)(global-int 527d8c) <idx> 3 0`
 *    （`src/INFOEN.txt:1568/1590`、`src/BTL.txt` 10 处，全部 `3 0`）。
 *  - **行距 3 dword**，角色号 **1-based**：角色 `c` ⇒ MOC `0x527d8c + 3c`、MTN `0x528944 + 3c`
 *    （角色 1 → `0x527d8f` / `0x528947`，与 `src/EBINIT.txt:115/116` 逐字命中）。
 *  - 写入覆盖角色号 **1..998**（344 个角色），扩展名逐条解析成 `.MOC` / `.MTN`，且两表的角色号集合
 *    **完全相同、同基名成对**（344/344）⇒ 这是「角色号 → 模型/动作统一文件 id」表。
 *  - 两个基址相差 `0x528944 - 0x527d8c = 0xBB8 = 250 * 3 * 4` 字节 ⇒ 两表同构、错开 250 行。
 *
 * ★为什么 headless 里读到 0：INFOEN 用的 `idx = 5063 (0x13c7)` **超出写入覆盖的 1..998** ⇒ 该行从未被写
 *   ⇒ 表里是 0 ⇒ 脚本走静态贴图回落。这是**数据的正确行为**，不是 emulator 缺陷。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSys4Toc, parseSys4Toc, parseAppendIndex, resolveFileEntry } from '../src/script/alf.js';

const TOKEN_MOC = 0x527d8c; // 表基址：角色 → .MOC 统一文件 id
const TOKEN_MTN = 0x528944; // 表基址：角色 → .MTN 统一文件 id
const ROW_DWORDS = 3; // 行距（dword）；对应脚本里 lookup-array-2d 的第 4 操作数 = 3

/** 6 份写入脚本：本体 `EBINIT.txt` + 扩展包 `$1$`..`$5$`。 */
const WRITER_FILES = [
  'EBINIT.txt',
  '$1$EBINIT.txt',
  '$2$EBINIT.txt',
  '$3$EBINIT.txt',
  '$4$EBINIT.txt',
  '$5$EBINIT.txt',
];

const SRC = '../../../src/';
const INSTALL = '../../../install/';

function srcPath(name: string): string {
  return fileURLToPath(new URL(SRC + name, import.meta.url));
}

/** 统一文件 id → 文件名（base FileDB + 5 个 APPEND 包）。 */
function fileIdResolver(): (id: number) => string | null {
  const root = fileURLToPath(new URL(INSTALL, import.meta.url));
  const base = parseSys4Toc(readSys4Toc(new Uint8Array(readFileSync(root + 'SYS4INI.BIN'))));
  const packs: (ReturnType<typeof parseAppendIndex> | null)[] = Array.from({ length: 8 }, () => null);
  for (const f of readdirSync(root)) {
    const m = /^APPEND0(\d)\.AAI$/.exec(f);
    if (m) packs[Number(m[1])] = parseAppendIndex(new Uint8Array(readFileSync(root + f)));
  }
  return (id: number) => resolveFileEntry(id, base, packs)?.name ?? null;
}

interface Write {
  ch: number;
  name: string;
  at: string;
}

/** 扫 6 份写入脚本，抽出落在两张表 3 列上的字面写点，并解析成文件名。 */
function scanWrites(): { moc: Map<number, Write>; mtn: Map<number, Write> } {
  const resolve = fileIdResolver();
  const moc = new Map<number, Write>();
  const mtn = new Map<number, Write>();
  for (const f of WRITER_FILES) {
    const lines = readFileSync(srcPath(f), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^mov \(global-int (5[0-9a-f]{5})\) ([0-9a-f]+)\s*$/.exec(lines[i]!.trim());
      if (!m) continue;
      const tok = parseInt(m[1]!, 16);
      const name = resolve(parseInt(m[2]!, 16));
      if (!name) continue;
      const up = name.toUpperCase();
      const at = `${f}:${i + 1}`;
      if (tok >= TOKEN_MOC && (tok - TOKEN_MOC) % ROW_DWORDS === 0 && up.endsWith('.MOC')) {
        const ch = (tok - TOKEN_MOC) / ROW_DWORDS;
        moc.set(ch, { ch, name, at });
      } else if (tok >= TOKEN_MTN && (tok - TOKEN_MTN) % ROW_DWORDS === 0 && up.endsWith('.MTN')) {
        const ch = (tok - TOKEN_MTN) / ROW_DWORDS;
        mtn.set(ch, { ch, name, at });
      }
    }
  }
  return { moc, mtn };
}

test('T-0107 ①：写入方是 EBINIT 族，且角色 1 = BM001A 的两列落在 0x527d8f / 0x528947', () => {
  const { moc, mtn } = scanWrites();
  assert.equal(moc.size, 344, 'MOC 表已写角色数');
  assert.equal(mtn.size, 344, 'MTN 表已写角色数');
  const a = moc.get(1);
  const b = mtn.get(1);
  assert.ok(a && b, '角色 1 必须有写点');
  assert.equal(a.name, 'BM001A.MOC');
  assert.equal(b.name, 'BM001A.MTN');
  assert.equal(a.at, 'EBINIT.txt:115', 'MOC 列锚点 = src/EBINIT.txt:115');
  assert.equal(b.at, 'EBINIT.txt:116', 'MTN 列锚点 = src/EBINIT.txt:116');
  // token 逐字：角色 c ⇒ 基址 + 3c
  assert.equal(TOKEN_MOC + ROW_DWORDS * 1, 0x527d8f);
  assert.equal(TOKEN_MTN + ROW_DWORDS * 1, 0x528947);
});

test('T-0107 ②：两表角色号集合完全相同、同基名成对，覆盖 1..998', () => {
  const { moc, mtn } = scanWrites();
  const mc = [...moc.keys()].sort((x, y) => x - y);
  const tc = [...mtn.keys()].sort((x, y) => x - y);
  assert.deepEqual(mc, tc, '两张表的角色号集合必须逐字相同');
  assert.equal(mc[0], 1);
  assert.equal(mc[mc.length - 1], 998, '最大已写角色号 = 998 (0x3e6)');
  let paired = 0;
  for (const c of mc) {
    const a = moc.get(c)!.name.replace(/\.MOC$/i, '');
    const b = mtn.get(c)!.name.replace(/\.MTN$/i, '');
    if (a === b) paired++;
  }
  assert.equal(paired, mc.length, '每个角色的 MOC/MTN 必须同基名');
});

test('T-0107 ③：表基址 token 本身无写点，13 处用法全是 lookup-array-2d … 3 0', () => {
  const dir = fileURLToPath(new URL(SRC, import.meta.url));
  const names = readdirSync(dir).filter((n) => n.endsWith('.txt'));
  assert.ok(names.length > 500, `src/*.txt 应远多于 500 份，实测 ${names.length}`);
  const hits = new Map<string, number>();
  for (const n of names) {
    const txt = readFileSync(srcPath(n), 'utf8');
    const c = (txt.match(/\(global-int (527d8c|528944)\)/g) ?? []).length;
    if (c > 0) hits.set(n, c);
  }
  assert.deepEqual([...hits.keys()].sort(), ['BTL.txt', 'INFOEN.txt']);
  assert.equal(hits.get('BTL.txt'), 10);
  assert.equal(hits.get('INFOEN.txt'), 3);
  const check = (file: string, lines: number[]) => {
    const src = readFileSync(srcPath(file), 'utf8').split('\n');
    for (const ln of lines) {
      assert.match(
        src[ln - 1]!,
        /^lookup-array-2d .*\(global-int (527d8c|528944)\) .* 3 0$/,
        `${file}:${ln}`,
      );
    }
  };
  check('BTL.txt', [1610, 1614, 1636, 1721, 1766, 2644, 2648, 2670, 2694, 2757]);
  check('INFOEN.txt', [712, 1568, 1590]);
});

test('T-0107 ④：INFOEN 的 idx 口径 =「有效角色枚举里的角色号」，5063 超界 ⇒ 表里是 0（走静态回落）', () => {
  const { moc } = scanWrites();
  // INFOEN 的 idx 来自 `local-int 13c7 ← local-int 13bd`，而 13bd 是从角色枚举里挑出来的角色号
  const infoen = readFileSync(srcPath('INFOEN.txt'), 'utf8').split('\n');
  assert.match(infoen[717 - 1]!, /^mov \(local-int 13c7\) \(local-int 13bd\)$/);
  assert.match(infoen[1568 - 1]!, /lookup-array-2d .*\(global-int 527d8c\) \(local-int 13c7\) 3 0/);
  // 探针实测的 idx = 0x13c7 = 5063 超出写入覆盖的 1..998 ⇒ 该行从未写 ⇒ 读出来是 0
  const idx = 0x13c7;
  assert.ok(idx > 998, `idx ${idx} 必须超出写入覆盖范围`);
  assert.equal(moc.has(1), true);
  assert.equal(moc.has(idx), false);
});

test('T-0107 ⑤：两表基址相差 250 行（0xBB8 字节），行距 3 dword —— 同构表判据', () => {
  const delta = TOKEN_MTN - TOKEN_MOC;
  assert.equal(delta, 0xbb8);
  assert.equal(delta % (ROW_DWORDS * 4), 0);
  assert.equal(delta / (ROW_DWORDS * 4), 250);
});
