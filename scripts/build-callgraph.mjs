#!/usr/bin/env node
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
/*  build-callgraph.mjs                                                                               */
/*  目的：扫描全部反汇编脚本里的 call-script 指令，构造「脚本 调用脚本」的有向图（SYS4INI 索引层）。    */
/*  输出：output/callgraph-dot.gv（graphviz DOT）、output/callgraph.html（@viz-js/viz 渲染，自包含）、  */
/*        output/callgraph.json（边/解析统计/家族一致性）。                                              */
/*  说明：                                                                                              */
/*   - call-script 参数 = SYS4INI.BIN 文件索引（base）或 APPENDnn.AAI 索引（0xnn000000 + pos），已验证。  */
/*   - SC/SG/SP/SN 家族成员若调用链完全一致，则折叠成一个占位节点（SCXXXX/SGXXXX/SPXXXX/SNXXXX）。       */
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlzss } from './alf/lzss.mjs';
import { instance } from '@viz-js/viz';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(ROOT, 'raw');
const OUT_DIR = path.join(ROOT, 'output');

// ============================================================================
// 1) SYS4INI / APPEND 索引解析（index -> filename）
// ============================================================================

function readBytesAt(fd, position, size) {
  const b = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = fs.readSync(fd, b, off, size - off, position + off);
    if (n <= 0) break;
    off += n;
  }
  return b;
}
function decodeAnsi(buf, offset, byteLen) {
  const limit = offset + byteLen;
  let end = offset;
  while (end < limit && buf[end] !== 0) end++;
  return buf.toString('latin1', offset, end);
}
function read_sect(fd, sectionPos) {
  const hdr = readBytesAt(fd, sectionPos, 12);
  const orig = hdr.readUInt32LE(0);
  const len = hdr.readUInt32LE(8);
  const buff = readBytesAt(fd, sectionPos + 12, len);
  const out = Buffer.alloc(orig);
  unlzss(buff, len, out, orig);
  return out;
}
function parseToc(toc) {
  const ARCENTRY = 256, FILENTRY = 80;            // S4（ANSI）结构
  const arcCount = toc.readUInt32LE(0);
  const filhdrBase = 4 + arcCount * ARCENTRY;
  const filBase = filhdrBase + 4;
  const filCount = toc.readUInt32LE(filhdrBase);
  const names = [];
  for (let i = 0; i < filCount; i++) {
    const off = filBase + i * FILENTRY;
    names.push(decodeAnsi(toc, off, 64));
  }
  return { arcCount, filCount, names };
}
function parseIndex(file, isS4AC) {
  const fd = fs.openSync(file, 'r');
  const sectionPos = isS4AC ? 268 : 300;
  const toc = read_sect(fd, sectionPos);
  fs.closeSync(fd);
  return parseToc(toc);
}

// base 名字表 + append 各包名字表
const base = parseIndex(path.join(RAW_DIR, 'SYS4INI.BIN'), false);
const appendPacks = [];
for (let n = 1; n <= 5; n++) {
  const f = path.join(RAW_DIR, `APPEND${String(n).padStart(2, '0')}.AAI`);
  if (fs.existsSync(f)) appendPacks[n] = parseIndex(f, true);
}

// 文件名 -> 便于显示的节点名（去扩展、去路径）；目标文件名保留大写
function nodeOf(name) {
  return String(name).replace(/\.(BIN|BIN|AGF|ALF)$/i, '').toUpperCase();
}

