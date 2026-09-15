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
  visibleRubyInLine,
  type MsgWinInput,
} from '../src/text/layout.js';
import { fontFaceFor, fontFileList, normalizeFace, resolveFace } from '../src/text/fontSet.js';

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
  // 本文行上方一个注音字高（`Font+1292` = -注音字号）+ 引擎在非 D3D 路径的 +1
  // （sub_465A20：`ruby.y = 行 y + Font+1292`，随后 `if (DrawMode != 1 && !Font+218600) ++y`）
  assert.equal(line.ruby[0].y, -9);
});

test('★注音随本文词的**末字**显现（不是整行一开头就全亮）—— tickets/T-0037', () => {
  // 本文「天結」二字（字号 30）+ 注音「あまゆ」；引擎把注音记录挂在本文词**最后一个字**的
  // 24B 记录之后并给该记录标 [+0]=1，显现循环 do { 贴 } while (上一记录[+0]) ⇒ 一步 = 末字 + 注音。
  const f = layoutWindow(9, input({ text: '天結い', ruby: [['天結', 'あまゆ']], style: { wrapRight: 1000 } }));
  const line = f.lines[0];
  assert.equal(line.ruby.length, 3);
  assert.deepEqual(
    line.ruby.map((g) => g.from),
    [2, 2, 2],
    '注音的可见点 = 本文词末字在本行里的序号（「結」= 2）',
  );
  // 逐字：第 1 个字（天）显现时**一个注音都不该有**；第 2 个字（結）显现时注音整组出现
  assert.equal(visibleRubyInLine(line, 0).length, 0);
  assert.equal(visibleRubyInLine(line, 1).length, 0, '★「天」显现时注音不得提前出现');
  assert.equal(visibleRubyInLine(line, 2).length, 3);
  assert.equal(visibleRubyInLine(line, 3).length, 3, '后一个字不影响注音');
});

