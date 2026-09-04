/** 交叉验证：SYS4450 BIN 解析器 vs 反汇编文本（src/*.txt）逐条一致。
 *  源解析与 FileSource 一致：只依赖 raw/（松散优先，否则从 ALF 切片）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScriptBytes } from '../src/script/bin.js';
import { parseSys4Index, type Sys4Index } from '../src/script/alf.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'raw');

function srcTxtOf(name: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', name), 'utf8');
}

function parseTxtInstrNames(txt: string): string[] {
  const names: string[] = [];
  for (const l of txt.split(/\r?\n/)) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith('==Binary') || t.startsWith('signature') || t.startsWith('local_vars') || t.startsWith('====')) continue;
    if (/^label_/.test(t)) continue;
    const m = /^([a-zA-Z0-9_-]+)/.exec(t);
    if (m) names.push(m[1]!);
  }
  return names;
}

/** 用 FileSource 读一个脚本（松散优先，否则 ALF 切片），返回其字节与名字。 */
async function loadBin(name: string): Promise<{ name: string; data: Uint8Array }> {
  const src = new NodeFileSource({ rawDir: RAW_DIR });
  // 从 SYS4INI base 索引找该名字对应的 index
  const idxBytes = new Uint8Array(fs.readFileSync(path.join(RAW_DIR, 'SYS4INI.BIN')));
  const base: Sys4Index = parseSys4Index(idxBytes);
  const idx = base.files.findIndex((f) => f.name === name);
  if (idx < 0) throw new Error(`索引里找不到 ${name}`);
  const r = await src.readScript(idx);
  await src.dispose?.();
  if (!r) throw new Error(`读不到 ${name}`);
  return { name: r.name, data: r.data };
}

async function assertMatches(binName: string, txtName: string): Promise<void> {
  const { data } = await loadBin(binName);
  const s = parseScriptBytes(data);
  const txtNames = parseTxtInstrNames(srcTxtOf(txtName));
  const binNames = s.instructions.map((i) => i.name);
  assert.equal(binNames.length, txtNames.length, `${binName}: 指令数不一致`);
  for (let i = 0; i < binNames.length; i++) {
    if (binNames[i] !== txtNames[i]) {
      assert.fail(`${binName}: 第 ${i} 条指令名不一致 bin=${binNames[i]} txt=${txtNames[i]}`);
    }
  }
}

test('SYSTEM4.BIN(松散) 与 src/SYSTEM4.txt 逐条一致', async () => assertMatches('SYSTEM4.BIN', 'SYSTEM4.txt'));
test('TITLE.BIN(ALF) 与 src/TITLE.txt 逐条一致', async () => assertMatches('TITLE.BIN', 'TITLE.txt'));
test('INIT2.BIN(ALF) 与 src/INIT2.txt 逐条一致', async () => assertMatches('INIT2.BIN', 'INIT2.txt'));
test('LOGO.BIN(ALF) 与 src/LOGO.txt 逐条一致', async () => assertMatches('LOGO.BIN', 'LOGO.txt'));