// 解析 call-script 索引值 -> { name, node }
function resolveIndex(rawVal) {
  const v = parseInt(rawVal, 16);
  if (v < base.filCount) {
    const n = nodeOf(base.names[v]);
    return { raw: rawVal, dec: v, node: n, name: base.names[v], kind: scriptKind(base.names[v]) };
  }
  const apn = Math.floor(v / 0x1000000);
  const pos = v - apn * 0x1000000;
  const pack = appendPacks[apn];
  if (apn >= 1 && apn <= 5 && pack && pos < pack.filCount) {
    const n = nodeOf(pack.names[pos]);
    return { raw: rawVal, dec: v, node: n, name: pack.names[pos], kind: scriptKind(pack.names[pos]), append: apn, pos };
  }
  // 超过 0xA00000 且 < 0x1000000 的（历史 5 位十六进制索引，有些脚本用 0x1000xx）
  if (v <= 0xFFFFFF) {
    const n = nodeOf(`IDX_${rawVal}`);
    return { raw: rawVal, dec: v, node: n, name: null, kind: 'unknown' };
  }
  return { raw: rawVal, dec: v, node: `UNRES_${rawVal}`, name: null, kind: 'unknown' };
}

function scriptKind(name) {
  if (!name) return 'unknown';
  const baseName = name.replace(/\.[^.]+$/, '').toUpperCase();
  const bare = baseName.replace(/^\$\d+\$/, '');           // 去掉 $n$ 前缀
  const m = bare.match(/^([A-Z]+?)(\d+)/);
  return m ? m[1] : 'other';
}

// ============================================================================
// 2) 扫描 data/*.txt，收集 call-script 边
// ============================================================================

const callScriptRe = /call-script\s+(\([^)]*\)|[0-9a-fA-F]+)/g;
const edgesMap = new Map();      // caller -> Set(callee)
const dynamicCount = new Map();  // caller -> 动态 call-script (global) 数量
const unresolved = [];           // 未能解析的目标
const allCallers = new Set();

function scanDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.txt')) continue;
    const caller = nodeOf(f.replace(/\.txt$/, '.BIN'));
    allCallers.add(caller);
    const text = fs.readFileSync(path.join(dir, f), 'latin1');
    let m;
    let has = false;
    while ((m = callScriptRe.exec(text)) !== null) {
      const operand = m[1];
      if (operand.startsWith('(')) {
        dynamicCount.set(caller, (dynamicCount.get(caller) || 0) + 1);
        continue;
      }
      const r = resolveIndex(operand);
      if (r.kind === 'unknown') unresolved.push({ caller, raw: operand, dec: r.dec, name: r.name });
      if (!r.node) continue;
      if (!edgesMap.has(caller)) edgesMap.set(caller, new Set());
      edgesMap.get(caller).add(r.node);
      has = true;
    }
  }
}
scanDir(DATA_DIR);

// 规整：把每个 call 的目标去重
const edges = [];
for (const [caller, callees] of edgesMap) {
  for (const c of callees) edges.push({ caller, callee: c, targetKind: scriptKind(c) });
}

// ============================================================================
// 3) SC/SG/SP/SN 家族一致性与折叠
// ============================================================================

const FAMILIES = ['SC', 'SG', 'SP', 'SN'];
// 按家族分组 caller（去 $n$ 前缀后取前缀）
function familyOf(caller) {
  const bare = caller.replace(/^\$\d+\$/, '');
  const m = bare.match(/^([A-Z]+?)(\d+)/);
  return m ? m[1] : null;
}

const collapseInfo = {};   // family -> {consistent, memberCount, calleeSet:[...], distinctSets}
const collapsed = new Set(); // 被折叠的 caller 名
const household = new Map(); // family -> placeholder node name