test('★换行步进 = 字号 + 行间距（Font+1380 / i08b）—— tickets/T-0038', () => {
  // 引擎 sub_46AF90：`v7 = 字号 + Font+1380`，随后 `*(新行 y) += v7`。
  // ADV 标准样式前导是 `i075 1e`(30px) + `i08b 10`(=16) ⇒ 行距 46px。
  const text = 'あいうえおかきくけこ'; // 10 字 × 30px，wrapRight=120 ⇒ 每行 4 字
  const adv = layoutWindow(
    9,
    input({ text, style: { wrapRight: 120, wrapBottom: 720, lineSpacing: 0x10 } }),
  );
  assert.deepEqual(
    adv.lines.map((l) => l.y),
    [0, 46, 92],
    '★ADV（i08b 10 = 16）：行距 = 30 + 16 = 46',
  );
  const def = layoutWindow(9, input({ text, style: { wrapRight: 120, wrapBottom: 720 } }));
  assert.deepEqual(
    def.lines.map((l) => l.y),
    [0, 36, 72],
    '默认行间距 = 引擎 Initialize 初值 6（raw 78858）⇒ 36',
  );
  // ★不变量：注音（画在行顶上方一个注音字高）不得压进上一行的字格
  const withRuby = layoutWindow(
    9,
    input({
      text: 'あいうえ天結', // 每行 4 字（wrapRight=120）⇒ 第二行 = 「天結」+ 它的注音
      ruby: [['天結', 'あまゆ']],
      style: { wrapRight: 120, wrapBottom: 720, lineSpacing: 0x10 },
    }),
  );
  const [l0, l1] = withRuby.lines;
  assert.ok(l0 && l1, '应换出两行');
  assert.equal(l1.ruby.length, 3, '注音配在第二行的本文词上');
  assert.ok(
    l1.ruby[0]!.y >= l0.y + withRuby.style.main.size,
    `注音顶 ${l1.ruby[0]!.y} 必须在上一行底部 ${l0.y + withRuby.style.main.size} 之下`,
  );
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

test('对齐：mode 1 居中（op3 = 行中心）/ mode 2 右对齐（行右缘落到 op3）—— 引擎 sub_4576C0', () => {
  // ★2026-09 修正：mode 1 的位移 = `op3 − 行宽/2`（op3 是**行中心**，不是对齐框宽度）。
  //   真机对照：win 8 `i303 8 1 1f4`（op3=500）+ 块原点 x=140 ⇒ 行中心 = 640 = 屏幕中心。
  const base = { wrapRight: 1000, alignWidth: 200 } as const;
  const center = layoutWindow(9, input({ text: '天結', style: { ...base, align: 1 } }));
  assert.equal(center.lines[0].glyphs[0].x, 200 - 60 / 2, '位移 = op3 − 行宽/2 ⇒ 行中心 = op3（此处 200）');
  const right = layoutWindow(9, input({ text: '天結', style: { ...base, align: 2 } }));
  assert.equal(right.lines[0].glyphs[0].x, 200 - 60, '右对齐：行右缘 = op3');
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
  // ★映射目标 = 汉化随包字体（`patch/patch.config.json` 同步 `Amayui-CN_cnjp.ttf` 与其 Bold 面，
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

test('★resources.version=jp：日文面名落到未做 cnjp 替换的更纱黑体；Amayui CN 在 jp 下是错误配置', () => {
  // 纯日文资源用 `Amayui CN`（cmap 把日文写法码位换成简体字形）会把原文也换成简体 ⇒ 必须换基底。
  for (const face of ['ＭＳ ゴシック', '@ＭＳ ゴシック', 'メイリオ', 'ＭＳ 明朝', '游ゴシック', 'MS Gothic', 'Meiryo']) {
    const r = resolveFace(face, 'jp');
    assert.equal(r.family, 'Sarasa Gothic SC', `${face} 在 jp 下应落到更纱黑体`);
    assert.equal(r.unknown, false, `${face} 是已知面名`);
  }
  // 未知面名在 jp 下回退到 jp 的默认字族（不是 Amayui CN）
  assert.equal(resolveFace('存在しないフォント', 'jp').family, 'Sarasa Gothic SC');
  assert.equal(resolveFace('存在しないフォント', 'jp').unknown, true);
  // 显式 cnjp / 省略 version（默认）都保持现状
  assert.equal(resolveFace('メイリオ', 'cnjp').family, 'Amayui CN');
  assert.equal(resolveFace('メイリオ').family, 'Amayui CN');
  // ★jp 下请求 `Amayui CN` = 错误配置（该面名只因汉化而存在）：**不做特殊处理** ⇒ 通用回退
  const mis = resolveFace('Amayui CN', 'jp');
  assert.equal(mis.family, 'Sarasa Gothic SC');
  assert.equal(mis.unknown, true, '走"表里没有 ⇒ 回退 + 记一次日志"的通用路径，不特判');
});

test('★字重解析：有真 Bold 面就用它（700 按 700 注册）；没有则退回 Regular 的 400 面', () => {
  // `Amayui CN` 2026-09 起有真 Bold 面（docs/font-build.md §8.7）⇒ 请求 700 = 真粗体，不再靠浏览器合成
  assert.deepEqual(fontFaceFor('Amayui CN', 700), { file: 'Amayui-CN_cnjp-Bold.ttf', weight: 700 });
  assert.deepEqual(fontFaceFor('Amayui CN', 400), { file: 'Amayui-CN_cnjp.ttf', weight: 400 });
  assert.equal(fontFaceFor('MS Gothic', 700), null, '旧 WenQuanYi 字族已摘除（不再有落地文件）');
  // Sarasa 也有真 Bold 面
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

test('★字重解析：绝不能把同一个 Regular 文件同时登记成 400 与 700（= 加粗静默失效）', () => {
  // 这条是"曾经踩过的坑"的棘轮：`fontFileList()` 旧实现用 `files[w] ?? files[400]` 把 Amayui CN 的
  // Regular 同时列成 400/700 ⇒ 注册成 700 的那一面会被浏览器当成"这就是粗体"，`i2bd 1` 完全没效果。
  const byFamily = new Map<string, { weight: number; file: string }[]>();
  for (const f of fontFileList()) {
    const list = byFamily.get(f.family) ?? [];
    list.push({ weight: f.weight, file: f.file });
    byFamily.set(f.family, list);
  }
  for (const [family, list] of byFamily) {
    const filesByWeight = new Map(list.map((x) => [x.weight, x.file]));
    if (filesByWeight.size === 1) continue; // 单面族（合法：只有 Regular，请求 700 时由宿主决定）
    assert.notEqual(
      filesByWeight.get(400),
      filesByWeight.get(700),
      `${family}: 400 与 700 指向同一个文件 ⇒ 粗体不会有任何视觉差别`,
    );
  }
  // 当前工程的两个族都应当是"真双面"
  assert.deepEqual(
    byFamily.get('Amayui CN')?.map((x) => x.file).sort(),
    ['Amayui-CN_cnjp-Bold.ttf', 'Amayui-CN_cnjp.ttf'],
  );
});
