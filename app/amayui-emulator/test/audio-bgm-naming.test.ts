/**
 * **BGM 曲号 → 文件名**（★订正：`play-bgm` 的操作数是**曲号**，不是统一文件 id）。
 *
 * 背景（2026-09 用户实测报错）：标题画面 `TITLE.txt:14 play-bgm 1f` 放的是**回想界面的曲子**。
 * 原因：我们曾把操作数当统一文件 id 解释 ⇒ id 31 = `BGM041.OGG`；而引擎的 `MusicBase` 有一张
 * 「曲号 → 文件 id」表（`sub_48DB80` raw 108738：`索引 = 曲号 − 2`），本作等价于文件名 `BGM%03d.OGG`
 * ⇒ 曲号 31 = **BGM031.OGG**。
 *
 * 本测试用**真实语料**把它钉死（E3）：
 *  1. `NodeFileSource.readByName('BGM031.OGG')` 真能取到 `OggS` 字节（宿主解析路径可用）；
 *  2. 剧本里的每个 `play-bgm <曲号>` 都能按名字解析；
 *  3. 脚本侧数据 `MUINIT.txt` 的**两张表自洽**：A（文件 id）指向的文件名 == `BGM<B>.OGG`（B = 曲号）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { bgmFileName } from '../src/audio/audioEngine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RES = resolveResourceDir(ROOT);

/** 用真实资源根建一个（只读）文件代理。 */
function src(): NodeFileSource {
  return new NodeFileSource({ resourceDir: RES });
}

test('曲号 → 文件名：bgmFileName 补零到 3 位', () => {
  assert.equal(bgmFileName(3), 'BGM003.OGG');
  assert.equal(bgmFileName(31), 'BGM031.OGG');
  assert.equal(bgmFileName(0x1f), 'BGM031.OGG', 'TITLE 的 play-bgm 1f');
  assert.equal(bgmFileName(56), 'BGM056.OGG');
});

test('E3：readByName 按文件名取到 BGM031.OGG 的 OggS 字节（= 标题曲）', async () => {
  const s = src();
  const hit = await s.readByName('bgm031.ogg'); // 大小写不敏感
  assert.ok(hit, 'BGM031.OGG 应能在 install/ 索引里按名字解析');
  assert.equal(hit.name, 'BGM031.OGG');
  assert.ok(hit.data.length > 100_000, `标题曲应有实质长度（${hit.data.length} B）`);
  assert.equal(String.fromCharCode(...hit.data.subarray(0, 4)), 'OggS', '是标准 Ogg（Vorbis）');

  // ★记下这个坑：**按统一 id 31 会取到另一首曲子**（回想界面的 BGM041）
  const wrong = await s.readById(31);
  assert.equal(wrong?.name, 'BGM041.OGG', 'id 31 ≠ 曲号 31：这就是"标题 BGM 放错"的根因');
  await s.dispose?.();
});

test('E3：MUINIT.txt 的两张表自洽（A = 文件 id、B = 曲号）', async () => {
  const pairs = parseMuinit(path.join(ROOT, 'src', 'MUINIT.txt'));
  assert.ok(pairs.length >= 30, `MUINIT 应有多条曲目（实际 ${pairs.length}）`);
  const s = src();
  let bgmOk = 0;
  const nonBgm: string[] = [];
  for (const { a, b, name } of pairs) {
    const f = await s.readById(a);
    assert.ok(f, `A=${a}（${name}）应能按 id 解析`);
    if (f.name.startsWith('BGM')) {
      assert.equal(f.name, bgmFileName(b), `曲号 ${b}（${name}）的文件名应为 ${bgmFileName(b)}`);
      // 反向：按名字也取得到同一份
      const byName = await s.readByName(bgmFileName(b));
      assert.equal(byName?.name, f.name);
      bgmOk++;
    } else {
      nonBgm.push(`${b}:${f.name}`);
    }
  }
  assert.ok(bgmOk >= 30, `多数曲目应落在 BGM###.OGG（实际 ${bgmOk}）`);
  // 少数例外是 OP/ED 影片（曲目表里指到影片文件），不是 BGM —— 记下来即可
  assert.ok(nonBgm.length <= 4, `非 BGM 条目应很少：${nonBgm.join(' / ')}`);
  await s.dispose?.();
});

test('E3：剧本里出现的每个 play-bgm 曲号都能按名字解析到文件', async () => {
  const files = ['TITLE.txt', 'CONFIG1.txt', 'SC0330.txt', 'SC0820.txt', 'SN0000.txt', 'CONFIG.txt'];
  const numbers = new Set<number>();
  for (const f of files) {
    const p = path.join(ROOT, 'src', f);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/^play-bgm\s+([0-9a-f]+)/gm)) {
      numbers.add(parseInt(m[1]!, 16));
    }
  }
  assert.ok(numbers.size > 0, '这几个脚本里应有 play-bgm');
  const s = src();
  for (const n of numbers) {
    const hit = await s.readByName(bgmFileName(n));
    assert.ok(hit, `play-bgm ${n.toString(16)} ⇒ ${bgmFileName(n)} 应存在`);
  }
  await s.dispose?.();
});

/** 解析 `MUINIT.txt`：连续两条 `mov (global-int …)` 后跟一条 `set-string`，即 `{A, B, 曲名}`。 */
function parseMuinit(file: string): Array<{ a: number; b: number; name: string }> {
  const out: Array<{ a: number; b: number; name: string }> = [];
  let pending: number[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const mov = /mov \(global-int [0-9a-f]+\) ([0-9a-f]+)/.exec(line);
    if (mov) {
      pending.push(parseInt(mov[1]!, 16));
      if (pending.length > 2) pending = pending.slice(-2);
      continue;
    }
    const s = /set-string \(global-string [0-9a-f]+\) "(.*)"/.exec(line);
    if (s) {
      if (pending.length === 2) out.push({ a: pending[0]!, b: pending[1]!, name: s[1]! });
      pending = [];
    }
  }
  return out;
}