for (const fam of FAMILIES) {
  const members = [...allCallers].filter((c) => familyOf(c) === fam);
  if (members.length === 0) { collapseInfo[fam] = { consistent: true, memberCount: 0, collapsed: true }; continue; }

  // 每个成员的 callee 集合
  const memberCallees = members.map((c) => ({
    caller: c,
    set: [...(edgesMap.get(c) || [])].sort(),
  }));
  const nonEmpty = memberCallees.filter((x) => x.set.length > 0);
  // 一致性：所有成员的 callee 集合完全相同（都为空也算一致）
  const distinct = new Set(memberCallees.map((x) => JSON.stringify(x.set)));
  const consistent = distinct.size === 1;

  if (consistent) {
    const place = `${fam}XXXX`;
    household.set(fam, place);
    for (const x of memberCallees) collapsed.add(x.caller);
    collapseInfo[fam] = {
      consistent: true,
      memberCount: members.length,
      calleeSet: memberCallees[0] ? memberCallees[0].set : [],
      placeholder: place,
    };
  } else {
    collapseInfo[fam] = {
      consistent: false,
      memberCount: members.length,
      distinctSets: distinct.size,
      nonEmptyMembers: nonEmpty.length,
      emptyMembers: memberCallees.length - nonEmpty.length,
    };
  }
}

// ============================================================================
// 4) 生成 DOT —— 两种视图
//     a) 完整视图（callgraph-full.*）：只折叠一致的 SG/SP/SN；SC 保持逐个（异构）。
//     b) 架构视图（callgraph.*）：把 SC/SG/SP/SN 都折叠成占位节点；仅显示“重要节点”
//        （框架枢纽 + 系统/入口脚本），次要目标聚合为「×N 其他」。
// ============================================================================

