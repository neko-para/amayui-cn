/**
 * **文本排版模型**（纯函数、无 DOM / 无 Pixi）—— 引擎文本子系统的等价物。
 *
 * 引擎事实（见 `docs-new/03-engine/adv-text-rendering.md`）：
 *  - **等宽网格**：`CreateFontIndirectA` 时强制 `lfWidth = lfHeight / 2`，GDI 对 DBCS 按半角解释
 *    ⇒ **全角字 = 1em、半角字 = 0.5em**（raw 71055-71060、24063-24068）。
 *    因此 `advance()` 是**纯算术**，不需要查浏览器度量 —— 排版完全确定、可在 Node 里断言。
 *    ★**唯一的配置门 = `set:BlankExtentMode`**（串常量 raw 4280；随包默认 **0** ——
 *    `tickets/T-0031/evidence/generated-SYS4REG.ini` 的 `BlankExtentMode=0`）：它**只改空白字**
 *    （`0x20` / `0x8140` / 控制字节，以及绘制期 `GetGlyphOutline` 失败的字）的前进量：
 *    `== 1` ⇒ 逐字 `GetTextExtentPoint32A` 量宽（`sub_404EE0` raw 10716-10739），
 *    否则 ⇒ `font_size / (全角?1:2)`（raw 87269-87280 最直白；另见 `sub_4072F0` raw 12221-12236
 *    与字形路径 raw 85126/85638/85812/86567/87269/… 共 20 余处，形态一致）。
 *    ⇒ **mode == 0 与本文件的纯算术逐字相等**（这就是"随包默认下 emulator 已等价"的判据）；
 *    mode == 1 需要**真实字体度量**，见 `BlankExtent` 与文件尾「缺口」。
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
  /**
   * ★**抗锯齿**（引擎 `Font+1352` = `Engine[21662]`；`tickets/T-0035`/`T-0042`）。
   *
   * `false` = 1bpp 字形路径（每像素非 0 即满 ⇒ 纯色）；`true` = 覆盖率字形路径
   * （`GetGlyphOutline` 的 `GGO_GRAY4/GRAY8` 位图 + `sub_46D9F0` 的逐像素 α 合成）。
   *
   * ★2026-09（`T-0042`）以**像素判据**为准取 `true`：配置门（`set:EnableAntiFont` 默认 0）
   * 推导出的是 1bpp，但 1bpp 路径的 α 恒满 ⇒ 引擎文字应是纯白 255，而真机实测是
   * `α·255+(1-α)·描边` 的 `(233,230,228)`（且描边有 3px 斜坡）⇒ 只可能来自覆盖率路径。
   * 见 `TEXT_FILL_ALPHA`。
   */
  antiAlias: boolean;
}

/**
 * 引擎字形合成的**填充覆盖率上限**（`sub_46D9F0` raw 84893-84898）：
 * `v30 = 255 * cov / 17`（`GGO_GRAY4`，cov ≤ 16）⇒ 满覆盖 = 240；实测真机文字平台
 * （序章旁白 `(233,230,228)`、字体样例 `(227,227,227)`）对应 `cov = 15` ⇒ **225/255**，
 * 即"白字"永不不透明 —— 这就是"引擎文字偏灰"的机制。
 */
export const TEXT_FILL_ALPHA = 225 / 255;

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
  /**
   * 引擎 `Font+235112/+235116/+235120/+235124`（op `0x260` 的四个操作数）——竖排 blit 矩形的内边距。
   *
   * ★这是 **Font 级**字段（全局），与 `vertical` 同层；`MsgWinStyle` 里带它只是为了**把值发布给宿主**
   * （快照/诊断能看到脚本设过什么），**不参与排版**（引擎的排版例程 `sub_46BE30` 完全不读它）。
   *
   * ★**它对渲染没有等价物**（审计 §4.1 P1 `0x260` 的核验结论，见 `vm/msgwin.ts` 的 `FontStyle.vPad`）：
   * 引擎在绘制期把目标矩形左/上边外移 `(x,y)`、右/下边外扩 `(dw,dh)`，并把源点按同一量
   * 除以表面缩放 —— 目标位移与源位移严格同步 ⇒ **字形内容的屏幕落点不变**，只有"从离屏表面
   * 复制哪一块"变大（防旋转字形边缘被裁）。重写侧不走"表面矩形复制"、也没有逐字裁切，
   * 所以这里**没有可消费的等价物**；随包语料的值也印证它只是 2px 级的边缘补白
   * （`i260 2 0 2 2` / `i260 2 2 2 2`，全部紧跟 `i261 1`）。
   */
  vPad: { x: number; y: number; dw: number; dh: number };
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
  /**
   * **行间距**（引擎 `Font+1380`，初值 6；op `0x8B` 写 —— ADV 标准样式前导是 `i08b 10` = 16）。
   *
   * ★换行步进 = **字号 + 本字段**（`sub_46AF90` raw 82674-82690：`v7 = v8 + Font+1380`；
   * 同族读取点 raw 71734/71943/72403/77464/77895/78686/80280/80723/81493 都是
   * 「行号 × (字号 + Font+1380)」）。**不是**颜色 —— 旧口径把它记成「第四色」是错的
   * （`tickets/T-0038`）。
   *
   * 为什么必须有它：注音画在**行顶上方**一个注音字高（`sub_465A20`：`ruby.y = 行 y + Font+1292(=-注音字号)`），
   * 行距只给字号时注音就压进上一行的字里 —— 用户实测的「振假名与前一行重叠」。
   */
  lineSpacing: number;
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

/**
 * **一段文本被"排队"那一刻的字体/颜色快照**（引擎侧对应物见下）。
 *
 * ★为什么需要它（2026-09 实测的"颜色溢出"）：引擎的文本是**排版时就把字形连颜色一起画进该窗的
 * 离屏表面**（`sub_46BE30` → `sub_455ED0`，用当时的 `Font+1360/+1364/+1372`），此后
 * **改全局字体/颜色不会回溯改已排版的文本**（`0x76` 只写 `Font+1360` 并 `sub_459F40` 重建 GDI 字体对象，
 * 不重绘任何已排好的窗；`0x20A` 的 `sub_45AD30` 也只重算位置、不重画字形）。
 * 而全局样式字段只有一套 ⇒ 谁最后写谁值（例：`CONFIG2` 逐行 `i076 <该行颜色>` 画完角色名后，
 * 全局色停在**最后一个可见行**的颜色上）。
 *
 * 模型侧因此必须在**入队时**把字体/颜色钉住；否则晚到的全局样式改动会把先前排好的窗
 * （如设置界面下方的 ADV 样例窗 9）一起改色 —— 这正是用户实测到的
 * 「角色名的颜色溢出到 ADV 展示页面」。
 */
