import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { RES_DIR } from '../config.js';

// 简体中文 → SJIS 码位映射（与上游 SExtractor 的 generateSubsJis 同一机制，字典已内置于 res/）
// 规则：字符本身可 cp932 编码 → 原样保留；
//       否则查 res/subs_cn_jp.json（简体→日文写法）→ 用日文写法占位，渲染时由 cnjp 字体还原。
const SUBS_PATH = path.join(RES_DIR, 'subs_cn_jp.json');

let subs = null;
function loadSubs() {
  if (!subs) subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));
  return subs;
}

export function canEncodeCp932(ch) {
  if (ch === '?') return true;
  const b = iconv.encode(ch, 'cp932');
  return !(b.length === 1 && b[0] === 0x3f);
}

// 将简体译文映射为“SJIS 可编码文本”（写入 txt 的内容）。
// 返回 { text, problems }；problems 列出无法映射的字符（默认替换为全角空格并标记）。
export function mapToSjis(text) {
  const dict = loadSubs();
  let out = '';
  const problems = [];
  for (const ch of text) {
    if (canEncodeCp932(ch)) {
      out += ch;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(dict, ch)) {
      const jp = dict[ch];
      if (canEncodeCp932(jp)) {
        out += jp;
        continue;
      }
      problems.push(`U+${ch.codePointAt(0).toString(16).toUpperCase()} ${ch} → ${jp}（映射目标不可编码）`);
    } else {
      problems.push(`U+${ch.codePointAt(0).toString(16).toUpperCase()} ${ch}（字典缺失）`);
    }
    out += '　';
  }
  return { text: out, problems };
}

// 校验整段文本是否可 cp932 编码（apply 之后、汇编之前的兜底检查）
// 注意：U+E000–U+E757 是游戏外字区（SJIS 0xF040–0xF9FC），Decompiler 可无损往返，放行。
export function validateSjis(text) {
  const bad = [];
  for (const ch of text) {
    const o = ch.codePointAt(0);
    if (o < 0x80) continue;
    if (0xE000 <= o && o <= 0xE757) continue;
    if (!canEncodeCp932(ch)) bad.push(`U+${o.toString(16).toUpperCase()} ${ch}`);
  }
  return bad;
}
