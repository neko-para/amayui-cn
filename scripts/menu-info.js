#!/usr/bin/env node
// 菜单文案信息：把运行时 dump 的菜单树（.tmp/menu-runtime.json）映射回
// AGERC.DLL 中的锚点（文件偏移 / 前导 id 字 / 所属 FONT 资源）。
//
// 用法：node menu-info.js [runtime-json] [dll]
//   默认：.tmp/menu-runtime.json 与 install/AGERC.DLL
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, INSTALL_DIR } from './config.js';

const jsonPath = process.argv[2] || path.join(ROOT_DIR, '.tmp', 'menu-runtime.json');
const dllPath = process.argv[3] || path.join(INSTALL_DIR, 'AGERC.DLL');

// FONT 110（主菜单）与 FONT 124（调试菜单）在文件中的区间（含资源头）
const RES = [
  { name: 'FONT110', start: 0xC66C4, end: 0xC6E30 },
  { name: 'FONT124', start: 0xC6E30, end: 0xC6F70 },
];

function resOf(off) {
  const r = RES.find((r) => off >= r.start && off < r.end);
  return r ? r.name : 'other';
}

function toBytes(text) {
  return Buffer.from([...text].map((c) => c.charCodeAt(0)).flatMap((u) => [u & 0xff, u >> 8]));
}

function findAnchors(data, text) {
  const pat = toBytes(text);
  if (pat.length === 0) return []; // 分隔线等空文本无锚点
  const hits = [];
  let pos = 0;
  while (true) {
    const i = data.indexOf(pat, pos);
    if (i < 0) break;
    hits.push(i);
    pos = i + 1;
  }
  return hits;
}

function wordAt(data, off) {
  if (off < 0 || off + 2 > data.length) return null;
  return data.readUInt16LE(off);
}

function main() {
  if (!fs.existsSync(jsonPath)) {
    console.error(`runtime json not found: ${jsonPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(dllPath)) {
    console.error(`dll not found: ${dllPath}`);
    process.exit(1);
  }
  const tree = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const dll = fs.readFileSync(dllPath);

  const rows = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const hits = findAnchors(dll, node.text);
      const children = node.items === undefined ? [] : (Array.isArray(node.items) ? node.items : [node.items]);
      const isPopup = children.length > 0;
      const detail = hits.length ? hits.map((h) => {
        const idw = wordAt(dll, h - 2);
        const idDesc = idw !== null ? `0x${idw.toString(16).toUpperCase().padStart(4, '0')}` : '-';
        return `0x${h.toString(16).toUpperCase()}[${resOf(h)} pre=${idDesc}]`;
      }) : (node.text === '' ? ['<separator>'] : ['<not in dll>']);
      rows.push({
        depth,
        role: isPopup ? 'popup' : node.text === '' ? 'sep' : 'item',
        text: node.text,
        anchors: detail,
      });
      if (children.length) walk(children, depth + 1);
    }
  };
  walk(tree, 0);

  for (const r of rows) {
    const indent = '  '.repeat(r.depth);
    console.log(`${indent}${r.role.padEnd(5)} ${JSON.stringify(r.text)}`);
    for (const a of r.anchors) console.log(`${indent}       -> ${a}`);
  }
  console.log(`\ntotal entries: ${rows.length}`);
}

main();