export interface FontStyleSnapshot {
  main: FontSpec;
  ruby: FontSpec;
  outlineMode: 0 | 1 | 2 | 3;
  outlineDx: number;
  outlineDy: number;
  /** 行间距（引擎 `Font+1380`）：换行步进 = 字号 + 本值 —— 见 `MsgWinStyle.lineSpacing`。 */
  lineSpacing: number;
  /** 竖排是全局的（`Font+235108`，`0x261`），同样按入队时刻钉住。 */
  vertical: boolean;
  /** 竖排 blit 内边距（`Font+235112..+235124`，`0x260`）—— 同样是 Font 级，按入队时刻钉住（见 `MsgWinStyle.vPad`）。 */
  vPad: { x: number; y: number; dw: number; dh: number };
  /**
   * ★**入队时刻的窗几何**（`originX/originY`、`wrapRight/wrapBottom`、`w/h`、`x/y`）。
   *
   * 与上面那些字段同一条理由，只是对象从"字形参数"换成了"排版边界"：引擎的排版**发生在入队那一刻**
   * （`show-text` 0x6E → `sub_46BE30` 逐字量宽 + 越右边界硬断，raw 83363-83997），此后
   * 改窗几何的指令（`0x70` 写 `+12/+16/+20/+24/+36/+40`、`0x198` 写 `+12/+16`、
   * `0x79` 写 `+28/+32`、`0x1C1` 写 `+36/+40`）**都不会回头重排已经排好的行**
   * —— `sub_45D660`（raw 73132-73193）与 `sub_4563D0`（raw 68248-68261）体里一行排版调用都没有。
   *
   * ⇒ 重写侧每次发布都重算排版（`renderer/scene/ops.ts:1282`、`vm/engine.ts:1146/1758`），
   * 若在这里取**实时**几何，"入队之后才改的几何"会静默重排已入队的正文（症状 = 一窗的字
   * 在改窗尺寸/文字起点的那一帧整块换行/跳位），而引擎不会。
   */
  geometry: MsgGeometrySnapshot;
}

/**
 * **入队时刻的窗几何快照**（`FontStyleSnapshot.geometry`）—— 只收**参与排版**的那几格。
 *
 * 不收 `align/alignWidth`/`background`/`itemId`：对齐与层序是**绘制期**的量
 * （引擎 raw 69210-69225 的对齐在绘制落点上做、`win+104` 是 DrawItem id 起点），
 * 它们不参与断行 ⇒ 照旧实时读（见 `styleOfWin`）。
 */
export interface MsgGeometrySnapshot {
  /** 窗屏幕位置（引擎 `win+12`/`+16`，op `0x70` 的 op4/op5 / `0x198`）。 */
  x: number;
  y: number;
  /** 窗尺寸（引擎 `win+20`/`+24`，op `0x70` 的 op2/op3）。 */
  w: number;
  h: number;
  /** 文字起点（引擎 `win+28`/`+32`，op `0x79`；`0x7A` 设过文本块原点时以它为准）。 */
  originX: number;
  originY: number;
  /** 换行右/下边界（引擎 `win+36`/`+40`，op `0x70` 初值 / `0x1C1` 覆盖）—— 断行的唯一判据。 */
  wrapRight: number;
  wrapBottom: number;
}

/** 排版输入（= 一个窗口的完整快照；VM 每次改动后交宿主重算）。 */
export interface MsgWinInput {
  style: MsgWinStyle;
  segments: readonly TextSegment[];
  /**
   * **空白字前进量的配置门**（引擎 `set:BlankExtentMode`，raw 12230 一族；由 `handlers/msgwin.ts`
   * 的 `emitWin` 从配置注册表读入）。`undefined` = 未接线（等同于 mode 0）。
   */
  blankExtent?: BlankExtent;
  /**
   * **逐字显现游标**：只画前 N 个字形（跨行累计）；`undefined` / 负数 = 全部显示。
   *
   * 引擎对应物：文本先整段画进离屏表面，再由 `sub_409400` 按 `message:MessageSpeed`
   * 节拍逐步"贴出来"（GDI 路径 `Sleep(MessageSpeed)` + `sub_45BE20` 一步）；
   * 重写侧没有离屏表面这一步 ⇒ 直接把游标交给光栅化，只画前 N 个字形。
   */
  revealed?: number;
  /**
   * 该窗在 Scene 里的 **DrawItem 区间**（引擎 `FontVWindow+104/+108` 与 `+276/+280`，由
   * `0x213`/`0x25D` 登记；`i213 1 19a28 1f4` = `[105000,105500)`）。
   *
   * 为什么渲染侧需要它：引擎的"正文行"**就是** Scene 的 DrawItem（id = 行号 + base），
   * 脚本清文字的手段是 `0x1F7 detach-texture <base> <count>`（换场/新页），
   * 而重写侧文本另有载体（`msgWins`）⇒ 必须按区间判"这窗的图元被删光了 ⇒ 字也消失"
   * （见 `scDetachTexture`）。缺了它，转场后文字会残留在画面上。
   */
  itemRanges?: readonly { base: number; count: number }[];
  /**
   * **字格图标**（▼「点击继续」）这一帧要画的那一格（引擎 `0x73` 配的精灵表 + 主循环每 `tickMs` 换一格）。
   *
   * 真相（2026-09 订正）：`0x73` **不是**文字逐字的单位，而是"一张图标精灵表的网格" ——
   * ADV = `SO000.AGF`(id 0x5191) 10 帧 35×35 装进槽 12；序章/NOVEL = `SO026.AGF`(id 0x5190)
   * 8 帧 56×56。主循环 raw 20887-20895 在 `effect_flags & 0x40000000` 期间每 `op10` ms 用
   * `sub_45A940(Font, 当前窗, k, 0)` 把第 k 格贴到屏幕（`k = (k+1) % op9`）⇒ 视觉上就是"闪烁的 ▼"。
   */
  cell?: MsgCellFrame;
}