function dotId(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

// 完整的 callers + callee 集合
const fullVertices = new Set();
for (const e of edges) { fullVertices.add(e.caller); fullVertices.add(e.callee); }

const styleFor = (n) => {
  if (/^(SC|SG|SP|SN)XXXX$/.test(n)) return ['#ffe9b3', 'bold'];          // 占位家族
  if (n.startsWith('$')) return ['#f3e8ff', ''];                            // append 包
  const fam = familyOf(n);
  if (fam === 'SC') return ['#fff2cc', ''];
  if (fam === 'SG' || fam === 'SP' || fam === 'SN') return ['#e0f0e8', ''];
  if (/^(DEAL|ROOM|GEOM|FIELD|REIGN|STUDIO|NOVEL|ALLMAP|INIT|SYSTEM4|GAMESTART|TITLE|LOGO|SETROOM|MENU|SAVE|CONFIG|INFO|QUIT|HISTORY|CHARMEDIT|DRAWCHARM|SBUNKI|BUNKI|SETWEATHER|SETCHARM|HIDEWIN|SHOWPOP|REPLAYVOICE|ADDDP|COMMITDR|RENDERMAP|LOOK|UNITECH|LOADCHARM|INITCHARM|SETFATE|CHECKCONFIG|INITCONFIG|SETROOM|STAGEREADY|STAGEROUND|STAGECLOSE)$/.test(n)) return ['#cfe4ff', 'bold'];
  return ['#eef3ff', ''];
};

// ---------- (a) 完整视图 ----------
function buildFullDot() {
  const vertices = new Set(fullVertices);
  for (const c of collapsed) vertices.delete(c);
  for (const fam of FAMILIES) if (household.has(fam)) vertices.add(household.get(fam));

  const L = [];
  L.push('digraph callgraph {');
  L.push('  rankdir=LR;');
  L.push('  node [shape=box, style="rounded,filled", fillcolor="#eef3ff", fontname="Segoe UI, Arial"];');
  L.push('  edge [color="#8899aa", arrowsize=0.7];');
  L.push('  bgcolor="white";');
  for (const v of vertices) {
    const [f, b] = styleFor(v);
    const label = household.has(v) ? `${v}\n(×${collapseInfo[v.replace(/XXXX$/, '')]?.memberCount || ''})` : v;
    L.push(`  ${dotId(v)} [fillcolor="${f}"${b ? `, fontweight="${b}"` : ''}, label=${dotId(label)}];`);
  }
  for (const e of edges) {
    if (collapsed.has(e.caller)) continue;
    if (!vertices.has(e.caller) || !vertices.has(e.callee)) continue;
    L.push(`  ${dotId(e.caller)} -> ${dotId(e.callee)};`);
  }
  for (const fam of FAMILIES) {
    const info = collapseInfo[fam];
    if (!info || !info.consistent || !info.memberCount) continue;
    const place = household.get(fam);
    for (const callee of info.calleeSet) if (vertices.has(callee)) L.push(`  ${dotId(place)} -> ${dotId(callee)};`);
  }
  L.push('}');
  return L.join('\n');
}

// ---------- (b) 架构视图：聚合 + 折叠 + 重要节点 ----------
function buildArchDot() {
  // 每个(调用者 -> 目标)汇总；计算每个节点的总度数
  const outDeg = {}, inDeg = {};
  for (const e of edges) {
    outDeg[e.caller] = (outDeg[e.caller] || 0) + 1;
    inDeg[e.callee] = (inDeg[e.callee] || 0) + 1;
  }
  const deg = {};
  for (const v of [...new Set([...Object.keys(outDeg), ...Object.keys(inDeg)])]) deg[v] = (outDeg[v] || 0) + (inDeg[v] || 0);

  // 重要节点：家族占位 + 系统/入口(黑名单词) + 高总度数
  const SYSTEM_RE = /^(DEAL|ROOM|GEOM|FIELD|REIGN|STUDIO|NOVEL|ALLMAP|INIT|SYSTEM4|GAMESTART|TITLE|LOGO|SETROOM|MENU|SAVE|CONFIG|INFO|QUIT|HISTORY|CHARMEDIT|DRAWCHARM|SBUNKI|BUNKI|SETWEATHER|SETCHARM|HIDEWIN|SHOWPOP|REPLAYVOICE|ADDDP|COMMITDR|RENDERMAP|LOOK|UNITECH|LOADCHARM|INITCHARM|SETFATE|CHECKCONFIG|INITCONFIG|SETCHARM|STAGEREADY|STAGEROUND|STAGECLOSE)$/;
  const THRESHOLD = 24;
  // placeholders for ALL families (SC 也折叠，标注异构)
  const placeholders = new Map();
  for (const fam of FAMILIES) {
    const info = collapseInfo[fam];
    if (!info || !info.memberCount) continue;
    const cond = info.consistent ? info.calleeSet : [...new Set(memberCalleesUnion(fam))];
    placeholders.set(fam, { name: `${fam}XXXX`, callees: cond, info });
  }

  function memberCalleesUnion(fam) {
    const s = new Set();
    for (const [caller, set] of edgesMap) if (familyOf(caller) === fam) for (const c of set) s.add(c);
    return [...s];
  }

  const keep = new Set();
  for (const fam of FAMILIES) if (placeholders.has(fam)) keep.add(placeholders.get(fam).name);
  for (const v of fullVertices) {
    if (SYSTEM_RE.test(v)) keep.add(v);
    else if (deg[v] >= THRESHOLD) keep.add(v);
  }
  // 聚合非重要目标：为每个调用方产生一条到「OTHER」的聚合边
  const otherNode = 'OTHER_SCRIPTS';
  keep.add(otherNode);
  const otherEdges = new Map();   // caller -> count 被聚合的目标

  function otherOf(v) { return familyOf(v) ? `${familyOf(v)}*` : null; }

  const L = [];
  L.push('digraph arch {');
  L.push('  rankdir=LR;');
  L.push('  node [shape=box, style="rounded,filled", fillcolor="#eef3ff", fontname="Segoe UI, Arial"];');
  L.push('  edge [color="#8899aa", arrowsize=0.7];');
  L.push('  bgcolor="white";');
  L.push('  compound=true;');

  // 节点声明
  for (const fam of placeholders.keys()) {
    const p = placeholders.get(fam);
    const mark = p.info.consistent ? '' : '\n(异构, ×' + p.info.memberCount + ')';
    const label = `${p.name}${mark}`;
    L.push(`  ${dotId(p.name)} [fillcolor="#ffe9b3", fontweight="bold", label=${dotId(label)}];`);
  }
  const keptNodes = [...keep];
  for (const v of keptNodes) {
    if (v === otherNode || placeholders.has(v.replace(/XXXX$/, ''))) continue;
    const [f, b] = styleFor(v);
    L.push(`  ${dotId(v)} [fillcolor="${f}"${b ? `, fontweight="${b}"` : ''}, label=${dotId(v)}];`);
  }

  // 边：caller/占位 -> callee/重要目标
  const used = new Set();
  function addEdge(a, b, extra = '') {
    const key = `${a}->${b}`;
    if (used.has(key)) return;
    used.add(key);
    L.push(`  ${dotId(a)} -> ${dotId(b)}${extra};`);
  }

  // 处理家族占位的边
  for (const fam of placeholders.keys()) {
    const p = placeholders.get(fam);
    let agg = 0;
    for (const callee of p.callees) {
      if (keep.has(callee) && callee !== otherNode) addEdge(p.name, callee);
      else agg++;
    }
    if (agg > 0) { otherEdges.set(p.name, (otherEdges.get(p.name) || 0) + agg); }
  }
  // 处理非占位的 keep 节点作为 caller 的边
  for (const [caller, set] of edgesMap) {
    if (collapsed.has(caller)) continue;                       // 被一致折叠的 SG/SP/SN 成员，由占位代表
    if (placeholders.has(familyOf(caller))) continue;            // 家族成员一律由占位代表
    if (!keep.has(caller) || caller === otherNode) continue;
    let agg = 0;
    for (const c of set) {
      if (keep.has(c) && c !== otherNode) addEdge(caller, c);
      else agg++;
    }
    if (agg > 0) otherEdges.set(caller, (otherEdges.get(caller) || 0) + agg);
  }
  // OTHER 节点
  L.push(`  ${dotId(otherNode)} [shape=diamond, style="filled", fillcolor="#eeeeee", label="其他脚本\\n(×合计 ${[...otherEdges.values()].reduce((a, b) => a + b, 0)})"];`);
  for (const [caller, cnt] of otherEdges) {
    addEdge(caller, otherNode, ` [style=dashed, color="#bbbbbb", label="×${cnt}"]`);
  }
  L.push('}');
  return L.join('\n');
}

const dotFull = buildFullDot();
const dotArch = buildArchDot();
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'callgraph-dot.gv'), dotFull);
fs.writeFileSync(path.join(OUT_DIR, 'callgraph-arch-dot.gv'), dotArch);

