#!/usr/bin/env node
/**
 * brief.js —— 「开工前一页纸」：**分析某个游戏脚本（`src/*.txt`）之前，先把已知的都摆在眼前**。
 *
 * 为什么需要它（真实教训）：用户报「点『ゲーム開始』的音效不对」，我直接去翻 `src/GAMESTART.txt`
 * 与 `src/SN0000.txt`、写测试、改派发逻辑 —— 而 `docs-new/05-scripts/GAMESTART.md` 第 19-21 行
 * **早就写着**「主循环按 `local 3f4` 分派：1 = ゲーム開始 ⇒ `label_000050b8`」，
 * `docs-new/03-engine/sound-system.md` 也早就写着 SE 的统一 id 口径。
 * **重读成本全部来自"没先读文档"**。本工具把这个动作变成一条命令。
 *
 * 它**只读不写**（不碰 `analysis/*.json`、不碰 md），输出四块：
 *   ① 台账条目（`analysis/scripts.json`）—— role/entry/layout/slots/invariants/gotchas/gaps/links/guards
 *   ② 文档落点 —— `docs-new/05-scripts/<ID>.md` 在不在、还有哪些 md 提到过这个脚本
 *   ③ 真源骨架 —— 行数 / label 清单 / 助记符直方图 / `call-script` 出口 / 音频行
 *   ④ 调用关系（`output/callgraph.json`）—— 谁 call 它、它 call 谁
 * 末尾打印**收尾三连**（重生成 md + 自检 + 守卫测试）。
 *
 * 用法：
 *   node brief.js CONFIG1            # 按台账 id / 文件名 / bin 名（大小写不敏感）定位
 *   node brief.js '$1$SC0330'
 *   node brief.js --file src/TITLE.txt
 *   node brief.js --list             # 已登记索引（一行一条）
 *   node brief.js --root <dir> <ID>  # 指定仓库根（默认 cwd）
 *
 * 退出码：0 = 有台账条目；1 = 未登记（仍会把真源骨架打出来，提示先 `--add` 骨架）；2 = 用法错。
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseOpt(argv) {
  const o = { set: [] };
  let root = null;
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--file' || a === '--id') {
      o[a.slice(2)] = argv[++i];
      continue;
    }
    if (a.startsWith('--')) {
      o[a.slice(2)] = true;
      continue;
    }
    pos.push(a);
  }
  root = o.root || '.';
  return { o, root, pos };
}

const { o: opt, root, pos } = parseOpt(process.argv.slice(2));
const LEDGER = path.join(root, 'analysis', 'scripts.json');
const MD_DIR = path.join(root, 'docs-new', '05-scripts');
const DOCS = path.join(root, 'docs-new');
const SRC_DIR = path.join(root, 'src');
const CALLGRAPH = path.join(root, 'output', 'callgraph.json');

const line = (s = '') => console.log(s);
const hr = (t) => line(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---------------------------------------------------------------------------
// 台账
// ---------------------------------------------------------------------------

function loadLedger() {
  if (!fs.existsSync(LEDGER)) {
    console.error(`✗ 找不到脚本台账：${LEDGER}（用 --root 指定仓库根）`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

/** 一个台账条目可能有多个"叫法"（id / 文件名 / bin 名），调用图里又是第三种（`$1$AUTORUN`）。 */
function keysOf(entry) {
  const ks = new Set();
  const add = (s) => {
    if (!s) return;
    ks.add(String(s).toUpperCase());
    ks.add(String(s).replace(/\.(BIN|TXT)$/i, '').toUpperCase());
  };
  add(entry.id);
  add(entry.bin);
  if (entry.file) add(path.basename(entry.file).replace(/\.txt$/i, ''));
  return [...ks];
}

function allEntries(ledger) {
  return Array.isArray(ledger.entries) ? ledger.entries : [];
}

function resolveEntry(ledger, want) {
  const w = String(want).toUpperCase();
  for (const e of allEntries(ledger)) {
    if (keysOf(e).includes(w)) return e;
    // bin 名带包前缀时（`$1$SC0330.BIN`）也接受去掉前缀的短名
    if (keysOf(e).includes(w.replace(/^\$\d+\$/, ''))) return e;
  }
  return null;
}

