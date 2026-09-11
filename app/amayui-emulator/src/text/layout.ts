/**
 * **文本排版模型**（纯函数、无 DOM / 无 Pixi）—— 引擎文本子系统的等价物。
 *
 * 引擎事实（见 `docs-new/03-engine/adv-text-rendering.md`）：
 *  - **等宽网格**：`CreateFontIndirectA` 时强制 `lfWidth = lfHeight / 2`，GDI 对 DBCS 按半角解释
 *    ⇒ **全角字 = 1em、半角字 = 0.5em**（raw 71055-71060、24063-24068）。
 *    因此 `advance()` 是**纯算术**，不需要查浏览器度量 —— 排版完全确定、可在 Node 里断言。
 *  - **换行**：逐字累计，越过右/下边界即硬断（`sub_475CF0` raw 90427：`x > win+36` / `y > win+40`）。
 *    ★**没有禁则**（行首/行尾禁则表全文件不存在），★**没有换行符**（只认 `end-text-line` 0x6F）。
 *  - **注音**：与本文**配对**（引擎 24B 行记录 `+0` 种类 / `+20` 组 ID），用**独立小号字体**；
 *    对齐时以"本文实际宽度"为基准（`sub_4572A0` raw 68886-68951）。
 *  - **排版恒为横向**（★这条纠正过一次错判）：引擎的排版例程 `sub_46BE30`（raw 83363-83997）
 *    里**完全不出现** `Font+235108`（`grep 235108` 的 16 个读点全在**绘制**函数里）。
 *    它的换行判据恒为 `penX > win+36` 换行、`penY > win+40` 报错停（`sub_475CF0` raw 90427）。
 *    ⇒ **没有任何"竖排换列"的排版分支。**
 *
 *  - `Font+235108`（op `0x261`）到底是什么：它在**绘制**路径里只做两件事
 *    （raw 71663-71671、71844-71851、72302-72311、75963-75990）：
 *    ① 跳过"描边偏移"那一段；② 用 `+235112/+235116/+235120/+235124`（op `0x260` 写）
 *    去**平移/放大离屏表面的源矩形**（配 `'@'` 面 + escapement 2700 的 HFONT）。
 *    重写侧**直接光栅化字形、根本没有"源矩形"这一步** ⇒ 该标志对渲染**无等价物**，
 *    因此**只记录、不消费**（`MsgWinStyle.vertical`）。它的真实语义留待 E4 对照。
 *  - **对齐**：`win+288` 0=左 / 1=中 / 2=右，`win+292` = 行宽上限。
 *  - **描边/阴影**：模式 `Font+1372`、偏移 `+1384/+1388` —— **两种字体共用同一套**（`sub_455ED0`）。
 *
 * 本模块只做「窗口状态 + 文本段 → 已排版的字形列表」；光栅化在 `renderer/text/raster.ts`。
 */

/** 一套字体的渲染参数（主文本 / 注音各一套）。 */
export interface FontSpec {
  /** 已映射到内嵌字族的面名（`'@'` 前缀已剥；见 `fontSet.ts`）。 */
  family: string;
  /** 像素高（引擎 `Font+201684` / `Font+218584`）。 */
  size: number;
  /** 400 / 700（引擎 `Font+1248` lfWeight：0 或 700，op `0x2BD`/`0x2BE`）。 */
  weight: 400 | 700;
  /** 填充色 `#rrggbb`（引擎 `Font+1360`，op `0x76`）。 */
  fill: string;
  /** 描边/阴影色 `#rrggbb`（引擎 `Font+1364`，op `0x77`）。 */
  outline: string;
}