/** 字格图标（▼）的一帧：源 = 槽 `srcSurface` 那张精灵表的第 `k` 格；目标 = 屏幕坐标 `(x,y)`。 */
export interface MsgCellFrame {
  /** 源贴图槽（引擎 `win+60` = `0x73` 的 op4）。 */
  srcSurface: number;
  /** 精灵表里网格的原点（`0x73` op5/op6）。 */
  originX: number;
  originY: number;
  /** 单格尺寸（op7/op8）。 */
  cellW: number;
  cellH: number;
  /** 每行列数（op9；引擎 `win+96`）。 */
  cols: number;
  /** 本帧的格号（引擎 `Engine[107704]`；源矩形 = 原点 + (k%cols, k/cols) × 格宽高）。 */
  k: number;
  /** 目标屏幕坐标（ADV 分支 = `0x73` 的 op2/op3 + 窗框原点）。 */
  x: number;
  y: number;
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
  /**
   * **该注音何时可见**：它所属本文词**末字**在本行里的字符序号（1-based，= `Glyph.i`）。
   *
   * 引擎语义（`sub_46BE30` raw 83988-83997 的收尾）：本文词的字逐个 push 成 24B 记录后，
   * 把**最后一个**那条标 `[+0] = 1`，再把注音自己的记录 push 在它后面；
   * 显现 `sub_45BE20`（raw 72427-72435）是 `do { 贴该记录 } while (上一记录[+0])`
   * ⇒ **一步 = 本文末字 + 它的注音**（同一帧贴出）。
   * 少了这个门控，注音会在整行刚开头时就把整行注音一起亮出来（用户实测，`tickets/T-0037`）。
   */
  from: number;
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
  /**
   * ★**段 → 显示行的来源**（与 `lines` 逐项对齐、长度恒相等）：
   * `rows[i].segment` = 产出第 `i` 个显示行的那一段在 `MsgWinInput.segments` 里的下标。
   *
   * 为什么需要它：`lines[].text` 是**拼出来**的（一段的多个显示行在各行里各占一部分），
   * 只看 `lines` 无法回答"这一段被断成了几行、断点在第几个显示行之后"——
   * 而"按排版断点补换行记录"（`0x1D1`/`0x82` 的记录驱动重画）要的正是这个。
   * 引擎的对应物是逐行 push 的 120B 文本记录（`sub_46BE30` 的换行分支 raw 83607-83718
   * 每换一行 push 一条）+ `sub_46AF90` 在那一刻推进行号，两者在入队时刻一一对应。
   *
   * 不变量：**同一个段的显示行一定是连续的**（排版按段顺序推进，段边界处收尾当前行
   * ⇒ 一段的行不会与别的段交错）。判据见 `rowFeedBoundaries`。
   */
  rows: TextRow[];
  /** 全部字形数（= 逐字显现的最大计数）。 */
  glyphCount: number;
  /** 本帧实际画出的字形数（= `revealed` 截断到 `glyphCount`；`0..glyphCount`）。 */
  revealed: number;
  /** 本帧要画的字格图标（▼）；`undefined` = 这一帧没有（未武装/该窗没配字格）。 */
  cell?: MsgCellFrame;
  /**
   * ★**缺口可见标志**：本帧遇到了空白字、`blankExtent.mode === 1`、但**拿不到字体度量**
   * （`BlankExtent.measure` 未提供或返回 `undefined`）⇒ 已按 mode 0 的网格回退。
   *
   * 为什么要有它：`set:BlankExtentMode == 1` 时引擎会走逐字 GDI 量宽，而 emulator 还没有度量来源
   * —— 回退本身是必需的（否则要编数），但**必须能被观测**，不然就是"静默缺口"。只在为真时出现。
   */
  blankExtentFallback?: boolean;
}

/** 一个显示行的来源（`TextFrame.rows` 的元素；见其说明）。 */
export interface TextRow {
  /** 产出这一行的段下标（`MsgWinInput.segments` 的下标）。 */
  segment: number;
  /** 这是该段的第几个显示行（0 起）。 */
  line: number;
}

/**
 * **排版把每一段断成了几行、断点落在哪**（`TextFrame.rows` 的消费口径）。
 *
 * 返回"**行内断点**"：对这些显示行下标之后的记录位置需要一条换行标记
 * （引擎 `sub_4691D0` 的 `flags | 8` 记录 / emulator 的 `TextItemTable.pushLineFeed`）。
 *
 * 口径 = **每段内部**的相邻行之间各一个断点：一段 N 行 ⇒ N-1 个。段的**末行之后不算**
 * （那是段的收尾：`end-text-line` 0x6F 自己会推一条，见 `0x1D1`/`0x82` 的记账）。
 * 例：一段 60 字在 800 宽/字号 30 下排成 3 行 ⇒ 断点 `[1, 2]`（第 1 行后、第 2 行后），
 * 于是记录表是「行1 行2 行3 + 2 条换行记录」，与 `repaintRange` 的拼行规则合起来正好 3 行。
 *
 * 纯函数、无副作用 ⇒ 可在 Node 里断言（守卫见 `test/record-driven-lines.test.ts` 第 ② 节）。
 */
export function rowFeedBoundaries(rows: readonly TextRow[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    // 同一段内、行号递增 ⇒ 这两行之间是本段的自动换行断点（段边界处行号归 0，不是断点）。
    if (a.segment === b.segment && b.line === a.line + 1) out.push(i);
  }
  return out;
}

/**
 * Shift-JIS 字节长度 ⇒ 占多少个"半角格"。
 * ASCII 与半角片假名（U+FF61..U+FF9F）在 Shift-JIS 里是 1 字节，其余 2 字节。
 */
export function sjisBytes(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x80 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
}

/** GDI `SIZE` 的等价物：`cx` = 字形像素宽、`cy` = 字体像素高（`GetTextExtentPoint32A` 的两个出参）。 */
export interface GlyphExtent {
  cx: number;
  cy: number;
}