/** 磁盘上找 `src/<name>.txt`（含 `$1$…` 这种带前缀的名字）。 */
function findSrcFile(want) {
  if (!fs.existsSync(SRC_DIR)) return null;
  const w = String(want).toUpperCase();
  const files = fs.readdirSync(SRC_DIR).filter((f) => /\.txt$/i.test(f));
  for (const f of files) {
    const base = f.replace(/\.txt$/i, '');
    if (base.toUpperCase() === w) return path.join(SRC_DIR, f);
  }
  for (const f of files) {
    const base = f.replace(/\.txt$/i, '').replace(/^\$\d+\$/, '');
    if (base.toUpperCase() === w.replace(/^\$\d+\$/, '')) return path.join(SRC_DIR, f);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 真源骨架
// ---------------------------------------------------------------------------

/** 去掉行尾 `// 注释`（`@"…"` 里出现的 `//` 不算注释）。 */
function stripComment(s) {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    if (!inStr && s[i] === '/' && s[i + 1] === '/') return s.slice(0, i);
    if (!inStr && s[i] === '@' && s[i + 1] === '"') {
      inStr = true;
      i++;
      continue;
    }
    if (inStr && s[i] === '"') inStr = false;
  }
  return s;
}

/** 真源行的注释部分（用于 `call-script 51e4  // INITGAME` 这类"注释即名字"）。 */
function commentOf(s) {
  const i = s.indexOf('//');
  return i < 0 ? '' : s.slice(i + 2).trim();
}

const AUDIO_RE = /^(play-sound-effect|play-bgm|play-voice|stop-bgm|i0b4|i0b5|i0b6|i0b7|i0b8|i0b9|i0ba|i0bb|i0bc|i0bf|i0c4|i2f4|i1bd)\b/i;

function scanSrc(file) {
  const text = fs.readFileSync(file, 'utf8');
  const raw = text.split(/\r?\n/);
  const ops = new Map();
  const labels = [];
  const calls = [];
  const audio = [];
  for (let i = 0; i < raw.length; i++) {
    const src = raw[i];
    const code = stripComment(src).trim();
    if (!code || code.startsWith('/*') || code.startsWith('*')) continue;
    const tok = code.split(/\s+/)[0];
    if (/^label_[0-9a-f]+$/i.test(tok)) {
      labels.push({ n: i + 1, name: tok });
      continue;
    }
    if (tok === 'comment') continue;
    ops.set(tok, (ops.get(tok) ?? 0) + 1);
    if (tok === 'call-script') {
      calls.push({ n: i + 1, text: code, note: commentOf(src) });
    } else if (AUDIO_RE.test(tok)) {
      audio.push({ n: i + 1, text: code, note: commentOf(src) });
    }
  }
  return { raw, lines: raw.length, ops, labels, calls, audio };
}

// ---------------------------------------------------------------------------
// 文档落点 / 调用关系
// ---------------------------------------------------------------------------

function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** 哪些文档提到过这个脚本（按台账的几种叫法模糊匹配）。 */
function docMentions(id, binBase, limit = 20) {
  const needles = [id, binBase].filter(Boolean).map((s) => s.toUpperCase());
  const hits = [];
  for (const f of walkMd(DOCS)) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const up = text.toUpperCase();
    const n = needles.reduce((acc, nd) => acc + (up.includes(nd) ? 1 : 0), 0);
    if (n > 0) hits.push({ file: path.relative(root, f).replace(/\\/g, '/'), n });
  }
  return hits.sort((a, b) => b.n - a.n).slice(0, limit);
}