/** 一个消息窗的几何 + 样式（引擎 `FontVWindow` + `Font` 的绘制相关字段）。 */
export interface MsgWinStyle {
  /** 屏幕位置（引擎 `win+12`/`+16`，op `0x70` 的 op4/op5）。 */
  x: number;
  y: number;
  /** 窗口尺寸（引擎 `win+20`/`+24`，op `0x70` 的 op2/op3；也是换行边界来源）。 */
  w: number;
  h: number;
  /**
   * 文字起点（引擎 `win+28`/`+32`，op `0x79`）。
   * ★**大概率正确**：CONFIG1 样例窗 `i079 9 6c 34` = (108,52) + 一行横排的结果与实机观感一致
   * （用户 2026 实测确认位置正确）。仍留 E4 待最终确认的是"它是文字起点还是文字区域左上角"
   * —— 当前横排下两者等价。
   */
  originX: number;
  originY: number;
  /** 文字区域右/下边界（引擎 `win+36`/`+40`，op `0x70`/`0x1A4`/`0x1C1`）。 */
  wrapRight: number;
  wrapBottom: number;
  /**
   * 引擎 `Font+235108` bit0（op `0x261`）—— **记录但不参与排版**（见文件头说明：
   * 排版例程不读它；它只改绘制期的源矩形，而重写侧没有源矩形这一步）。
   */
  vertical: boolean;
  /** 对齐模式 0=左 / 1=中 / 2=右（引擎 `win+288`，op `0x303`）。 */
  align: 0 | 1 | 2;
  /** 对齐用行宽上限（引擎 `win+292`）。 */
  alignWidth: number;
  /**
   * 描边档位（引擎 `Font+1372`，op `0x78`）：`0` 只画一遍 /
   * `1` 额外一遍 `(x+dx, y+dy)`（**单向投影，引擎默认档**）/ `2` 同位置叠 1/4 强度副本 /
   * `3` 多向描边（GDI 四对角 / D3DX 圆环扫描）。
   */
  outlineMode: 0 | 1 | 2 | 3;
  /** 描边偏移 dx/dy（引擎 `Font+1384`/`+1388`，op `0x1A4`）—— 两种字体共用。 */
  outlineDx: number;
  outlineDy: number;
  /** 主字体（引擎 `Font` 的 `+1232/+1236/+1248/+1260` 一族）。 */
  main: FontSpec;
  /** 注音字体（引擎 `Font` 的 `+1292/+1296/+1308/+1320` 一族）。 */
  ruby: FontSpec;
  /** 窗口底色 `#rrggbb`（引擎 `sub_43B070(dd, 表面, 色)` raw 73178）；`null` = 不填。 */
  background: string | null;
  /**
   * **本窗文本在场景里的层序** = 引擎正文行的 DrawItem id 起点 `win+104`（op `0x213` 写，
   * `id = 行号 + 本值`；raw 31771-31774、71633）。
   *
   * ★这是"文字会不会被盖住"的关键：`0x213` 在本工程里给的是 **180500 量级**
   * （CONFIG.txt:39 `i213 9 2c114 1f4` → 0x2c114 = 180500），而普通 2D 图元的 key 是
   * 100 量级 ⇒ 若用固定的小层序（曾用 `20+win` = 29），文字会被**整屏 UI 盖掉**。
   * `0` = 脚本没设过 ⇒ 由渲染层回退到引擎的平面号 `20+win`。
   */
  itemId: number;
}

/** 一段文本 + 其注音对（引擎 `show-text` 0x6E / `display-furigana` 0x196 / `end-text-line` 0x6F）。 */
export interface TextSegment {
  text: string;
  /** `[被注音的词, 注音]`。 */
  ruby: [string, string][];
  /** 是否已断行（`end-text-line`）。 */
  lineEnded: boolean;
}

/** 排版输入（= 一个窗口的完整快照；VM 每次改动后交宿主重算）。 */
export interface MsgWinInput {
  style: MsgWinStyle;
  segments: readonly TextSegment[];
  /**
   * **逐字显现游标**：只画前 N 个字形（跨行累计）；`undefined` / 负数 = 全部显示。
   *
   * 引擎对应物：文本先整段画进离屏表面，再由 `sub_409400` 按 `message:MessageSpeed`
   * 节拍逐步"贴出来"（GDI 路径 `Sleep(MessageSpeed)` + `sub_45BE20` 一步）；
   * 重写侧没有离屏表面这一步 ⇒ 直接把游标交给光栅化，只画前 N 个字形。
   */
  revealed?: number;
}