/**
 * **`set:BlankExtentMode` 门**（引擎：空白字前进量是否改用逐字量宽）。
 *
 * 引擎体（`sub_4072F0` raw 12221-12236；字形路径 raw 85126/85366/85638/85812/86567/87269/… 形态一致）：
 * ```c
 * if (GetConfig(engine, "set:BlankExtentMode") == 1) {     // ★判据是 == 1，不是"非 0"
 *   sub_404EE0(ctx, &sz, sjis_char);                       // GetTextExtentPoint32A（raw 10716-10739）
 *   pen += (sjis_char >= 0x100) ? sz.cy : sz.cx;           // 全角取**高**（DBCS 格是方的）、半角取宽
 * } else {
 *   pen += font_size / ((sjis_char >= 0x100) ? 1 : 2);     // = 等宽网格（raw 87279）
 * }
 * ```
 * ⇒ mode 0（随包默认）**逐字等于**本文件的 `sjisBytes(ch) × size / 2`；mode 1 = 主机字体度量。
 */
export interface BlankExtent {
  /** `set:BlankExtentMode`（引擎注册表默认 0）。只有 `=== 1` 才开门（同引擎的 `== 1`）。 */
  mode: number;
  /**
   * 引擎 `Font+201680`（= `Font` 对象 +0x313D0；**不是** `Engine+0x46100` 的 `font_metrics_mode`，
   * 那个是 `0x2DB` 写的 `Engine[71744]`，见 raw 33530）。省略 = 0。
   *
   * 唯一作用：`0x204` **描边**直绘路径（`sub_471180` raw 87269）的空白字量宽多一道
   * `Font+201680 <= 1` 门；档位 0 那条（`sub_46F2D0` raw 86057）**没有**这道门。
   * ★已核：全库对 `Font+201680` 的写入只有 raw 78769 与 raw 78895（`Initialize` 里各写一次 `= 0`），
   * 无其它写点 ⇒ 本 build 里它**恒 0**、这道门恒真（`<= 1` 连负数也算开门）。
   * 仍留作入参是为了让判据在代码里是**显式**的、可被单测钉住（`test/text-204-blank-extent.test.ts`）。
   */
  fontMetricsFlag?: number;
  /**
   * mode == 1 时的度量来源（引擎 = `GetTextExtentPoint32A`，`sub_404EE0` raw 10716-10739）。
   *
   * ★**emulator 现状 = 没有这个来源**（纯 Node 层无字体度量；宿主缝见文件尾「缺口」）：
   * `undefined` 或返回 `undefined` 时**显式回退**到 mode 0 网格，并把
   * `TextFrame.blankExtentFallback` 置真 ⇒ 缺口可见，而不是静默编一个数。
   *
   * 宿主实现时的期望语义：对**一个** SJIS 字符返回 GDI `SIZE` 的等价物 —— `cx` = 该字形在当前
   * 字体下的像素宽、`cy` = 字体像素高（≈ 请求的字号）；字体必须与**光栅化这一行用的同一**
   * family/weight，因为引擎量的是度量 IC（`Font+1108` = Engine+0x15184）上当前选中的那支 HFONT：
   * `Font+201680` 非 0 时先临时 `SelectObject` 参考面 `Font+201784`（raw 10733-10737），
   * 否则用重建留在 IC 上的 `Font+101852`（raw 71041-71046）—— 见 `fontSet.ts` 的 `metricFaceSlot`。
   */
  measure?: (ch: string, size: number) => GlyphExtent | undefined;
}

/**
 * 该字符是否走引擎的「空白字前进量」分支。
 *
 * 引擎的进入条件（raw 85083-85111 / 85352-85398 / 86555-86596 / 87255-87268，四处形态一致）：
 * **SJIS 单字节 `0x20`（半角空格）**、**双字节 `0x8140`（全角空格）**、**单字节控制字（< `0x20`）**；
 * 绘制路径另外还包括 `GetGlyphOutline` 返回 -1 的"无轮廓字"——那条在排版层**无法预知**
 * （排版例程 `sub_46BE30` 用的是 `GetTextExtentPoint32A`，不是 `GetGlyphOutline`）⇒ 本函数不收。
 */
export function isBlankExtentChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c === 0x20 || c === 0x3000 || c < 0x20;
}

/**
 * 空白字前进量的完整结果：`value` + 是否**真的**用了 mode 1 的度量。
 *
 * `measured === false` 且 `blank.mode === 1` 且该字是空白字 ⇒ **回退**（无度量来源）；
 * 调用方据此把 `TextFrame.blankExtentFallback` 置真（缺口可见）。
 */
export function blankAdvance(ch: string, size: number, blank?: BlankExtent): { value: number; measured: boolean } {
  if (blank?.mode === 1 && isBlankExtentChar(ch)) {
    const m = blank.measure?.(ch, size);
    // 全角取高（raw 85129-85132/85641-85644/85817-85824 的 `psizl.cy`；DBCS 的格是方的）、半角取宽
    if (m && (m.cx > 0 || m.cy > 0)) return { value: sjisBytes(ch) >= 2 ? m.cy : m.cx, measured: true };
    return { value: sjisBytes(ch) * size * 0.5, measured: false };
  }
  return { value: sjisBytes(ch) * size * 0.5, measured: false };
}

/**
 * 引擎的推进量：`半角格数 × 0.5em`（`lfWidth = 字高/2`）。
 * 给了 `blank`（`set:BlankExtentMode`）且 mode == 1 时，**空白字**改走逐字量宽。
 */
export function advance(ch: string, size: number, blank?: BlankExtent): number {
  return blankAdvance(ch, size, blank).value;
}

/**
 * `0x205` 数字文本的**全角格宽**（引擎 `sub_4072F0` raw 12221-12236 里那个 `psizl.cy` 变量）。
 *
 * 引擎先算 `cy = font_metrics_mode ? Font+0x46104(字号) : -lfHeight`（raw 12221-12225），
 * 再在 `set:BlankExtentMode == 1` 时**整个覆盖**它（raw 12232-12235）：
 * `cy = 半角(flags bit16) ? 2 × 量宽(0x20) : 量宽(0x8140)` —— 串里每一格的前进量 = `cy`
 * （`op6` bit1 居中时 `cy/2`、bit2 左对齐时 0；见 `handlers/msgwin.ts` 的 `0x205`）。
 *
 * mode == 0 时 `cy` 就是网格口径 ⇒ 内容不变（`measured: false`，零回归）。
 */
