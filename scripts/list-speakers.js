// list-speakers.js —— 扫描 src/*.txt 中全部 `// FROM: <id> <名称>` 注释，
// 归一化行尾（CRLF/LF）后按 id 汇总：名称、台词页数、涉及文件数。
// 输出：.tmp/character-analysis/speakers.json
//
// 用法:
//   node scripts/list-speakers.js
//   node scripts/list-speakers.js --out .tmp/character-analysis

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FROM_RE = /^\/\/ FROM: (\S+)(?:\s+(.*))?$/;

function usage() {
  console.log(`用法: node list-speakers.js [--out <目录>] [--root <工程根>]
  --out   输出目录（默认 <工程根>/.tmp/character-analysis）
  --root  工程根目录（默认脚本上级目录）`);
}

function parseArgs(argv) {
  const opts = { out: null, root: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { usage(); process.exit(1); }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const outDir = opts.out || path.join(opts.root, '.tmp', 'character-analysis');
fs.mkdirSync(outDir, { recursive: true });

const srcDir = path.join(opts.root, 'src');
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.txt')).sort();

const byId = new Map(); // id(hex string) -> { id, names:Map<name,count>, pages, files:Set }
let nonePages = 0;

for (const f of files) {
  const raw = fs.readFileSync(path.join(srcDir, f), 'utf8');
  for (const ln of raw.split(/\r\n|\r|\n/)) {
    const m = FROM_RE.exec(ln.trim());
    if (!m) continue;
    const id = m[1];
    const name = (m[2] || '').trim();
    if (id === 'none') {
      nonePages++;
      continue;
    }
    let e = byId.get(id);
    if (!e) {
      e = { id, names: new Map(), pages: 0, files: new Set() };
      byId.set(id, e);
    }
    e.pages++;
    e.files.add(f);
    if (name) e.names.set(name, (e.names.get(name) || 0) + 1);
  }
}

// id 数值升序（hex 解析），末尾 none 不进入列表（仅统计）
const order = [...byId.values()].sort(
  (a, b) => parseInt(a.id, 16) - parseInt(b.id, 16)
);

const out = order.map((e) => {
  const nameCounts = [...e.names.entries()].sort((x, y) => y[1] - x[1]);
  return {
    id: e.id,
    name: nameCounts.length ? nameCounts[0][0] : '??',
    names: nameCounts.map(([n, c]) => ({ name: n, count: c })),
    pages: e.pages,
    fileCount: e.files.size,
    files: [...e.files].sort(),
  };
});

const payload = {
  generatedAt: new Date().toISOString(),
  note: 'id 为十六进制字符串；none（旁白）不纳入分析，仅统计 nonePages',
  nonePages,
  totalCharacters: out.length,
  characters: out,
};

fs.writeFileSync(path.join(outDir, 'speakers.json'), JSON.stringify(payload, null, 2), 'utf8');

console.log(`共 ${out.length} 个角色（none 旁白 ${nonePages} 页，不处理）。`);
console.log('id\t页数\t文件数\t名称');
for (const c of out) {
  console.log(`${c.id.padEnd(4)}\t${String(c.pages).padStart(6)}\t${String(c.fileCount).padStart(4)}\t${c.name}`);
}
console.log(`\n输出: ${path.join(outDir, 'speakers.json')}`);