/** 一个已摆位的字形（坐标相对**窗口左上角**）。 */
export interface Glyph {
  ch: string;
  x: number;
  y: number;
  /** 该字形在本行文本里的字符序号（1-based），用于与注音区间对应。 */
  i: number;
}

/** 一个已摆位的注音字形。 */
export interface RubyGlyph {
  ch: string;
  x: number;
  y: number;
}

/** 一行（水平）或一列（垂直）。 */
export interface TextLine {
  glyphs: Glyph[];
  ruby: RubyGlyph[];
  /** 行首位置（相对窗口）。 */
  x: number;
  y: number;
  /** 行宽（水平）/ 行长（垂直）—— 对齐用。 */
  width: number;
  /** 本行连接文本（诊断/快照用）。 */
  text: string;
}

/** 一个窗口的排版结果。 */
export interface TextFrame {
  win: number;
  style: MsgWinStyle;
  lines: TextLine[];
  /** 全部字形数（= 逐字显现的最大计数）。 */
  glyphCount: number;
  /** 本帧实际画出的字形数（= `revealed` 截断到 `glyphCount`；`0..glyphCount`）。 */
  revealed: number;
}

/**
 * Shift-JIS 字节长度 ⇒ 占多少个"半角格"。
 * ASCII 与半角片假名（U+FF61..U+FF9F）在 Shift-JIS 里是 1 字节，其余 2 字节。
 */
export function sjisBytes(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x80 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
}

/** 引擎的推进量：`半角格数 × 0.5em`（`lfWidth = 字高/2`）。 */
export function advance(ch: string, size: number): number {
  return sjisBytes(ch) * size * 0.5;
}

/** 一个字符串按引擎网格的总宽/总长。 */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += advance(ch, size);
  return w;
}

/** 默认窗口样式（`sub_465390` Initialize 初值 + 随包 INI：30px 白字 + 黑投影，注音 10px）。 */
export function defaultWinStyle(): MsgWinStyle {
  return {
    x: 0,
    y: 0,
    w: 800,
    h: 720,
    originX: 0,
    originY: 0,
    wrapRight: 800,
    wrapBottom: 720,
    vertical: false,
    align: 0,
    alignWidth: 0,
    outlineMode: 1,
    outlineDx: 2,
    outlineDy: 2,
    main: { family: 'Amayui CN', size: 30, weight: 400, fill: '#ffffff', outline: '#000000' },
    ruby: { family: 'Amayui CN', size: 10, weight: 400, fill: '#ffffff', outline: '#000000' },
    background: null,
    itemId: 0,
  };
}

/**
 * 把窗口的文本段排版成行/列。
 *
 * 与引擎一致的两条硬规则：
 *  1. 换行**只看边界**（等宽网格下退化为格子数），不做任何禁则；
 *  2. 只有 `end-text-line` 才换行 —— 普通换行符会被当普通字排进去。
 *
 * 注音配对按「同一行内本文出现」判定：引擎把注音挂在行记录上
 * （`sub_46BE30` 断行时本文/注音成对 push，raw 83675-83702），跨行的注音不成立。
 */