export function numberCellExtent(
  halfWidth: boolean,
  gridCy: number,
  blank?: BlankExtent,
): { cy: number; measured: boolean } {
  if (blank?.mode === 1) {
    // 量的是"空格字"（半角量 0x20、全角量 0x8140）：size 用网格格宽当尺度提示（GDI 那边字号已在字体里）
    const m = blank.measure?.(halfWidth ? ' ' : '　', gridCy);
    if (m && m.cx > 0) return { cy: halfWidth ? 2 * m.cx : m.cx, measured: true };
  }
  return { cy: gridCy, measured: false };
}

/**
 * 字符串的 **Shift-JIS 字节长度** —— 即引擎 `strlen()`（`0x2C5` / `0x1A6`）看到的值。
 *
 * ★为什么单独有它：emulator 内部字符串是 JS 串，`.length` 是**字符数**（≈ 引擎的 `_mbstrlen`，即 `0x2C6`），
 * 而引擎的 `strlen` 数的是**字节**：ASCII 与半角片假名 1 字节、其余 2 字节。
 * 两者在纯 ASCII 下相等，一遇日文就分叉 ⇒ `0x2C5`（`op1 = strlen(op2)`）与 `0x1A6`（`op1 = strlen(op2) >> 1`）
 * 都必须用字节长算（`tickets/T-0076` 的 B3 批次顺带订正了 `0x2C5` 此前用 `.length` 的问题）。
 */
export function sjisByteLength(s: string): number {
  let n = 0;
  for (const ch of s) n += sjisBytes(ch);
  return n;
}

/** 一个字符串按引擎网格的总宽/总长（给了 `blank` 时空白字按 `set:BlankExtentMode` 口径）。 */
export function textWidth(s: string, size: number, blank?: BlankExtent): number {
  let w = 0;
  for (const ch of s) w += advance(ch, size, blank);
  return w;
}

/** `0x204` draw-string 的一次字形绘制（宿主照这个列表画即可；纯数据 ⇒ 可测）。 */
export interface DrawStringGlyph {
  ch: string;
  x: number;
  y: number;
  /** 用填充色还是描边色画这一遍。 */
  role: 'fill' | 'outline';
  /** 叠画强度（档位 2 的"同位 1/4 强度副本"用 0.25，其余 1）。 */
  alpha: number;
}

/**
 * `0x204` 直绘路径的空白字前进量（引擎 `sub_471180` raw 87255-87280 / `sub_46F2D0` raw 86050-86067）。
 *
 * ★**与消息窗排版路径口径不同**（这是审计 `0x204`/approximation 的那条）：
 * ```c
 * // 描边档位 != 0 ⇒ sub_471180（raw 87269-87280）
 * if ( Font+201680 <= 1 && GetConfig("set:BlankExtentMode") == 1 ) {
 *   sub_404EE0(_this, &psizl, c); cx = psizl.cx;         // ← ★全角也取 cx
 * } else cx = Font+201684 / ((c < 0x100) + 1);           //   网格：半角 字号/2、全角 字号
 * // 描边档位 == 0 ⇒ sub_46F2D0（raw 86057-86067）：同一形状，但**没有** Font+201680 那道门，
 * // 且网格除数用 `(__int16)Font+201704`（`sub_456C90` 写的度量字）而不是字号。
 * ```
 * 消息窗排版（`blankAdvance`）全角取的是 `psizl.cy`（raw 85129-85132）⇒ **两条路不许互相照搬**。
 *
 * ★`(int16)Font+201704` 那一格（档位 0 的 mode-0 除数）**未建模**：它是 `sub_456C90`（raw 68697-68718）
 * 用 `GetGlyphOutline(Font+1108, 0x8C83, …)` 填的参考字度量，emulator 没有等价来源 ⇒ 这里统一用
 * `size`（两者在标准字号下相等；差只可能出现在「参考字 0x8C83 的宽度 ≠ 字号」时）。
 */
export function drawStringBlankAdvance(
  ch: string,
  size: number,
  outlineMode: 0 | 1 | 2 | 3,
  blank?: BlankExtent,
): { value: number; measured: boolean } {
  const grid = sjisBytes(ch) * size * 0.5; // 引擎 raw 87279 / 86066 的 `字号 / ((全角?0:1)+1)`
  if (blank?.mode !== 1) return { value: grid, measured: false };
  // ★`Font+201680 <= 1` 只在描边路径上（raw 87269）；档位 0 那条没有这道门。
  if (outlineMode !== 0 && (blank.fontMetricsFlag ?? 0) > 1) return { value: grid, measured: false };
  const m = blank.measure?.(ch, size);
  // ★全角也取 `cx`（不是消息窗那条的 `cy`）
  if (m && m.cx > 0) return { value: m.cx, measured: true };
  return { value: grid, measured: false };
}

/** `0x204` 直绘路径的单字前进量。 */
export function drawStringAdvance(ch: string, size: number, outlineMode: 0 | 1 | 2 | 3, blank?: BlankExtent): number {
  return isBlankExtentChar(ch) ? drawStringBlankAdvance(ch, size, outlineMode, blank).value : advance(ch, size);
}

/**
 * **单行直绘文本的字形位置表**（`0x204` draw-string → 引擎 `sub_456710` 的 GDI 整串直绘）。
 *
 * 与消息窗的区别：这里**不换行、不排版**，就是"从 (x,y) 起按等宽网格推进一路画过去"，
 * 描边语义与消息窗同一套（档位来自 `Font+1372`，见 `raster.ts` 的表）。
 * 抽成纯函数的原因：canvas 只在浏览器里有，而"推进量/描边副本位置"是**引擎语义**，
 * 必须能在 Node 里断言（见 `test/draw-string.test.ts`）。
 */
