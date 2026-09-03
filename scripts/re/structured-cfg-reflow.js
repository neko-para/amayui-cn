#!/usr/bin/env node
// structured-cfg-reflow.js
//
// Driver: for EVERY *.txt in <srcDir> run scripts/re/structured_cfg.js and write the
// structured-pseudocode version into <outDir>.
//
//   * Runs multiple tool processes CONCURRENTLY (default os.cpus()/2, override --jobs N).
//   * By default SKIPS the SC* and SP* families (SG*, and everything else, is kept).
//     Pass --sc-sp (or --all) to also process SC/SP.
//
// Usage:
//   node re/structured-cfg-reflow.js                       # src -> src-reflow (defaults, skips SC/SP)
//   node re/structured-cfg-reflow.js src src-reflow .txt   # explicit dirs/suffix
//   node re/structured-cfg-reflow.js <srcDir> <outDir> [suffix] [--sc-sp | --all] [--jobs N]
//
// Output naming: <outDir>/<basename><suffix> (default ".txt", so src/$1$AMINIT.txt ->
// src-reflow/$1$AMINIT.txt).

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const tool = path.join(__dirname, 'structured_cfg.js');

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { srcDir: 'src', outDir: 'src-reflow', suffix: '.txt', includeScSp: false, jobs: null };
  const positionals = [];
  for (const a of args) {
    if (a === '--sc-sp' || a === '--all') out.includeScSp = true;
    else if (a === '--jobs') out.jobs = Number(args[args.indexOf(a) + 1]);
    else if (a.startsWith('-')) { /* ignore unknown flags */ }
    else positionals.push(a);
  }
  if (positionals[0]) out.srcDir = positionals[0];
  if (positionals[1]) out.outDir = positionals[1];
  if (positionals[2]) out.suffix = positionals[2];
  return out;
}

// Family code of a script name: strip a leading `$NN$` prefix, take the leading token.
// SC / SP are the families we skip by default (SG is NOT skipped).
function isScSp(base) {
  const s = base.replace(/^\$[^$]*\$/, '');
  return /^SC/.test(s) || /^SP/.test(s);
}

function runTool(fileAbs) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [tool, fileAbs], { cwd: repoRoot });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ text: stdout, code, stderr }));
    p.on('error', (err) => resolve({ text: '', code: -1, stderr: String(err) }));
  });
}

async function main() {
  const o = parseArgs(process.argv);
  const srcDir = path.resolve(repoRoot, o.srcDir);
  const outDir = path.resolve(repoRoot, o.outDir);
  const jobs = o.jobs || Math.max(1, Math.floor(os.cpus().length / 2));

  const allFiles = readdirSync(srcDir).filter((f) => f.endsWith('.txt')).sort();
  const files = allFiles.filter((f) => isScSp(f) ? o.includeScSp : true);
  const skipped = allFiles.length - files.length;

  mkdirSync(outDir, { recursive: true });

  console.log(`structured_cfg driver`);
  console.log(`  src     : ${srcDir}`);
  console.log(`  out     : ${outDir}`);
  console.log(`  files   : ${files.length}/${allFiles.length}  (skipped SC/SP: ${skipped})`);
  console.log(`  concurrency: ${jobs}  (--sc-sp to include SC/SP)`);

  const errors = [];   // per-file tool errors ("!! ..." from stderr)
  const records = new Map(); // unexpected instruction shapes ([record])
  let ok = 0;
  let idx = 0;

  const worker = async () => {
    while (idx < files.length) {
      const i = idx++;
      const file = files[i];
      const base = path.basename(file, '.txt');
      const dest = path.join(outDir, base + o.suffix);
      const r = await runTool(path.join(srcDir, file));
      if (r.code === 0) {
        writeFileSync(dest, r.text);
        ok++;
        console.log(`# -> ${dest}`);
      } else {
        const msg = (r.stderr || '').trim();
        errors.push(`${file}: ${msg || `exit ${r.code}`}`);
        console.error(`!! ${file}: exit ${r.code}`);
      }
      // Aggregate per-process diagnostics from stderr.
      for (const l of (r.stderr || '').split('\n')) {
        if (l.startsWith('[record]')) {
          console.error(l);
          const m = /([0-9]+)x\s+(.+)/.exec(l); // best-effort; the tool already aggregates per file
          if (m) records.set(m[2], (records.get(m[2]) || 0) + Number(m[1]));
        }
      }
    }
  };

  await Promise.all(Array.from({ length: jobs }, () => worker()));

  console.log(`  wrote : ${ok}/${files.length} into ${outDir}`);
  if (errors.length) {
    console.error(`ERRORS (${errors.length}):`);
    for (const e of errors.slice(0, 30)) console.error(`  ${e}`);
  }
  if (records.size) {
    console.error('\n[record] unexpected instruction shapes kept VERBATIM (aggregated):');
    for (const [key, count] of records) console.error(`  ${count}x  ${key}`);
  }
  process.exitCode = errors.length ? 1 : 0;
}

main();
