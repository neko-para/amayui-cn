// 折行核心：把一段文案（可含 <ruby> 注音标注与 <nb> 不折行标注）按
// “每行最多 maxLen 个中文字（默认 25，ASCII 按半个中文宽度计）”排版，
// 输出标准游戏脚本指令行。
//
// 规则：
//   1. 单行总长度 ≤ maxLen 个中文字（默认 25；内部按 1 中文字 = 2 显示单位计）；
//   2. 有标注（<ruby>）的内容整体不折行；
//   3. 连续词语尽量不折行：<nb> 区域、术语表词条、引号实体、拉丁/数字串均视为原子；
//   4. 贪心排版：当前行放不下下一个词时提前折行；
//   5. 输入允许携带 <nb>…</nb> 声明特定区域不得折行。
//   6. 页面最后一行不加 end-text-line（保留 concat 镜像；对应原文结构，行由
//      wait-for-input 后的 end-text-line 收尾）；
//   7. 若最后一行 ≤5 个字符（孤行），递减单行最大长度重新排版，最多重试 3 次。
//   8. 输出首行为单行注释 `// 输入原文：<输入文案>`（含 ruby 标记），
//      便于后续把正文还原为排版前原文再重新排版。
//
// 输出约定（与 src 翻译语法一致）：
//   - 普通文本  → show-text 0 @"…"
//   - <ruby>…<rt>…</rt></ruby> → display-furigana 0 @"主词" @"注音"
//   - 每个视觉行末尾：concat (global-string bba) (global-string bba) @"最后一段"；
//     非末行追加 end-text-line 0，页面最后一行不加

export const DEFAULT_MAX = 25;

export function charWidth(ch) {
  const c = ch.codePointAt(0);
  // 全角：CJK、CJK 标点/符号、全角形式、以及破折号/省略号/弯引号等常用中文标点
  if (
    (c >= 0x2e80 && c <= 0x9fff) ||
    (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x2000 && c <= 0x206f) ||
    (c >= 0xf900 && c <= 0xfaff)
  ) {
    return 2;
  }
  return 1;
}

export function strWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

const MARKUP_RE = /<ruby>([^<]*)<rt>([^<]*)<\/rt><\/ruby>|<nb>([^<]*)<\/nb>/g;
const OPEN_CLOSE = { '「': '」', '『': '』', '（': '）', '(': ')', '【': '】' };
const PUNCT = new Set('，。、；：！？…—·「」『』（）《》〈〉【】');
const LATIN_RE = /^[A-Za-z0-9][A-Za-z0-9%.\-+]*/;