export function drawStringGlyphs(
  text: string,
  x: number,
  y: number,
  size: number,
  outlineMode: 0 | 1 | 2 | 3,
  outlineDx: number,
  outlineDy: number,
  blank?: BlankExtent,
): DrawStringGlyph[] {
  const out: DrawStringGlyph[] = [];
  let cx = x;
  for (const ch of text) {
    switch (outlineMode) {
      case 1:
        out.push({ ch, x: cx + outlineDx, y: y + outlineDy, role: 'outline', alpha: 1 });
        out.push({ ch, x: cx, y, role: 'fill', alpha: 1 });
        break;
      case 2:
        out.push({ ch, x: cx, y, role: 'fill', alpha: 1 });
        out.push({ ch, x: cx, y, role: 'outline', alpha: 0.25 });
        break;
      case 3:
        out.push({ ch, x: cx + outlineDx, y: y + outlineDy, role: 'outline', alpha: 1 });
        out.push({ ch, x: cx - outlineDx, y: y - outlineDy, role: 'outline', alpha: 1 });
        out.push({ ch, x: cx + outlineDx, y: y - outlineDy, role: 'outline', alpha: 1 });
        out.push({ ch, x: cx - outlineDx, y: y + outlineDy, role: 'outline', alpha: 1 });
        out.push({ ch, x: cx, y, role: 'fill', alpha: 1 });
        break;
      default:
        out.push({ ch, x: cx, y, role: 'fill', alpha: 1 });
        break;
    }
    cx += drawStringAdvance(ch, size, outlineMode, blank);
  }
  return out;
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
    vPad: { x: 0, y: 0, dw: 0, dh: 0 },
    align: 0,
    alignWidth: 0,
    outlineMode: 1,
    // ★引擎的**初始化值**是 1/1（raw 78780-78781 `Font+1384/+1388 = 1`；`0x1A4` 之后由脚本改写）。
    //   早前这里是 2/2（错把某个脚本值当默认）⇒ 未显式设过偏移的文本描边副本会偏出去 2px。
    outlineDx: 1,
    outlineDy: 1,
    // ★引擎 Initialize 初值 6（raw 78858 `Font+1380 = 6`）；脚本用 `i08b`（op 0x8B）改写，
    //   ADV 标准样式前导写的是 `i08b 10`（= 16）⇒ 行距 30+16 = 46px。
    lineSpacing: 6,
    main: { family: 'Amayui CN', size: 30, weight: 400, fill: '#ffffff', outline: '#000000', antiAlias: true },
    ruby: { family: 'Amayui CN', size: 10, weight: 400, fill: '#ffffff', outline: '#000000', antiAlias: true },
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
  /** `set:BlankExtentMode` 门（`undefined` = 未接线，行为与 mode 0 相同）。 */
  const blank = input.blankExtent;

  /** 收集全部注音对（跨段累计），配对时按行文本过滤。 */
  const pairs: [string, string][] = [];
  for (const seg of input.segments) for (const p of seg.ruby) pairs.push(p);

  const lines: TextLine[] = [];
  let glyphs: Glyph[] = [];
  let chars: string[] = [];
  /** ★本帧每个显示行的来源（段下标 + 段内行号）—— 与 `lines` 同步增长，供 `rowFeedBoundaries` 用。 */
  const rows: TextRow[] = [];
  /** 正在排的那一段的下标（段边界处推进）；`flush` 用它记来源。 */
  let segmentAt = 0;
  /** 当前段已经产出的显示行数（段边界处归 0）⇒ `flush` 的"段内行号"就是它。 */
  let segmentRow = 0;
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
    pairRuby(line, pairs, st, blank);
    applyAlign(line, st);
    lines.push(line);
    // ★行来源：与本段已产出的行数无关地自增"段内行号"（见 `TextFrame.rows` 的说明）。
    rows.push({ segment: segmentAt, line: segmentRow });
    segmentRow += 1;
    glyphs = [];
    chars = [];
  };

  /**
   * 换行；返回 false = 已越过下边界（引擎报「文字がウインドウ内に収まりません」并停，raw 83720-83728）。
   *
   * ★步进 = **字号 + 行间距**（`Font+1380`）：引擎在 `sub_46AF90`（raw 82674-82690）里
   * `v7 = v8 + Font+1380` 再 `*(新行记录 - 16) += v7`。只加字号会让注音（画在行顶上方
   * 一个注音字高）压到上一行 —— `tickets/T-0038`。
   */
  const wrap = (): boolean => {
    flush();
    lineStartY += size + st.lineSpacing;
    if (lineStartY + size > st.wrapBottom) return false; // `win+40`
    penX = lineStartX;
    penY = lineStartY;
    return true;
  };

  let outOfRoom = false;
  // ★`set:BlankExtentMode == 1` 但拿不到字体度量 ⇒ 本帧有空白字时置真（见 TextFrame.blankExtentFallback）
  let blankFallback = false;
  for (let segIdx = 0; segIdx < input.segments.length; segIdx++) {
    const seg = input.segments[segIdx]!;
    segmentAt = segIdx;
    for (const ch of seg.text) {
      const r = blankAdvance(ch, size, blank);
      if (!r.measured && blank?.mode === 1 && isBlankExtentChar(ch)) blankFallback = true;
      const adv = r.value;
      if (penX + adv > st.wrapRight && glyphs.length > 0 && !wrap()) {
        outOfRoom = true;
        break;
      }
      glyphs.push({ ch, x: penX, y: lineStartY, i: chars.length + 1 });
      chars.push(ch);
      penX += adv;
    }
    if (outOfRoom) break;
    // ★段的收尾**必须落在段边界上**：`end-text-line` 的换行要断在"这一段之后"，
    //   而不是断在"这一段之后又来了一段"之后 —— 否则这一段的显示行会与下一段拼进同一行。
    if (seg.lineEnded && !wrap()) break;
    // 段边界：下一段的显示行从 0 起算（`rows` 的 `segment`/`line` 两格，见 `TextFrame.rows`）。
    segmentRow = 0;
  }
  // ★**这一个收尾换行（`flush()` 出的空行）不留**：`wrap()` 无条件 `flush()`，于是"以一个
  //   `end-text-line` 段收尾"的页会多出末尾一条空显示行。引擎不产生它 —— `sub_46BE30` 的换行
  //   只在**逐字循环里**触发（raw 83607-83718 的量宽/越界判据），空串上一个字都没有。
  //   ★位置**必须在最终 `flush()` 之前**：清掉它之后，之后 `flush()` 出的行会以行号 0 重新开始
  //   （= 属于同一个段），否则那个段的下标会与 `input.segments` 错位一格（`rows` 的 `segment` 就废了）。
  //   中间的段边界不受影响（下一个段仍有字要排，行号会归 0 继续）。
  if (
    lines.length > 1 &&
    rows[rows.length - 1]!.line > 0 &&
    lines[lines.length - 1]!.glyphs.length === 0
  ) {
    lines.pop();
    rows.pop();
  }
  if (glyphs.length > 0 || lines.length === 0) flush();

  const glyphCount = lines.reduce((n, l) => n + l.glyphs.length, 0);
  // ★约定：**负数 = 全部显示**（`MsgWindow.revealedOf` 对"没有显现状态"的窗返回 -1）；
  //   `0` = 一个字都不画（显现刚起步）。把负数当 0 处理会让**所有普通窗口变成空白**
  //   —— 2026 实测的"文字直接不显示"就是这个（模型对、画面空，属最难查的静默缺陷）。
  const rev = input.revealed ?? glyphCount;
  const revealed = rev < 0 ? glyphCount : rev >= glyphCount ? glyphCount : rev;
  return blankFallback
    ? { win, style: st, lines, rows, glyphCount, revealed, blankExtentFallback: true }
    : { win, style: st, lines, rows, glyphCount, revealed };
}

