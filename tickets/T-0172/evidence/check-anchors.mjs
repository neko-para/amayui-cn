#!/usr/bin/env node
/**
 * T-0172 的 raw 行号锚点机械核对（两向 + 一致性）。
 *
 *   node tickets/T-0172/evidence/check-anchors.mjs            # 逐条打印 ✅/❌，全绿退出 0
 *   node tickets/T-0172/evidence/check-anchors.mjs --quiet    # 只打印失败项与小计
 *
 * 表 = `tickets/T-0172/evidence/anchors.json`（唯一真源；`app/amayui-emulator/test/doc-model.test.ts`
 * 的「B7-B 棘轮（T-0172）」读同一张表 ⇒ 文档/守卫/取证三处永不漂移）。
 *
 * 三个方向（缺一不可）：
 *   ① 文档那一行（`line`）必须存在、且仍含 `row` 这段锚点文字；
 *   ② 文档那一行必须仍写着 `cites[]` 里的每个行号字面量（防"改回旧行号"）；
 *   ③ 每个 `raw[].line` 处必须真的含 `raw[].has` 这段代码串（防"换了反编译版本还留着旧行号"）。
 * 另加一致性检查：`raw[].line` 必须被某个 `cites[]` 覆盖（精确匹配，或落在某个 `A-B` 区间内）
 * —— 不许"文档没写这个行号，却拿它当断言"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const DOCS = path.join(ROOT, 'docs-new');

/** `cites[]` 里的一项是否覆盖行号 n（精确或区间）。 */
export function citeCovers(cites, n) {
  for (const c of cites) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(c);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (n >= a && n <= b) return true;
  }
  return false;
}

/** 读真源（文件名里的"天结"是简体码位 ⇒ 按后缀找，别硬编码码位）。 */
function readRaw() {
  const name = fs.readdirSync(path.join(ROOT, 'engine')).find((f) => f.endsWith('_unpacked.exe_utf8.c'));
  if (!name) throw new Error('找不到反编译真源 engine/*_unpacked.exe_utf8.c');
  return { name, lines: fs.readFileSync(path.join(ROOT, 'engine', name), 'utf8').split('\n') };
}

export function loadAnchors() {
  const doc = JSON.parse(fs.readFileSync(path.join(HERE, 'anchors.json'), 'utf8'));
  if (!Array.isArray(doc.anchors) || doc.anchors.length === 0) throw new Error('anchors.json 里没有 anchors[]');
  return doc.anchors;
}

/** 纯核对：返回问题清单（空 = 全绿）。 */
export function checkAnchors(anchors, rawLines) {
  const problems = [];
  for (const a of anchors) {
    const docLines = fs.readFileSync(path.join(DOCS, a.doc), 'utf8').split('\n');
    const at = docLines[a.line - 1];
    if (at === undefined) { problems.push(`${a.id}：${a.doc} 只有 ${docLines.length} 行，找不到第 ${a.line} 行`); continue; }
    // ① 锚点行没漂
    if (!at.includes(a.row)) problems.push(`${a.id}：${a.doc}:${a.line} 不再含锚点文字「${a.row}」（现为：${at.trim().slice(0, 80)}）`);
    // ② 仍写着这些行号
    for (const c of a.cites) if (!at.includes(c)) problems.push(`${a.id}：${a.doc}:${a.line} 不再写着行号 ${c}（被改回旧行号？）`);
    // ③ 该行号处真含那段代码串
    for (const r of a.raw) {
      const got = rawLines[r.line - 1];
      if (got === undefined) { problems.push(`${a.id}：真源只有 ${rawLines.length} 行，找不到 raw ${r.line}`); continue; }
      if (!got.includes(r.has)) problems.push(`${a.id}：raw ${r.line} 不含「${r.has}」→ 实际：${got.trim().slice(0, 90) || '(空行)'}`);
      if (!citeCovers(a.cites, r.line)) problems.push(`${a.id}：raw ${r.line} 未被 cites[] 覆盖（文档没写该行号，却在拿它断言）`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const quiet = process.argv.includes('--quiet');
  const { name, lines } = readRaw();
  const anchors = loadAnchors();
  if (!quiet) console.log(`真源 = engine/${name}（${lines.length} 行）；锚点 ${anchors.length} 条\n`);
  const problems = checkAnchors(anchors, lines);
  for (const a of anchors) {
    const own = problems.filter((p) => p.startsWith(a.id + '：'));
    if (!quiet || own.length) console.log(`${own.length ? '❌' : '✅'} ${a.id}  [${a.doc}:${a.line}]  cites=${a.cites.length} raw=${a.raw.length}`);
    for (const p of own) console.log(`     ${p}`);
  }
  console.log(`\n小计：${anchors.length} 条锚点，❌ ${problems.length} 处问题`);
  console.error(`[${problems.length === 0 ? 'ok' : 'red'}] ${problems.length} 处与体不符`);
  process.exit(problems.length === 0 ? 0 : 1);
}