function pushPlain(tokens, seg, glossary) {
  const n = seg.length;
  let i = 0;
  while (i < n) {
    const ch = seg[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // 术语表词条（调用方需按长度降序传入）
    let gl = null;
    if (glossary) {
      for (const g of glossary) {
        if (seg.startsWith(g, i)) {
          gl = g;
          break;
        }
      }
    }
    if (gl) {
      tokens.push({ type: 'plain', text: gl, w: strWidth(gl), atomic: true });
      i += gl.length;
      continue;
    }
    // 引号实体（如 『因夫鲁斯王国』）整体不折行
    const closer = OPEN_CLOSE[ch];
    if (closer) {
      const j = seg.indexOf(closer, i + 1);
      if (j >= 0) {
        const t = seg.slice(i, j + 1);
        tokens.push({ type: 'plain', text: t, w: strWidth(t), atomic: true });
        i = j + 1;
        continue;
      }
    }
    // 拉丁/数字串
    const lm = LATIN_RE.exec(seg.slice(i));
    if (lm) {
      tokens.push({ type: 'plain', text: lm[0], w: lm[0].length, atomic: true });
      i += lm[0].length;
      continue;
    }
    // 标点：粘到前一个 token 的尾部（避免行首出现标点）
    if (PUNCT.has(ch)) {
      const prev = tokens[tokens.length - 1];
      if (prev) {
        prev.tail = (prev.tail || '') + ch;
        prev.w += charWidth(ch);
      } else {
        tokens.push({ type: 'plain', text: ch, w: charWidth(ch) });
      }
      i++;
      continue;
    }
    // 普通 CJK 单字
    tokens.push({ type: 'plain', text: ch, w: charWidth(ch) });
    i++;
  }
}

export function tokenize(text, glossary = []) {
  const tokens = [];
  let last = 0;
  MARKUP_RE.lastIndex = 0;
  let m;
  while ((m = MARKUP_RE.exec(text))) {
    pushPlain(tokens, text.slice(last, m.index), glossary);
    if (m[1] !== undefined) {
      tokens.push({ type: 'ruby', main: m[1], rt: m[2], w: strWidth(m[1]) });
    } else {
      tokens.push({ type: 'nb', text: m[3], w: strWidth(m[3]) });
    }
    last = MARKUP_RE.lastIndex;
  }
  pushPlain(tokens, text.slice(last), glossary);
  return tokens;
}

function splitByWidth(text, maxLen) {
  const out = [];
  let cur = '';
  let w = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (w + cw > maxLen && cur) {
      out.push(cur);
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur) out.push(cur);
  return out;
}

// 贪心排版：放不下就提前折行。maxLen 单位为“中文字数”（内部按 ×2 显示单位比较）。
export function breakLines(tokens, maxLen = DEFAULT_MAX) {
  const maxUnits = maxLen * 2;
  const lines = [];
  let cur = [];
  let curW = 0;
  const flush = () => {
    if (cur.length) {
      lines.push(cur);
      cur = [];
      curW = 0;
    }
  };
  for (const t of tokens) {
    if (cur.length && curW + t.w > maxUnits) flush();
    if (!cur.length && t.w > maxUnits) {
      if (t.type === 'ruby' || t.type === 'nb') {
        // 标注/不折行内容不允许拆分：独立成行（可能超限，调用方自行处理）
        lines.push([t]);
        continue;
      }
      for (const piece of splitByWidth(t.text, maxUnits)) {
        lines.push([{ type: 'plain', text: piece, w: strWidth(piece) }]);
      }
      continue;
    }
    cur.push(t);
    curW += t.w;
  }
  flush();
  return lines;
}

export function emitLine(tokens, { concat = true, endTextLine = true } = {}) {
  const out = [];
  let lastShow = '';
  let buf = '';
  const flushBuf = () => {
    if (buf) {
      out.push(`show-text 0 @"${buf}"`);
      lastShow = buf;
      buf = '';
    }
  };
  for (const t of tokens) {
    if (t.type === 'ruby') {
      flushBuf();
      out.push(`display-furigana 0 @"${t.main}" @"${t.rt}"`);
      lastShow = t.main;
      if (t.tail) {
        out.push(`show-text 0 @"${t.tail}"`);
        lastShow = t.tail;
      }
    } else {
      buf += (t.text || '') + (t.tail || '');
    }
  }
  flushBuf();
  if (concat && lastShow && /[^\s，。、；：！？…—·]/.test(lastShow)) {
    out.push(`concat (global-string bba) (global-string bba) @"${lastShow}"`);
  }
  if (endTextLine) out.push('end-text-line 0');
  return out;
}

function lineCharCount(line) {
  let n = 0;
  for (const t of line) {
    if (t.type === 'ruby') {
      n += [...t.main].length + (t.tail ? [...t.tail].length : 0);
    } else {
      n += [...(t.text || '')].length + (t.tail ? [...t.tail].length : 0);
    }
  }
  return n;
}

// 一段文案 → 标准脚本指令行列表（页面最后一行不加 end-text-line）
export function reflow(text, opts = {}) {
  let maxLen = opts.maxLen ?? DEFAULT_MAX;
  const glossary = (opts.glossary ?? []).slice().sort((a, b) => b.length - a.length);
  const tokens = tokenize(text, glossary);
  let lines = breakLines(tokens, maxLen);
  // 孤行优化：最后一行 ≤5 字且行数 ≥2 时，递减行宽重排，最多重试 3 次
  for (let attempt = 0; attempt < 3 && lines.length >= 2 && lineCharCount(lines[lines.length - 1]) <= 5 && maxLen > 10; attempt++) {
    maxLen -= 1;
    lines = breakLines(tokens, maxLen);
  }
  const flat = [];
  if (opts.sourceComment !== false) {
    const src = String(text).replace(/\r?\n/g, '').trim();
    if (src) flat.push(`// 输入原文：${src}`);
  }
  for (let k = 0; k < lines.length; k++) {
    flat.push(...emitLine(lines[k], { concat: opts.concat !== false, endTextLine: k < lines.length - 1 }));
  }
  return flat;
}
