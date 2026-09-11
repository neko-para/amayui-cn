/**
 * 文本排版模型单测（S1）。
 *
 * 断言的每一条都对应引擎的一条 raw 事实（见 `src/text/layout.ts` 的注释）：
 * 等宽网格、边界硬断、无禁则、注音配对、竖排换列、对齐。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  defaultWinStyle,
  layoutWindow,
  sjisBytes,
  textWidth,
  visibleInLine,
  type MsgWinInput,
} from '../src/text/layout.js';
import { fontFaceFor, normalizeFace, resolveFace } from '../src/text/fontSet.js';

const input = (over: {
  text: string;
  ruby?: [string, string][];
  lineEnded?: boolean;
  style?: Partial<MsgWinInput['style']>;
}): MsgWinInput => {
  const st = { ...defaultWinStyle(), ...(over.style ?? {}) };
  if (!over.style?.main && over.style?.main) throw new Error('unreachable');
  return {
    style: st,
    segments: [{ text: over.text, ruby: over.ruby ?? [], lineEnded: over.lineEnded ?? false }],
  };
};

test('sjisBytes / advance：全角 1em、半角 0.5em（引擎 lfWidth = 字高/2）', () => {
  assert.equal(sjisBytes('A'), 1);
  assert.equal(sjisBytes('ｱ'), 1); // 半角片假名
  assert.equal(sjisBytes('天'), 2);
  assert.equal(advance('A', 30), 15);
  assert.equal(advance('天', 30), 30);
  assert.equal(textWidth('天A結', 30), 75);
});

test('边界硬断：越过 wrapRight 即换行，且不产生禁则', () => {
  // 窗宽 100、字号 30 ⇒ 每行 3 个全角字（30*3=90 ≤ 100 < 120）
  const f = layoutWindow(1, input({ text: 'あいうえおか', style: { wrapRight: 100, wrapBottom: 720 } }));
  assert.deepEqual(
    f.lines.map((l) => l.text),
    ['あいう', 'えおか'],
  );
  assert.deepEqual(
    f.lines.map((l) => l.width),
    [90, 90],
  );
  // 行首禁则不存在：标点可以落在行首（引擎无禁则表）
  const g = layoutWindow(1, input({ text: 'あい。', style: { wrapRight: 60, wrapBottom: 720 } }));
  assert.deepEqual(
    g.lines.map((l) => l.text),
    ['あい', '。'],
  );
});

test('半角字按 0.5em 排：一行可容纳 "A"×6 或全角×3', () => {
  const f = layoutWindow(1, input({ text: 'AAAAAAA', style: { wrapRight: 100, wrapBottom: 720 } }));
  assert.deepEqual(
    f.lines.map((l) => l.text),
    ['AAAAAA', 'A'],
  );
});

test('end-text-line 才换行（文本里的 \\n 当普通字处理）', () => {
  const st = { ...defaultWinStyle(), wrapRight: 1000, wrapBottom: 720 };
  const f = layoutWindow(9, {
    style: st,
    segments: [
      { text: 'あい', ruby: [], lineEnded: true },
      { text: 'うえ', ruby: [], lineEnded: false },
    ],
  });
  assert.deepEqual(
    f.lines.map((l) => l.text),
    ['あい', 'うえ'],
  );
});

test('show-text 的多段拼接成一行（未 end-text-line 时不换行）', () => {
  const st = { ...defaultWinStyle(), wrapRight: 1000, wrapBottom: 720 };
  const f = layoutWindow(9, {
    style: st,
    segments: [
      { text: 'い', ruby: [], lineEnded: false },
      { text: 'キャッスル', ruby: [], lineEnded: false },
    ],
  });
  assert.equal(f.lines.length, 1);
  assert.equal(f.lines[0].text, 'いキャッスル');
});

test('注音：居中于本文词上方一个注音字高', () => {
  // 本文「天結」二字 = 60px（字号 30），注音「あまゆ」3 字 × 10px/字 = 30px
  const f = layoutWindow(9, input({ text: '天結', ruby: [['天結', 'あまゆ']], style: { wrapRight: 1000 } }));
  const line = f.lines[0];
  assert.equal(line.glyphs.length, 2);
  const rx0 = line.ruby[0].x;
  const rxEnd = line.ruby[line.ruby.length - 1].x + advance('ゆ', 10);
  // 居中：注音左右端点相对本文词左右端点各内缩 (60-30)/2 = 15
  assert.equal(rx0, 0 + 15);
  assert.equal(rxEnd, 60 - 15);
  assert.equal(line.ruby[0].y, -10); // 本文行上方一个注音字高
});

test('注音：跨行不配对（引擎把注音挂在行记录上）', () => {
  const f = layoutWindow(
    9,
    input({ text: 'あいうえ', ruby: [['あい', 'アイ']], style: { wrapRight: 60, wrapBottom: 720 } }),
  );
  // 每行 2 字：['あい','うえ'] ⇒ 只有第一行能配对到「あい」
  assert.deepEqual(
    f.lines.map((l) => l.text),
    ['あい', 'うえ'],
  );
  assert.equal(f.lines[0].ruby.length, 2);
  assert.equal(f.lines[1].ruby.length, 0);
});

test("★`vertical` 标志不改变排版流向（引擎 sub_46BE30 不读 Font+235108）", () => {
  // raw 83363-83997 的排版例程里**没有** 235108 的任何引用；换行判据恒为 penX > win+36。
  // ⇒ 同样的文本在 vertical=0/1 下必须排出**同样的行**（`0x261` 只影响绘制期的源矩形）。
  const text = 'あいうえおかきくけこ';
  const style = { wrapRight: 120, wrapBottom: 720 } as const;
  const flat = layoutWindow(9, input({ text, style: { ...style, vertical: false } }));
  const vert = layoutWindow(9, input({ text, style: { ...style, vertical: true } }));
  assert.deepEqual(
    flat.lines.map((l) => l.text),
    ['あいうえ', 'おかきく', 'けこ'], // 每行 4 字（4×30=120 = wrapRight）
  );
  assert.deepEqual(
    vert.lines.map((l) => l.text),
    flat.lines.map((l) => l.text),
    'vertical 标志不得改变换行/朝向',
  );
  assert.deepEqual(
    vert.lines.flatMap((l) => l.glyphs.map((g) => [g.x, g.y])),
    flat.lines.flatMap((l) => l.glyphs.map((g) => [g.x, g.y])),
    '字形位置也必须一致',
  );
});

test('超过下边界即停（引擎报「文字がウインドウ内に収まりません」raw 83720-83728）', () => {
  // 下边界 70 ⇒ 只放得下 2 行（y=0,30）；第 3 行 60+30 > 70 被拒
  const f = layoutWindow(9, input({ text: 'あいうえおかき', style: { wrapRight: 60, wrapBottom: 70 } }));
  assert.deepEqual(
    f.lines.map((l) => l.text),
    ['あい', 'うえ'],
  );
});

test('对齐：mode 1 居中 / mode 2 右对齐（引擎 win+288 / win+292）', () => {
  const base = { wrapRight: 1000, alignWidth: 200 } as const;
  const center = layoutWindow(9, input({ text: '天結', style: { ...base, align: 1 } }));
  assert.equal(center.lines[0].glyphs[0].x, (200 - 60) / 2);
  const right = layoutWindow(9, input({ text: '天結', style: { ...base, align: 2 } }));
  assert.equal(right.lines[0].glyphs[0].x, 200 - 60);
  const left = layoutWindow(9, input({ text: '天結', style: { ...base, align: 0 } }));
  assert.equal(left.lines[0].glyphs[0].x, 0);
});

test('★逐字显现游标：负数 = 全部显示、0 = 不画（漏掉这条 ⇒ 所有窗口空白）', () => {
  const st = { wrapRight: 1000, wrapBottom: 720 };
  const all = layoutWindow(9, { style: { ...defaultWinStyle(), ...st }, segments: [{ text: '天結い', ruby: [], lineEnded: false }] });
  assert.equal(all.glyphCount, 3);
  assert.equal(all.revealed, 3, '默认（未给 revealed）= 全部显示');
  // -1 是 MsgWindow.revealedOf 对"无显现状态"的返回值 —— **必须**当作全部显示
  assert.equal(layoutWindow(9, { ...input({ text: '天結い', style: st }), revealed: -1 }).revealed, 3);
  assert.equal(layoutWindow(9, { ...input({ text: '天結い', style: st }), revealed: 0 }).revealed, 0);
  assert.equal(layoutWindow(9, { ...input({ text: '天結い', style: st }), revealed: 2 }).revealed, 2);
  assert.equal(layoutWindow(9, { ...input({ text: '天結い', style: st }), revealed: 99 }).revealed, 3, '越界截断');
});

test('逐字显现游标：按跨行累计的字形序号决定每行画几个', () => {
  const f = layoutWindow(1, input({ text: 'あいうえおか', style: { wrapRight: 100, wrapBottom: 720 } }));
  assert.equal(visibleInLine(f.lines[0], 0, 0), 0);
  assert.equal(visibleInLine(f.lines[0], 0, 2), 2);
  assert.equal(visibleInLine(f.lines[0], 0, 5), 3); // 第一行封顶
  assert.equal(visibleInLine(f.lines[1], 3, 5), 2);
  assert.equal(f.glyphCount, 6);
});

test('面名映射：剥竖排 "@" 前缀 + 未知面名回退并标记', () => {
  assert.equal(normalizeFace('@ＭＳ ゴシック'), 'ＭＳゴシック');
  // ★映射目标 = 汉化随包字体（`patch/patch.config.json` 只同步 `Amayui-CN_cnjp.ttf`，
  //   TTF 自报 family 名 = `Amayui CN`）；旧 WenQuanYi 线（族名伪装成 `MS Gothic`）已废弃，
  //   不再作为任何面名的落地字族（见 fontSet.ts 文件头「字体政策」）。
  assert.equal(resolveFace('ＭＳ ゴシック').family, 'Amayui CN');
  assert.equal(resolveFace('@ＭＳ ゴシック').family, 'Amayui CN');
  assert.equal(resolveFace('Amayui CN').family, 'Amayui CN');
  // ★消息窗主面 `bbb = メイリオ`（$1$INITCONFIG0.txt:18）：汉化环境渲染为 Amayui CN
  //   —— 历史错误是映射到 `MS Gothic`（WenQuanYi，日志：`[font] MS Gothic#400 ← MSGothic_WenQuanYi_cnjp.ttf`）
  assert.equal(resolveFace('メイリオ').family, 'Amayui CN');
  assert.equal(resolveFace('ＭＳ 明朝').family, 'Amayui CN');
  assert.equal(resolveFace('游ゴシック').family, 'Amayui CN');
  const unk = resolveFace('存在しないフォント');
  assert.equal(unk.family, 'Amayui CN', '未知面名回退到默认字族（= Amayui CN）');
  assert.equal(unk.unknown, true);
});

test('★字重解析：只有 Regular 面的字族请求 700 时按 400 注册（让浏览器合成加粗）', () => {
  // 注册成 700 会让浏览器以为"这就是粗体面" ⇒ 脚本的 i2bd 1 完全失效（字重看起来不变）
  assert.deepEqual(fontFaceFor('Amayui CN', 700), { file: 'Amayui-CN_cnjp.ttf', weight: 400 });
  assert.equal(fontFaceFor('MS Gothic', 700), null, '旧 WenQuanYi 字族已摘除（不再有落地文件）');
  // Sarasa 有真 Bold 面 ⇒ 请求 700 就用 Bold 文件
  assert.deepEqual(fontFaceFor('Sarasa Gothic SC', 700), {
    file: 'SarasaGothicSC/SarasaGothicSC-Bold.ttf',
    weight: 700,
  });
  assert.deepEqual(fontFaceFor('Sarasa Gothic SC', 400), {
    file: 'SarasaGothicSC/SarasaGothicSC-Regular.ttf',
    weight: 400,
  });
  assert.equal(fontFaceFor('存在しない', 400), null);
});