function callgraphOf(keys) {
  if (!fs.existsSync(CALLGRAPH)) return null;
  let g;
  try {
    g = JSON.parse(fs.readFileSync(CALLGRAPH, 'utf8'));
  } catch {
    return null;
  }
  const edges = Array.isArray(g.edges) ? g.edges : [];
  const up = new Set(keys);
  const callers = [];
  const callees = [];
  for (const e of edges) {
    const c = String(e.caller ?? '').toUpperCase();
    const d = String(e.callee ?? '').toUpperCase();
    if (up.has(c)) callees.push(e.callee);
    if (up.has(d)) callers.push(e.caller);
  }
  return {
    callers: [...new Set(callers)].sort(),
    callees: [...new Set(callees)].sort(),
    stats: g.stats ?? null,
  };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function printEntry(e) {
  hr(`① 台账条目（真源 analysis/scripts.json —— md 是它的渲染物）`);
  line(`id      : ${e.id}`);
  line(`file    : ${e.file}${fs.existsSync(path.join(root, e.file ?? '')) ? '' : '   ⚠ 文件不存在'}`);
  line(`bin     : ${e.bin ?? '—'}`);
  line(`status  : ${e.status}`);
  line(`是什么  : ${e.role ?? '—'}`);
  line(`怎么进/出: ${clip(e.entry, 400)}`);

  const layout = Array.isArray(e.layout) ? e.layout : [];
  line(`\n结构（${layout.length} 段 —— 只列"读过"的区间；跳段读就行，不用从头读）：`);
  for (const s of layout) {
    line(`  · ${String(s.lines ?? '').padEnd(12)} ${clip(s.anchor, 34).padEnd(36)} ${clip(s.what, 90)}`);
  }
  const slots = Array.isArray(e.slots) ? e.slots : [];
  if (slots.length) {
    line(`\n关键槽（${slots.length}）：`);
    for (const s of slots) line(`  · ${String(s.key ?? '').padEnd(28)} ${clip(s.what, 90)}`);
  }
  const list = (name, arr) => {
    if (Array.isArray(arr) && arr.length) {
      line(`\n${name}：`);
      for (const s of arr) line(`  · ${clip(s, 160)}`);
    }
  };
  list('不变量（回归断言的素材）', e.invariants);
  list('坑（踩过一次，别再踩）', e.gotchas);
  list('缺口 gaps', e.gaps);
  const links = e.links ?? {};
  line(`\n回链：capabilities=${clip((links.capabilities ?? []).join(', '), 120) || '—'}`);
  line(`      functions=${clip((links.functions ?? []).join(', '), 120) || '—'}`);
  line(`      docs=${clip((links.docs ?? []).join(', '), 160) || '—'}`);
  line(`守卫：${clip((e.guards ?? []).join(' '), 160) || '—'}`);
  if (e.evidence) line(`证据：${clip(e.evidence, 300)}`);
  if (e.notes) line(`\n★ notes 里写的"未读"就是这次要补的部分：\n  ${clip(e.notes, 600)}`);
}

function printDocs(e, id, binBase, srcFile) {
  hr(`② 文档落点（★先读这些，再动 src/*.txt）`);
  const page = path.join(MD_DIR, `${id}.md`);
  line(`${fs.existsSync(page) ? '✅' : '⚠ '} 本脚本专页：${path.relative(root, page).replace(/\\/g, '/')}${fs.existsSync(page) ? '' : '（还没有；先 scripts.js --add 骨架再重生成）'}`);
  line(`✅ 索引页：docs-new/05-scripts/README.md（覆盖率 + 全部已登记脚本）`);
  const hits = docMentions(id, binBase);
  line(`\n还提到过这个脚本的文档（${hits.length} 篇，按提及次数）：`);
  for (const h of hits) line(`  · ${String(h.n).padStart(3)}×  ${h.file}`);
  line(`\n别再从反编译重推这些（先读，再决定要不要补）：`);
  line(`  · docs-new/03-engine/opcode-table.md        （每条指令的语义）`);
  line(`  · docs-new/03-engine/sound-system.md        （SE/BGM/语音的统一 id 与通道口径）`);
  line(`  · docs-new/03-engine/input-system.md        （0xCD/0x12E/悬停与点击派发）`);
  line(`  · docs-new/03-engine/adv-text-rendering.md / message-config-gates.md（消息窗与显示闸门）`);
  line(`  · docs-new/03-engine/scene-start-flow.md    （场景切换/黑幕/资源生命周期）`);
  line(`  · docs-new/02-data/*.md                     （脚本引用的业务数据表）`);
  line(`  · docs-new/00-overview/{authority,conventions}.md（权威判定与数据分层纪律）`);
  if (srcFile) line(`\n真源：${path.relative(root, srcFile).replace(/\\/g, '/')}`);
}

function printSrc(scan, srcFile) {
  hr(`③ 真源骨架（只读扫描，用于决定"从哪一段开始读"）`);
  line(`行数：${scan.lines}   label：${scan.labels.length}   不同助记符：${scan.ops.size}`);
  const top = [...scan.ops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  line(`\n助记符直方图（前 25）：`);
  line('  ' + top.map(([k, v]) => `${k}×${v}`).join('  '));
  if (scan.labels.length) {
    line(`\nlabel 清单（前 30 / 共 ${scan.labels.length}）：`);
    const show = scan.labels.slice(0, 30).map((l) => `${l.name}@${l.n}`);
    for (let i = 0; i < show.length; i += 3) line('  ' + show.slice(i, i + 3).map((s) => s.padEnd(26)).join(''));
  }
  if (scan.calls.length) {
    line(`\ncall-script 出口（共 ${scan.calls.length}，前 40 —— 注释里常写着目标脚本名）：`);
    for (const c of scan.calls.slice(0, 40)) line(`  ${String(c.n).padStart(6)}  ${clip(c.text, 60).padEnd(62)} ${clip(c.note, 40)}`);
  }
  if (scan.audio.length) {
    line(`\n音频行（共 ${scan.audio.length}，前 30 —— play-sound-effect 的 op1 是**统一文件 id**）：`);
    for (const c of scan.audio.slice(0, 30)) line(`  ${String(c.n).padStart(6)}  ${clip(c.text, 60).padEnd(62)} ${clip(c.note, 40)}`);
  } else {
    line(`\n音频行：无。`);
  }
}

function printCallgraph(cg, id) {
  hr(`④ 调用关系（output/callgraph.json；没有就跑 node scripts/build-callgraph.mjs）`);
  if (!cg) {
    line(`⚠ 没有 output/callgraph.json`);
    return;
  }
  line(`谁 call 它（${cg.callers.length}）：${clip(cg.callers.join(', '), 600) || '—（可能是引擎直接进的，如 SYSTEM4/TITLE）'}`);
  line(`\n它 call 谁（${cg.callees.length}）：${clip(cg.callees.join(', '), 600) || '—'}`);
  if (cg.stats) line(`\n（统计：${cg.stats.dataScripts} 个脚本 / ${cg.stats.callScriptLines} 条 call-script 行 / 未解析目标 ${cg.stats.unresolvedTargets}）`);
}

function printTail() {
  hr(`收尾（改完台账必跑；否则守卫会因 md 不同步而红）`);
  line(`  node scripts/build-scripts.mjs                                                  # 重生成 docs-new/05-scripts/（勿手改 md）`);
  line(`  node .agents/skills/amayui-engine-analysis/scripts/scripts.js --validate        # 离线自检（锚点棘轮 / guards / 回链）`);
  line(`  cd app/amayui-emulator && npx tsx --test test/script-ledger.test.ts             # 守卫测试`);
  line(`\n引擎层结论别写进本层：函数/偏移 → report.js；常态行为 → capabilities.js；跨脚本叙述 → docs-new/03-engine/*.md（只回链）。`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const ledger = loadLedger();

if (opt.list) {
  const es = allEntries(ledger);
  line(`已登记 ${es.length} 条（覆盖 ${ledger.counts?.total ?? es.length}；分母见 README 的 941）：`);
  for (const e of es) line(`  ${String(e.status).padEnd(9)} ${String(e.id).padEnd(12)} ${String(e.bin ?? '').padEnd(20)} ${clip(e.role, 70)}`);
  process.exit(0);
}

const want = opt.file ? path.basename(String(opt.file)).replace(/\.txt$/i, '') : opt.id || pos[0];
if (!want) {
  console.error('用法：node brief.js <ID|文件名|bin 名>   |   node brief.js --list');
  process.exit(2);
}

const entry = resolveEntry(ledger, want);
const id = entry ? entry.id : String(want).replace(/\.(bin|txt)$/i, '');
const binBase = entry && entry.bin ? String(entry.bin).replace(/\.BIN$/i, '') : id;
const srcFile = (entry && entry.file && fs.existsSync(path.join(root, entry.file)) && path.join(root, entry.file)) || findSrcFile(id) || findSrcFile(want);

line(`\n████ 脚本分析·开工前一页纸：${id} ████`);

if (entry) {
  printEntry(entry);
} else {
  hr(`① 台账条目`);
  line(`⚠ **未登记**：analysis/scripts.json 里没有「${want}」。`);
  line(`  先建骨架（role/entry 各写一句话，status 先写 partial/stub，别留空）：`);
  line(`    node .agents/skills/amayui-engine-analysis/scripts/scripts.js --add '{"id":"${id}","file":"src/${id}.txt","bin":"${id}.BIN","role":"…","entry":"…","layout":[],"slots":[],"invariants":[],"gotchas":[],"gaps":["正文未读"],"links":{},"guards":[],"status":"stub","evidence":"","notes":"正文未读"}'`);
  line(`  然后读它 —— 但**先把下面 ② 的文档看完**，这个脚本可能已经在主题文档里被描述过。`);
}

printDocs(entry ?? {}, id, binBase, srcFile);

if (srcFile) {
  printSrc(scanSrc(srcFile), srcFile);
} else {
  hr(`③ 真源骨架`);
  line(`⚠ 没找到 src/${id}.txt —— 名字对吗？（带包前缀的写成 '$1$SC0330'；或用 --file src/XXX.txt）`);
}

printCallgraph(callgraphOf(entry ? keysOf(entry) : [id.toUpperCase()]), id);
printTail();

process.exit(entry ? 0 : 1);