/**
 * 注音摆位：居中于本文词**上方**一个注音字高（引擎以本文词宽为基准，`sub_4572A0` raw 68886）。
 *
 * 可见时机（`from`）：引擎把注音记录挂在本文词**末字**的 24B 记录之后并给那条记录标 `[+0]=1`
 * （raw 83988-83997），显现循环 `do { 贴 } while (上一记录[+0])`（raw 72427-72435）于是
 * 在同一步里贴出「本文末字 + 注音」⇒ `from` = 本文词末字在本行里的序号（`tickets/T-0037`）。
 */
function pairRuby(line: TextLine, pairs: [string, string][], st: MsgWinStyle, blank?: BlankExtent): void {
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
    const x1 = last.x + advance(last.ch, st.main.size, blank);
    let rx = x0 + (x1 - x0 - textWidth(ruby, rSize, blank)) / 2;
    // 引擎：`ruby.y = 行 y + Font+1292`（Font+1292 = **-注音字号** ⇒ 行顶上方一个注音字高），
    // 且非 D3D 路径（DrawMode != 1）且 `Font+218600 == 0`（全库只读不写 ⇒ 恒 0）时再 **+1**
    // （sub_465A20 raw 79089-79091 一带；`Font+218600` 初值 raw 78772）。
    const ry = first.y - rSize + 1;
    for (const ch of ruby) {
      line.ruby.push({ ch, x: rx, y: ry, from: last.i });
      rx += advance(ch, rSize, blank);
    }
  }
}

/**
 * 对齐（引擎 `sub_4576C0` raw 69147-69231，消费点 raw 79940-79947 的 `sub_4AC750`）。
 *
 * 引擎语义（`win+288` = mode、`win+292` = op3，由 `0x303` 写）：
 * ```c
 * if (mode == 1) shift = win+292 - (maxX - minX) / 2;   // ★居中：op3 是**行中心**
 * else if (mode == 2) shift = minX + win+292 - maxX;    // 右对齐：行右缘落到 op3
 * // mode == 0 → 不位移
 * *a4 = shift; *a5 = 0;   // 返回的是 (x, y) **位移**，调用方把行图元平移这么多
 * ```
 * ★2026-09 修正：旧实现按"op3 = 对齐宽度"算成 `(op3 - 行宽)/2`，**少了 op3/2**。
 * 反例（真机截图）：win 8 由 `SYSTEM4.txt:70 i303 8 1 1f4` 置 mode=1、op3=500，
 * 块原点 x = 140（`i079 8 8c 10` / 序章 `i07a 8 8c 12c`）⇒ 行中心 = 140 + 500 = **640（屏幕中心）**，
 * 与实机画面一致；旧式给 `(500-780)/2 = -140` ⇒ 文字被推到 x<0 的左上角。
 */
function applyAlign(line: TextLine, st: MsgWinStyle): void {
  if (st.align === 0) return;
  const off = st.align === 1 ? st.alignWidth - line.width / 2 : st.alignWidth - line.width;
  if (off === 0) return;
  for (const g of line.glyphs) g.x += off;
  for (const g of line.ruby) g.x += off;
}

/** 逐字显现：`revealed` = 已显示到的字形总数（跨行累计）；返回本行应画出的字形个数。 */
export function visibleInLine(line: TextLine, lineStartIndex: number, revealed: number): number {
  const n = revealed - lineStartIndex;
  return n <= 0 ? 0 : n >= line.glyphs.length ? line.glyphs.length : n;
}

/**
 * 本行该画出的注音字形（逐字显现期间）。
 *
 * 引擎的一步显现 = 「本文词的**末字** + 它的注音」（`sub_45BE20` 的 `do { 贴 } while (上一记录[+0])`，
 * raw 72427-72435；注音记录由 `sub_46BE30` 收尾 push，raw 83988-83997）
 * ⇒ 注音的 `from` ≤ 本行已显现字数时才画。少了这道门，整行注音会在该行刚出现第一个字时就全亮
 * （用户实测，`tickets/T-0037`）。
 */
export function visibleRubyInLine(line: TextLine, revealedInLine: number): RubyGlyph[] {
  return line.ruby.filter((g) => g.from <= revealedInLine);
}