export function layoutWindow(win: number, input: MsgWinInput): TextFrame {
  const st = input.style;
  const size = st.main.size;

  /** 收集全部注音对（跨段累计），配对时按行文本过滤。 */
  const pairs: [string, string][] = [];
  for (const seg of input.segments) for (const p of seg.ruby) pairs.push(p);

  const lines: TextLine[] = [];
  let glyphs: Glyph[] = [];
  let chars: string[] = [];
  // 水平：行首 y 逐行下移，penX 在行内推进。
  // 竖排：列首 x 逐列左移，penY 在列内推进。
  // 恒为横向流：行首 x = 文字起点，行首 y 逐行下移（引擎 sub_46BE30 的换行方向）
  const lineStartX = st.originX;
  let lineStartY = st.originY;
  let penX = st.originX;
  let penY = st.originY;

  const flush = (): void => {
    const width = penX - lineStartX;
    const line: TextLine = {
      glyphs,
      ruby: [],
      x: lineStartX,
      y: lineStartY,
      width: Math.max(0, width),
      text: chars.join(''),
    };
    pairRuby(line, pairs, st);
    applyAlign(line, st);
    lines.push(line);
    glyphs = [];
    chars = [];
  };

  /** 换行；返回 false = 已越过下边界（引擎报「文字がウインドウ内に収まりません」并停，raw 83720-83728）。 */
  const wrap = (): boolean => {
    flush();
    lineStartY += size;
    if (lineStartY + size > st.wrapBottom) return false; // `win+40`
    penX = lineStartX;
    penY = lineStartY;
    return true;
  };

  let outOfRoom = false;
  for (const seg of input.segments) {
    for (const ch of seg.text) {
      const adv = advance(ch, size);
      if (penX + adv > st.wrapRight && glyphs.length > 0 && !wrap()) {
        outOfRoom = true;
        break;
      }
      glyphs.push({ ch, x: penX, y: lineStartY, i: chars.length + 1 });
      chars.push(ch);
      penX += adv;
    }
    if (outOfRoom) break;
    if (seg.lineEnded && !wrap()) break;
  }
  if (glyphs.length > 0 || lines.length === 0) flush();

  const glyphCount = lines.reduce((n, l) => n + l.glyphs.length, 0);
  // ★约定：**负数 = 全部显示**（`MsgWindow.revealedOf` 对"没有显现状态"的窗返回 -1）；
  //   `0` = 一个字都不画（显现刚起步）。把负数当 0 处理会让**所有普通窗口变成空白**
  //   —— 2026 实测的"文字直接不显示"就是这个（模型对、画面空，属最难查的静默缺陷）。
  const rev = input.revealed ?? glyphCount;
  const revealed = rev < 0 ? glyphCount : rev >= glyphCount ? glyphCount : rev;
  return { win, style: st, lines, glyphCount, revealed };
}

/** 注音摆位：居中于本文词**上方**一个注音字高（引擎以本文词宽为基准，`sub_4572A0` raw 68886）。 */
function pairRuby(line: TextLine, pairs: [string, string][], st: MsgWinStyle): void {
  if (line.text.length === 0) return;
  const rSize = st.ruby.size;
  for (const [base, ruby] of pairs) {
    if (base.length === 0) continue;
    const at = line.text.indexOf(base);
    if (at < 0) continue;
    const run = line.glyphs.filter((g) => g.i > at && g.i <= at + base.length);
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) continue;
    const x0 = first.x;
    const x1 = last.x + advance(last.ch, st.main.size);
    let rx = x0 + (x1 - x0 - textWidth(ruby, rSize)) / 2;
    const ry = first.y - rSize;
    for (const ch of ruby) {
      line.ruby.push({ ch, x: rx, y: ry });
      rx += advance(ch, rSize);
    }
  }
}

/** 对齐（引擎 `sub_4572A0` raw 68939-68950）：mode 1 居中、mode 2 右对齐。 */
function applyAlign(line: TextLine, st: MsgWinStyle): void {
  if (st.align === 0 || st.alignWidth <= 0) return;
  const off =
    st.align === 1 ? (st.alignWidth - line.width) / 2 : st.align === 2 ? st.alignWidth - line.width : 0;
  if (off === 0) return;
  for (const g of line.glyphs) g.x += off;
  for (const g of line.ruby) g.x += off;
}

/** 逐字显现：`revealed` = 已显示到的字形总数（跨行累计）；返回本行应画出的字形个数。 */
export function visibleInLine(line: TextLine, lineStartIndex: number, revealed: number): number {
  const n = revealed - lineStartIndex;
  return n <= 0 ? 0 : n >= line.glyphs.length ? line.glyphs.length : n;
}
