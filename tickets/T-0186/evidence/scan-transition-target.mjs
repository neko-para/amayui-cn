// 一次性（T-0091 ② 的"可发现性"取证）：扫语料里所有转场记录写端（0x223/0x24D/0x24F/0x250/0x251），
// 取它们的 op2（= 记录 [4] 渲染目标层的来源），并按形态分类 + 追 op2 是全局时的全部写点。
// 用法：node tickets/T-0186/evidence/scan-transition-target.mjs [--json]（从仓库根跑；归档副本，T-0091 ② 取证的原始脚本）
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const MNEMONIC = { i223: 0x223, i24d: 0x24d, i24f: 0x24f, i250: 0x250, i251: 0x251 };
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort();

/** 一行指令 → [助记符, 操作数…]（操作数可能是 `(global-int X)` / 数字 / `"串"`）。 */
function tokens(line) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of line) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const sites = [];
const globalWriters = new Map(); // 全局下标 → [{file,line,what}]
for (const f of files) {
  const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = raw.replace(/\/\/.*$/, '').trim();
    if (!code) continue;
    const t = tokens(code);
    const m = t[0];
    if (m in MNEMONIC) {
      const op2 = t[2] ?? '(缺)';
      sites.push({ file: f, line: i + 1, mnemonic: m, op2, raw: code });
      continue;
    }
    // 全局 int 写点（只看直接常量写与 save/load 口径）
    const w = /^(mov|add|sub|mul|div|save-int|load-int|i0b6|i0b7|i0c2|i140|i1a0)\s+\(global-int ([0-9a-f]+)\)/.exec(code);
    if (w) {
      const idx = w[2];
      if (!globalWriters.has(idx)) globalWriters.set(idx, []);
      globalWriters.get(idx).push({ file: f, line: i + 1, what: code.slice(0, 90) });
    }
  }
}

const byForm = {};
for (const s of sites) byForm[s.op2.replace(/[0-9a-f]+/i, 'X')] = (byForm[s.op2.replace(/[0-9a-f]+/i, 'X')] ?? 0) + 1;
console.log(`写端站点 ${sites.length} 处 / ${new Set(sites.map((s) => s.file)).size} 个文件；op2 形态：`);
for (const [k, v] of Object.entries(byForm).sort((a, b) => b[1] - a[1])) console.log(`   ${k} × ${v}`);

// 常量 op2：直接判 0..999
const parsed = sites.map((s) => {
  const g = /^\(global-int ([0-9a-f]+)\)$/.exec(s.op2);
  const l = /^\(local-int ([0-9a-f]+)\)$/.exec(s.op2);
  const n = /^[0-9a-f]+$/.test(s.op2) ? parseInt(s.op2, 16) : null;
  return { ...s, kind: g ? 'global' : l ? 'local' : n !== null ? 'const' : 'other', ref: (g ?? l)?.[1] ?? null, value: n };
});
const consts = parsed.filter((p) => p.kind === 'const');
console.log(`\n常量 op2：${consts.length} 处；越界（>999 或负）：${consts.filter((p) => p.value > 999).length} 处`);
for (const p of consts.filter((p) => p.value > 999).slice(0, 10)) console.log(`   ★${p.file}:${p.line} ${p.mnemonic} op2=${p.op2} → ${p.value}`);

const globals = [...new Set(parsed.filter((p) => p.kind === 'global').map((p) => p.ref))];
console.log(`\nop2 是全局的：${globals.length} 个不同下标（${globals.join(', ')}）；逐个看写点：`);
for (const g of globals) {
  const ws = globalWriters.get(g) ?? [];
  const consts = ws.map((w) => /^(?:mov|save-int)\s+\(global-int [0-9a-f]+\)\s+([0-9a-f]+)$/.exec(w.what)).filter(Boolean);
  const risky = ws.filter((w) => /^(load-int|i0b6|i0b7|i0c2|i1a0)\b/.test(w.what));
  console.log(
    `   全局 ${g}：写点 ${ws.length}（其中常量直写 ${consts.length}、可疑/外部来源 ${risky.length}）` +
      (consts.length ? ` 常量值=[${consts.map((c) => c[1]).join(',')}]` : ''),
  );
  for (const r of risky.slice(0, 4)) console.log(`      ⚠ ${r.file}:${r.line}  ${r.what}`);
}

const locals = [...new Set(parsed.filter((p) => p.kind === 'local').map((p) => p.ref))];
if (locals.length) console.log(`\nop2 是本帧 local 的：${locals.join(', ')}（要在同块里追它的赋值）`);
console.log(`\n其它形态：${parsed.filter((p) => p.kind === 'other').length} 处`);
for (const p of parsed.filter((p) => p.kind === 'other').slice(0, 8)) console.log(`   ${p.file}:${p.line} ${p.mnemonic} op2=${p.op2}`);
if (process.argv.includes('--json')) fs.writeFileSync('.tmp/flash/transition-target-scan.json', JSON.stringify(parsed, null, 1), 'utf8');