// ============================================================================
// 5) 渲染 SVG + 生成 HTML
// ============================================================================

const viz = await instance();
const svgArch = viz.renderString(dotArch, { format: 'svg', engine: 'dot' });
const svgFull = viz.renderString(dotFull, { format: 'svg', engine: 'dot' });

const stats = {
  dataScripts: allCallers.size,
  callScriptLines: edges.length + [...dynamicCount.values()].reduce((a, b) => a + b, 0),
  resolvedCallees: new Set(edges.map((e) => e.callee)).size,
  distinctCallers: new Set(edges.map((e) => e.caller)).size,
  dynamicCallers: dynamicCount.size,
  unresolvedTargets: unresolved.length,
  families: collapseInfo,
};

fs.writeFileSync(path.join(OUT_DIR, 'callgraph.json'), JSON.stringify({ stats, edges, dynamicCount: Object.fromEntries(dynamicCount), unresolved }, null, 2));

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const famRows = FAMILIES.map((fam) => {
  const i = collapseInfo[fam];
  if (!i) return `<tr><td>${fam}</td><td>—</td></tr>`;
  const tail = i.consistent
    ? (i.memberCount ? `一致 ✅（${i.memberCount} 个，调用 ${i.calleeSet.length} 个目标）` : '无成员')
    : `不一致 ❌（${i.memberCount} 个成员，${i.distinctSets} 种调用集；有调用 ${i.nonEmptyMembers}，无调用 ${i.emptyMembers}）`;
  return `<tr><td>${fam}XXXX</td><td>${tail}</td></tr>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>天結 CALL-SCRIPT 调用图</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; padding: 24px; color: #223; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: #667; font-size: 13px; margin-bottom: 18px; }
  table.stats { border-collapse: collapse; font-size: 13px; margin-bottom: 18px; }
  table.stats td, table.stats th { border: 1px solid #ccd; padding: 6px 12px; text-align: left; }
  table.stats th { background: #f4f6fb; }
  .legend { font-size: 12px; color: #556; margin-bottom: 14px; }
  .legend b { font-weight: 600; }
  .svgwrap { border: 1px solid #dde3ee; border-radius: 8px; padding: 12px; background: #fff; overflow: auto; }
  .svgwrap svg { width: 100%; height: auto; }
</style>
</head>
<body>
<h1>天結いキャッスルマイスター — CALL-SCRIPT 调用图</h1>
<div class="sub">
  ${esc(`脚本总数 ${stats.dataScripts}；call-script 指令 ${stats.callScriptLines}；已解析目标 ${stats.resolvedCallees}；含动态(call-script global)调用的脚本 ${stats.dynamicCallers}；未解析目标 ${stats.unresolvedTargets}`)}
</div>
<table class="stats">
  <tr><th>占位家族</th><th>折叠判定</th></tr>
  ${famRows}
</table>
<div class="legend">
  <b>图例</b>：蓝=系统/框架脚本；黄=SC 剧情；绿=SG/SP/SN；浅紫=$n$ 追加包；橙=占位家族（调用链一致时折叠）；箭头 <code>caller → callee</code>。
</div>
<div class="svgwrap">${svgArch}</div>
</body>
</html>`;
fs.writeFileSync(path.join(OUT_DIR, 'callgraph.html'), html);

// 完整视图（SC 逐个保留）
const fullHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>天結 CALL-SCRIPT 调用图（完整）</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; padding: 24px; color: #223; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: #667; font-size: 13px; margin-bottom: 16px; }
  .svgwrap { border: 1px solid #dde3ee; border-radius: 8px; padding: 12px; background: #fff; overflow: auto; }
  .svgwrap svg { width: 100%; height: auto; }
</style>
</head>
<body>
<h1>天結いキャッスルマイスター — CALL-SCRIPT 调用图（完整，SC 未折叠）</h1>
<div class="sub">SG/SP/SN 调用链一致，已折叠为占位；SC 调用链不一致（121 种），逐个保留。DOT 源：<code>callgraph-dot.gv</code>。</div>
<div class="svgwrap">${svgFull}</div>
</body>
</html>`;
fs.writeFileSync(path.join(OUT_DIR, 'callgraph-full.html'), fullHtml);

console.log('===== 统计 =====');
console.log('data 脚本数:', stats.dataScripts);
console.log('call-script 边数(已解析):', edges.length, ' 去重后目标:', stats.resolvedCallees);
console.log('发起调用的脚本数:', stats.distinctCallers, ' 含动态调用的脚本数:', stats.dynamicCallers, ' 未解析目标:', stats.unresolvedTargets);
for (const fam of FAMILIES) {
  const i = collapseInfo[fam];
  if (i) {
    if (i.consistent && i.memberCount) console.log(`  ${fam}XXXX: 一致 ✅ ${i.memberCount} 个成员 -> ${i.calleeSet.length} 个目标`);
    else if (i.consistent) console.log(`  ${fam}XXXX: 无成员`);
    else console.log(`  ${fam}XXXX: 不一致 ❌ ${i.memberCount} 成员 / ${i.distinctSets} 种调用集`);
  }
}
console.log('DOT  ->', path.join(OUT_DIR, 'callgraph-dot.gv'));
console.log('HTML ->', path.join(OUT_DIR, 'callgraph.html'));