// ---------------------------------------------------------------------------
// 缺口（`tickets/T-0085`）：`set:BlankExtentMode == 1` 的**字体度量来源**
// ---------------------------------------------------------------------------
/**
 * 门本身已接线（`MsgWinInput.blankExtent` ← `handlers/msgwin.ts` 的 `emitWin` 读
 * `set:BlankExtentMode`），**但 mode == 1 需要的"字形度量来源"在 emulator 里还不存在** ——
 * 这一节把"要拿到什么、从哪来"写死在这里，避免下次又从"只有一个数字不对"开始查。
 *
 * ## 引擎要的是什么
 * `sub_404EE0`（raw 10716-10739）对**一个字符的 Shift-JIS 字节**（`0x8140` 全角空格要 2 字节、
 * `0x20` 半角空格 1 字节，`strlen` 数的是字节数）调度量 IC（`Font+1108` = Engine+0x15184）上的
 * `GetTextExtentPoint32A` ⇒ 出参 `SIZE{cx = 该字形像素宽, cy = 字体像素高}`。
 * 量之前若 `font_metrics_mode`（Engine+0x46100）非 0，会先临时 `SelectObject` 那支
 * 按纵横比缩放的字体（Engine+0x46168）并在量完还原（raw 10733-10737）。
 * 消费点的用法（形态一致）：**全角取 `cy`**（DBCS 的格是方的）、**半角取 `cx`**；
 * `0x205`（`sub_4072F0` raw 12232-12235）例外地只用 `cx`：全角 `cy = 量宽(0x8140)`、
 * 半角 `cy = 2 × 量宽(0x20)`。
 *
 * ## emulator 缺的正是"宿主字体度量 API"
 * `BlankExtent.measure` 是**唯一**的注入点（签名见其注释）。三种可选来源，按推荐序：
 *  1. **宿主 canvas 度量**（首选，等价物最直接）：字体加载完（`renderer/text/fontLoader.ts`）后
 *     `ctx.font = \`${weight} ${size}px ${family}\`` + `measureText(ch)` ⇒ `cx = width`、
 *     `cy = size`（GDI 的 `cy` 就是字体像素高）。需要一条**从渲染宿主到 `MsgWinInput` 的缝**：
 *     `MsgWinInput` 由 VM 的 `emitWin` 组装、宿主只读它 ⇒ 要么在渲染侧 sync 时补 `measure`
 *     （`scMsgWinSync` 是唯一调用点），要么给 `native` 加一个 `measureText` 回调（`native.ts`
 *     属别的票的范围）。**本票没有改 `renderer/**` 与 `native.ts`**（并发分工），故留空。
 *  2. **自建度量表**：解析 `res/fonts/` 那两支 TTF 的 `hmtx`（advanceWidth）/`head`（unitsPerEm）
 *     ⇒ `cx = advance × size / unitsPerEm`。纯 Node 可跑、可单测，但要知道字体文件与当前
 *     family/weight 的对应（`fontSet.ts` 有表）。
 *  3. **不实现**：保持 `measure` 为 `undefined`（现状）⇒ mode 1 下布局显式回退到 mode 0 网格，
 *     `TextFrame.blankExtentFallback` 置真。**默认配置（INI 的 `BlankExtentMode=0`）下这与引擎
 *     逐字等价**，所以这条只影响玩家手动把该项设成 1 的情况。
 *
 * ## 还有两处没接（同一张票的显式缺口，写法与理由）
 *  - `0x204`（`drawStringGlyphs` → `native.drawString` → `renderer/pixi/textureCache`）：
 *    ★**纯函数侧已按体补齐**（`tickets/T-0151`）：`drawStringBlankAdvance` / `drawStringAdvance`
 *    实现了 `sub_471180`（raw 87269-87280）与 `sub_46F2D0`（raw 86057-86067）的空白字分支
 *    （mode 1 取 `psizl.cx`、**全角也取 cx**；描边路径多一道 `Font+201680 <= 1` 门），
 *    `drawStringGlyphs` 也多了第 8 个可选参 `blank?: BlankExtent`。
 *    **仍未接线**：`renderer/pixi/textureCache.ts:375` 的调用点还停在 7 个实参、`native.drawString`
 *    的宿主参数里也没有 `blankExtent` ⇒ `set:BlankExtentMode=1` 时直绘文本的空白字前进量仍走网格。
 *    （那两个文件属别的 owner 的范围，本票没动；接线只需把 `emitWin` 的那份 `BlankExtent` 透传给宿主。）
 *  - **绘制期"无轮廓字"**：引擎在 `GetGlyphOutline` 返回 -1 时也走空白字分支（raw 85115/85808），
 *    那是**光栅化时**才知道的信息（本模块只有排版，拿不到字形是否缺轮廓）⇒ 未建模。
 *
 * ## 还缺的度量输入（`0x204` / `0x205` 共用）
 *  - `sub_404EE0` 量的**是哪支句柄**已查清并落库：`Font+201680` 非 0 ⇒ `Font+201784`
 *    （`sub_456C90` raw 68712-68716 建的 `"ＭＳ ゴシック"` 参考面），否则用度量 IC 上当时选中的
 *    `Font+101852`（raw 71041-71046）—— 见 `fontSet.ts` 的 `metricFaceSlot`。
 *  - **缩放修正**未建模：`Font+218592 / Font+218596`（纵横比修正，raw 71088-71090）与
 *    `Font+218520`（raw 87289-87291 的 `cx = (int)(cx * Font+218592 + 0.5)`）。纯函数见
 *    `fontSet.ts` 的 `aspectCorrectedLfWidth` / `aspectScaledLfHeight`；要不要用取决于
 *    `display:AspectMode`，而 emulator 没有这对字段 ⇒ 登记在 `GDI_FACE_REBUILD_NOT_MODELED`。
 *
 * ## 还没读到、不确定的（不许沉默掩盖）
 *  - 全角分支在 20 余处里有两种写法：多数用 `psizl.cy`（raw 85130/85642/85815），
 *    `sub_471180` 那支（raw 87274-87279）**两种宽度都用 `psizl.cx`**，且开门的条件多一条
 *    `font_metrics_mode <= 1`（raw 87269：度量模式 > 1 时即使 `BlankExtentMode == 1` 也走字号公式）。
 *    本模块按多数写法（全角取 `cy`）实现、且没有 `font_metrics_mode` 输入 ⇒ 后一条未建模；
 *    **语料里不可达**：`i2db` 全仓只有 **1 处**（值 `1`）⇒ `font_metrics_mode ∈ {0, 1}`，
 *    条件恒真。差异留 E4。
 *  - `sub_46DED0`（raw 85136-85140）与 `sub_46E3E0`/`sub_46FB90` 的 mode 0 写法方向不同
 *    （`a4 -= tmHeight` vs `a3 -= 2*lfWidth`，后者因 `lfWidth` 为负而实际前进）；前一处的
 *    `a4` 是竖排字体的 y 笔位（`a4 += tmHeight` 是正常字的前进）⇒ 空白字反向的具体原因未确证。
 */
