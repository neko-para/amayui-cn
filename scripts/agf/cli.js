// AGF 工具 CLI（Node 移植版，逻辑与 Eushully_AGF_TooL Python 版一致）
//
// 用法：
//   node agf/cli.js extract <AGF文件...> [--out <目录>] [--mode auto|acgf|nohead]
//   node agf/cli.js inject <原AGF> <PNG> -o <输出AGF>
//   node agf/cli.js build <PNG> -o <输出AGF>        # 无头打包（24bpp 无压缩）
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractAgfToPng, injectAcgfFixed, buildNoheadAgfFromPng } from './format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log('AGF 工具（Node 移植版）');
  console.log('  node agf/cli.js extract <AGF文件...> [--out 目录] [--mode auto|acgf|nohead]');
  console.log('  node agf/cli.js inject <原AGF> <PNG> -o <输出AGF>');
  console.log('  node agf/cli.js build <PNG> -o <输出AGF>');
}

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(cmd ? 0 : 1);
}

function parseArgs(rest) {
  const opts = { positionals: [], out: null, mode: 'auto' };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out' || rest[i] === '-o') opts.out = rest[++i];
    else if (rest[i] === '--mode') opts.mode = rest[++i];
    else if (rest[i].startsWith('-')) {
      usage();
      process.exit(1);
    } else opts.positionals.push(rest[i]);
  }
  return opts;
}

if (cmd === 'extract') {
  const opts = parseArgs(args.slice(1));
  if (!opts.positionals.length) {
    usage();
    process.exit(1);
  }
  if (opts.out) fs.mkdirSync(opts.out, { recursive: true });
  const files = [];
  for (const p of opts.positionals) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      files.push(
        ...fs
          .readdirSync(p)
          .filter((f) => f.toUpperCase().endsWith('.AGF'))
          .map((f) => path.join(p, f))
      );
    } else {
      files.push(p);
    }
  }
  let ok = 0;
  for (const f of files) {
    if (extractAgfToPng(f, opts.out, opts.mode)) ok++;
  }
  console.log(`[extract] ${ok}/${files.length}`);
  process.exit(ok === files.length ? 0 : 1);
} else if (cmd === 'inject') {
  const opts = parseArgs(args.slice(1));
  if (opts.positionals.length !== 2 || !opts.out) {
    usage();
    process.exit(1);
  }
  const ok = injectAcgfFixed(opts.positionals[0], opts.positionals[1], opts.out);
  process.exit(ok ? 0 : 1);
} else if (cmd === 'build') {
  const opts = parseArgs(args.slice(1));
  if (opts.positionals.length !== 1 || !opts.out) {
    usage();
    process.exit(1);
  }
  const ok = buildNoheadAgfFromPng(opts.positionals[0], opts.out);
  process.exit(ok ? 0 : 1);
} else {
  usage();
  process.exit(1);
}
