/**
 * **消息窗 / ADV 子系统**的 opcode 实现。
 *
 * 这一族是「跨指令的持续状态」最典型的地方：`show-text` 写内容、`end-text-line` 断行、
 * `wait-for-input` 结束一页并把脚本**挂起**，玩家推进后才继续。引擎把它摊在
 * `_this[1223xx] / [1415] / [9705x]` 与两个对象表里；emulator 过去只把它当整数塞进
 * `engineValues`，于是出现「ADV 位永久置住 → `sleep` 被整条跳过 → 每帧空转 10000 条指令」
 * 这类**无声错误**（2026 实测 TITLE 空转 598000 步/秒）。
 *
 * ## 关键结论（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 * - `0x6E`(sub_41EB20) / `0x71`(sub_41ED80) / `0x72`(sub_41EEF0) 共用同一骨架：**置
 *   `effect_flags |= 0x8000000`（ADV＝逐字显示中）受 `GetConfig("message:ReadTextSkip")` 门控**。
 *   emulator 无文本渲染 ⇒ 逐字显示视为**立即完成** ⇒ **不置 ADV**。这是修掉"位卡死"的关键。
 * - `0x72` 清完 ADV 后置 `effect_flags |= 0x80000000`（**等待推进门**）；主循环在该位下
 *   每帧只调 `sub_411BC0` + `Sleep(2)`，**不派发脚本指令** ⇒ 脚本真正挂起。
 * - `0x71` 是**"开始一段新消息"**（`sub_45EC60`）：清该窗文本记录向量 + 复位显现游标，
 *   然后才判 ADV。**漏掉清空 ⇒ 上一屏文案残留并在下次 `0x71` 被当新消息重新逐字显现**
 *   （2026 实测：「首次进设置直接显示 / 退出后主界面逐字显示 / 再进设置两行」）。
 * - ADV 位的**每帧**清除者 `sub_411900` 与等待门的推进者 `sub_411BC0` 属帧循环（第二层），
 *   由宿主（renderer session / headless 驱动）调用 `Engine.serviceAdvanceWait()`。
 *
 * ## 不做的部分（明确记录，不假装实现）
 * 文本**布局与 GDI 渲染**（`sub_456430` / `sub_45D660` / `sub_45BE20` / `sub_465390`）、
 * 消息窗对象的每帧布局节流（`sub_409400`，bit `0x20000000`）与键绑定表驱动的推进条件
 * （`sub_403E70` + `set:WheelKeyUp/Down`）都不建模。本模块只忠实实现**状态机与控制流**，
 * 文本内容按槽保存（足够让 `wait-for-input` 的挂起/推进成立）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { ADV_ACTIVE, CHAR_REVEAL_ACTIVE, SLEEP_GATE, type Engine } from '../engine.js';
import { cfgInt } from '../../engineConfig.js';
import {
  advance,
  defaultWinStyle,
  layoutWindow,
  numberCellExtent,
  type BlankExtent,
  type FontSpec,
  type FontStyleSnapshot,
  type MsgCellFrame,
  type MsgWinStyle,
} from '../../text/layout.js';
import { ENGINE_FONT_LIST, AGE_EXTEND_FACES, fontListIndex, resolveFace } from '../../text/fontSet.js';
import { REVEAL_FRAME_MS, WINDOW_OBJECT_SLOTS } from '../msgwin.js';
import { REPAINT_KEEP_SURFACE, REPAINT_RUBY_RANGE, REPAINT_SET_COLORS } from '../textItems.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { CFG, registryDefault } from '../../configRegistry.js';

/**
 * 取本族的**操作数计划视图**；缺计划 = 编程错误（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 *
 * ★本族（`tickets/T-0082` 批次"消息窗族整表"）**51 条一次迁完** —— 全库最大的一族。
 * 三条（`0x73`/`0x90`/`0x25c`）用的是**变量 n 的辅助读法**（`rd(n)` / `.map((n) => readIntOperand(…, n))`），
 * 迁移时按同一口径替换（机械侦察一开始把它们误看成"只读 1 位"）。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：消息窗族走操作数计划层，但没有声明计划`);
  return p;
}
import type { OpTable } from './shared.js';

const setAdv = (e: Engine): void => void (e.effectFlags |= ADV_ACTIVE);
const clearAdv = (e: Engine): void => void (e.effectFlags &= ~ADV_ACTIVE);

/**
 * **已画文本行的记录颜色**（引擎 `sub_45F090` raw 74386-74393 的 `+20/+24`）。
 *
 * 引擎写入端逐字：`v12[5] = _this[340]`（`Font+1360` = 填充色）、`v12[6] = _this[341]`
 * （`Font+1364` = 描边色）—— 与 `globalTextStyle` 读的是**同一对字段**，所以这里取同一份
 * `ENGINE_FIELD.colorFill/colorOutline`（存的是 **COLORREF**，读时才 `bgrToRgb`）。
 * 初值与 `globalTextStyle` 的缺省一致（填充 `0xffffff`、描边 `0x000000`）。
 *
 * ★为什么要照抄这两个值：`0x1D3` 是按 `+24 == key` 匹配的，记录里这两格**必须**是真值，
 * 否则脚本按颜色当键的那类查询会静默错配（`src/HISTORY.txt:33` 正是拿 `key = -1` 问
 * "这一页有没有已画行"）。
 */
function rowColors(e: Engine): { fill: number; outline: number } {
  return {
    fill: e.engineValues.get(ENGINE_FIELD.colorFill) ?? 0xffffff,
    outline: e.engineValues.get(ENGINE_FIELD.colorOutline) ?? 0x000000,
  };
}

/**
 * **已画文本行的记账门**（引擎 `0x6E`/`0x196` 的第 5 实参 = `Engine[97055]`）。
 *
 * 引擎两个文本入队指令都把 `_this[97055]` 当 `sub_46BE30` 的 **第 5 实参 `a5`** 传下去
 * （raw 28330/28375 与 29088/29104），而被调体在**写记录**那一步才查它：
 * `if ( a5 >= 0 ) sub_4691A0(_this, win, a5, &v100, Font+201684, Source);`（raw **83941-83942**）
 * ⇒ `i1bb 0`（`0x1BB` 把 `Engine[97055]` 写成 `0x80000000`）期间**不记已画行**（但仍然排版/绘制）。
 * `0x6F` 的换行记录同理：`sub_4691D0` raw **81549** 的 `if ( a3 >= 0 ) { … sub_4691A0(…, a3 | 8, …) }`
 * （`a3` 也是 `Engine[97055]`，见 `sub_41ECE0` raw 28394-28397）。
 *
 * ★这是审计 `0x196`/missing-operand-io 点名的"第 4 实参不是操作数、而是 `Engine[97055]`"那条的
 * **真实后果**：修前 emulator 的 `recordRenderedRow`/`pushLineFeed` 无条件记账 ⇒ `i1bb 0` 片段
 * 也会进回看页记录表（`src/SC0000.txt:1554-1560` 的语音重播片段就是靠它不被记账）。
 */
function recordGateOpen(e: Engine): boolean {
  // ★`| 0` 把 `0x80000000` 归成 32 位有符号（引擎那一格是 `int`，`0x80000000` 就是负数）——
  //   `0x1BB`（`handlers/text-items.ts`）已经写成 `0x80000000 | 0`，这里再兜一次，
  //   免得"某处存成无符号正数"时门静默常开。
  return ((e.engineValues.get(ENGINE_FIELD.textBaseGate) ?? 0) | 0) >= 0;
}

/** 把刚入队的这一段正文记进 `Font+3364` 记录表（引擎 `sub_46BE30` → `sub_45F090`，门见上）。 */
function recordRenderedRow(e: Engine, slot: number, text: string): void {
  if (text === '') return; // 引擎对空串不产生可见行；记账也无意义（`sub_4691D0` 那条另有 `flags|8`）
  if (!recordGateOpen(e)) return; // raw 83941-83942：`Engine[97055] < 0` ⇒ 不记
  const { fill, outline } = rowColors(e);
  e.textItems.pushRenderedRow(e.msgwin.resolveWin(slot), text, fill, outline);
}

/**
 * **文本色的 BGR→RGB 交换**（丢弃 alpha 字节）—— 引擎文本色写入端的**唯一口径**。
 *
 * 引擎逐字（`sub_466000` raw 79666/79668）：
 * `*(_DWORD *)(_this + 1360) = BYTE2(a5) + ((BYTE1(a5) + ((unsigned __int8)a5 << 8)) << 8);`
 * ⇒ 取低 3 字节按 **B,G,R** 读入、写成 `0xRRGGBB`；`0x76`/`0x77`（`ENGINE_FIELD_STORE` 的
 * `transform`）用的是同一段位运算，所以三处写入端共用本函数（写两份必然漂移）。
 */
export function bgrToRgb(v: number): number {
  return ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff);
}

/**
 * 写引擎配置注册表（`SetConfig` 的等价物）：`Engine.config.values` 就是注册表。
 *
 * 为什么要写它：`0x1B5/0x1B9/0x2E7/0x2E8/0x2CD/0x141` 这类指令的全部作用就是"把值持久化进配置"，
 * 漏掉则"设置界面改了但下次启动又变回去"。数值本身同时也写进引擎字段（各 handler 自己负责）。
 *
 * ★**落盘**：写完后通知宿主（`Engine.onConfigChanged`）—— Electron 走 IPC 写回
 * `SYS4REG.INI`，headless 直接写文件；测试不注入该钩子 ⇒ 仓库配置不会被测试改动。
 * 读回侧见 `config-read.ts`（`0x2E6`/`0x2EA`/`0x1B8`/`0xC5`/`0xC7`/`0x2CC` 等）。
 */
export function setConfigValue(e: Engine, key: string, value: number): void {
  if (!e.config) {
    e.config = { values: new Map(), sections: [], order: new Map() };
  }
  // 手工构造的配置（测试里 `{values, sections}`）可能没有 `order` ⇒ 补一个，别让"记键序"把写配置搞崩
  if (!e.config.order) e.config.order = new Map();
  const k = key.toLowerCase();
  e.config.values.set(k, value);
  // 记下分节/键序，保证回写时 INI 的排版不被重排（新键追加到该节末尾）
  const [section = '', ...rest] = k.split(':');
  const bare = rest.join(':');
  if (section && !e.config.sections.includes(section)) e.config.sections.push(section);
  const keys = e.config.order.get(section) ?? [];
  if (bare && !keys.some((x) => x.toLowerCase() === bare)) {
    keys.push(bare);
    e.config.order.set(section, keys);
  }
  e.onConfigChanged?.(e.config);
}

// ---------------------------------------------------------------------------
// 文本渲染状态 → 渲染层（引擎「每窗一张离屏表面」的等价物）
// ---------------------------------------------------------------------------

/**
 * 把引擎字段里的**全局**样式（颜色/描边）读成 `#rrggbb`。
 *
 * ★`0x76`/`0x77`（raw 28663-28682）把**脚本的 RGB 值**翻成 **COLORREF** 存进 `_this[21664]/[21665]`，
 * 引擎随后把该字段**原样交给 GDI**（raw 79241 → 68093 `SetTextColor(hdc, *(Font+1360))`）
 * ⇒ 字段是 COLORREF（`0x00BBGGRR`），**取用时必须再翻一次**才是屏幕上的 RGB
 * （见 `globalTextStyle` 的注释与 `tickets/T-0102` 判据 4）。`bgrToRgb` 是逐字节对合 ⇒
 * `bgrToRgb(bgrToRgb(v)) === v`，于是"字段→屏幕色"就是脚本原值。
 */
const hex6 = (rgb: number): string => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

/**
 * ★**引擎文字"偏灰"的真正机制 = 字形覆盖率合成**（`tickets/T-0042`，2026-09 定位）。
 *
 * 引擎自己光栅化字形：`sub_46F2D0` 取 `GetGlyphOutline` 的**覆盖率位图**（raw 86146：
 * `v62 = 5`/`6` = `GGO_GRAY4/GRAY8_BITMAP`，AA 关时才是 `1` = `GGO_BITMAP`），
 * 交给合成器 `sub_46D9F0` 逐像素写目标表面（32bpp 分支 raw 84956-85011）：
 *
 * ```text
 * v29 = 255 * cov                       // 覆盖率 0..16（GRAY4）
 * v30 = v29 / 17  (或 /65 for GRAY8)    // ← 满覆盖 16 ⇒ 240，永不为 255
 * dst = (C * v30 + dst * (255 - v30)) / 255   // 与**已经画好的描边**混合
 * ```
 *
 * ⇒ **填充永不不透明**：满覆盖也只在 0.88~0.94 之间，于是"白字"落在
 * `α·255 + (1-α)·描边色` 上 —— 实测 `(233,230,228)`（序章旁白，描边≈`(63,32,16)`）
 * 正好等于 `(255·225 + dst·30)/255`；而模拟器此前把描边色/填充色**当成不透明纯色**画，
 * 所以"字更白、更粗"。**这条同时解释了偏灰与偏粗**（覆盖率在边缘还有斜坡）。
 *
 * 数值常量与"为什么按覆盖率路径画"的判据放在 `text/layout.ts` 的 `TEXT_FILL_ALPHA`。
 */

/**
 * **全局文本样式**（不依赖任何窗几何）—— 引擎 `Font` 对象上那几个"当前字体/颜色/描边"字段的快照。
 *
 * 用途：任何"直绘文本"的指令（`0x204` draw-string → `sub_456710(Font, 槽, 串, x, y)`）
 * 用的就是同一套全局字段；消息窗的 `styleOfWin` 也在这里取 main/outline 部分，避免两处各写一遍。
 *
 * 字段（`engineValues` 下标 = 字节偏移/4，见 `ENGINE_FIELD_STORE`）：
 * `21664` ← `Font+1360` 填充色（`0x76` 写，BGR→RGB 已重排）、`21665` ← `Font+1364` 描边色（`0x77`）、
 * `21667` ← `Font+1372` 描边档位（`0x2BD`/`0x2BE` 一族的邻位）、`21670/21671` ← 描边偏移。
 */
export function globalTextStyle(e: Engine): {
  main: FontSpec;
  outlineMode: 0 | 1 | 2 | 3;
  outlineDx: number;
  outlineDy: number;
  /** 行间距（`Font+1380` = Engine[21669]；op `0x8B`）；换行步进 = 字号 + 本值。 */
  lineSpacing: number;
} {
  const m = e.msgwin;
  const v = (k: number, d: number): number => e.engineValues.get(k) ?? d;
  const base = defaultWinStyle();
  return {
    main: {
      family: resolveFace(m.font.mainFace, e.resourceVersion).family,
      size: m.font.mainSize,
      weight: m.font.mainBold ? 700 : 400,
      // ★填充/描边**不再压暗颜色**：引擎的"偏灰"是字形覆盖率的合成结果（见上 `TEXT_FILL_ALPHA`），
      //   由光栅化侧按 `globalAlpha` 复现 ⇒ 这里必须给出脚本/config 的**原色**。
      //
      // ★★**字段是 COLORREF，取用时要换回 RGB**（`tickets/T-0102` 判据 4，2026-09 修）：
      //   引擎 `0x76`（`sub_41F390` raw 28663-28671）把**脚本的 RGB 值**翻成 COLORREF 存进
      //   `Font+1360`，然后**原样喂给 GDI**：raw 79241 `sub_455ED0(..., *(Font+1360), *(Font+1364), ...)`
      //   → raw 68093 `SetTextColor(hdc, color)` —— `SetTextColor` 收的是 `COLORREF(0x00BBGGRR)`。
      //   ⇒ 屏幕上看到的颜色 = **COLORREF 读法**下的那个字段 = `bgrToRgb(字段)` = 脚本原值。
      //   修前这里直接把字段当 `0xRRGGBB` 交给渲染器 ⇒ R/B 互换：阿瓦罗（脚本 `0xffe100` 橘）
      //   渲染成 `#00E1FF` 青、角色设定页残留色（`0xff90b6`）渲染成 `#B690FF` 紫（用户实测两条症状）。
      fill: hex6(bgrToRgb(v(21664, 0xffffff))),
      outline: hex6(bgrToRgb(v(21665, 0x000000))),
      // ★抗锯齿（`Font+1352` = Engine[21662]，`tickets/T-0035`）：配置门（`set:EnableAntiFont`）
      //   在真机 INI 里是关的，但**实测像素只可能来自覆盖率路径**（1bpp 路径的 α 恒满 ⇒ 255）。
      //   ⇒ 以"像素判据"为准开 AA；配置门的推导见 `TEXT_FILL_ALPHA` 的注释。
      antiAlias: true,
    },
    outlineMode: (v(21667, base.outlineMode) & 3) as 0 | 1 | 2 | 3,
    outlineDx: v(21670, base.outlineDx),
    outlineDy: v(21671, base.outlineDy),
    // ★行间距（`Font+1380` = Engine[21669]，初值 6；op `0x8B`/`i08b` 写，ADV 前导写 16）：
    //   换行步进 = 字号 + 本值（`sub_46AF90` raw 82674-82690）⇒ 少了它注音会压到上一行（`tickets/T-0038`）。
    lineSpacing: v(21669, base.lineSpacing),
  };
}

/** 由「该窗入队时钉住的字体样式 + 该窗几何 + 该窗文本」组装排版输入（引擎 `FontVWindow` + `Font` 的快照）。 */
export function styleOfWin(e: Engine, win: number, itemId?: number): MsgWinStyle {
  const m = e.msgwin;
  const g = m.geom(win);
  // ★字体/颜色取**入队时的快照**（`MsgSlot.fontStyle`），几何取**实时**的窗字段。
  //   理由见 `FontStyleSnapshot`：引擎排版时就把颜色画进离屏表面，之后再改全局色不回溯；
  //   拿实时全局色会让 CONFIG2 逐行设的角色名颜色溢到已排好的 ADV 样例窗上（用户实测）。
  const core = m.slot(win).fontStyle ?? globalFontSnapshot(e);
  // ★文本块原点：引擎的排版例程先把 `buf[-20] = obj[28]`（= `0x79` 的文字起点）写进文本项缓冲头，
  //   而 `0x7A`（`sub_45A910`）会**覆盖**这两个 dword；`sub_45A940` 贴字格/贴行时用的正是
  //   `x = win+80 + buf[-20] + win+12`、`y = win+84 + buf[-16] + win+16`（raw 71352-71359、
  //   写入端 raw 82684-82685 / 81545-81546）。SN0000 序章：`i079 8 8c 10`（140,16）之后
  //   `i07a 8 8c 12c`（**140,300**）⇒ 真机文字块顶在 y≈300（实机截图对照）。
  const o = m.object(win);
  return {
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    originX: o.pre48Set ? o.pre48a : g.originX,
    originY: o.pre48Set ? o.pre48b : g.originY,
    wrapRight: g.wrapRight,
    wrapBottom: g.wrapBottom,
    // 竖排是**全局**的（引擎 Font+235108；下标 80101，由 0x261 写）—— 同样按入队时刻钉住
    vertical: core.vertical,
    // 竖排 blit 内边距（Font+235112..+235124，0x260）—— 同为 Font 级，随快照发布（渲染侧有意忽略，见字段说明）
    vPad: core.vPad,
    // ★`+288` 的**存储值 = 原样**（`0x303` 的 op2 直写，见 `op_align`），但发布给排版层的
    //   `MsgWinStyle.align` 只有 0/1/2 三态（`src/text/layout.ts` 的类型，属另一 owner 的文件）⇒
    //   在这条边界上做一次与引擎消费者**同口径**的映射：引擎 raw 69210-69225 是
    //   `if (+288) { if (== 1) 居中; else if (== 2) 右对齐; else 偏移 = 0 }` ——
    //   其它非 0 值的**偏移量也是 0**（= 左对齐），与映射到 0 的排版结果逐像素相同；
    //   丢掉的只有"进没进对齐块"这个返回值（重写侧无该粒度，登记在 `0x303` 的说明里）。
    align: g.align === 1 ? 1 : g.align === 2 ? 2 : 0,
    alignWidth: g.alignWidth,
    outlineMode: core.outlineMode,
    outlineDx: core.outlineDx,
    outlineDy: core.outlineDy,
    lineSpacing: core.lineSpacing,
    main: core.main,
    // 注音与本文共用填充/描边色（引擎只有一套 +1360/+1364）
    ruby: core.ruby,
    background: g.background,
    // 层序 = 引擎正文行 DrawItem id 起点（op 0x213 写的 win+104）—— 几何类，实时。
    // ★`itemId` 实参 = `0x82`/`0x1D1` 的 `op3 & 0x40` 偏移（引擎 raw 79687-79688 / 80658-80662：
    //   `v155 = win+104 + win+132`，只用在那两条指令本次绘制项上，**不写回窗对象**）。
    itemId: itemId ?? m.object(win).f104,
  };
}

/**
 * **当前全局字体/颜色快照**（入队时钉住用；`styleOfWin` 在没有快照时也回退到它）。
 *
 * 与 `globalTextStyle` 的区别：这里把注音字体与竖排一起收进来，正好是"一次排版要用到的全部样式"，
 * 而几何（位置/尺寸/换行/对齐/层序）**不在**其中 —— 那些是逐窗字段，必须实时。
 */
function globalFontSnapshot(e: Engine): FontStyleSnapshot {
  const m = e.msgwin;
  const core = globalTextStyle(e);
  const resolvedRuby = resolveFace(m.font.rubyFace, e.resourceVersion);
  return {
    main: core.main,
    ruby: {
      family: resolvedRuby.family,
      size: m.font.rubySize,
      weight: m.font.rubyBold ? 700 : 400,
      fill: core.main.fill,
      outline: core.main.outline,
      // 注音与正文共用同一个 `Font+1352`（引擎只有一把 AA 开关）
      antiAlias: core.main.antiAlias,
    },
    outlineMode: core.outlineMode,
    outlineDx: core.outlineDx,
    outlineDy: core.outlineDy,
    lineSpacing: core.lineSpacing,
    // 引擎 `Font+235108` bit0（0x261 写）；未写时用随包 INI 的默认值
    vertical: ((e.engineValues.get(ENGINE_FIELD.verticalText) ?? (m.font.vertical ? 1 : 0)) & 1) !== 0,
    // 引擎 `Font+235112..+235124`（0x260 写）：Font 级，按入队时刻钉住（同 `vertical`）
    vPad: { ...m.font.vPad },
  };
}

/** 把当前全局样式钉进该窗（文本入队路径专用）。 */
function captureFontStyle(e: Engine, i: number): void {
  e.msgwin.setFontStyle(i, globalFontSnapshot(e));
}

/**
 * **重画期的覆写色入口**（`0x82`/`0x1D1` 的 `op3 & 2` 专用；与 `captureFontStyle` 的区别）。
 *
 * 引擎这两条重画体的 `op3 & 2` 只动**颜色**两格（`Font+1360` 填充 / `Font+1364` 描边，
 * raw 79664-79670 / 80629-80634），随后把字**画进该窗的离屏表面**（逐字 GDI），
 * 所以"这次重画用的是覆写色"。重写侧这一等价物落在该窗的字体快照上（`styleOfWin`
 * 先取 `slot.fontStyle`，见 :251）⇒ 覆写色必须更新快照里的颜色，否则目标窗**已有快照**时
 * （= 该窗的文本早已入队过）覆写色根本到不了载荷。
 *
 * ★**只换颜色四格**（`main`/`ruby` 的 `fill`/`outline`），**不整份 `captureFontStyle`**：
 *   引擎这两条重画体不重排版（它重画的是**已经排好版**的记录），而 emulator 的快照里
 *   除颜色外还有竖向/行距/内边距这些**排版量**（`FontStyleSnapshot`）—— 整份重钉会把
 *   "入队时刻的排版参数"换成"重画时刻的全局值"，那是引擎在这里没做的动作。
 *   注音与正文共用同一套 `Font+1360/+1364`（引擎只有一套），故 `ruby` 同步。
 *   形参口径与 `globalTextStyle` 一致：`FontSpec.fill/outline` 是 `#rrggbb` 串（字段是 COLORREF，
 *   `hex6(bgrToRgb(字段))` ⇒ 渲染侧读法 = 脚本原值）。
 */
function applyOverrideColorToSnapshot(e: Engine, i: number, fill: string, outline: string): void {
  const prev = e.msgwin.slot(i).fontStyle;
  const base = prev ?? globalFontSnapshot(e);
  e.msgwin.setFontStyle(i, {
    ...base,
    main: { ...base.main, fill, outline },
    ruby: { ...base.ruby, fill, outline },
  });
}

/** 发布一个窗（文本或样式变化后调用；排版在共享层做，宿主只光栅化）。 */
export function emitWin(e: Engine, win: number, itemId?: number): void {
  const w = e.msgwin.resolveWin(win);
  e.native.msgWinSync?.(w, {
    style: styleOfWin(e, w, itemId),
    segments: e.msgwin.slot(w).segments,
    revealed: e.msgwin.revealedOf(w), // -1 = 全部显示
    // ★两个 DrawItem 区间（`0x213` 写 `+104/+108`、`0x25D` 写 `+276/+280`）：渲染侧的
    //   `scDetachTexture` 靠它判"脚本删掉这窗的正文图元 ⇒ 画面上的字也该消失"（见其说明）。
    itemRanges: itemRangesOf(e, w),
    cell: cellFrameOf(e, w),
    // ★`set:BlankExtentMode`（空白字前进量的门）：引擎在每个消费点现读配置
    //   （raw 12230/85126/87272 … 全是 `GetConfig(..., aSetBlankextent) == 1`）⇒ 这里也逐次读，
    //   不在 Engine 上缓存（脚本 `0x1B5` 一族的写配置指令会改它）。
    blankExtent: blankExtentOf(e),
  });
}

/**
 * `set:BlankExtentMode` 的**读取点**（引擎 raw 12230 / 85126 / 85366 / 85638 / 85812 / 86567 /
 * 87272 / 87689 … 共 20 余处，判据一律是 **`== 1`**，不是"非 0"）。
 *
 * 口径（引擎 `sub_404EE0` raw 10716-10739 + 消费点）：`== 1` 时**空白字**（`0x20` / `0x8140` /
 * 控制字，绘制期还含"无轮廓字"）的前进量改用 `GetTextExtentPoint32A` 逐字量宽；
 * 否则用字号网格（raw 87279：`font_size / (全角?1:2)`）。
 *
 * ★**`measure` 故意不给**：emulator 没有字体度量缝（见 `text/layout.ts` 文件尾「缺口」）。
 * ⇒ `mode == 1` 时布局会**显式回退**到网格并把 `TextFrame.blankExtentFallback` 置真（缺口可见）。
 * 随包默认是 0（`tickets/T-0031/evidence/generated-SYS4REG.ini`）⇒ 默认配置下与引擎逐字等价。
 */
function blankExtentOf(e: Engine): BlankExtent {
  const def = registryDefault(CFG.setBlankExtentMode);
  return { mode: e.config ? cfgInt(e.config, CFG.setBlankExtentMode, def) : def };
}

/** 该窗在 Scene 里的 DrawItem 区间（引擎 `FontVWindow+104/+108` 与 `+276/+280`；count<=0 视为未登记）。 */
function itemRangesOf(e: Engine, win: number): { base: number; count: number }[] {
  const o = e.msgwin.object(win);
  const out: { base: number; count: number }[] = [];
  if (o.f108 > 0) out.push({ base: o.f104, count: o.f108 });
  if (o.f280 > 0) out.push({ base: o.f276, count: o.f280 });
  return out;
}

/**
 * 该窗此刻要画的**字格图标那一格**（`0x73` 配的精灵表 + 主循环每 `tickMs` 换一格）。
 *
 * 目标位置两条路（引擎 `sub_45A940` raw 71349 的 `v7 = Font[348]` 分岔）：
 *  - `Font+1392 == 1`（NOVEL 分支）：**跟随最后一条 24B 字记录的笔位** ⇒ 就是"文字结尾处"；
 *  - `Font+1392 == 0`（ADV）：`(op2 + 窗框 x, op3 + 窗框 y)`，ADV win1 实测 = (1080,667)。
 *
 * ★2026-09 实测补充（用户指出序章确实有 ▼，用的是 SO026 第二行【横向】那张）：
 * 序章的 win8 是**满屏叙述窗**（`i070 8 500 2d0 0 0` ⇒ 框 (0,0)-(1280,720)），
 * 这时"窗内固定位"没有意义（会落到 (0,-5) 左上角）⇒ 只要窗口铺满视口就按 NOVEL 分支处理
 * （跟随文字末尾）。这条是 E4 实测定的，待真机截图最终确认（已登记）。
 */
function cellFrameOf(e: Engine, win: number): MsgCellFrame | undefined {
  if ((e.effectFlags & CHAR_REVEAL_ACTIVE) === 0) return undefined;
  // ★▼ **只在本页逐字显完之后**才出现在载荷里 —— 这是"图标何时可见"的**唯一判决点**。
  //   引擎依据：文字泵 `sub_45BE20` 在等待泵里**自旋到整页显完**（raw 13847/13863/13907/13920 的
  //   `while (!sub_45BE20(...))`），主循环的图标分支 raw 20887-20895 只在 `effect_flags & 0x40000000`
  //   且节拍到点时贴第 k 格 —— 而那一帧永远是"泵已经返回 true"之后才轮到的。
  //   emulator 的泵是**每帧推进**（非阻塞）⇒ 必须显式挡住：否则 `#publishReveal → emitWin` 会
  //   边逐字边把 `cell` 发出去，宿主立刻把 ▼ 画上屏（2026-09 用户报 #2「图标被提前显示」；
  //   E4 日志里 `[reveal] win=8 1/52` 紧跟着 `[cell]`）。
  //   ★判"**任何**窗还在显现"（`isRevealing()` 无参）而不是只判 `win`：图标游标是**全局一份**
  //   （`Engine[107704]`）；与 `Engine.serviceCharGrid` 的同一条件保持一致（那里管"别提前起算节拍"）。
  if (e.msgwin.isRevealing()) return undefined;
  const g = e.msgwin.gridOf(win);
  if (!g || !g.gate || g.cells <= 0 || g.cellW <= 0 || g.cellH <= 0) return undefined;
  const geom = e.msgwin.geom(win);
  const followText = e.engineValues.get(ENGINE_FIELD.followTextMode) === 1 || (geom.x <= 0 && geom.y <= 0 && geom.w >= 640 && geom.h >= 360);
  let x = g.textX + geom.x;
  let y = g.textY + geom.y;
  if (followText) {
    // 引擎 raw 71352-71359 的 mode-1：`v6[12]` = win+48 = 记录向量的 **end 指针** ⇒
    // `buf[-20]`/`buf[-16]` 就是**最后一条 24B 记录**的 `+4`/`+8`：
    //   - 逐字排版（sub_46BE30 raw 83899/83912）把它写成"该字画完后的笔位 / 该行 y"；
    //   - `0x6F end-text-line`（raw 82684-82685）才把它重置成"下一行行首 x / 下一行 y"。
    // 语料里页末最后一条是 `concat`（不是 end-text-line）⇒ 目标 = **末行最后一个字的后面**
    // （用户实测："应该在最后一行的末尾"）。
    const style = styleOfWin(e, win);
    const layout = layoutWindow(win, { style, segments: e.msgwin.slot(win).segments });
    const line = layout.lines[layout.lines.length - 1];
    const glyph = line && line.glyphs.length > 0 ? line.glyphs[line.glyphs.length - 1] : undefined;
    // 末字右边 = 字形 x + 该字的推进量（`advance` = 半角格数 × 0.5em，与排版同源）
    const penX = glyph ? glyph.x + advance(glyph.ch, style.main.size) : line ? line.x + line.width : 0;
    x = g.textX + penX;
    y = g.textY + (line ? line.y : 0);
  }
  return {
    srcSurface: g.srcSurface,
    originX: g.originX,
    originY: g.originY,
    cellW: g.cellW,
    cellH: g.cellH,
    cols: g.cells,
    k: e.msgwin.cellK % g.cells,
    x,
    y,
  };
}

/**
 * `styleOfWin` 的**别名**，供 `vm/engine.ts` 使用。
 *
 * 为什么需要别名：engine 的闸门泵（`serviceWinReveal`）要排版该窗，需要同一份 style；
 * 而 `engine → handlers/msgwin` 这条值依赖是既有的（见重构清单 §8 A2 循环）。别名只是把
 * "engine 侧只读样式"的意图写清楚，等 `styleOfWin` 下沉到 `vm/msgwin-style.ts` 后即可删除。
 */
export const winStyle = styleOfWin;

/**
 * 发布全部"已知"窗口。
 *
 * ⚠**不要在任何 handler 里调用它**：引擎**没有任何指令**会把文本发布给别的窗 —— 每帧泵只泵
 * **当前窗**（raw 13943-13945），`0x70` 的落点也只写几何/回看页（raw 73133-73193）。
 * 历史上它被挂在这里导致过两次用户可见缺陷：① 全局样式指令（`0x76`/`0x77`…）把新样式糊到
 * 已排版的窗上（`test/text-style-snapshot.test.ts` 钉着，见 `:1339`）；② `0x70` 用它会**重画**
 * "记录还在但屏上项已被 detach"的窗（`tickets/T-0100`）。
 * ⇒ 自 `T-0100` 起**已无调用者**，保留仅作诊断/历史对照（遗留文档 `README.md`/`docs/12-*` 仍提到它）。
 */
export function emitAllWins(e: Engine): void {
  const wins = new Set<number>([...e.msgwin.slots.keys(), ...e.msgwin.wins.keys(), e.msgwin.defaultWin]);
  for (const w of wins) emitWin(e, w);
}

/** `message:ReadTextSkip` 当前取值：运行期覆盖（0x1CA 写入）优先，否则用启动配置，缺省 0。 */
function readTextSkipOf(e: Engine): number {
  const m = e.msgwin;
  if (m.readTextSkip !== null) return m.readTextSkip;
  return e.config ? cfgInt(e.config, CFG.messageReadTextSkip, 0) : 0;
}

/**
 * `message:MessageSpeed`（ms；= `Font+1376` = `Engine[21668]`）—— **消息推进节拍**。
 *
 * 引擎（`sub_41EB20` raw 28361-28382）：`if (!_this[21668] || (effect_flags & 0x8000000))` ⇒ 走
 * **同步排空**（`sub_46CBF0`）；否则入队 + 置 `0x20000000` + `sub_453A60(Engine+430572, 该值)`。
 * 同一字段在 `sub_409400` 里还是逐字显现的 `Sleep()` 值（raw 13954）。
 *
 * ★历史错误：这里曾读 `message:MesWinAlpha`。引擎的 `Engine[21668]` 其实是 **MessageSpeed**
 * （raw 23736-23738 把 `message:MessageSpeed` 灌进 `Engine+86672`）；`MesWinAlpha` 从不进字段。
 */
/**
 * `message:MessageSpeed` 的**唯一**解析处（`Font+1376` = `Engine[21668]`，缺省回退到随包 INI 的配置键）。
 *
 * ★为什么必须唯一：引擎里它就是**一个字段**（`sub_41A5?` 写、显现泵读），
 * emulator 曾在 `vm/engine.ts` 两处 + 本文件一处各写一遍同样的 `??` 回退
 * ⇒ 任何一处漏掉回退（或改了键名）都会让"速度旋钮"只在部分路径生效。
 */
export function messageSpeedOf(e: Engine): number {
  return e.engineValues.get(ENGINE_FIELD.messageSpeed) ?? (e.config ? cfgInt(e.config, CFG.messageMessageSpeed, 0) : 0);
}

/**
 * **ADV 位判定（三处 handler 共用）** —— 对应引擎里重复出现的那段
 * `if (GetConfig("message:ReadTextSkip")) { …sub_48E870/sub_48F000… } else { … }`。
 *
 * ## 引擎的三条出口（`sub_41EB20` raw 28339-28359，`0x6E`/`0x71`/`0x72` 逐字同形）
 * ```c
 * 28339  if ( !GetConfig("message:ReadTextSkip") ) {        // ★门**关闭**
 * 28341      if ( !_this[122455] ) goto LABEL_11;           //   已清 ⇒ 什么都不做
 * 28343      goto LABEL_10;                                //   已置 ⇒ 清 0
 *        }
 * 28345  v4 = sub_48E870(队列, 句 id, …);                    //   门**打开**：查"该句第 a3 段"
 * 28350  if ( !sub_48F000(队列, 句 id, v4) ) {                //   查不到 ⇒ 没有后续内容
 * 28352      if ( _this[97050] ) goto LABEL_11;              //     ★跳读/自动位 ⇒ **保持** 122455
 * LABEL_10:  _this[122455] = 0;                             //     否则清 0
 *        } else { 174801 |= 0x8000000; 122455 = 1; }        //   有内容 ⇒ 置 ADV + 显示中
 * ```
 * ★**两条必须分开**（审计 `0x6e`/`wrong-condition`）：`97050`（跳读/自动位）**只**出现在
 * 门打开那一支（raw 28352）。修前 emulator 把它写成了"门关时也置 `showing = 1`"
 * —— 与体相反（门关那一支的判据里根本没有 `97050`）。
 *
 * ## `sub_48F000` 是什么、emulator 用什么代替（★有据缺口，不是等价）
 * `sub_48F000`（raw 109810-109825）逐字是：`sprintf_s(Buffer, ".%8.8x", 句 id)` →
 * 在**消息队列对象** `_this+258` 里按名查表（`sub_48EE60`）→ 命中且 `entry[1] > a3` 时返回
 * `entry[2][a3]`，否则返回 **0**。也就是说它问的是「**脚本分段表里该句还有没有第 `a3` 段**」——
 * 那张表由 `sub_48FFB0` 从队列刷进去，而 emulator **不装载脚本分段资源**（登记在
 * `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`）⇒ 用**本页文本的显示态**当等价物：
 *  - 该窗正有未走完的逐字显现（`RevealState.active`）⇒ 有内容；
 *  - 或本页有字形、且这一页还没被 `0x72` 武装过（刚 `show-text`/刚 `0x71` 开新消息）⇒ 有内容；
 *  - 空页（`glyphCount == 0`）⇒ 没有内容（对应 `sub_48F000` 返回 0）。
 *
 * @param incoming 调用点是不是"**新消息开始**"（`0x71`）。引擎在那里问的是**即将入队的**那一句
 *   在分段表里有没有段 —— emulator 连表都没有，更没有"还没入队的那一句"，故按"本指令本身就是要
 *   显示一段新消息"记为**有内容**（= 修前行为，用户实测过的 ADV 节奏不回退）。
 *   这一格是**登记的有意近似**，不是双份真源。
 * @returns 是否仍在显示中（`122455 != 0`）；调用方据此 `setAdv`/`clearAdv`。
 */
function advanceReveal(e: Engine, incoming = false): boolean {
  const m = e.msgwin;
  const win = m.resolveWin(m.lastArg);
  if (readTextSkipOf(e) === 0) {
    // 门关闭（随包 INI 默认）：引擎只做「清 122455」，**不置 ADV** —— 修掉"位卡死"的那条路径。
    if (m.showing !== 0) m.showing = 0;
    return false;
  }
  if (incoming || pageHasPendingText(e, win)) {
    m.showing = 1; // raw 28359
    return true; // 调用方 setAdv（raw 28358）
  }
  if (m.skipMode !== 0) return m.showing !== 0; // raw 28352-28353：跳读/自动 ⇒ 保持（不清也不置）
  m.showing = 0; // LABEL_10（raw 28354-28355）
  return false;
}

/**
 * `sub_48F000` 的 emulator 等价物（**本页还有没有要显示的内容**）—— 见 `advanceReveal` 的说明。
 *
 * 判据只读 `MsgWindow` 自己的两个状态（逐字显现游标 + 内容版本号），**不看** `ReadTextSkip` 门
 * （门是调用方的事），也不看任何"全局模式位"。
 */
function pageHasPendingText(e: Engine, win: number): boolean {
  const m = e.msgwin;
  const st = m.reveal.get(win);
  if (st && st.active) return true; // 逐字还没走完 ⇒ 还有内容
  const laid = layoutWindow(win, { style: styleOfWin(e, win), segments: m.slot(win).segments });
  if (laid.glyphCount === 0) return false; // 空页 ⇒ 没有内容
  return !m.revealArmed(win); // 有字形但还没被 `0x72` 武装过（刚入队 / 刚开新消息）
}

/**
 * **`sub_48F000` 的脚本分段表在 emulator 里没有对应物**（有据缺口，登记在此以免被当成"已等价"）。
 *
 * 引擎那张表 = 消息队列对象 `Engine+80107` 里按 `.8.8x`（句 id 的十六进制）为名的条目
 * （`sub_48F000` raw 109810-109825 查、`sub_48FBB0` raw 110300- 建、`sub_48FFB0` raw 110456-110482
 * 从队列刷入）。emulator 既不装载该资源、也没有"一次表演的分段表"这一层概念 ⇒
 * `advanceReveal` 只能用**本页显示态**（见 `pageHasPendingText`）近似"还有没有内容"。
 *
 * 重新评估条件：① 真机 E4 抓到"门开（`ReadTextSkip=1`）时某页应当分多段显示、而 emulator 一段就完"；
 * 或 ② 需要复刻 `0x6E`/`0x72` 在门开时的逐段 ADV 位翻转。届时先从 `Engine+80107` 的队列名表
 * （`sub_48EE60` 的容器）反推脚本侧资源从哪来（`sub_41A780` 一族？），再决定要不要建这张表。
 */
export const ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED: readonly { raw: string; what: string }[] = [
  {
    raw: '109810-109825',
    what: '`sub_48F000`：按 `".%8.8x"`（句 id）查 `Engine+80107+258` 的分段表，返回该句第 a3 段的项（未命中/越界返回 0）。emulator 用 `pageHasPendingText`（本页是否还有未显示的字形）代替。',
  },
  {
    raw: '110456-110482',
    what: '`sub_48FFB0`：把消息队列 `_this[279..281]` 逐条刷进表（`0x71` raw 28431 是调用点）—— emulator 无队列可刷 ⇒ `0x71` 的这一步是 no-op（不是"忘了接"）。',
  },
];

/**
 * `0x6E show-text`（sub_41EB20 raw 28307-28385）：向文本槽追加一段文本。
 * 注音/内嵌模式（`122497` bit0）走引擎的 `sub_46BE30` 分支。
 */
const op_show_text: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const m = e.msgwin;
  const slot = (plan.int(1) ?? 0);
  const text = (plan.str(2) ?? '');
  m.lastArg = slot;
  // ★入队即钉住当前字体/颜色（引擎 `sub_46BE30` 排版时把字形连颜色画进该窗离屏表面）
  captureFontStyle(e, slot);
  if ((m.flags & 1) !== 0) {
    m.addRuby(slot, text, '');
    // ★与 `0x196` 同一道门：引擎这两条路（`sub_41EB20` 的入队支 / `sub_41FC20` 的第③路）都在
    //   `sub_46BE30` 返回非 0（= 本行有内容）时才置 bit16（raw 28368/28374 一族与 raw 29105）⇒
    //   空串入队**不置** bit16。`0x305` 的总门 `(flags & 0x10001) == 0x10001`（raw 26045）是它的读者。
    if (text.length > 0) m.flags |= 0x10000;
    recordRenderedRow(e, slot, text); // ★`tickets/T-0170`：正文段落也要进 `Font+3364`
    return;
  }
  m.appendText(slot, text);
  m.flags &= ~0x10000;
  // ★`tickets/T-0170`：引擎这条路的收尾是 `sub_46CBF0` → `sub_46BE30` → `sub_45F090`
  //   （raw 28368 / 83999-84009 / 74360-74400），**把这一段正文连同 `+44` 串写进记录表** ——
  //   那正是 `0x1D1`（回想页重绘）要重画的数据源。漏了它 ⇒ 回想页只有框、没有正文。
  recordRenderedRow(e, slot, text);
  // 新内容入队 ⇒ 该窗的显现游标作废（引擎 `0x71` 会 idx=0 重头显示）
  const w = e.msgwin.resolveWin(slot);
  e.msgwin.reveal.delete(w);
  // ★2026-09 修（用户实测："文字会在逐字出现前**完整出现**一下"）：可见字形数**只在
  //   `MsgWindow.revealedOf` 一处判决** —— 它已把"字格门（`0x73` 的 `win+88`）"与
  //   "`0x300` 逐行泵"两条路径的"未武装 ⇒ 0 个"写进同一个例外里。
  //   这里**不能**自己判断再发一份（曾在 `0x6E` 里单独发 `revealed: 0`，但紧随其后的
  //   `0x6F end-text-line`/`0x73` 仍走 `emitWin` 发出 −1 ⇒ 中间那一帧照样整页先亮）。
  emitWin(e, slot);
  // 引擎 sub_41EB20：`sub_48F000` 非 0（仍在显示）才置 ADV，否则清 122455（并保持 ADV 清除）
  if (advanceReveal(e)) setAdv(e);
  else clearAdv(e);
  // ★引擎 `sub_41EB20` 的 LABEL_11（raw 28361）是**带前置条件**的分支，不是无条件节流：
  //   `if (!_this[21668] || (_this[174801] & 0x8000000) != 0) { sub_46CBF0(...) }`
  //   —— MessageSpeed（`Engine[21668]`）为 0 **或 ADV 位已置**（raw 28358 刚置）⇒ **同步排空**。
  //   `sub_46CBF0` 真身 raw 83999-84009 只有 `sub_46BE30` + `while(!sub_45BE20)` 自旋：
  //   **体内既没有 Sleep、也不装计时器**。
  //   **只有 else**（MessageSpeed 非 0 且 ADV 未置）才 raw 28380 `_this[174801] |= 0x20000000`
  //   + raw 28382 `sub_453A60(_this+430572, _this[21668])`（计时器）⇒ 那一支才是"每段之间按该
  //   毫秒数节流"（emulator 用 `sleepUntil`；计时器对象本身见文件头"不做的部分"）。
  // ★订正（审计 `op-10-002`）：此前无条件按 `speed > 0` 置门。可是上面 `advanceReveal()` 为真时
  //   刚刚 `setAdv`（raw 28358 的等价物：本模型把"仍在显示中"记为 ADV）⇒ 随后仍装门就等于
  //   **对已经置 ADV 的情况多等 MessageSpeed ms**（跳读/自动模式下每段文本各多等一拍）。
  //   raw 28361 的 `(_this[174801] & 0x8000000) != 0` 正是排除这一情况的那一项。
  const speed = messageSpeedOf(e);
  if (speed > 0 && (e.effectFlags & ADV_ACTIVE) === 0) {
    e.sleepUntil = e.nowMs + Math.max(1, speed);
    e.effectFlags |= SLEEP_GATE;
  }
};

/** `0x6F end-text-line`（sub_41ECE0 raw 28389-28397）：结束当前行。 */
const op_end_text_line: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  e.msgwin.endLine(slot);
  // ★`tickets/T-0170`：换行在记录表里也留一条**空串 + `flags|8`** 的记录
  //   （`sub_4691D0` raw 81530-81553；排版层的调用点 raw 82667 / 83094）。`sub_4675A0` 靠它推进 y
  //   （raw 80718-80724），也是"一行到哪儿结束"的唯一标记（`flags&4` 的连续段是**一行**，raw 80731-80752）。
  //   ★2026-09（`T-0151`）：体里那条 push **有门** —— `sub_4691D0` raw 81549 的 `if ( a3 >= 0 )`
  //   （`a3` = `Engine[97055]`，由 `sub_41ECE0` raw 28395 传入）⇒ `i1bb 0` 期间不记换行记录。
  //   另一半（raw 82665 的 `if (v5[28] == 1)` = 窗对象 `+112` 专用路径）未建模，登记在缺口表里。
  if (recordGateOpen(e)) e.textItems.pushLineFeed(e.msgwin.resolveWin(slot));
  emitWin(e, slot);
};

/**
 * `0x71 message-show`（sub_41ED80 raw 28419-28473，**argc=1**）：`op1` = **消息窗槽号**。
 *
 * 引擎顺序（raw 28425-28431）：
 *  1. `sub_45EC60(文本对象, v2, 97055)` = **开始一段新消息**：把该窗的文本记录向量
 *     （`win+208` 120B/条）截断为 0、显现游标 `win+132 = 0`、`win+284 = 1`、`win+296 = 0`，
 *     并清该窗离屏表面（D3D memset / dd 填底色）；
 *  2. 记返还点 `frame.state_6C` → 复制两片工作区 → `sub_48FFB0` 冲消息窗队列；
 *  3. 判 ADV（`message:ReadTextSkip` 门 + `sub_48F000`），不满足则清 `122455`。
 *
 * ★**1 不能漏**：漏掉就表现为「上一屏文案残留」——残留文本在本次 `0x71` 被当成新消息重新显现
 * （2026 实测：退出设置后主界面逐字冒出一行、再进设置变成两行）。文本内容由 `show-text`(0x6E)
 * 在**本指令之后**写入本窗的槽（`CONFIG.txt:171-179`、`CONFIG1.txt:2916-2932` 即此顺序）。
 *
 * ★历史误解：本指令曾被当成"呈现已入队文本"（因此 emulator 旧实现不在它这里清槽，
 * 测试也用 `show-text → 0x71` 的顺序）。剧本语料不支持这个读法：`0x71` 前面从来不是
 * 文本指令（90713 处里 30239 处紧邻另一条 `0x71`、30231 处紧邻 `jcc`），而是页末/切场清屏；
 * 真正的"入队后显示"由 `0x6E` 自己完成（`sub_46BE30` 同步排版 + `sub_46CBF0` 排空）。
 *
 * 不建模：DD 表面的填底（无渲染）与 `frame.state_6C` 返还点槽（emulator 用 `ctx.jump`/`retStack`）。
 */
const op_message_show: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const m = e.msgwin;
  const slot = (plan.int(1) ?? 0); // 窗索引（0 ⇒ 默认窗；1/2/7/8/9…）
  // ★记下"本帧最后一次开始消息"的位置（`tickets/T-0063`）：本工程槽读档时用它当落点
  //   ⇒ 存档当时那句话会被**重放**（引擎帧记录里那一格 `[259]` 就是 `0x71` 表下标，语义一致）。
  c.frame.lastMsgIp = c.frame.ip;
  m.lastArg = slot;
  m.alt = 0;
  const w = m.resolveWin(slot);
  // ★开始一段新消息：清该窗文本记录 + 复位显现游标（引擎 sub_45EC60，raw 74277-74281）
  m.beginNewMessage(w);
  // 同一函数还会在 `a3 >= 0` 时做**回看记账**（raw 74267-74276）：
  //  - push 一条回看页 `{窗号, 该时刻的记录条数}`（raw 74269-74271）；
  //  - 双游标都指向新末项（raw 74272-74274）；
  //  - 置该窗「组首」标记 `Font[849+win] = 1`（raw 74275）⇒ 下一条 `0x1D2`/语音记录 push 带上 bit0，
  //    `0x1D3`/`0x1D4`/`0x2F3` 的扫描在此处停。
  // ★门 = `Engine[97055] >= 0`：`sub_41ED80` raw 28427 把 `_this[97055]` 当第 3 实参传给 `sub_45EC60`。
  //   ⇒ `i1bb 1`（0）时成立、`i1bb 0`（0x80000000）时**不成立**、`i1bb 0` 期间不记页。
  //   ★订正（T-0095）：旧实现判的是 `m.textSlotArg >= 0`，而那个字段全库只被初始化（`vm/msgwin.ts:371/795`）、
  //   **从未被赋值** ⇒ 恒真 ⇒ `i1bb 0` 期间照样记页（既有缺陷）。真源字段 = `ENGINE_FIELD.textBaseGate`。
  if ((e.engineValues.get(ENGINE_FIELD.textBaseGate) ?? 0) >= 0) {
    e.textItems.pushPage(w); // raw 74269-74271
    e.textItems.markGroupStart(w); // raw 74275
  }
  // ★`incoming = true`：本指令就是"新消息开始"，引擎这一支问的是**即将入队的**那一句在分段表里
  //   有没有段（raw 28439 的 `sub_48F000`）—— emulator 不装载那张表（见
  //   `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`）⇒ 按"有内容"处理，保持 ADV 节奏（修前行为）。
  if (advanceReveal(e, true)) setAdv(e);
  else clearAdv(e);
  // 引擎 `sub_41ED80` raw 28361-28382：非跳读路径下入队 + `sub_453A60(Engine+430572, MessageSpeed)`
  // ⇒ **从这里开始逐字显现**（跳读/自动模式下走同步排空，即一次显示完）。
  // 清空后 total 通常为 0（新文本随后由 0x6E 写入）⇒ 不留显现状态
  // （本模型「无状态 = 全部显示」，避免后续 emit 把随后写入的文本画成 0 字）。
  const total = layoutWindow(w, { style: styleOfWin(e, w), segments: m.slot(w).segments }).glyphCount;
  if (m.skipping !== 0 || m.skipMode !== 0) m.finishReveal(w);
  else if (total > 0) m.beginReveal(w, total, e.nowMs, messageSpeedOf(e));
  else m.reveal.delete(w);
  emitWin(e, slot);
};

/**
 * `0x72 wait-for-input`（sub_41EEF0 raw 28482-28600）：**结束一页并挂起等玩家推进**。
 *
 * 引擎：清显示态 → 清 `0x8000000` → 若 ADV 已清则消费输入边沿 + 付托文本 +
 * **置 `0x80000000`（等待推进门）**。
 *
 * ★尾段（raw 28539-28554，`LABEL_17`）还是**逐字显现的启动点**：
 * ```
 * Engine[122371] = 窗;
 * sub_45A940(Font, 窗, -1, Engine+107705);   // 查询 ⇒ Engine[107705] = win+92（字格数）
 * effect_flags |= 0x80000000;                // 等待门
 * if (!(effect_flags & 0x40000000)) {        // 未在逐字模式 ⇒ 进入
 *     effect_flags |= 0x40000000;
 *     Engine[107704] = 0;                    // 游标归零
 *     sub_453A90(Engine+430600);             // 重启节拍（周期 = 0x73 op10）
 * }
 * ```
 * ⇒ 每次 `wait-for-input` 都**重新武装 ▼ 字格**（bit30 + `Engine[107704]=0` + 重启节拍）；
 * **文字**的显现游标（`win+132`）不在这里动 —— 它由 `sub_45BE20` 泵推进、由 `0x71`/`sub_45EC60` 复位。
 * 文本内容与注音由 `show-text` 提前写入本窗。
 * ★所以本 handler 只在"这一页的文本还没武装过显现"时才启动显现（`revealArmed`，见其说明）。
 */
const op_wait_for_input: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const m = e.msgwin;
  m.lastArg = (plan.int(1) ?? 0);
  const w = m.resolveWin(m.lastArg);
  // ★raw 28556-28586：**共存消息标志 `Engine[97052]` 的消费端**（审计 §4.1 P1 `0x1b6`/`0x1b7`）。
  //   引擎 `0x72` 的**所有**控制流都汇到 `LABEL_17`（raw 28539），而共存块紧跟在它后面
  //   ⇒ 即使这一页还在逐字显示也要起"自动翻页"节拍（`sub_453A60(Engine+107545, max(100, 时长))`）；
  //   `Engine[97053] = 0` 在同一段里（raw 28557；该格全库只写不读，照写）。
  armCoexistAutoMessage(e, w);
  // 引擎 `sub_45A940(..., -1, Engine+107705)`：把该窗字格数写进模数槽（字格未设时 win+92 = 0）。
  // ★这条查询同时是"**▼ 图标动画的武装**"：模数 = 精灵表格数 op9；`sub_453A90` 重启节拍 ⇒ 帧号归零。
  const grid = m.gridOf(w);
  m.charTotal = grid ? grid.cells : 0;
  e.engineValues.set(ENGINE_FIELD.charModulus, m.charTotal);
  m.cellK = 0;
  // ★0 = "已预备、等本页逐字显完再起步"：引擎主循环里文字泵（sub_409400 的 `while(!sub_45BE20) Sleep`）
  //   是自旋的 —— 一页没贴完就走不到 raw 20887-20895 的图标分支 ⇒ 图标天然出现在文字之后。
  m.cellNextAt = 0;
  if (!m.isRevealing(w) && !m.revealArmed(w)) {
    const laid = layoutWindow(w, { style: styleOfWin(e, w), segments: m.slot(w).segments });
    const total = laid.glyphCount;
    // ★武装记账（`tickets/T-0016`）：这一页的文本从此算"已武装过" ⇒ 门指令**重跑**（悬停 label 的
    //   `ret` 正好回到门指令）不会再启动一次显现。引擎的 `0x72` 本来就不碰文字游标（raw 28539-28555）。
    m.markRevealArmed(w);
    if (m.skipping !== 0 || m.skipMode !== 0) m.finishReveal(w);
    else {
      // ★文字逐字 = **正常泵**（引擎 `sub_45BE20` 一步一个字、节拍 `message:MessageSpeed`）——
      //   `0x73` 不是"文字的单位"（那是 ▼ 图标精灵表，见 `CharGrid`），所以这里不再传 grid。
      m.beginReveal(w, total, e.nowMs, messageSpeedOf(e));
      m.charMode = total > 0;
      m.charCursor = 0;
      e.engineValues.set(ENGINE_FIELD.charCursor, 0);
      e.effectFlags |= CHAR_REVEAL_ACTIVE;
    }
  }
  if (m.isRevealing(w)) {
    e.awaitingAdvance = true; // 门已置，但显现未完 ⇒ 由帧循环的 text-reveal 分支继续推进
    return;
  }
  if (advanceReveal(e)) return; // 仍在显示中（= 引擎 `122455` 非 0）⇒ 跳 LABEL_17（不动等待门）
  // ---- raw 28518-28537：LABEL_11 的交付块，**整块**被 `!122496 && !(mask & 0x40)` 门控 ----
  //   `mask` 的 bit6 = `Engine[1415]`（raw 28487-28488 在开头合成）⇒ 跳读中**不进这一块**：
  //   于是 `174801 &= ~0x8000000`（raw 28520）**也不会发生** ⇒ 随后的 LABEL_17 里 `ADV != 0`，
  //   等待推进门不置（脚本继续跳读）。修前 emulator 无条件 `clearAdv` ⇒ 跳读时反而挂起等玩家。
  const skipping = m.skipMirror !== 0; // `Engine[1415]`（= memo 的跳读镜像）
  if (m.alt === 0 && !skipping) {
    clearAdv(e); // raw 28520（块内）
    m.finishPage(w); // 交付/记账的等价物（3 槽语音交付见 `op_poll_msg_advance` 的说明）
    e.input.consumeEdges(); // 引擎 sub_478090(Engine+258, …)（raw 28542）
    // raw 28543 `Engine[174802] = 0`：消费刷把掩码写进那一格后**当帧清零**
    // （emulator 的对应格 = `InputManager.inputMask`，唯二写者是两把刷子）。
    e.input.inputMask = 0;
  }
  // ---- LABEL_17（raw 28539-28547）：`ADV == 0` 才置等待推进门 ----
  //   emulator 的 `awaitingAdvance` = `effect_flags |= 0x80000000` + `sub_45A940(..., -1, 107705)` 查询
  //   的那两半（字格模数查询在其上、`0x300` 闸门各半，见本 handler 开头）。
  if ((e.effectFlags & ADV_ACTIVE) === 0) e.awaitingAdvance = true;
};

/**
 * 引擎 `Engine[122501]`：**语音 3 路里是否有正忙**（`sub_404CB0(Voice)` 的结果，由 `0xC4`/`0x2F5`/`0x2F6`
 * 一族写）。自动翻页的两组参数按它二选一（raw 28560/28573）。
 */
const FIELD_VOICE_BUSY = 122501;

/** 引擎 `Engine[97053]`：与共存消息同段的记账格（raw 28557 只写 0）。 */
const FIELD_COEXIST_AUX = 97053;

/**
 * **自动翻页计时器对象**（引擎 `Engine+107545` 起 7 个 dword 的计时器块，`sub_453A60` 写 `[2]/[5]/[6]`）。
 *
 * ★`sub_453A60`（raw 66101-66112）逐字：`t[2] = 1`（周期序号）、`t[5] = timeGetTime()`（起点）、
 * `t[6] = ms`（周期，**0 取 1**）。这里按同一形态写进 `engineValues`（= 引擎内存视图）。
 * ★**这一格的到期读者在本 build 里不存在**：全 .c 只有两处 arm 它（raw 13726 的 `sub_4090F0`、
 * raw 28585 的 `0x72`），而 `sub_453AF0`/`sub_453B60` 的调用点（raw 20430/20889/…/21192）里
 * **没有** `Engine+107545`（主循环只查 107440/107461/107468/107475/107482/107489/107496/107503/
 * 107524/107650 这几格）。⇒ 忠实模型 = **照引擎只写不读到点判定**，不自己发明"到点自动翻页"。
 */
const TIMER_AUTO_MESSAGE = 107545;

/**
 * `0x72` 尾段的**共存/自动翻页块**（raw 28556-28586）—— `Engine[97052]` 的真实消费者。
 *
 * ```c
 * v7 = (Engine[97052] == 0);  Engine[97053] = 0;
 * if (!v7) {                                   // 97052 != 0 ⇒ 起自动翻页节拍
 *   if (Engine[122501]) {                      // 有语音在播 ⇒ 用 Pitch0/Time0
 *     if ((GetConfig("message:AutoMessageOption") & 1) == 0) goto LABEL_32;   // 关着就不武装
 *     v11 = Engine[122371]; if (!v11) v11 = Engine[21631];                    // 当前窗 / 默认窗
 *     v12 = (该窗 24B 行记录数) - 1;
 *     v10 = (v12 - Engine[122464]) * GetConfig("message:AutoMessagePitch0") + GetConfig("message:AutoMessageTime0");
 *   } else {                                   // 没有语音 ⇒ Pitch1/Time1
 *     v8 = Engine[122371]; if (!v8) v8 = Engine[21631];
 *     v9 = (该窗行记录数) - 1;
 *     v10 = (v9 - Engine[122464]) * GetConfig("message:AutoMessagePitch1") + GetConfig("message:AutoMessageTime1");
 *   }
 *   if (v10 <= 100) v10 = 100;
 *   sub_453A60(Engine+107545, v10);
 * }
 * ```
 * `Engine[122464]` = `0x2E9` 写的"行基准"（`ENGINE_FIELD.autoMessageBaseline`，此前只有写者）
 * ⇒ 本函数是它的**第一个读者**。"行记录数"在重写侧的等价物 = `layoutWindow(...).lines.length`
 * （引擎的 `(win_obj+48 - win_obj+44)/24` 就是排版推入的 24B **行**记录条数）。
 *
 * ★与 `sub_4090F0`（raw 13708-13727）的关系：那是**同一段逻辑的另一处**，但它的**入口**
 * 在 AGERC 的系统命令层（`IAGEService` vtable +132 = `sub_4764E0`，由 AGERC 的
 * `case 40035/40037`（开设置画面）调用 —— 见 `engine/AGERC.DLL_utf8.c:2426/2441` 与
 * `.data:00526B78`）⇒ emulator 没有那一层，**清零点 `Engine[97052] = 0` 至今无落点**
 * （见 `op_get_coexist_state` 的说明）。本函数至少把"读"这一半接上了。
 */
function armCoexistAutoMessage(e: Engine, win: number): void {
  if ((e.advFields.get(97052) ?? 0) === 0) return;
  e.engineValues.set(FIELD_COEXIST_AUX, 0); // raw 28557
  const conf = (k: string, d: number): number => (e.config ? cfgInt(e.config, k, d) : d);
  const voiceBusy = (e.engineValues.get(FIELD_VOICE_BUSY) ?? 0) !== 0;
  let ms: number;
  if (voiceBusy) {
    if ((conf(CFG.messageAutoMessageOption, 0) & 1) === 0) return; // raw 28563-28564：门关 ⇒ 不武装
    ms =
      (lineCountOf(e, win) - 1 - (e.engineValues.get(ENGINE_FIELD.autoMessageBaseline) ?? 0)) *
        conf(CFG.messageAutoMessagePitch0, 0) +
      conf(CFG.messageAutoMessageTime0, 0);
  } else {
    ms =
      (lineCountOf(e, win) - 1 - (e.engineValues.get(ENGINE_FIELD.autoMessageBaseline) ?? 0)) *
        conf(CFG.messageAutoMessagePitch1, 0) +
      conf(CFG.messageAutoMessageTime1, 0);
  }
  if (ms <= 100) ms = 100; // raw 28583-28584
  // `sub_453A60` 的三格（raw 66105-66110）
  e.engineValues.set(TIMER_AUTO_MESSAGE + 2, 1);
  e.engineValues.set(TIMER_AUTO_MESSAGE + 5, e.nowMs | 0);
  e.engineValues.set(TIMER_AUTO_MESSAGE + 6, ms > 0 ? ms : 1);
}

/** 该窗文本**行数**（引擎 `(win_obj+48 - win_obj+44)/24` = 排版推入的 24B 行记录条数）。 */
function lineCountOf(e: Engine, win: number): number {
  const w = e.msgwin.resolveWin(win);
  return layoutWindow(w, { style: styleOfWin(e, w), segments: e.msgwin.slot(w).segments }).lines.length;
}

/**
 * `0xFA poll-msg-advance`（sub_4199B0 raw 24952-24987）：消息收尾 / 快速推进。
 * 输入掩码**没有**「跳读中」位（0x40）⇒ 清 ADV 并冲掉 3 个消息槽；随后若 ADV 已清，
 * 消费输入边沿并置 bit31（等待门）。
 *
 * ★这条过去**未在任何注册表**里 —— 脚本一旦命中就抛 `NotImplementedOp` 硬报错。
 *
 * ★审计 §4.1 P1 `op-18`（"3 个待播语音槽没有消费者"）的核验结论 = **重写侧在别处已有等价物**：
 * 引擎那 3 个槽是 `Engine[122505+i]`（语音 id）/`Engine[122508+i]`（循环位）/`Engine[5053+i]`（pan），
 * 写入端 = `0xC4`/`0x1BD`（raw 29893-29894/30047-30048，只在 ADV 位**已置**时写槽）与
 * `0x2F5`（raw 33641-33647）。emulator 把同一状态放在**宿主**：`0xC4`/`0x1BD` → `voice-defer`
 * 意图 → `AudioEngine.voiceDefer` 的 `v.deferred`，由 `AudioEngine.tick(nowMs, advActive)` 在
 * **ADV 位清除时统一冲刷**（`audioEngine.ts:641-651`，注释里就写着 `raw 20146/24966` 的冲刷点，
 * 而 raw 24966 正是本指令体里的 `_this[174801] &= ~0x8000000`）⇒ 「ADV 退出时补播」不丢。
 * ★同时**订正原文的槽步长**：不是 `122505 + 3*i`，而是 `122505 + i`（`v4` 每次 `++`），
 * 另两格在 `122508 + i` 与 `5053 + i`（`*(v4 - 117452)`）。
 * 残留（不属本票）：`0x2F5` 在 ADV 位已置时引擎是**写槽**、emulator 的 `op_voice_queue` 直接发
 * `voice-queue`（宿主按 delayMs 到期就播，不看 ADV 位）—— 那是 `T-0152`（audio 侧）的范围。
 * ★订正（审计 §4.1 P2 `op-130`）：raw 24985 的 `_this[174802] = 0`（刚被消费刷吸取的那一格掩码）
 * 此前没做 —— emulator 的对应格是 `InputManager.inputMask`（唯二写者 = 两把刷子），
 * 现按体清零（它进输入快照 ⇒ 是可观察状态）。
 */
const op_poll_msg_advance: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  // 引擎 raw 24963：这里的 `(mask & 0x40)` 判据来自 `sub_4780D0(..., &v5)` ⇒ **实时刷**；
  //  随后 raw 24983 的 `sub_478090` + `_this[174802]=0` = 消费刷的吸收（emulator 用 consumeEdges 等价）。
  const mask = e.input.flushHeld();
  if ((mask & 0x40) === 0) {
    clearAdv(e);
    e.msgwin.showing = 0;
  }
  if ((e.effectFlags & ADV_ACTIVE) === 0) {
    e.input.consumeEdges();
    e.input.inputMask = 0; // raw 24985：`_this[174802] = 0`
    e.awaitingAdvance = true;
  }
};

/**
 * `0x196 display-furigana`（sub_41FC20 raw 29032-29113）：在消息文本里插注音。
 *
 * 引擎体的三步（raw 行号）：
 *  1. raw 29055-29070：把 **op3** 的字符串拷进栈缓冲 `v20`（之后作为 `a4` 交给 `sub_46CBF0`/`sub_46BE30`），
 *     并算**外层门** `v7 = (*(_BYTE *)(_this + 489988) & 1) == 0`（raw 29071）。
 *     489988/4 = 下标 **122497** = `msgwin.flags`（bit0 由 `0x304` 置、由 `0x305` 清，见本文件那两个 handler）。
 *  2. `v7` 为真（**文本块位未置**，raw 29073-29097）：MessageSpeed/ADV 两分支 ——
 *     raw 29075 `if (!_this[86672] || (_this[699204] & 0x8000000) != 0)` ⇒ raw 29081 `sub_46CBF0`
 *     （同步排空，体内无 Sleep）；否则 raw 29088 `sub_46BE30` + raw 29093 `effect_flags |= 0x20000000`
 *     + raw 29095 `sub_453A60(_this+430572, MessageSpeed)`（计时器）。
 *  3. `v7` 为假（**文本块位已置**，即 `0x304`…`0x305` 之间）：raw 29104 `sub_46BE30`，
 *     成功则 raw 29108 `_this[489988] |= 0x10000` + raw 29109 `_this[489484] = op1`。
 *
 * emulator：`captureFontStyle` + `addRuby` + `emitWin` 是"入队 + 发布"的等价物；
 * raw 29077/29094/29109 的 `_this[489484] = op1`（= `msgwin.lastArg`，见其字段说明）在此照写。
 *
 * ★**订正（审计 `op-3-004`）**：此前本 handler 只做入队，**外层门整个丢了** ⇒ `0x304`…`0x305`
 *   之间（注音/内嵌模式）与之外走的是同一条路。现在按 raw 29071 接上：`m.flags & 1` 置位时走第③路。
 *
 * ★**已建模（`T-0094`）**：第①②路的 `effect_flags |= 0x20000000` + `sub_453A60(Engine+430572, MessageSpeed)`
 *   **节流半边** —— 与 `0x6E` 的 raw 28380/28382 **同形**，故复用同一个 `SLEEP_GATE`/`sleepUntil` 机制
 *   （不新造平行机制）。三具被调函数的体（各自 raw 区间）：
 *
 * | 函数 | raw | 是什么 |
 * |---|---|---|
 * | `sub_46BE30(Font, win, 本行, 注音, op4)` | 83363-83995 | **把"本行 + 注音"排进该窗记录**（`sub_45D120` raw 83918 push 一条 24B 记录；注音经 `sub_45E870` raw 83962）。**无 Sleep、无计时器、无自旋**。返回 **1** = 已排版；**0** = `*a3 == 0`（op2 空串，raw 83493-83497 提前 `return 0`）⇒ **返回值 = "本行有内容吗"**。 |
 * | `sub_46CBF0(同参)` | 83998-84010 | `Font[54630] = 1` → `sub_46BE30` → `Font[54630] = 0` → `do … while (!sub_45BE20(Font, op1))` **自旋**。⇒ **差别不在排不排版，而在结尾那次"把该窗剩余行一次性泵完"**；"同步排空"排空的就是 **`sub_45BE20` 的行泵**（raw 72172：`v5 = win+132` 行游标；"没有下一行"时 `return 1` ⇒ 自旋退出）。体内**既没有 Sleep、也不起计时器**。 |
 * | `sub_453A60(Engine+430572, ms)` | 66100-66112 | **一个 MessageSpeed 节拍计时器对象**（`Engine+430572` = 该对象基址，不是消息窗/message 状态）：`t[2] = 1`（周期序号，`sub_453B60` raw 66210 每次到期自增）→ `t[5] = timeGetTime()`（起点）→ `t[6] = ms`（周期，**`ms == 0` 时取 1**，raw 66108-66110）⇒ **单位 = 毫秒，量级 = `message:MessageSpeed` 本身**。 |
 *
 * **`0x20000000` 谁来清**：`sub_453B60(Engine+430572)`（raw 66188-66212）是它的到期判定 ——
 * 未到点返回 **-1**（raw 66198/66205-66206），到点返回 `已过周期数 - 1`（>= 0）。读者是主循环
 * raw 21176 `if ((v35 & 0x20000000) != 0) sub_409400(...)`（= 本模型帧循环的 `sleep` 分支）；
 * 清位点是 `sub_409400` 内的 raw 13892 / 13919 / 13940 / 13964 —— **每条出口都在"门可以放行了"之后**
 * （raw 13860/13958 的 `sub_453B60(Engine+430572)` 先判 -1 就 `return`）。⇒ emulator 的等价物
 * 就是 `frame/loop.ts` raw 299 `if (gates.sleep === 'clear' || nowMs >= e.sleepUntil) e.waitFlags &= ~SLEEP_GATE`。
 *
 * **为什么这是"少等一拍"**：引擎在 raw 29095 起计时器后，主循环那一帧的 raw 21176 分支会**一直**
 * 拿 `sub_453B60` 去撞计时器（raw 13860 撞不过就 `return`，本帧什么都不推进）⇒ 紧随其后的
 * `show-text`（`src/CONFIG.txt:174-175` 就是这个顺序）要等满 `MessageSpeed` ms 才派发。
 * 修前 emulator 从不起计时器 ⇒ 注音之后立刻派发下一条 ⇒ **每处注音少等一拍**。
 *
 * ★**未建模（有据缺口，不静默跳过）**：
 *  - raw 29075 的 ADV 支（`sub_46CBF0` 的**自旋**那一半）：emulator 无文本渲染、`sub_45BE20`
 *    的"行泵"不建模 ⇒ `0x6E` 那边同样以"不装门"表达"同步排空"（口径一致）。因此第①②路的
 *    ADV 支 / MessageSpeed=0 支在 emulator 里都是"不装门"，差别只在不在计时器上。
 *  - `sub_46BE30` 的字形排版/光栅化半边（本模块文件头"不做的部分"）；
 *  - raw 29079/29085/29101 的 `op4`（`v19/v18/v17`，作为 `a5` 交给 `sub_46BE30`）：`scripts/asm/opcodes.json`
 *    给 `0x196` 的 `argc = 3` ⇒ 语料里只写 3 个操作数（`CONFIG1.BIN` 实读：`0x196 0 "天俟" "天俟"`，
 *    `args.length = 3`）⇒ emulator 不读第 4 个操作数（`a5 < 0` 时 `sub_46BE30` 的 `sub_4691A0` 那一支
 *    raw 83941-83942 直接在体外，不建模）。
 *    ★注意这三处的 `sub_41B640((_DWORD)_this, 4)` 在反编译里用 `_this[97055]`（= `textBaseGate` 槽）
 *    当"当前脚本"—— 是**反编译器把不同字段认串了**（`0x41` 与 `0x5E` 的字节距离），不是引擎真的从
 *    那张表取操作数；原本照抄这个下标会读到"文本记账门"的值。`textBaseGate` 的事实见
 *    `src/vm/engineFieldIds.ts`（`_this[97055]`，`0x1BB` 写）。
 *  - **raw 29077 的 `_this[489484] = sub_41BF50(...,1)`**：第①路写的是 `sub_41BF50` 的**返回值**
 *    （不是 `op1`！），而 `sub_41BF50`（raw 26554-…）是"取操作数的值"本身。emulator 三条出口
 *    统一写 `lastArg = op1`（第②③路 raw 29094/29109 确实是 `op1` 求值后的值）—— 第①路的
 *    "两次 `sub_41BF50(...,1)`"在当前操作数形态下与 `op1` 同值，故不单列；若将来遇到
 *    `op1` 是**引用型**操作数（表项/字符串下标）而两者分叉，需在此补显式求值。
 *  - raw 26045（`0x305` 的 `(flags & 0x10001) == 0x10001`）是 bit16 的**读者** —— 它不在本 handler，
 *    且 emulator 的 `0x305` 目前不查这一位（属既有缺口，登记在此以免被当成"没人读"）。
 */
const op_display_furigana: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  // ★同样是"文本入队"（引擎 `sub_46BE30`）⇒ 追加前钉住当前样式
  //   （口径：**一页的样式 = 最后一次入队那一刻的样式**；引擎严格来说是"每段各自用当时的样式"，
  //    但全库 87324 处文本入队里，页内"文本→改样式→再文本"的出现次数是 **0** ⇒ 两者等价）
  captureFontStyle(e, slot);
  const base = (plan.str(2) ?? '');
  e.msgwin.addRuby(slot, base, (plan.str(3) ?? ''));
  // ★同一条 `sub_46BE30` 调用 ⇒ 也留一行记录（`tickets/T-0170`）；漏了它，回想页里
  //   **被注音的那个词会缺字**（正文的其它段由 `0x6E` 记账，这一段只有 `0x196` 走）。
  recordRenderedRow(e, slot, base);
  e.msgwin.reveal.delete(e.msgwin.resolveWin(slot));
  emitWin(e, slot);
  // raw 29071 的外层门：bit0 置位（`0x304` 已开文本块）⇒ 走引擎第③路（raw 29104-29109）。
  // ★bit16 的**门 = `sub_46BE30` 的返回值**（raw 29104-29105 的 `result = …; if (result)`）——
  //   该返回值 = 「**本行有内容吗**」（`*a3 == 0` 时 raw 83493-83497 提前 `return 0`）。
  //   ⇒ 本行文本为空串时**不得**置 bit16（`0x305` 的总门 `(flags & 0x10001) == 0x10001`，raw 26045，
  //   会因此走 else 支只清 flags）。修前是"bit0 置位就无条件置 bit16"，比引擎多置一位。
  const rubyLineHasContent = base.length > 0; // `sub_46BE30` 的返回值等价物
  if ((e.msgwin.flags & 1) !== 0 && rubyLineHasContent) e.msgwin.flags |= 0x10000; // raw 29108（bit16；读者 raw 26045）
  e.msgwin.lastArg = slot; // raw 29077 / 29094 / 29109：`_this[489484] = op1`（= `msgwin.lastArg`）
  // ---- 第①②路（bit0 未置）的 MessageSpeed 节流半边（`T-0094`；raw 29075-29095）----
  // 与 `0x6E` 的 raw 28361-28382 **同形**，故照搬同一个机制：MessageSpeed==0 **或** ADV 位已置
  // ⇒ raw 29075 的第一/第二个析取项成立 ⇒ 走 raw 29081 的 `sub_46CBF0`（同步排空，体内无 Sleep、
  // 不起计时器）⇒ emulator 不装门（与 `op_show_text` 的口径一致）；**只有 else**（raw 29083）
  // 才是 raw 29088 `sub_46BE30` + raw 29093 `effect_flags |= 0x20000000`（= `SLEEP_GATE`）
  // + raw 29095 `sub_453A60(Engine+430572, MessageSpeed)`（= `sleepUntil = now + max(1, speed)`；
  // 计时器对象的 `ms == 0 ⇒ 1` 见 raw 66108-66110，这里 `speed > 0` 已排除该支）。
  if ((e.msgwin.flags & 1) === 0) {
    const speed = messageSpeedOf(e);
    if (speed > 0 && (e.effectFlags & ADV_ACTIVE) === 0) {
      e.sleepUntil = e.nowMs + Math.max(1, speed);
      e.effectFlags |= SLEEP_GATE;
    }
  }
};

// ---------------------------------------------------------------------------
// 字格逐字显现（0x73 字格 + 0x1CE 开关 + 0x20A 重画 + 0x304/0x305 文本块）
// ---------------------------------------------------------------------------

/**
 * `0x73 <win> <op2>…<op9> <ms>`（sub_41F250 raw 28601-28639，argc=10）：**设字格 + 逐字节拍**。
 *
 * 引擎：`v = read(10)` → `sub_453AD0(Engine+430600, v)`（逐字计时器周期 ms，0 ⇒ 1，raw 66142）；
 * 其余 9 个操作数交给 `sub_456430`（raw 68282-68306）拷进窗对象 `win+60..99`：
 * `{op4, op5, op6, op7+op5, op8+op6, op2, op3, 1, op9, op9}` —— 其中 `win+88 = 1` 是**逐字总门**，
 * `win+92 = win+96 = op9` 是字格数/列数（引擎主循环的模数）。
 * 另外 GDI 路径（`Engine[166964] == 0`）还会调一次 vtable(33, 2*op7, op8, 2) 建绘制容器。
 *
 * ★脚本侧只有 27 处（`NOVEL.txt:11/265`、`SN0000.txt` 各页、`SYSTEM4.txt:41`）—— 也就是**序章 /
 * NOVEL / SYSTEM4 才走逐字**；普通 ADV 不开这道门（`sub_45A940` 直接返回）。
 */
const op_set_char_grid: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const m = e.msgwin;
  const rd = (n: number): number => (plan.int(n) ?? 0);
  const win = m.resolveWin(rd(1));
  const tickMs = rd(10);
  m.setCharGrid(win, {
    textX: rd(2),
    textY: rd(3),
    srcSurface: rd(4),
    originX: rd(5),
    originY: rd(6),
    cellW: rd(7),
    cellH: rd(8),
    cells: rd(9),
    gate: true,
    tickMs,
  });
  emitWin(e, win);
};

/**
 * `0x1CE <v>`（sub_420280 raw 29329-29351）：**逐字显现开关**（并记录 `Engine[107706] = v`）。
 *
 * - `v != 0` ⇒ `effect_flags |= 0x40000000` + `Engine[107704] = 0` + `sub_453A90(Engine+430600)`
 *   （重启节拍）；若本窗已有显现状态，这里把它的 `nextAt` 按字格节拍重置（等价于重启计时器）。
 * - `v == 0` ⇒ 若 bit30 已置：`if (!(effect_flags & 0x100000)) sub_45A940(Font, 当前窗, -2, 0)`
 *   （整段收尾）→ 清 bit30。
 *
 * ★全库只有 `i1ce 0`（0 处 `i1ce 非0`）—— 真正的逐字启动点是 `0x72`（见 `op_wait_for_input`）。
 */
const op_char_reveal_switch: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  const p = operandsFor(c);
  if (!p) throw new Error('0x1ce：逐字开关走操作数计划层，但没有声明计划');
  const v = p.int(1) ?? 0;
  m.charModeArg = v;
  e.engineValues.set(ENGINE_FIELD.charModeArg, v);
  if (v !== 0) {
    m.charMode = true;
    m.charCursor = 0;
    e.engineValues.set(ENGINE_FIELD.charCursor, 0);
    e.effectFlags |= CHAR_REVEAL_ACTIVE;
    // `sub_453A90`：重启节拍 ⇒ 已有显现状态的下一次推进点按当前节拍重排（不补走欠账）
    for (const [, st] of m.reveal) {
      if (!st.active) continue;
      st.nextAt = e.nowMs + st.intervalMs;
    }
    // 同一句也重启**字格图标**的节拍（引擎 `Engine+430600` 是同一个计时器对象）
    const g0 = m.gridOf(m.resolveWin(m.lastArg));
    if (g0) {
      m.cellK = 0;
      m.cellNextAt = e.nowMs + (g0.tickMs > 0 ? g0.tickMs : 1);
    }
    return;
  }
  if ((e.effectFlags & CHAR_REVEAL_ACTIVE) !== 0) {
    // ★引擎（raw 29343-29349）只对 **`Engine[122371]`（= 当前窗）** 做一次 `sub_45A940(Font, 窗, -2, 0)`
    //   （= 用当前游标重贴），而不是对所有 reveal 窗整段收尾（审计 P3 `op-10-004`：凭空扩大范围）。
    if ((e.effectFlags & 0x100000) === 0) m.finishReveal(m.resolveWin(m.lastArg));
    e.endCharReveal();
    e.serviceTextReveal(e.nowMs);
  }
};

/**
 * `0x20A <win>`（sub_423620 raw 31546-31566）：**按当前状态重排并重画该窗文本**。
 *
 * 引擎体（raw 31553-31565）有**两条**效果，按序：
 *  ① raw 31553 `_this[30*cur + 95805] = 3`（步长槽）
 *     然后 raw 31555 `sub_45AD30(Font, win)` = **重排该窗文本**（raw 71481-…；体内先读
 *     `win+132`（显现游标）到 `Font+1396`（raw 71533-71534），再按 24B/条 文本记录
 *     （`(end-begin)/24 - 1`，raw 71538）重排成行/字形）；
 *  ② raw 31556-31559 `v3 = _this[124350] ? _this[95779] : _this[174801]`，若 `(v3 & 0x40000000) != 0`
 *     （bit30 = 逐字显现中）则 raw 31562-31564 用**当前** `_this[107704]`（字格游标）
 *     调 `sub_45A940(Font, win, k, 0)` **重贴第 k 格**（`sub_45A940` raw 71380-71413：
 *     `a3 >= 0` 时按 `k % cols` / `k / cols` 算字格坐标重贴；`-1`/`-2` 才是查询/收尾哨兵）
 *     —— **游标不动、内容不变**，只是把当前那一格再贴一次。
 *
 * ## emulator 选②：把"两条效果"折进 `emitWin`，在这里写明**为什么等价**（不空口）
 *  - ①的对应物 = **宿主通道的重排**：`emitWin` → `native.msgWinSync(win, input)` →
 *    `renderer/scene/ops.ts` 的 `scMsgWinSync`（两个宿主共用这一个函数：
 *    `headlessScene.msgWinSync` 与 pixi 都调它）**每次同步都无条件跑一次 `layoutWindow(win, input)`**
 *    ⇒ 重排是 emit 通道的固有步骤，且**排在"贴格"之前**（与引擎 raw 31555 → 31564 同序）。
 *    等价性的关键前提是"input 带的是**活**的 segments"——守卫断言：`emitWin` 交给宿主的
 *    `input.segments` **就是** `m.slot(win).segments` 这个数组本身（引用相同），
 *    因此宿主那次重排 == 引擎 `sub_45AD30` 的输出。
 *  - ②的对应物 = `emitWin` 载荷里的 `cell: cellFrameOf(e, w)`（同上文件）：它**正好**以
 *    `(effectFlags & CHAR_REVEAL_ACTIVE) !== 0`（bit30）为门，`k = m.cellK % g.cells`
 *    （**当前**字格游标，取模但不自增）⇒ 与 raw 31556-31564 的条件与取值逐一对应。
 *  - 未建模：raw 31556 的 `_this[124350] ? _this[95779] : _this[174801]` 这个**选择器**——
 *    emulator 只读 `effectFlags`（= `_this[174801]`）；`124350`/`95779` 两条备选位未建模
 *    （`124350` 的语义未定；两者的取值差异未做语料统计 ⇒ 登记为缺口，不假装等价）。
 *  - `sub_45AD30` 内部"把记录重排后写回 win 的记录向量"这一步不落回 `m.slot().segments`
 *    （emulator 的 segments 是脚本侧真源，重排只发生在 `layoutWindow` 的返回值里）⇒ 若将来
 *    出现"引擎重排后 segments 顺序变了、而 emulator 的 layout 与之一致"的分叉，需在此补显式重排。
 *
 * 脚本侧 1011 处；★这条过去**未注册**（命中即 `NotImplementedOp` 硬报错）。
 */
const op_window_relayout: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const m = e.msgwin;
  const win = m.resolveWin((plan.int(1) ?? 0));
  // 重排（宿主 `scMsgWinSync` 内）+ 按当前游标/当前字格重贴（`emitWin` 的 `revealed` / `cell`）
  // 一次做完 ⇒ 游标不动、内容不变（见上方①/②的逐条对应）。
  emitWin(e, win);
};

/**
 * `0x82`（`sub_41F720` raw 28808-28826 → **`sub_466000` raw 79319-80311**，argc 5）：
 * **用给定颜色把某窗的文本记录重画一遍**（GDI 文本重绘族）——`tickets/T-0104`。
 *
 * 引擎逐条（体已读完，见 `tickets/T-0104/notes.md` 轮 9）：
 * ```
 * v8 = (Font+3368 − Font+3364)/72;              // 该 Font 的 72B 文本项记录条数
 * if (v8 > op2 && op2 >= 0) {                   // ★门：op2 = **起始记录下标**，越界 ⇒ 什么都不做
 *   if (surface[op1]+112 == 1) { sub_462040(...); return; }   // 该窗的专用路径（见 gaps）
 *   ... for (i = op2; i < v8; ++i) { sub_4576C0(Font, op1, i, …) … GDI 画进窗 op1 的表面 }
 *   if (op3 & 2) { Font+1360 = BGR(op4); sub_459F40(Font);     // ← 填充色（与 0x76 同一个字段）
 *                  Font+1364 = BGR(op5); sub_459F40(Font); }   // ← 描边色（与 0x77 同一个字段）
 * }
 * ```
 * ⇒ `op1` = 窗索引、`op2` = 该窗文本记录的起始下标、`op3` = 模式/标志位、
 * **`op4`/`op5` = 填充色 / 描边色**。全语料仅 1 处：`src/CONFIG.txt:269`
 * （设置界面「回 ADV」路径的最后一笔：前面 `label_00001ae8` 刚用 `i076/i077` 重算并应用
 * `f807b`/`f807c`，这一笔把**已经排好版的那条记录**按新颜色重画 ⇒ 与 T-0102 的"退出设置后
 * ADV 文字色不刷新"自洽）。
 *
 * emulator 等价物（与 `0x20A` 同一条发布通路）：**用 `op4`/`op5` 覆盖全局填充/描边色字段
 * （仅当 `op3 & 2`）、把覆写色钉进该窗的字体快照，再 `emitWin(op1)` 把该窗文本按新样式重新光栅化，
 * 最后把全局两格色值恢复成调用前的值**。
 *
 * ★**登记的近似（不是等价，别当等价用）**：① `op2` 只用于引擎那道越界门（emulator 的排版是
 * 「整窗从模型重排」，没有"从第 i 条记录起重画"的粒度）⇒ 门通过后重画的是整窗；
 * ② `op3` 的 bit0/bit2/bit3 参与**记录级过滤**（raw 79699 的 `(flags & 2) != 0 && (op3 & 1) == 0`
 * ⇒ 跳过该条记录、raw 80773 的 `op3 & 4` ⇒ 不贴这一行）—— 重写侧没有记录级粒度 ⇒ 未建模；
 * bit6（`0x40`）与 bit4/5（`0x30`）**已建模**（见下）；
 * ③ 引擎只在 `v8 > op2` 时**才**动颜色 ⇒ emulator 同样把设色放在这道门之后（乱序修复会变成"越界也改色"）；
 * ④ 窗对象 `+112 == 1` ⇒ 引擎改走专用路径 `sub_462040` 并**直接 return**（raw 79504-79508）——
 *    emulator 的窗对象没有 `+112` ⇒ 该支未建模（与 `0x1D1` 的 `dedicatedPath` 同一条登记）。
 * ⑤ bit6 的语义订正：**不是**"起始记录下标后移"，而是 **DrawItem id 起点**后移
 *    （raw 79685-79688：`v45 = obj+104; v155 = v45; if (op3 & 0x40) v155 = obj+132 + v45;`）——
 *    影响的是本次绘制项的层序 id，`a3`（起始记录下标）不动。
 * ⑥ 记录循环里**逐条**改全局色的那两写（raw 79738-79759，带 `&& !v158`）未建模 ⇒ 收尾那对恢复
 *    （raw 80239-80262）只由覆写色那一支触发；两件事同一张登记（`missing[]` 的 raw 80239-80262）。
 */
const op_gdi_repaint_window: OpHandler = (c) => {
  const e = c.e;
  const p = operandsFor(c);
  if (!p) return;
  // ★**先读完五格再进门**（与引擎同序）：handler `sub_41F720` 无条件 `sub_41BF50` ×5，那道越界门在
  //   **被调**体 `sub_466000` 里 —— 顺序反了会把"引擎读了但没用上"变成"根本没读"（操作数纪律守卫会红）。
  const win = e.msgwin.resolveWin(p.int(1) ?? 0);
  const start = p.int(2) ?? -1;
  const mode = p.int(3) ?? 0;
  const fill = p.int(4) ?? 0;
  const outline = p.int(5) ?? 0;
  // ★引擎的越界门（raw 79502）：记录表中没有第 `start` 条 ⇒ **整条指令什么都不做**（连颜色都不改）。
  //   记录表 = `Engine.textItems`（引擎 `Font[841..842]` 的 72B 向量，同一张表）。
  if (!(start >= 0 && start < e.textItems.records.length)) return;
  const o = e.msgwin.objectAt(win);
  if (!o) return; // raw 79504 无条件解引用 `Font[a2+261]`（表内恒存在）；表外 ⇒ 不发明对象
  // ---- raw 79634-79653：`op3 & 0x40` 为 0 ⇒ 移除 `win+104/+108`；`op3 & 0x30` ⇒ 移除 `win+276/+280` ----
  //   ★这两段在引擎里只在 **DrawMode == 1**（raw 79629 `v39 = Engine[667856]`）那一支里；重写侧
  //     没有 D3D/GDI 两套表面，取"照做"（与 `0x1D1` 的同一段保持一致，见 `op_recall_page_repaint`）。
  if ((mode & REPAINT_KEEP_SURFACE) === 0) {
    o.f104 = 0;
    o.f108 = 0;
  }
  if ((mode & REPAINT_RUBY_RANGE) !== 0) {
    o.f276 = 0;
    o.f280 = 0;
  }
  // ---- raw 79664-79670：`op3 & 2` ⇒ 覆写全局填充/描边色（与 0x76/0x77、`0x1D1` 同一对字段）----
  //   ★进门先把调用前的两格存下来（= 引擎 raw 79509-79525 存进 `v138/v139` 那一步），收尾用。
  const overrideColors = (mode & REPAINT_SET_COLORS) !== 0;
  const savedFill = e.engineValues.get(ENGINE_FIELD.colorFill);
  const savedOutline = e.engineValues.get(ENGINE_FIELD.colorOutline);
  if (overrideColors) {
    e.engineValues.set(ENGINE_FIELD.colorFill, bgrToRgb(fill));
    e.engineValues.set(ENGINE_FIELD.colorOutline, bgrToRgb(outline));
    // ★覆写色还要**钉进该窗的字体快照**（孪生 `0x1D1` 在 :1364 有这一步，本 handler 此前漏了）：
    //   引擎把这次重画的字形**连同覆写色一起画进该窗表面**，而重写侧的 `styleOfWin` 对已有快照的窗
    //   只认 `slot.fontStyle`（:251）⇒ 不钉的话，目标窗的文本早已入队过时覆写色**到不了载荷**。
    applyOverrideColorToSnapshot(e, win, hex6(bgrToRgb(fill)), hex6(bgrToRgb(outline)));
  }
  // raw 79684-79688：`v155 = win+104; if (op3 & 0x40) v155 = win+132 + win+104;` —— 本次绘制项的
  //   **id 起点**（不动窗对象）⇒ 只影响这一次发布的层序。
  emitWin(e, win, (mode & REPAINT_KEEP_SURFACE) !== 0 ? o.f104 + o.f132 : o.f104);
  // ★raw 80239-80262：**恢复端**。`sub_466000` 进门时把调用前的四格色值存进局部
  //   （raw 79509-79525：`v139/v146` ← `+1364`、`v138/v145` ← `+1360`、另存 `+1368/+1372`），
  //   收尾按**逐格 guard** 写回：`+1364` 的 guard 是 `if (v146 != v128 || v158)`（raw 80241）、
  //   `+1360` 的是 `if (v145 != v138 || v158)`（raw 80258），`v158 = a4 & 2`（raw 79663）。
  //   ⇒ 语义 = 「本次设过色（`op3 & 2`）或记录循环把该格改成了别的值 ⇒ 恢复成调用前的值」。
  //   ★为什么必须恢复（不是记账）：记录循环**逐条**把记录自带的色值写进这两格
  //   （raw 79738-79759：`if (v146 != v53 && !v158) Font+1364 = v53;` / `if (v145 != v55 && !v158) Font+1360 = v55;`
  //   —— 注意两条都带 `&& !v158`，即"设色位开着时循环自己不改这两格"）⇒ 不恢复就会泄漏到后续入队的文本与其它窗。
  //   重写侧的记录循环没有"逐条改全局色"这一步（登记的近似②）⇒ 今天的可观测差异只来自覆写色那一支，
  //   但这条不变量必须在：它挡住的是"记录级色值进全局字段"这条路径将来落地时的泄漏。
  if (overrideColors) {
    if (savedFill === undefined) e.engineValues.delete(ENGINE_FIELD.colorFill);
    else e.engineValues.set(ENGINE_FIELD.colorFill, savedFill);
    if (savedOutline === undefined) e.engineValues.delete(ENGINE_FIELD.colorOutline);
    else e.engineValues.set(ENGINE_FIELD.colorOutline, savedOutline);
  }
};

/**
 * `0x1D1`（`sub_420310` raw 29353-29371 → `sub_4675A0` raw 80313-81522）：**回看页重绘**
 * —— 上一条 `0x82`（`op_gdi_repaint_window`）的**孪生兄弟**（`tickets/T-0170`）。
 *
 * ## 与 `0x82` 同形的部分（逐条 raw 对照）
 * | 件 | `0x82`：`sub_41F720` raw 28808-28826 → `sub_466000` raw 79319-80311 | `0x1D1`：`sub_420310` raw 29353-29371 → `sub_4675A0` raw 80313-81522 |
 * |---|---|---|
 * | handler 骨架 | `_this[30*cur+95805] = 11`；`op5..op1` 五次 `sub_41BF50`；第 7 参 = `Engine+84128` | **逐字相同**（raw 29364-29370 / 28819-28825） |
 * | 越界门 | `(Font+3368 − Font+3364)/72 > op2 && op2 >= 0`（raw 79499-79505） | **同一道**（raw 80529）⇒ 越界则整条指令什么都不做 |
 * | 专用窗路径 | 窗对象 `+112 == 1` ⇒ `sub_462040`（raw 79506） | 同条件 ⇒ `sub_4634B0`（raw 80531-80532；体 raw 77500-78716） |
 * | 颜色覆写 | `op3 & 2` ⇒ `Font+1360 ← BGR(op4)`、`Font+1364 ← BGR(op5)` | 同（raw 80629-80634） |
 * | 旧表面/区间 | `sub_4A3890` / `sub_4ABB60`（raw 79636-79652） | 同（raw 80593-80611：`op3 & 0x40` 才跳过、`op3 & 0x30` 另移除 `win+276/+280`） |
 * | 记录循环 | 从 `op2` 起逐条重画 | 从 `op2` 起逐条重画（raw 80664-81014） |
 *
 * ## 与 `0x82` **分叉**的部分（每一条都有 raw）
 * 1. **颜色是临时的**（两条都一样，**不是**分叉 —— 波 G 逐行读体所得）：两条重画体收尾都把
 *    `Font+1360/+1364` 恢复成**调用前**的值：`sub_4675A0` raw 81470-81473（guard `v172[1]` 是个恒非空的局部
 *    指针 ⇒ 实质无条件；它的记录循环在 `!(op3 & 2)` 时会逐条改这两格，所以必须恢复）、
 *    `sub_466000` raw 80239-80262（guard 是**逐格**的「当前值 != 保存值 || `op3 & 2`」，并多恢复 `+1368/+1372`）。
 *    ⇒ 两侧 handler **都按体恢复**（`op_gdi_repaint_window` 的恢复端在 :1252-1257，2026-09 补齐）。
 * 2. **记录分流**：`sub_4675A0` 分四类 —— 语音项（`op3 & 8` 才贴图标 ⇒ `sub_4BB840`，raw 80678-80699）、
 *    换行记录（记录 `flags & 8`，raw 80718-80724）、正文行（记录 `flags & 4`，把**连续**若干条的 `+44`
 *    串 `memcpy` 拼成一整行再逐字画，raw 80725-81014）、切页哨兵（记录 `flags & 2` 且 `!(op3&1)`，raw 80676）。
 * 3. **专用体**：`sub_4634B0`（raw 77500-78716，GDI-only 变体，字体句柄 `+101852/+101856`）vs `sub_462040`。
 * 4. **正文来源**：`sub_4675A0` 从记录 `+44` 的 `std::string` 取（raw 80736-80745）——
 *    即"ADV 已经画过的正文行"；这就是它被 `src/HISTORY.txt` 用来重画回想页正文的原因。
 * 5. 尾部还有 `win+136`（已画字数）/`win+132`（高水位）两个**窗口记账**写（raw 81220/81224）
 *    与 `op3 & 0x20` 的栏带四边形循环（raw 81498-81509）—— 后者驱动数据是**窗对象自己的栏表**
 *    （`win[56]`/`win[70]`），emulator 未建模该表 ⇒ 登记在 `missing[]`。
 *
 * ## ★它不是"页面/滚动/高亮"模型（这条是给后来者的护栏）
 * 引擎体 **raw 81140-81522 全域搜索**：无 `FillRect`/`Rectangle`/`PatBlt`、无区域填充、无行底填色、
 * 无选中页高亮、无滚动位置；唯一的"光标"是 raw 81145 `sub_4AC750` 的矩阵平移项。
 * 滚动/选中/翻页全部由脚本自己做：`src/HISTORY.txt` 的 `i1d0`（取页）+ `i1d3`（取记录字段）
 * + `draw-texture`/`i217`/`i1fd`（画框、条纹、页码），`i1d1` 全语料**只在 `HISTORY.txt:1314` 一处**。
 *
 * ## emulator 的登记近似（不是等价，别当等价用）
 *  - 引擎把记录画进该窗的**离屏表面** `win+20`（`sub_45E870` raw 81197 + 逐字 GDI raw 81275-81417；
 *    `sub_4ACE50` 在本函数每次都传 `win+20` 当纹理）⇒ 重写侧没有"在该窗表面追加若干行"的粒度，
 *    改用 `setPageText(窗, 切片正文行)` + `emitWin(窗)`＝"整窗从模型重排"（与 `0x82` 同一条近似）。
 *  - 覆写色发布时钉进该窗的字体快照（= "字形连颜色一起进表面"），随后恢复全局字段；
 *    `0x82` 走同一入口（`applyOverrideColorToSnapshot`，只是它不清快照 ⇒ 只换颜色四格）。
 *  - 专用路径（`win+112 == 1`）不建第二套渲染器 ⇒ 只把 `dedicatedPath` 记进结果，呈现通路相同。
 *  - `sub_404CB0(语音)` 没有宿主缝 ⇒ 恒 `false`（登记在 `missing[]`）。
 *  - 窗对象 `+112`（专用路径判定）与 `win[56]/[70]` 栏表未建模 ⇒ `dedicatedPath` 恒 `false`、
 *    栏带四边形循环不实现（同 `missing[]`）。
 *
 * 语料 **1 处**：`src/HISTORY.txt:1314` 的 `i1d1 (local-int 4a9) (local-int 94) 40 0 0`
 * （op1 = `3 + 行号`、op2 = 上一段 `i1d0` 收出来的记录下标、op3 = 0x40 = "不清旧表面"）。
 */
const op_recall_page_repaint: OpHandler = (c) => {
  const e = c.e;
  const p = operandsFor(c);
  if (!p) return;
  // ★**先读完五格再进门**（与引擎同序，`sub_420310` raw 29365-29369 无条件五次 `sub_41BF50`，
  //   越界门在**被调体** `sub_4675A0` raw 80529 里）—— 与 `0x82` 同一条纪律。
  const winArg = p.int(1) ?? 0;
  const start = p.int(2) ?? -1;
  const mode = p.int(3) ?? 0;
  const fill = p.int(4) ?? 0;
  const outline = p.int(5) ?? 0;
  const win = e.msgwin.resolveWin(winArg);
  const o = e.msgwin.object(win);
  // 窗对象 `+112` 未建模 ⇒ 专用路径恒 false（见上文登记）。
  const dedicatedPath = false;
  // ★raw 80529 的越界门：不满足 ⇒ 被调体**直接 return**（连颜色都不改、也不发布该窗；
  //   「什么都没做」在宿主侧可观测 = 一次 `msgWinSync` 都没有）。
  if (!(start >= 0 && start < e.textItems.records.length)) return;
  // ---- raw 80589-80611：`op3 & 0x40` 为 0 ⇒ 清旧表面 + 移除 `win+104/+108`；`op3 & 0x30` ⇒ 移除 `win+276/+280` ----
  if ((mode & REPAINT_KEEP_SURFACE) === 0) {
    o.f104 = 0;
    o.f108 = 0;
  }
  if ((mode & REPAINT_RUBY_RANGE) !== 0) {
    o.f276 = 0;
    o.f280 = 0;
  }
  // ---- raw 80629-80634：`op3 & 2` ⇒ 覆写全局填充/描边色（与 0x76/0x77、0x82 同一对字段）----
  const override = (mode & REPAINT_SET_COLORS) !== 0;
  const savedFill = e.engineValues.get(ENGINE_FIELD.colorFill);
  const savedOutline = e.engineValues.get(ENGINE_FIELD.colorOutline);
  if (override) {
    e.engineValues.set(ENGINE_FIELD.colorFill, bgrToRgb(fill));
    e.engineValues.set(ENGINE_FIELD.colorOutline, bgrToRgb(outline));
  }
  // ---- raw 80664-81014：从 op2 起的那一圈记录循环（纯切片，无副作用）----
  //   ★它就是"这一窗要重画哪些记录"的唯一真源；结果**只**经 `setPageText` + `emitWin`
  //     流到渲染侧（不另设诊断字段 —— 那会是一条没有生产读者的死写）。
  const page = e.textItems.repaintRange(start, { win, mode, dedicatedPath, voiceBusy: false });
  // ---- raw 81197-81417：把这一页画进该窗（登记近似：整窗从模型重排）----
  //   引擎在"记录全被过滤掉 + 不清表面"时只清注音区间、不产生可见变化 ⇒ 这里也不动槽内容。
  if (page.lines.length > 0 || (mode & REPAINT_KEEP_SURFACE) === 0) {
    e.msgwin.setPageText(win, page.lines);
    captureFontStyle(e, win); // 字形连颜色一起钉住（引擎把字画进离屏表面）
  }
  // ★本 handler **不要**再去调 `0x82` 用的 `applyOverrideColorToSnapshot`：上面 `setPageText`
  //   已经把该窗快照清空、`captureFontStyle` 随即用**当前全局**样式（含刚写进去的覆写色）整份重钉，
  //   覆写色已经在快照里了。再加一次只会把颜色按 `hex6(bgrToRgb(...))` 多翻一次（实测把
  //   `#ff0000` 变成 `#0000ff`，`test/recall-page-0x1d1.test.ts` 的 ⑤ 直接红）。
  //   `0x82` 那边不同：它**不清快照**（目标窗的既有快照必须保住排版量）⇒ 只能走"只换颜色四格"那一支。
  // ★raw 80656-80662（`0x82` 的同一段在 raw 79684-79688）：`v192 = obj+104; v190 = 0;
  //   if (op3 & 0x40) { v192 += obj+132; v190 = obj+132; }` —— 本次绘制项的 **id 起点**后移，
  //   并另有一格 `v190` = 行偏移（引擎用它给逐行 id 编号；重写侧没有逐行 id ⇒ 只发布前者）。
  emitWin(e, win, (mode & REPAINT_KEEP_SURFACE) !== 0 ? o.f104 + o.f132 : o.f104);
  // ---- raw 81470-81473：颜色**恢复**（两侧同一条不变量：`0x82` 的恢复端在 raw 80239-80262）----
  if (override) {
    if (savedFill === undefined) e.engineValues.delete(ENGINE_FIELD.colorFill);
    else e.engineValues.set(ENGINE_FIELD.colorFill, savedFill);
    if (savedOutline === undefined) e.engineValues.delete(ENGINE_FIELD.colorOutline);
    else e.engineValues.set(ENGINE_FIELD.colorOutline, savedOutline);
  }
};

/**
 * `0x304`（sub_41A420 raw 24610-24625，argc=0）：**文本块开始**。
 * 引擎：`Engine[122497] = 1`（注音/内嵌模式位）→ 把当前消息窗对象的 `+296 = +132`
 * （**保存当前行游标**）。`+296` 由 `0x305` 取回，是"文本块"的括号语义。
 */
const op_text_block_begin: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  m.flags = 1; // Engine[122497] = 1（赋值，不是 |=）
  const win = m.resolveWin(m.lastArg);
  const st = m.reveal.get(win);
  m.lineCursorSave.set(win, st ? st.shown : -1);
};

/**
 * `0x305`（sub_41B1C0 raw 26034-26102，argc=0）：**文本块结束**。
 *
 * 引擎逐行（**门在第一条**）：
 * ```c
 * Engine[120*cur + 383220] = 1;                       // frame 状态槽（不建模）
 * if ((Engine[122497] & 0x10001) != 65537) { Engine[122497] = 0; return; }   // ★else 出口：只清 flags
 * v4 = 该窗对象;  if (v4) v4+132 = v4+296;            // 取回行游标（0x304 保存的）
 * if (ReadTextSkip) { if (sub_48F000(...)) { effect_flags |= 0x8000000; 122455 = 1; }
 *                     else if (!Engine[97050]) 122455 = 0; }
 * else if (122455) 122455 = 0;
 * if (Engine[86672] /*MessageSpeed*​/) {
 *     if (!(effect_flags & 0x8000000)) { effect_flags |= 0x20000000; 起节拍计时器(MessageSpeed); 清 flags; return; }
 * }
 * while (!sub_45BE20(Font, Engine[122371])) ;          // 把该窗余下的行一次性贴出
 * if (Engine[667856] == 1 && (Engine[369360] & 2) == 0) { 369352 = 0; 369356 = 0; 369344 = 1; }
 * Engine[122497] = 0;
 * ```
 * 重写侧映射：`finishReveal(当前窗)` = "把余下的行贴出"（引擎只泵 `Engine[122491]` 这一窗）；
 * 行游标存取由 `0x304`/`0x305` 的 `lineCursorSave` 承担；`0x20000000` 复用 `SLEEP_GATE`/`sleepUntil`
 * （与 `0x6E` raw 28380-28382、`0x196` raw 29093-29095 同形）；等待门计时器三格里
 * `369352`/`369356` = `Engine.gateWaitStart`/`gateWaitMs`，第三格 `369344` 只写不读 ⇒ 按既有口径不建模。
 *
 * ★订正（审计 P1 `op-13`，`tickets/T-0151`）：**总门此前整个缺失** —— 旧实现无条件
 * `finishReveal` 所有窗。bit0 由 `0x304` 置、bit16 由 `0x6E` 在 bit0 已置时补写
 * （raw 28332-28334）⇒ 只有「`0x304` 之后真的插了 `0x6E`/`0x196`」才满足 `0x10001`；
 * 「`0x304` 后紧跟 `0x305`」（注音插入被判空内容、bit16 未补）引擎**只清 flags**、
 * 一个字都不贴。旧实现那一路会多贴一整段文本。
 *
 * ★订正（审计 P2 `op-78`）：出口侧的**两段**（`0x20000000` 节拍 + 等待计时器三格）也补上了
 * ——它们只在 `MessageSpeed != 0`（节拍）或 `set:DrawMode == 1`（计时器）时才可见。
 */
const op_text_block_end: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  // ★argc 0（计划层照声明 `kinds: []`，`tickets/T-0082`）：本指令没有操作数。
  if (!operandsFor(c)) throw new Error('0x305：文本块结束走操作数计划层，但没有声明计划');
  const win = m.resolveWin(m.lastArg);
  // ★总门（raw 26045）：`(flags & 0x10001) == 0x10001` 才贴余下的行；否则 only 清 flags（raw 26099）。
  if ((m.flags & 0x10001) !== 0x10001) {
    m.flags = 0;
    return;
  }
  m.lineCursorSave.delete(win); // raw 26052：`win+132 = win+296`（取回 0x304 保存的行游标）
  // raw 26087 `while (!sub_45BE20(Font, Engine[122371]))`：只把**当前窗**余下的行贴出
  // （引擎只泵 `Engine[122371]` 一窗，不是所有窗 —— 与 `T-0100` 同一条纪律）。
  // ★游标按**当前**文本重算，但**只在已有显现条目、且新内容更多时**才刷新：
  //   ① 文本块里的 `0x6E` 会往该窗追加行，而显现状态里的 `total` 是上次武装时的旧值
  //      （块内 `0x6E` 提前 return、不碰显现状态）⇒ 不刷新会只贴出旧那一段；
  //   ② **但不能在这里新造条目**：没有条目时 `revealedOf` 本来就是 `-1`（全显示）/`0`（未武装），
  //      而新造一条 `shown = total` 会让随后的 `0x72` 武装（`beginReveal(..., speed>0)` ⇒ `shown = 0`）
  //      在"内容版本不变而游标变小 = 重放"的判据下变成**假重放**
  //      （`test/game-start-chain.test.ts` 判据⑦ 实测 1 次；A/B：只回退这一处即转绿）。
  const st = m.reveal.get(win);
  const laid = layoutWindow(win, { style: styleOfWin(e, win), segments: m.slot(win).segments });
  if (st && laid.glyphCount > st.total) {
    // `speedMs = 0` ⇒ `beginReveal` 走 instant 支（`shown = total`、`active = false`）= 一次贴满
    m.beginReveal(win, laid.glyphCount, e.nowMs, 0);
  } else {
    m.finishReveal(win);
  }
  if (m.charMode) e.endCharReveal();
  e.serviceTextReveal(e.nowMs);
  emitWin(e, win);
  // raw 26074-26086：MessageSpeed 非 0 且 ADV 未置 ⇒ 置 `0x20000000` + 起 MessageSpeed 节拍，
  // 然后清 flags 直接返回（这一支**不碰**等待门计时器）。
  const speed = messageSpeedOf(e);
  if (speed > 0 && (e.effectFlags & ADV_ACTIVE) === 0) {
    e.effectFlags |= SLEEP_GATE;
    e.sleepUntil = e.nowMs + Math.max(1, speed);
  } else if (
    // raw 26090-26094：`Engine[667856] == 1`（=`set:DrawMode`）且 `Engine[369360] & 2 == 0`
    // ⇒ 清等待门计时器两格（`369352/369356`）；第三格 `369344 = 1` 全库只写不读 ⇒ 不建模。
    (e.config ? cfgInt(e.config, CFG.setDrawMode, 0) : 0) === 1 &&
    ((e.engineValues.get(ENGINE_FIELD.msgField92340) ?? 0) & 2) === 0
  ) {
    e.gateWaitStart = 0;
    e.gateWaitMs = 0;
  }
  // ★引擎三条出口都清 `Engine[122497]`（raw 26083/26095/26099）⇒ 文本块结束后必须退出"注音/内嵌模式"。
  m.flags = 0;
};


/**
 * `0x88 message-mode`（sub_41FAB0 raw 28965-28977）：`1415 = 97050 = op1`；
 * 非 0 置 `122368 = 1`（跳读态），为 0 清 ADV。
 */
const op_message_mode: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const v = (plan.int(1) ?? 0);
  e.msgwin.skipMirror = v;
  e.msgwin.skipMode = v;
  if (v !== 0) e.msgwin.skipping = 1;
  else clearAdv(e);
};

/** `0x19C adv-enter`（sub_419120 raw 24546-24575）：按 `97050/122455/124331` 条件置/清 ADV。 */
const op_adv_enter: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const m = e.msgwin;
  m.advEnter = 1;
  m.cancelStage = 0;
  if (m.skipMode !== 0) {
    m.skipMirror = 1;
  } else if (m.showing === 0) {
    if (m.hold === 0) {
      m.skipMirror = 0;
      clearAdv(e);
    }
    return;
  }
  setAdv(e);
  m.skipping = 1;
};

/** `0x19B adv-exit`（sub_4190E0 raw 24532-24542）：清 ADV 并复位字段。 */
const op_adv_exit: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  clearAdv(e);
  e.msgwin.skipMirror = 0;
  e.msgwin.advEnter = 0;
  e.msgwin.cancelStage = 0;
};

/**
 * `0x1CA`（sub_420240 raw 29315-29325）：`SetConfig(Engine+174405, "message:ReadTextSkip", op1)`。
 *
 * ★这是 ADV 置位门控的**脚本侧开关**（`sub_411900` 收消息时会写回 0）。过去被当 no-op，
 * 于是脚本根本无法切换「逐字显示」。
 */
const op_set_read_text_skip: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.msgwin.readTextSkip = (plan.int(1) ?? 0);
};

/**
 * `0x1CB`（sub_42D3D0 raw 38082-38089）：**读 `message:ReadTextSkip` ⇒ 写回 op1**（`0x1CA` 的读取端）。
 *
 * ```
 * sub_42D3D0: v2 = GetConfig(_this+174405, "message:ReadTextSkip");
 *             return sub_42B4B0(_this, 1, v2);      // ★写操作数 1
 * ```
 * 引擎里 `GetConfig` 与 `0x1CA` 的 `SetConfig` 操作**同一个配置对象**，
 * 所以运行期写进去的值立刻能被读回来；emulator 用 `readTextSkipOf(e)` 表达同一件事
 * （运行期覆盖 `msgwin.readTextSkip` 优先，否则回落启动配置 `message:ReadTextSkip`）。
 *
 * ★**这是一条回写操作数的指令**：此前它在 `ENGINE_INTERNAL_OPS` 里当 no-op，
 * 于是脚本读到的是**上一条指令留在那个槽里的旧值**（静默逻辑错误）。
 * 语料证据：扩展包 1/2 的场景脚本（`$1$SC0330` / `$1$SG0821` / `$2$SG2331` …）等 30+ 个文件
 * 在固定位置都有 `i1cb (global-int 139d)`（把该开关读进全局 139d 再分支）。
 * 与 `0x1CA`（写）成对，`Engine` 帧循环 `sub_411900` 收消息时把它写回 0（emulator：`engine.ts` 同点）。
 */
const op_get_read_text_skip: OpHandler = (c) => {
  const plan = planFor(c);
  plan.setInt(1, readTextSkipOf(c.e));
};

// ---------------------------------------------------------------------------
// ADV / 消息状态**查询**指令族（sub_42D2xx / sub_42D3xx / sub_42D4xx 的 getter）
//
// ★这一族的共同点：handler 体极短，但**每一条都经 `sub_42B4B0(this, 1, v)` 回写 op1**。
// 因此它们**不是**可以忽略的"内部状态写入" —— 当 no-op 跳过时 op1 保留上一条指令的旧值，
// 而脚本紧接着就用 op1 做条件跳转（SN0000 的 ADV 主循环就是 `i1c7/i1cc` + `or` + `jcc`）。
// 2026 实测：启动 → Game Start → SN0000 首文案这条路径上，这一族占了未知指令的 4/25。
// ---------------------------------------------------------------------------

/**
 * `0x19A`（sub_42D290 raw 38031-38035）：`op1 = Engine[97050]`（**跳读/自动模式镜像**）。
 *
 * 引擎：`return sub_42B4B0(this, 1, this[97050]);`。
 * 写者：`0x88 message-mode`（`1415 = 97050 = op1`，emulator 见 `op_message_mode`）。
 * 读者（引擎内）：`sub_41EB20`/`sub_411BC0` 的「跳读中」分支；语料里脚本也直接读
 * （`src/DRAWCHARM.txt:1` 等）。
 */
const op_get_skip_mode: OpHandler = (c) => {
  const plan = planFor(c);
  plan.setInt(1, c.e.msgwin.skipMode);
};

/**
 * `0x1B6`（sub_42D2C0 raw 38038-38042）：`op1 = (Engine[97052] != 0)`。
 *
 * `Engine[97052]` 是**「共存消息」标记**（配置键串 = `"set:CoexistMesSkip"`；raw 4276 的
 * `aSetCoexistmess[19] = "set:CoexistMesSkip"` —— 符号名少两个字母，**串本身**才是键名，
 * `configRegistry.ts` 用的也是 `set:CoexistMesSkip`）：
 *  - 写入端 = `0x1B7`（sub_41FF20 raw 29181-29189）`97052 = (op1 != 0)`；
 *  - **读出端之一** = 本指令（`sub_42D2C0` 回写 `_this[97052] != 0`）；
 *  - **读出端之二** = `0x72 wait-for-input` 尾段（raw 28556 `v7 = (97052 == 0)` ⇒ 非 0 时给该窗起
 *    自动翻页节拍）—— emulator 见 `armCoexistAutoMessage`；
 *  - **清零点** = `sub_4090F0` 开头的"消费即清零"（raw 13699-13703）与 `sub_4764F0`（raw 90964）。
 *
 * ★**订正（审计 §4.1 P1 `op-4`/`op-5` + P3 `op-174`）**：旧注释把 `sub_4090F0` 说成
 * 「引擎帧循环每帧看到它就清 0」、且把键名写成 `set:CoexistMess` —— **两处都不对**：
 *  - 它的入口**不是帧循环**：`sub_4090F0` 是 `IAGEService` vtable 的 **+132** 槽
 *    （`.data:00526B78 = sub_4764E0`，`sub_4764E0` 的体只有一行 `sub_4090F0(Engine, a1)`），
 *    由 **AGERC.DLL 的系统命令** `case 40035`（vtable +136 = `sub_4764F0`）与 `case 40037`
 *    （vtable +132 = `sub_4764E0`）调用，两处后面都跟着装 `CALLBACK_SETTING.BIN`
 *    （`engine/AGERC.DLL_utf8.c:2426/2441`）⇒ 触发点是**进设置画面**，不是每帧；
 *  - 键名是 `"set:CoexistMesSkip"`（见上）。
 *  emulator 侧：`Engine[97052]` 存 `Engine.advFields`，**读**已由 `0x72` 接上（本次），
 *  **清零**仍无落点 —— 因为清零点在 AGERC 的系统命令层，emulator 没有那一层（登记为缺口）。
 *  另注意语料：置 1 的只有 `src/FELLOW.txt:1324 i1b7 1`（调试菜单），而 334 处
 *  `i1b6 <g> / sub <g> 1 <g> / i1b7 <g>` 是**脚本侧**的"读-减-写回"消费习语
 *  （值 1 ⇒ 减成 0 ⇒ 写回 0）⇒ "永久读回 1"只在脚本不跑那个习语时成立。
 */
const op_get_coexist_state: OpHandler = (c) => {
  const plan = planFor(c);
  plan.setInt(1, (c.e.advFields.get(97052) ?? 0) !== 0 ? 1 : 0);
};

/** `0x1B7`（sub_41FF20 raw 29181-29189）：`Engine[97052] = (op1 != 0)`（`0x1B6` 的写入端）。 */
const op_set_coexist_state: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.advFields.set(97052, (plan.int(1) ?? 0) !== 0 ? 1 : 0);
};

/**
 * `0x1C7`（sub_42D390 raw 38072-38079）：`op1 = (effect_flags & 0x8000000) != 0`
 * ＝ **「消息逐字显示中 / ADV 激活」查询**（与 `Engine.advActive` 同一位）。
 *
 * 语料：`src/SN0000.txt:1114` 起的主循环 `i1c7 f7ff5` / `i1cc f7ff6` → `or` → `jcc`，
 * 用来判断"这一页是否还在显示 / 是否需要等玩家"。跳过它会让 `f7ff5` 保留旧值，
 * 循环按错误的状态走（提前跳读或永不推进）。
 */
const op_get_adv_active: OpHandler = (c) => {
  const plan = planFor(c);
  plan.setInt(1, (c.e.effectFlags & ADV_ACTIVE) !== 0 ? 1 : 0);
};

/**
 * `0x1CC`（sub_42D410 raw 38092-38096）：`op1 = Engine[122455]` ＝ **「本页文本正在显示中」**。
 *
 * 与 `Engine.msgwin.showing` 同一字段（`0x88`/`0x19C`/`sub_411900` 都写它）。
 * 语料同 `0x1C7`（`i1cc f7ff6`，与 `i1c7` 的 `or` 一起作为"要不要接着等"的判据）。
 */
const op_get_msg_showing: OpHandler = (c) => {
  const plan = planFor(c);
  plan.setInt(1, c.e.msgwin.showing);
};

/**
 * `0x090`（sub_420640 raw 29477-29518）：**登记点击热点/路由项**。
 * `i090 <x> <y> <w> <h> <labelA> <labelB> <labelC>` →
 * `sub_403B30(Engine+0x55D8, x, y, x+w, y+h, labelA, labelB, labelC, frames[cur][95796])`。
 *
 * ★第 9 个实参是 **`frames[cur][95796]` = 当前帧的脚本身份 token**（raw 29504），
 * 引擎把它存成 `panelA[7461]`，供 `sub_4083B0` 的「不许跨脚本派发 label」守卫比对
 * （见 `Engine.guardScriptIdentity`）。这里传 `frame.scriptId` —— 早前传的是 `frameArg`（恒 0），
 * 那是语义错（`frameArg` 与 `[7461]` 无关）。
 *
 * 入队失败（表满 100）时引擎抛 `Command_ShowMessage`；emulator 照抛，绝不静默。
 * ★这是「等待输入」结束后脚本能继续的**唯一**机制（见 `src/vm/route.ts`）。
 */
const op_route_push: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const [x, y, w, h, labelA, labelB, labelC] = [1, 2, 3, 4, 5, 6, 7].map((n) => (plan.int(n) ?? 0));
  const ok = e.routes.push(x!, y!, w!, h!, labelA!, labelB!, labelC!, c.frame.scriptId);
  if (!ok) throw new Error('0x090: 点击热点表已满（引擎上限 100，引擎此处抛 ShowMessage）');
};

/** `0x212`（sub_423A30 raw 31742-31754）：消息窗对象 `+100 = op2`（op1 = 对象索引）。 */
const op_msgwin_obj_f100: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const idx = (plan.int(1) ?? 0);
  const o = e.msgwin.objectAt(idx); // raw 31751-31753：`if (v4) *(_DWORD *)(v4 + 100) = v2;`
  if (!o) return;
  o.f100 = (plan.int(2) ?? 0);
};

/** `0x213`（sub_423A80 raw 31758-31775）：消息窗对象 `+104 = op2`、`+108 = op3`。 */
const op_msgwin_obj_range: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const idx = (plan.int(1) ?? 0);
  const a = (plan.int(2) ?? 0);
  const o = e.msgwin.objectAt(idx); // raw 31769-31774：空表项 ⇒ 两个写都跳过
  if (!o) return;
  o.f104 = a;
  o.f108 = (plan.int(3) ?? 0);
};

/** `0x25D`（sub_425EF0 raw 33248-33265）：消息窗对象 `+276 = op2`、`+280 = op3`。 */
const op_msgwin_obj_range2: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const idx = (plan.int(1) ?? 0);
  const a = (plan.int(2) ?? 0);
  const o = e.msgwin.objectAt(idx); // raw 33259-33264：空表项 ⇒ 两个写都跳过
  if (!o) return;
  o.f276 = a;
  o.f280 = (plan.int(3) ?? 0);
};

// ---------------------------------------------------------------------------
// 消息窗对象：文本块原点 / 块参数 / 颜色（`Font[win+261]` = `Engine[21585+win]` 对象）
// 引擎里这几条与 `0x212`/`0x213`/`0x25D` 同族 —— 都写**窗对象**的固定偏移，只是偏移不同。
// ★语料用量（2026-09 实测 `grep -c '^i0xx ' src/*.txt`）：`i07a` = **520**（win 1 共 506、win 8 共 12，
//   用序章页每次 `i07a 8 8c 12c` 覆盖文字块原点）、`i303` = 252、`i073` = 27、`i079` = 10；
//   而 `i25c`/`i25e`/`i25f` = **0**（无调用，但写的是有读者的对象字段 ⇒ 仍按引擎语义建真实现，不做 no-op）。
//   历史错误：这里曾写"i7a/i25c/i25e/i25f 全 0"，据此外推成"0x7A 只是游标参数、与排版无关"，
//   直接导致序章文字块原点被忽略（文字跑到左上角）。**别再用"语料 0 处"当"语义不重要"的证据。**
// ---------------------------------------------------------------------------

/**
 * `0x7A`（`sub_41F4E0` raw 28710-28721）：`sub_45A910(Font, op1, op2, op3)`。
 *
 * 引擎：`win = op1 ?: Font[307]`、`obj = Font[win+261]`，
 * `*(obj[48] - 20) = op2`、`*(obj[48] - 16) = op3` —— 写**文本项缓冲头**的两个 dword。
 * 这两个 dword 就是**文本块原点**：`sub_45A940` 贴字格/贴行时用
 * `x = win+80 + buf[-20] + win+12`、`y = win+84 + buf[-16] + win+16`（raw 71352-71359），
 * 而排版例程在重排时把 `buf[-20]` 复位成 `obj[28]`（= `0x79` 的文字起点，raw 82684-82685）。
 * ⇒ 语义 = 「**覆盖该窗的文字块原点**」，0x79 是默认值、0x7A 是每页的覆盖值。
 * 语料：win 1 共 506 处（`i07a 1 <x> f`，y 与 0x79 一致）、win 8 共 12 处（序章每页一次）。
 */
const op_msgwin_obj_pre48: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const o = e.msgwin.object(win);
  o.pre48a = (plan.int(2) ?? 0);
  o.pre48b = (plan.int(3) ?? 0);
  o.pre48Set = true;
};

/**
 * `0x25C`（`sub_425E70` raw 33224-33245 → `sub_456510` raw 68347-68372）：
 * **消息窗「文本块」参数（13 dword）**。
 *
 * 引擎把 13 个 dword 整块 `qmemcpy` 到窗对象 `+224`：
 * `[0]=1, [1]=op4, [2]=op5, [3]=op6, [4]=op7+op5, [5]=op8+op6, [6]=op2, [7]=op3, [11]=-1, [12]=-1`
 * （`+8..+10` 清零）⇒ 即"文本框原点/宽高 + 两个终结哨兵"。emulator 存成数组（渲染层不消费）。
 */
const op_msgwin_obj_text_block: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const [, o2, o3, o4, o5, o6, o7, o8] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    (plan.int(n) ?? 0),
  );
  const o = e.msgwin.object(win);
  o.block224 = [1, o4!, o5!, o6!, o7! + o5!, o8! + o6!, o2!, o3!, 0, 0, 0, -1, -1];
};

/** `0x25E`（`sub_425F50` raw 33269-33288 → `sub_456590`）：窗对象 `+256=op2`、`+260=op3`、`+272=ARGB`。 */
const op_msgwin_obj_colors: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const o = e.msgwin.object(win);
  o.f256 = (plan.int(2) ?? 0);
  o.f260 = (plan.int(3) ?? 0);
  // 引擎：v2 = op4（>255 截断）当 alpha，op5 取 RGB ⇒ `(a<<24)|(b2<<16)|(b1<<8)|b0`
  o.f272 = packArgb((plan.int(4) ?? 0), (plan.int(5) ?? 0));
};

/** `0x25F`（`sub_425FF0` raw 33291-33308 → `sub_4565D0`）：窗对象 `+264=op2`、`+268=ARGB`。 */
const op_msgwin_obj_colors2: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const o = e.msgwin.object(win);
  o.f264 = (plan.int(2) ?? 0);
  o.f268 = packArgb((plan.int(3) ?? 0), (plan.int(4) ?? 0));
};

/**
 * 引擎 `sub_425F50`/`sub_425FF0` 的颜色组装：
 * ```c
 * if (a > 255) a = 255;
 * v = (u8)c | ((BYTE1(c) | (((a << 8) | BYTE2(c)) << 8)) << 8);
 * ```
 * ⇒ `(a<<24) | (c.b2<<16) | (c.b1<<8) | c.b0`（`c` 的低 3 字节当 RGB，`a` 当 alpha）。
 */
function packArgb(a: number, c: number): number {
  const alpha = a > 255 ? 255 : a & 0xff;
  return (((alpha << 24) | ((c >>> 16) & 0xff) << 16) | ((c >>> 8) & 0xff) << 8) | (c & 0xff);
}


// ---------------------------------------------------------------------------
// P0 参数面（描边 / 颜色 / 字号 / 几何 / 竖排）—— 直接决定阅读体验
// ---------------------------------------------------------------------------

/**
 * `0x70 <win> <w> <h> <x> <y>`（sub_41ED20 → sub_45D660 raw 73132-73193）：窗口几何
 * + **回看页 push / 组首标记 / 双游标复位**（末尾 raw 73181-73191，**不过门**）。
 *
 * 操作数语义（`a2..a6` = op1..op5）由语料量纲 + 槽位复用推得（`T-0095`，非逐字节反汇编）：
 * `op1 = 窗号`（0 ⇒ 默认窗）、`op2 = w`（也写 `win+36` 换行右界）、`op3 = h`（也写 `win+40`）、
 * `op4 = x`、`op5 = y`（`win+12/+16`）。量纲自洽解：`SYSTEM4.txt:23-30` 给出窗 1 = 880×148 @(190,557)、
 * 窗 2 = 430×40 @(120,508)、窗 8 = 1280×720 @(0,0)（1280×720 屏）。
 */
const op_window_geometry: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const w = (plan.int(2) ?? 0);
  const h = (plan.int(3) ?? 0);
  const x = (plan.int(4) ?? 0);
  const y = (plan.int(5) ?? 0);
  const g = e.msgwin.geom(win);
  g.w = w;
  g.h = h;
  g.x = x;
  g.y = y;
  // 引擎同函数把 w/h 也写进换行边界 win+36/+40（raw 73162-73163）；底色随表面重建设置
  g.wrapRight = w;
  g.wrapBottom = h;
  // ★**一共三对格**（工作清单 `0x70`/missing-operand-io 只点了两对，这里按体补第三对）：
  //   `+20/+24`（`v10[5]/v10[6]`，raw 73157-73158）、`+124/+128`（`v10[31]/v10[32]`，raw 73159-73160）、
  //   `+36/+40`（raw 73162-73163）。后两者在下游分叉：`+36/+40` 是**换行边界**（`0x1C1` 只改它，
  //   见 `op_window_wrap`），而 `+124/+128` 是**缩放后的表面尺寸** —— 只在 `set:DrawMode == 1` 时
  //   被 `sub_4A7170` 重建的 D3D 表面尺寸覆写（raw 73164-73171）、否则留在 `w/h`。
  //   emulator 没有"离屏表面"这一层 ⇒ `+124/+128` 无消费者（登记在下方缺口注释里，不假装有）。
  // ★同一落点函数 `sub_45D660` 的末尾还有**回看页 push**（raw 73181-73191），而且**不过门**：
  // `sub_41ED20` raw 28415 的末参 `a7` 恒传字面量 `0` ⇒ `if (a7 >= 0)`（raw 73181）恒真
  // （对照 `0x71` 的 `a3 = Engine[97055]` 那道门）。落点里 `a2 == 0` ⇒ 默认窗（raw 73147-73152）。
  // push 的形状与 `0x71` 完全相同：`{窗号, 该时刻记录条数}`（raw 73183-73186）+ 置该窗组首标记（raw 73187）。
  e.textItems.pushPage(win);
  e.textItems.markGroupStart(win); // raw 73187（`Font[849+win] = 1`）
  // ★只发布**本指令点名的窗**（`T-0100`）：落点 `sub_45D660`（raw 73133-73193）只写几何 + 回看页，
  //   **不重画任何窗的正文行**；修前这里调 `emitAllWins(e)` ⇒ 会把"文本记录还在、但屏上项已被
  //   `detach-texture` 删掉"的**别的**窗重新画出来（与 `0x74` 在 `:1339` 被去掉 `emitAllWins` 同因）。
  emitWin(e, win);
};

/**
 * `0x198 <win> <x> <y>`（sub_41FE10 → sub_456400 raw 68263-68279）：窗口屏幕位置。
 *
 * ★2026-09（`T-0151`）两处照体订正：
 *  1. `sub_456400` 的 `if (result)`（raw 68273）—— **窗对象不存在 ⇒ 一格都不写**。修前
 *     `MsgWindow.geom()` 是惰性建窗 ⇒ 凭空建一个窗几何再把 `+12/+16` 写进去（审计 `0x198`）。
 *     现在先过对象表门（表内 0..9 恒存在，只有表外下标会被挡下）。
 *  2. **引擎这里不重画、也不置任何脏位**（只写 `+12/+16`）—— 而 emulator 必须 `emitWin` 才能
 *     把新位置送到宿主（宿主只在收到 `msgWinSync` 时更新该窗的排版落点）。这是**有意的宿主
 *     接口差**（审计 `0x198`/host-invented 已点名），保留但在此写明：引擎的"位置生效"发生在
 *     下一次**绘制/贴出**（`sub_45A940` 现读 `win+12/+16`），emulator 的等价"下一次绘制"就是
 *     这一次发布 —— 不发布则位置永远不生效。登记在 `MSGWIN_HOST_INTERFACE_DEVIATIONS`。
 */
const op_window_pos: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  if (!e.msgwin.objectAt(win)) return; // raw 68273
  const g = e.msgwin.geom(win);
  g.x = (plan.int(2) ?? 0);
  g.y = (plan.int(3) ?? 0);
  emitWin(e, win);
};

/** `0x1C1 <win> <right> <bottom>`（sub_420070 → sub_4563D0 raw 68248-68261）：换行边界。 */
const op_window_wrap: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const g = e.msgwin.geom(win);
  g.wrapRight = (plan.int(2) ?? 0);
  g.wrapBottom = (plan.int(3) ?? 0);
  emitWin(e, win);
};

/** `0x79 <win> <x> <y>`（sub_41F490 → sub_4563A0 raw 68233-68246）：文字起点。 */
const op_text_origin: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const g = e.msgwin.geom(win);
  g.originX = (plan.int(2) ?? 0);
  g.originY = (plan.int(3) ?? 0);
  emitWin(e, win);
};

/**
 * `0x303 <win> <mode> <width>`（sub_426A90 → sub_456600 raw 68405-68418）：对齐模式 + 行宽。
 *
 * 引擎逐字：`v4 = a2 ? a2 : Font[307]`（**默认窗重定向**）→ `obj = Font[v4+261]`（不查空）→
 * `*(obj+288) = a3`（**原值**）、`*(obj+292) = a4`。
 * ★修前 emulator 把 `mode` 归一成 `1/2/0` 再存 ⇒ `op2` 取 1/2 之外的非 0 值时引擎留下原值、
 * emulator 存 0（审计 `0x303`/approximation）。现在照体存原值，语义解释留给排版层
 * （`layoutWindow` 只认 `align === 1` / `=== 2`，其它值等同于不指定 —— 与引擎消费者一致口径）。
 */
const op_align: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = e.msgwin.resolveWin((plan.int(1) ?? 0));
  const g = e.msgwin.geom(win);
  g.align = (plan.int(2) ?? 0); // raw 68415：原样
  g.alignWidth = (plan.int(3) ?? 0);
  emitWin(e, win);
};

/**
 * `0x80 <win>`（sub_41F690 raw 28786-28796）：设默认窗（`Font+1228` = `Font[307]`）。
 *
 * ★**只写一处**（`tickets/T-0101` 的 D5）：引擎那一格就是 `Font+1228`（初值 1，raw 78899），
 * emulator 对它的建模 = `MsgWindow.defaultWin`；此前这里还顺手写了 `engineValues[21631]`，
 * 而读侧（`handlers/text-items.ts` 的 `defaultWin`）读的是那一份 ⇒ **同一语义两处真源**、
 * 且在 `i080` 之前两侧初值不同（1 vs `?? 0`）。现读侧改读 `msgwin.defaultWin`，这行镜像写随之删掉。
 */
const op_set_default_window: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const win = (plan.int(1) ?? 0);
  e.msgwin.defaultWin = win;
};

/**
 * `0x2DE`（sub_430DF0 raw 40251-40261）：**字体名 → 可选字体表下标**（查不到 -1）写回 op1。
 *
 * 引擎：`sub_428990(textobj, 串)` 在 `Font+201664` 的 32B/条 向量里线性查名（**查前剥 `'@'`**，
 * raw 35149）。脚本只用它的**符号**：`$1$CHECKCONFIG.txt:6-11` 里 `i2de` 得到 `<0` 就把默认面名
 * 写回并保存。★原实现按助记符猜成 `stringResourceId` ⇒ 永远 -1 ⇒ 每次启动覆盖用户的字体选择。
 */
const op_font_name_to_index: OpHandler = (c) => {
  const plan = planFor(c);
  const name = (plan.str(2) ?? '');
  plan.setInt(1, fontListIndex(name));
};

/**
 * `0x2DC`（sub_430DB0 raw 40239-40249）：**可选字体数量** → op1。
 *
 * 引擎：`v = (Font[71741] - Font[71740]) >> 5`（`Font+201664` 那张 **32B/条** 的字体名向量长度，
 * 由 `EnumFontFamilies` 填充）；**空表返回 -1**（不是 0！`if (!v1) v1 = -1`）。
 * emulator 侧的表 = `ENGINE_FONT_LIST`（与 0x2DE/0x2DD 同一张表，三者必须一致）。
 *
 * ★为什么必须实现：`$1$SELFONT.txt:34` 用它做**分页与滚动条**（每页 9 项：`:43/:49` 的 `9`），
 * 而 `:35` 是 `eq count 0 ⇒ exit`。原实现走通用配置 getter ⇒ 恒 0 ⇒ 字体选择器**直接退出、
 * 中间不出现列表**；更糟的是 `:78` 会用 `count` 做**除数**（`div 413 = 41b / count`）⇒ 除零，
 * 于是滚动条几何被写成 Infinity/NaN 而**漂到左边**（用户实测）。
 */
const op_font_list_count: OpHandler = (c) => {
  const plan = planFor(c);
  const n = ENGINE_FONT_LIST.length;
  plan.setInt(1, n > 0 ? n : -1);
};

/**
 * `0x2DD <str-out> <idx>`（sub_434720 raw 42541-42575）：**字体表第 idx 项的名字** → op1（字符串）。
 *
 * 引擎：`v2 = read(2)`（下标）；越界（`<0` 或 `>= count`）⇒ 写**空串**（`byte_51EA3C`），
 * 否则把第 v2 条 32B `std::string` 拷进 op1。脚本用法（`$1$SELFONT.txt:567/:644`）：
 * `i2dd (local-string 0) (local-int 41b)` → `set-font (local-string 0)` → `draw-string …`（逐行画候选字体名），
 * 以及 `:567` 把选中项写进 `global-string d5d` 当当前值。
 */
const op_font_list_name: OpHandler = (c) => {
  const plan = planFor(c);
  const idx = (plan.int(2) ?? 0);
  const name = idx >= 0 && idx < ENGINE_FONT_LIST.length ? ENGINE_FONT_LIST[idx]! : '';
  plan.setStr(1, name);
};

/**
 * `0x1B5 <ms>`（sub_41FED0 raw 29165-29178）：**设消息速度** ——
 * `Font+1376`（= `Engine[21668]`）**且**写配置注册表 `message:MessageSpeed`。
 *
 * ★与 `0x74` 的区别：`0x74` 只写字段（脚本用它做"这一段立即显示"：`i074 0`）；
 * `0x1B5` 还会持久化到配置。**CONFIG1/CONFIG2 的速度滑条走的正是这条**
 * （`CONFIG1.txt:2286-2287`：`sub 7f2 = 100 - 滑条值` → `i1b5 7f2`，滑条范围 1..99）。
 *
 * ★`$1$INITREGMES.txt:6` 用 `i1b5 19`（= **25ms/字**）设消息注册表的默认值
 * —— 这才是引擎脚本自己认的默认速度（随包 INI 的 `MessageSpeed=5` 只写字段、不进注册表）。
 */
const op_set_message_speed: OpHandler = (c) => {
  const plan = planFor(c);
  const v = (plan.int(1) ?? 0);
  c.e.engineValues.set(ENGINE_FIELD.messageSpeed, v);
  setConfigValue(c.e, CFG.messageMessageSpeed, v);
};

/**
 * `0x74 <ms>`（sub_41F320 raw 28642-28651）：**设消息速度 —— 仅字段**。
 *
 * 引擎体只有两行：`_this[21668] = read(1)`（对比 `0x1B5` 还多一次 `SetConfig`）⇒ **不持久化**。
 * 脚本用这一对做「这段/这一帧立即出字」：`i07f f7ffc`（读现值存档）→ `i074 0`（0 = 立即显示）
 * → …绘制杂项消息… → `i074 f7ffc`（还原）。全库 206 处 `i074 0`，全部成对还原
 * （例：`$1$SC0330.txt:18674-18702`）。
 *
 * ★原实现把 `0x74` 当 no-op ⇒ 「立即显示」失效、逐字速度被这段文本拉长；同时 `i07f` 存下的
 * 值会被后续 `0x1B5` 改写而还原不回去。
 */
const op_set_message_speed_field: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.engineValues.set(ENGINE_FIELD.messageSpeed, (plan.int(1) ?? 0));
};

/**
 * 自动翻页的两个「**idx 二选一**」写入端（引擎体只在 0/1 时写配置，其它值走错误串分支且**不写任何键**）：
 *  - `0x1B9`（`sub_41FF60` raw 29191-29220）：`idx == 0 → message:AutoMessageTime0`、`== 1 → …Time1`，
 *    否则 `sprintf_s(aGetautomessp)` + `sub_4034D0`（打印错误串、不写配置）；
 *  - `0x2E7`（`sub_426540` raw 33534-…）：同形状，键为 `message:AutoMessagePitch0/1`（错误串 `aGetautomespi`，raw 33553）。
 *
 * ★修前 emulator 用 `idx === 1 ? 1 : 0` ⇒ `idx >= 2` 被**静默写成 0 号键**（审计 P2 `op-10-001`：凭空回退）。
 * 语料只有 0/1，但静默回退会让任何坏脚本静默改错设置。
 */
function setAutoMessageByIndex(c: StepCtx, p: PlannedOperands, kind: 'time' | 'pitch'): void {
  const idx = p.int(1) ?? 0;
  if (idx !== 0 && idx !== 1) {
    c.log(`自动翻页 idx=${idx} 非法 ⇒ 按引擎走错误串分支（不写任何配置键）`);
    return;
  }
  // ★键名走 `CFG.*` 常量（不要手打前缀拼接：`test/config-keys.test.ts` 静态扫全仓，前缀会被判成"幽灵键"）。
  const key =
    kind === 'time'
      ? idx === 0
        ? CFG.messageAutoMessageTime0
        : CFG.messageAutoMessageTime1
      : idx === 0
        ? CFG.messageAutoMessagePitch0
        : CFG.messageAutoMessagePitch1;
  setConfigValue(c.e, key, p.int(2) ?? 0);
}

/** `0x1B9 <idx> <ms>`（sub_41FF60 raw 29191-29220）：`message:AutoMessageTime{idx}`（自动翻页基础时长）。 */
const op_set_auto_message_time: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1b9：走操作数计划层，但没有声明计划');
  setAutoMessageByIndex(c, p, 'time');
};

/** `0x2E7 <idx> <ms>`（sub_426540 raw 33534-33562）：`message:AutoMessagePitch{idx}`（自动翻页每行附加时长）。 */
const op_set_auto_message_pitch: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x2e7：走操作数计划层，但没有声明计划');
  setAutoMessageByIndex(c, p, 'pitch');
};

/** `0x2E8 <v>`（sub_4265E0 raw 33565-33577）：`message:AutoMessageOption`。 */
const op_set_auto_message_option: OpHandler = (c) => {
  const plan = planFor(c);
  setConfigValue(c.e, CFG.messageAutoMessageOption, (plan.int(1) ?? 0));
};

/** `0x2CD <v>`（sub_426390 raw 33463-33475）：`message:AdvanceMesOnWheel`（滚轮是否推进消息）。 */
const op_set_advance_mes_on_wheel: OpHandler = (c) => {
  const plan = planFor(c);
  setConfigValue(c.e, CFG.messageAdvanceMesOnWheel, (plan.int(1) ?? 0));
};

/**
 * `0x75 <size>`（sub_41F350 → sub_4185F0 raw 24057-24082）：主字号（全局）。
 *
 * ★**只改"下一次排版用哪套样式"，不重绘任何已排版的窗**（引擎：`sub_4185F0` 写
 * `Font+201684/+1232/+101972` 再 `sub_459F40` **重建 GDI 字体对象/字宽**，已画进各窗离屏表面的字形
 * 一点都不动）。因此这里**不再** `emitAllWins` —— 那会把晚到的全局样式糊到先前排好的窗上
 * （用户实测：`CONFIG2` 逐行设的角色名颜色溢到设置界面下方的 ADV 样例窗）。
 * 脚本想换样式重画时会**重新入队**（`i071` + `show-text`，如 `CONFIG.txt:171-179`）。
 *
 * ★2026-09（`T-0151`）：**5 格一起写**（raw 24062-24070）—— 除字号本体（`Font+201684`）外还有
 * 两套 LOGFONTA 模板的 `lfHeight`（横排 `Font+1232`、竖排 `Font+101972` = `-字号`）与它们的
 * 半格派生态（`Font+1236`/`Font+101976` = `字号 / -2`，**C 整数除法向零截断**）。
 * 修前只写字号本体 ⇒ 模板格留在旧值（审计 `0x75`/approximation 点名的"三到五格"）。
 */
const op_set_main_size: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const size = (plan.int(1) ?? 0);
  e.engineValues.set(ENGINE_FIELD.fontSize, size); // Font+201684 / 4（raw 24063）
  e.engineValues.set(ENGINE_FIELD.logfontMain, -size); // Font+1232（raw 24064）
  e.engineValues.set(ENGINE_FIELD.mainLfHeightVertical, -size); // Font+101972（raw 24065）
  // `sub_4185F0` 的这两个格在 `Font+201680 == 0` 时无条件写（raw 24066-24070）；
  // 非 0 时改走 `sub_459A20`/`sub_459C50` 重算（= 建模板，emulator 无句柄层 ⇒ 登记为缺口）。
  e.engineValues.set(ENGINE_FIELD.mainGlyphHalf, Math.trunc(size / -2)); // raw 24068
  e.engineValues.set(ENGINE_FIELD.mainGlyphHalfVertical, Math.trunc(size / -2)); // raw 24069
  e.msgwin.font.mainSize = size;
};

/**
 * `0x197 <size>`（sub_41FDD0 → sub_418680 raw 24084-24154）：注音字号（全局）。同上，不重绘。
 *
 * ★**4 格派生态 + 10 个窗对象**（raw 24109-24152）：
 *  - `Font[54646]`（= `Font+218584`）字号本体；
 *  - `Font[324] = Font[25509] = 字号 / -2`（`Font+1296` / `Font+102036`，**整数向零截断**）；
 *  - `Font[323] = Font[25508] = -字号`（`Font+1292` / `Font+102032`）；
 *  - 逐个 `Font[261..270]`（**10 个窗对象**）：`*(obj+200) = 字号`、`*(obj+204) = Font[327]`
 *    （`Font+1308` = 注音 LOGFONTA 模板的 lfWeight）。
 */
const op_set_ruby_size: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const size = (plan.int(1) ?? 0);
  e.engineValues.set(ENGINE_FIELD.rubySize, size); // Font+218584 / 4 = 75970（raw 24108）
  e.engineValues.set(ENGINE_FIELD.rubyGlyphHalf, Math.trunc(size / -2)); // raw 24109（向零截断）
  e.engineValues.set(ENGINE_FIELD.rubyGlyphHalfVertical, Math.trunc(size / -2)); // raw 24110
  e.engineValues.set(ENGINE_FIELD.rubyLfHeight, -size); // raw 24111
  e.engineValues.set(ENGINE_FIELD.rubyLfHeightVertical, -size); // raw 24112
  applyWindowFontSize(e, size, e.engineValues.get(ENGINE_FIELD.logfontRubyWeight) ?? 0);
  e.msgwin.font.rubySize = size;
};

/**
 * `sub_418680` raw 24114-24152 的那 10 次写：`Font[261..270]` 的 `+200 = 字号`、`+204 = Font[327]`。
 *
 * 表大小 = 10（见 `WINDOW_OBJECT_SLOTS`）；这 10 格由构造建立 ⇒ 这里**不建新对象**。
 * `Font[327]` = `Font+1308` = `Engine[21651]`（`logfontRubyWeight`，由 `0x2BE` 写 700/0）。
 */
function applyWindowFontSize(e: Engine, size: number, aux: number): void {
  for (let i = 0; i < WINDOW_OBJECT_SLOTS; i++) {
    const o = e.msgwin.objectAt(i);
    if (!o) continue; // 构造后恒存在；防御表被清空的情况（不发明对象）
    o.f200 = size;
    o.f204 = aux;
  }
}

/** `0x1A5 <name>`（sub_433290 → sub_4328F0 raw 41344-41565）：主字体面名（全局）。同上，不重绘。 */
const op_set_main_face: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const face = (plan.str(1) ?? '');
  warnUnknownFace(c, '0x1A5', face); // raw 41385-41392
  e.msgwin.font.mainFace = face;
  // raw 41394-41399：`Font+1236/101976 = Font+201684 / -2`、`Font+1232/101972 = -Font+201684`
  // —— 面名 setter 会**按当前字号重算**这两对模板格（与 `0x75` 写的是同一批格）。
  const size = e.engineValues.get(ENGINE_FIELD.fontSize) ?? 0;
  e.engineValues.set(ENGINE_FIELD.logfontMain, -size);
  e.engineValues.set(ENGINE_FIELD.mainLfHeightVertical, -size);
  e.engineValues.set(ENGINE_FIELD.mainGlyphHalf, Math.trunc(size / -2));
  e.engineValues.set(ENGINE_FIELD.mainGlyphHalfVertical, Math.trunc(size / -2));
};

/** `0x2FE <name>`（sub_4332D0 → sub_432DD0 raw 41568-41798）：注音字体面名（全局）。同上，不重绘。 */
const op_set_ruby_face: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const face = (plan.str(1) ?? '');
  warnUnknownFace(c, '0x2FE', face); // raw 41613-41620
  e.msgwin.font.rubyFace = face;
  // raw 41622-41627：与 `0x197` 同一批 4 格（用**当前**注音字号重算）
  const size = e.engineValues.get(ENGINE_FIELD.rubySize) ?? 0;
  e.engineValues.set(ENGINE_FIELD.rubyGlyphHalf, Math.trunc(size / -2)); // Font+1296（raw 41623）
  e.engineValues.set(ENGINE_FIELD.rubyGlyphHalfVertical, Math.trunc(size / -2)); // Font+102036（41624）
  e.engineValues.set(ENGINE_FIELD.rubyLfHeight, -size); // Font+1292（raw 41626）
  e.engineValues.set(ENGINE_FIELD.rubyLfHeightVertical, -size); // Font+102032（raw 41627）
};

/**
 * **可选字体表白名单警告**（`0x1A5` raw 41385-41392 与 `0x2FE` raw 41613-41620 **逐字相同**）。
 *
 * ```c
 * if ( sub_428990(Font, Source) < 0 && strcmp(Source, "AGE Extend") )
 *   sprintf_s(Font + 8, 0x400, "警告：[%s]は選択可能フォントの一覧に含まれていません。\r\n", Source);
 *   sub_4034D0(Font, Font + 8);        // → 日志/消息汇（sub_4976A0 → … → WriteFile）
 * ```
 * `sub_428990`（raw 35125-35168）= 在**可选字体一览** `Font+201664`（32 B/条，`EnumFontFamiliesExA`
 * 填充）里按名线性查（**查前剥 `'@'`**，raw 35149），查不到返回 **-1**。
 *
 * ★审计 `0x1A5`/`0x2FE` 的 `missing-branch`：修前 emulator **无条件接受任何面名**（既不警告也不
 * 回退）⇒「装不到的字体名」与「装得到的」表现完全相同。现在接上警告面（面名照旧写进去 ——
 * 引擎在警告之后**没有 return**，raw 41394 起照样建面）。
 * `"AGE Extend"`（`aAgeExtend` raw 4455）是**豁免项**（引擎内部派生面，见 `AGE_EXTEND_FACES`）。
 */
function warnUnknownFace(c: StepCtx, op: string, face: string): void {
  if (face === '') return; // `sub_428990` 对空串也返回 -1，但空面名不是"装不到"（`0x1A5` 从不传空）
  if (fontListIndex(face) >= 0) return; // raw 41385 前半：表内 ⇒ 不警告
  if (AGE_EXTEND_FACES.some((f) => f === face)) return; // raw 41385 后半的 `strcmp(Source, aAgeExtend)`
  c.log(`警告：[${face}]は選択可能フォントの一覧に含まれていません。（${op}；raw 41390/41618）`);
}

/** `0x2BD <flag>`（sub_426200 raw 33384-33402）：主字体加粗（`lfWeight` 700/0，全局）。同上，不重绘。 */
const op_set_main_bold: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const on = (plan.int(1) ?? 0) !== 0;
  e.engineValues.set(ENGINE_FIELD.fontWeight, on ? 700 : 0); // Font+218516 / 4（raw 33393/33398）
  // ★第二个格：`Font+1248` = 主 LOGFONTA 模板的 `lfWeight`（raw 33394/33399，与上一个同写）
  e.engineValues.set(ENGINE_FIELD.logfontMainWeight, on ? 700 : 0);
  e.msgwin.font.mainBold = on;
};

/** `0x2BE <flag>`（sub_426260 raw 33404-33422）：注音字体加粗（全局）。同上，不重绘。 */
const op_set_ruby_bold: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const on = (plan.int(1) ?? 0) !== 0;
  e.engineValues.set(ENGINE_FIELD.rubyWeight, on ? 700 : 0); // Font+218588 / 4（raw 33413/33418）
  // ★第二个格：`Font+1308` = 注音 LOGFONTA 模板的 `lfWeight`（raw 33414/33419）
  e.engineValues.set(ENGINE_FIELD.logfontRubyWeight, on ? 700 : 0);
  e.msgwin.font.rubyBold = on;
};

/**
 * `0x260 <x> <dw> <y> <dh>`（sub_426080 raw 33310-33328）：竖排 blit 内边距
 * `Font+235112/235116/235120/235124 = op1/op2/op3/op4`（`_this[80102..80105]`，`_this` = **Font**）。
 *
 * ★**订正（审计 §4.1 P3 `0x260`，写入归属错）**：这四个是 **Font 级全局字段**，不是逐窗字段。
 * 旧实现写 `geom(defaultWin).vPad` ⇒ `i080 N`（`0x80` 换默认窗）之后这四个值就"归"到旧窗名下、
 * 新默认窗读到 0；现在落 `msgwin.font.vPad`（与 `vertical` 同层，按入队时刻进 `FontStyleSnapshot`）。
 *
 * ★**P1「无消费者」的核验结论 = 重写侧没有可消费的等价物**（不是"忘了接"）：
 * 引擎的读点全在 `sub_45A940` 一族的**绘制**路径（raw 71663-71674、71844-71853、72302-72311 …），
 * 逐字是「`if (Font+235108 & 1) { 目标左边 -= x; 目标上边 -= y; 目标右边 += dw; 目标下边 += dh;
 * 源点x -= x/218592; 源点y -= y/218596; }`」—— **目标位移与源位移严格同步**：
 * 目标像素 `p` 采样的表面坐标 = `(S − x/s) + (p − (L − x))/s = S + (p − L)/s`，与 x 无关
 * （`s` = `Font+218592/218596`，raw 78765/78767 初始化为 **1.0**）。
 * ⇒ 这四个值**只改变"从离屏表面复制哪一块"**（把旋转字形的边缘也包进来），
 * 字形内容的屏幕落点一个像素都不变。重写侧直接光栅化字形（`renderer/text/raster.ts`）、
 * 既没有"源矩形复制"这一步，也没有逐字裁切 ⇒ 复制范围放大**没有可观察结果**。
 * 因此这里**不再假装有消费者**：值按 Font 级发布给宿主（`MsgWinStyle.vPad`，供诊断/快照），
 * 渲染侧有意忽略它。对照：`0x261`（`vertical`）同理只记录 —— 引擎的排版例程不读它。
 */
const op_vertical_rect_pad: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  e.msgwin.font.vPad = {
    x: (plan.int(1) ?? 0),
    dw: (plan.int(2) ?? 0),
    y: (plan.int(3) ?? 0),
    dh: (plan.int(4) ?? 0),
  };
};

// ---- 以下为既有实现（引擎里是"读操作数 → 写 `_this[字段]`"，保持不变）----

/**
 * `0x7F`（sub_42D1F0 raw 38010-38016）：`op1 = _this[21668]` = **`message:MessageSpeed`**
 * （= `Font+1376` = `Engine+86672`）。`i07f` 全工程 210 处。
 *
 * ★历史错误：旧注释写成"消息窗 α"。`message:MesWinAlpha` 是**另一个键**，只被 `0x131`/`0x141`
 * 按名直读直写、**不落任何字段**（见 `engineConfig.ts` 的说明）。这里读字段是对的，不要改成读配置表。
 */
const op_get_message_speed: OpHandler = (c) => {
  const plan = planFor(c);
  plan.setInt(1, c.e.engineValues.get(ENGINE_FIELD.messageSpeed) ?? 0);
};

/** `0x300`（sub_426990）：对象旗标 `_this[122466+v] |= op2`（保留 bit16）、`_this[122476+v] = op3`。 */
const op_msgwin_slot_flags: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const v = (plan.int(1) ?? 0);
  const flags = (plan.int(2) ?? 0);
  const value = (plan.int(3) ?? 0);
  const slot = v + 122466;
  const merged = (flags | ((e.engineValues.get(slot) ?? 0) & 0x10000)) | 0;
  e.engineValues.set(slot, merged);
  e.engineValues.set(v + 122476, value);
  // ★闸门状态（`sub_409400` 第一循环的消费端）：bit0 = 逐行贴出、bit16 = 已被泵接管、
  //   op3 = 贴完后的延时清场 ms（`Engine[122476+win]`）。CONFIG 的消息预览靠它做**循环演示**。
  const g = e.msgwin.gateOf(v);
  g.enabled = (merged & 1) !== 0;
  g.pumping = (merged & 0x10000) !== 0;
  g.autoHideMs = value;
};

/**
 * `0x301`（sub_4269F0 raw 33757-33765 → `sub_404F80` raw 10741-10763）：清 `win+132`（显现游标）+ 删两段绘制项。
 *
 * ★`sub_404F80` **不清文本记录**，只把游标归零 ⇒ 闸门（`0x300`）开着时，下一次泵调用会
 * 从第一行重新贴出（这正是 CONFIG 预览"消失后重来"的那一步）。故这里在清视图的同时把
 * 显现状态重新武装到 0。
 *
 * ★2026-09（`T-0151`）两处照体订正：
 *  1. **默认窗重定向**（raw 10748-10749）：`if (!a2) v2 = *(Font+1228)` ⇒ `op1 == 0` 指的是
 *     **默认窗**（修前 emulator 把 0 当窗号 0，于是清了窗 0、默认窗的游标一个都没动）；
 *  2. **对象表存在性门**（raw 10750）：`if (*(Font + 4*v2 + 1044))` —— 表项为空 ⇒ 连 `+132`
 *     都不清、也不删绘制项。修前走 `object(v)` 会**凭空建对象**（审计 `0x301`/missing-branch）。
 *  注意 `sub_4269F0` raw 33763 写的是 `_this[v2 + 122486] = 0`（用**未重定向**的原始 op1 ⇒
 *  引擎这格表在 `op1 = 0` 时写的是下标 122486 那一格而不是默认窗那一格）—— 这一处照 raw 保留。
 */
const op_msgwin_slot_clear: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const v = (plan.int(1) ?? 0);
  e.engineValues.set(ENGINE_FIELD.winRevealDoneBase + v, 0); // raw 33763（未重定向）
  const w = e.msgwin.resolveWin(v); // raw 10748-10749
  const o = e.msgwin.objectAt(w); // raw 10750
  if (!o) return;
  o.f132 = 0; // sub_404F80 的清 `+132` 那一步（raw 10752）
  // 引擎 sub_404F80 同时 sub_4ABB60 删该窗两段绘制项（raw 10753-10760）⇒ 重写侧清掉该窗文本
  e.native.msgWinClear?.(w);
  const g = e.msgwin.gateOf(w);
  g.doneAt = null;
  if (g.enabled) {
    const laid = layoutWindow(w, { style: styleOfWin(e, w), segments: e.msgwin.slot(w).segments });
    if (laid.glyphCount > 0) {
      e.msgwin.beginReveal(w, laid.glyphCount, e.nowMs, messageSpeedOf(e));
      emitWin(e, w);
    }
  }
};

/**
 * **`0x204` draw-string（sub_423390, raw 31454）：把一整串文本"直绘"进某个纹理槽。**
 *
 * 引擎：`op1`=纹理槽、`op2`=x、`op3`=y、`op4`=字符串 →
 * `sub_456710(Font, 槽, 串, x, y)`（raw 68470）：**槽的 CTexture 必须已存在且可锁定、串非空**，
 * 否则整条什么都不做（raw 68478-68480 的三个 && 门）；然后按当前字体（`Font+1084`）与
 * `GetTextMetricsA` 的高度把串画到**该槽的表面**上（带描边时走 `sub_471180`，否则 `sub_46F2D0`）。
 *
 * ★与消息窗文本的关系：**两条独立路径**。消息窗是"排版 + 逐行贴出"，本指令是"GDI 一次性整串直绘"，
 *   用的是同一套全局字体/颜色/描边字段（`Font+1360/+1364/+1372`）。
 * ★为什么必须实现：`CONFIG1`（设置界面）把每行的**项目名 + 数值**先 `draw-string` 写进
 *   一张 `create-texture` 出来的 628×360 离屏槽（槽 196），再按行把它裁成 628×30 贴到行上
 *   （`CONFIG1.txt:2760/2773` + `:3019-3022`）。漏了本条 ⇒ 那张离屏槽**永远是空的**
 *   （宿主只能把它当"程序化纹理"画成白块）⇒ 设置界面中间一片纯白（用户实测）。
 *
 * emulator 侧：handler 只把「位置 + 文本 + 全局样式快照」交给宿主（排版/光栅化是宿主的事，
 * 与 `msgWinSync` 同一分工）；宿主把字画进该槽的 canvas 纹理（见 `textureCache.drawString`）。
 */
const op_draw_string: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  const x = (plan.int(2) ?? 0);
  const y = (plan.int(3) ?? 0);
  const text = (plan.str(4) ?? '');
  if (text.length === 0) return; // 引擎：`*a3` 为 0 直接返回
  const st = globalTextStyle(e);
  c.native.drawString?.(slot, x, y, text, {
    family: st.main.family,
    size: st.main.size,
    weight: st.main.weight,
    fill: st.main.fill,
    outline: st.main.outline,
    outlineMode: st.outlineMode,
    outlineDx: st.outlineDx,
    outlineDy: st.outlineDy,
    antiAlias: st.main.antiAlias,
  });
};

/**
 * **`0x205`（`sub_4233E0` raw 31470-31491）：把**数值**按格式画进纹理槽（GDI 数字文本）。**
 *
 * 引擎体全文（**`op2` 只读**；x 前进量落在**栈局部** `v8` 上，脚本看不见）：
 * ```c
 * v8 = sub_41BF50(_this, 2);                          // x（读进局部）
 * v6 = sub_41BF50(_this, 6);  v4 = sub_41BF50(_this, 5);  v2 = sub_41BF50(_this, 4);
 * sub_4072F0(_this, v9, &v8, v2, v4, v6);             // ★&v8 = **栈地址**（`int v8; // BYREF`）
 * v5 = v8;  v3 = sub_41BF50(_this, 1);
 * sub_456710(_this + 21324, v3, v9, v5, v7);          // 用新 x 把串直绘进槽 op1（与 0x204 同一个 GDI 缝）
 * ```
 * ★**订正（`tickets/T-0147`，审计 P1）**：此前 handler 注释、`operandPlan.ts` 的 io 与
 * `analysis/opcodes.json` 的语义**三处一致地**写成"`op2` 是 in/out、会把 x 前进量回写脚本"——
 * 那是错的：`&v8` 是 `[ebp-28h]` 的栈局部，**引擎从不回写操作数**。错实现的后果有两面：
 * ① `op2` 是立即数时 `writeIntOperand` 直接抛（真实语料 `i205 … 50 …` 就是立即数 ⇒ 硬停）；
 * ② `op2` 是可写槽时**静默污染**脚本状态（脚本下一次读该槽会拿到"数字排完后"的 x）。
 * ⇒ 现在只把 §"格式语义"里的 `x` 前进量当**内部量**交给 `drawString`。
 *
 * 语料：`i205` **313 处 / 35 个脚本**（`INFOSK` / `DRAWLINKTIP` / `INFOIT` / `ALCHEMY` / `INFOEN` …），
 * 典型写法 `i205 c5 166 50 (local-int 2776) 1 10000`。
 *
 * ## 格式语义（`sub_4072F0` raw 12198-12334，逐条照抄）
 * - `op5` = 字段宽（字符格），下面 `v11 = 宽-1`；需要符号位时 `v11 = 宽-2`（少一格）。
 * - `op6` 位：`bit0` = 补前导零；`bit1` = 居中；`bit2` = 左对齐（否则右对齐）；`bit3` = 正数带 `+`；
 *   `bit4` = 值为 0 时带 `+`；`bit5` = 值为 0 时带 `-`；**`bit16` = 半角**（不设时按全角输出）。
 *   ★订正：`opcode-table.md` 早前把 `bit16` 记成"全角"，读 `sub_4072F0` 的调用点可确证**相反** ——
 *   `if ((flags & 0x10000) == 0) sub_41A6C0(buf)`，而 `sub_41A6C0`（raw 25539-25593）是把 ASCII
 *   逐字改成 **SJIS 全角**（`'0'→0x82B0`、`'-'→0xA3AD`、`'+'→0xA3AB`、`'#'→0xA3A3`）。
 * - 数字从右往左填（`i = v11 … 0`，写 `buf[i + 符号位]`），`i == v11 || 剩余值 || bit0` 才写 ⇒ 前导零/空格。
 * - 符号写在 `buf[v19]`（`v19` = 最后写入的格）；`v11 < 0`（字段太窄）时写 `#`。
 * - **x 前进量**（`v13 = v19` = 首个字符所在格）：居中 = `v13*cy/4`（全角）/`v13*cy/2`（半角）；
 *   左对齐 = `0`；右对齐 = `v13*cy`（全角）/`v13*cy/2`（半角）。`cy` = 一个全角格宽：
 *   默认取 `Engine[71744] ? Engine[71745] : -Engine[21632]`（字体度量模式 → 字号 / lfHeight，raw 12221-12225）；
 *   **`set:BlankExtentMode == 1` 时整个 `cy` 被逐字量宽覆盖**（raw 12232-12235）：
 *   半角 `cy = 2 × 量宽(0x20)`、全角 `cy = 量宽(0x8140)`（`sub_404EE0` raw 10716-10739）——
 *   见 `text/layout.ts` 的 `numberCellExtent`。
 *
 * ## 缺口（明确记录，`tickets/T-0085`）
 * 门的**读取与公式**已接（`numberCellExtent`），但 `set:BlankExtentMode == 1` 需要的**字体度量来源**
 * 在 emulator 里不存在（没有 GDI `GetTextExtentPoint32A` 的等价物）⇒ 该分支按 `measured: false`
 * **显式回退**成默认的 `cy`（= 现状，`op2` 写回的值也因此不变），不编数。
 * 要拿到什么、从哪来（宿主 `measureText` / 自建 TTF `hmtx` 表）写在 `src/text/layout.ts` 文件尾「缺口」。
 * 对"把数字排进离屏槽"的用量（INFO/ALCHEMY 等）只影响像素级位置，不影响脚本状态。
 */
const op_draw_number_string: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  const x = (plan.int(2) ?? 0);
  const y = (plan.int(3) ?? 0);
  const value = (plan.int(4) ?? 0);
  const width = (plan.int(5) ?? 0);
  const flags = (plan.int(6) ?? 0);
  const halfWidth = (flags & 0x10000) !== 0;
  // 引擎：cy = Engine[71744] ? Engine[71745] : -Engine[21632]（= 一个全角格宽）
  const gridCy = (e.engineValues.get(ENGINE_FIELD.fontMetricsMode) ?? 0) !== 0 ? e.engineValues.get(ENGINE_FIELD.fontSize) ?? 0 : -(e.engineValues.get(ENGINE_FIELD.logfontMain) ?? 0);
  // ★`set:BlankExtentMode == 1` ⇒ cy 改由逐字量宽决定（raw 12232-12235）。没有度量来源时
  //   `numberCellExtent` 返回原 `gridCy`（`measured: false`）⇒ 默认与改动前逐字相等。
  const cy = numberCellExtent(halfWidth, gridCy, blankExtentOf(e)).cy;
  const cell = formatNumberCell(value, width, flags);
  // 引擎的 x 前进量（全角/半角与对齐方式三档）
  const advance =
    (flags & 2) !== 0
      ? Math.trunc((cell.start * cy) / (halfWidth ? 2 : 4))
      : (flags & 4) !== 0
        ? 0
        : halfWidth
          ? Math.trunc((cell.start * cy) / 2)
          : cell.start * cy;
  const nx = x + advance; // ★引擎的 x 前进量只在**栈局部** `v8` 上（raw 31482/31486/31488）⇒ 不回写 op2
  if (cell.ascii.length === 0) return;
  const st = globalTextStyle(e);
  c.native.drawString?.(slot, nx, y, halfWidth ? cell.ascii : toFullWidth(cell.ascii), {
    family: st.main.family,
    size: st.main.size,
    weight: st.main.weight,
    fill: st.main.fill,
    outline: st.main.outline,
    outlineMode: st.outlineMode,
    outlineDx: st.outlineDx,
    outlineDy: st.outlineDy,
    antiAlias: st.main.antiAlias,
  });
};

/**
 * `sub_4072F0` 的**纯函数**部分：把数值按 (字段宽, 格式位) 排成 ASCII 数字串。
 *
 * 返回 `ascii`（首位是符号位时的符号 + 数字）与 `start`（= 引擎的 `v13`，首个字符所在的格号；
 * 调用方用它算 x 前进量）。字段太窄时引擎写 `#`（溢出标记），这里照做。
 */
export function formatNumberCell(value: number, width: number, flags: number): { ascii: string; start: number } {
  const cells = new Array<string>(Math.max(8, width + 2)).fill('');
  let v11 = width - 1;
  let v9 = value;
  let showSign = false;
  let plus = false;
  if (value >= 0) {
    if (value > 0 && (flags & 8) !== 0) {
      plus = true;
      showSign = true;
    } else if (value === 0 && (flags & 0x10) !== 0) {
      plus = true;
      showSign = true;
    } else if (value === 0 && (flags & 0x20) !== 0) {
      plus = false;
      showSign = true;
    }
    if (showSign) v11 = width - 2;
  } else {
    v11 = width - 2;
    v9 = -value;
    showSign = true;
  }
  const signOffset = showSign ? 1 : 0;
  let v19 = 0;
  for (let i = v11; i >= 0; i--) {
    if (i === v11 || v9 !== 0 || (flags & 1) !== 0) {
      cells[i + signOffset] = String(((v9 % 10) + 10) % 10);
      v19 = i;
    }
    v9 = Math.trunc(v9 / 10);
  }
  if (showSign) cells[v19] = v11 >= 0 ? (plus ? '+' : '-') : '#';
  const ascii = cells.slice(v19).join('');
  return { ascii, start: v19 };
}

/** `sub_41A6C0`（raw 25539-25593）：ASCII 数字 → 全角（`'0'`→`'０'`、`'-'`→`'－'`、`'+'`→`'＋'`、`'#'`→`'＃'`）。
 *
 * ★**实现已去重**（`tickets/T-0175` ⑫）：本条原本在这里有一份逐字节相同的本地副本，现改为从
 * `../operand.js` 引入唯一那一份（`toFullWidthAscii`，原名 `toFullWidthNumber`）。两份实现一旦漂移，
 * 症状是"同一个字符在 `0x205` 的逐字直绘与 `0x192` 的取串下宽度不同"——极难察觉，故合并。
 * 本地别名保留 `toFullWidth` 以免动调用点。 */
import { toFullWidthAscii as toFullWidth } from '../operand.js';

/**
 * **本族已知未实现的 opcode**（有据登记；工作清单 `msgwin-text-object`/missing-behavior 点名的
 * `0x7D`）。
 *
 * ★为什么要有这张表：`0x7D`（十六进制串入队，`sub_41F580` raw 28736-28765）与 `0x6E`
 * （`sub_41EB20` raw 28307-28386）**逐句同形** —— 同样的 `argc 2`（op1 = 窗、op2 = 串）、
 * 同样的 MessageSpeed/ADV 二分（`!Engine[21668] || (effect_flags & 0x8000000)` ⇒ `sub_46CBF0`
 * 同步排空；否则 `sub_46BE30` + `0x20000000` + `sub_453A60(Engine+430572, MessageSpeed)`）；
 * **唯一差别**是读串用 `sub_41A780(_this, 2)`（十六进制/转义形态）而不是 `sub_41B640`。
 * 此前它既不在派发表、也不在"仍未建模"清单里 ⇒ 命中即抛 `NotImplementedOp` 而无人知道
 * （语料 `src/*.txt` 941 个脚本里 `^\s*i07d\b` 命中 **0** 处 ⇒ 这一支在本树下不可达）。
 *
 * 处置 = **登记 + 保持硬报错**（不猜实现）：只要语料出现 `i07d`，或 E4 真机抓到"十六进制串
 * 文本"没有入队，就按 `sub_41F580` 落地（届时把它加进 `MSGWIN_OPS` 并从本表移除）。
 */
export const MSGWIN_TEXT_GAPS: readonly {
  opcode: number;
  mnemonic: string;
  handler: string;
  /** raw 行区间（台账口径 `^\d+(-\d+)?$`）。 */
  raw: string;
  what: string;
}[] = [
  {
    opcode: 0x7d,
    mnemonic: 'i07d',
    handler: 'sub_41F580',
    raw: '28736-28765',
    what: '十六进制串入队：与 0x6E 同形（argc 2；op1 = 窗、op2 = 串，读串用 sub_41A780 而非 sub_41B640），未注册 ⇒ 命中即 NotImplementedOp。语料 0 处。',
  },
];

/**
 * **宿主接口差**（引擎不重画、而重写侧必须发布才能让变化生效的那几处）—— 「有意为之」的登记。
 *
 * 这一张表**不是缺口清单**（缺口见 `MSGWIN_TEXT_GAPS` / `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`），
 * 而是给下一轮审计的护栏：这几处的 `emitWin` 是**有意的**，不要按"引擎没重画"去删它。
 */
export const MSGWIN_HOST_INTERFACE_DEVIATIONS: readonly { op: string; raw: string; what: string }[] = [
  {
    op: '0x198',
    raw: '68263-68279',
    what: '`sub_456400` 只写 `win+12/+16`（不置脏位、不重画）；emulator 必须 `emitWin` 才能把新位置送到宿主 —— 引擎的"位置生效"在下一次绘制（`sub_45A940` 现读 `win+12/+16`），重写侧的等价物就是这一次发布。删掉它 ⇒ 窗口位置永远不生效。',
  },
  {
    op: '0x204/0x205',
    raw: '31454/31470',
    what: '直绘进纹理槽：引擎直接写槽表面，重写侧经 `native.drawString` 交给宿主光栅化（同一分工，见 `op_draw_string` 的说明）。',
  },
];

/** 消息窗 / ADV 指令族（全部为 `OPS`＝真实现）。 */
export const MSGWIN_OPS: OpTable = [
  // ---- 文本内容与推进 ----
  [0x6e, op_show_text], // show-text：追加文本 + 分段节流
  [0x6f, op_end_text_line], // end-text-line
  [0x204, op_draw_string], // draw-string：把一整串文本直绘进某个纹理槽（不走消息窗）
  [0x205, op_draw_number_string], // ★数字直绘进纹理槽（★op2 **只读**：x 前进量是引擎体内的栈局部，`tickets/T-0147`），313 处
  [0x071, op_message_show], // message-show（修正：不再无条件置 ADV）
  [0x072, op_wait_for_input], // wait-for-input：结束一页并挂起（bit31 等待门）
  [0x0fa, op_poll_msg_advance], // poll-msg-advance（★过去未注册 ⇒ 命中即硬报错）
  [0x196, op_display_furigana], // display-furigana：记录注音
  // ---- 状态位 ----
  [0x088, op_message_mode],
  [0x19c, op_adv_enter],
  [0x19b, op_adv_exit],
  [0x1ca, op_set_read_text_skip], // SetConfig message:ReadTextSkip
  [0x1cb, op_get_read_text_skip], // ★GetConfig message:ReadTextSkip → 写回 op1（0x1CA 的读取端）
  // ---- ADV 状态**查询**（getter，回写 op1；见上方「查询指令族」说明）----
  [0x19a, op_get_skip_mode], // op1 = Engine[97050]（跳读/自动模式镜像）
  [0x1b6, op_get_coexist_state], // op1 = (Engine[97052] != 0)（共存消息状态）
  [0x1b7, op_set_coexist_state], // Engine[97052] = (op1 != 0)（0x1B6 的写入端）
  [0x1c7, op_get_adv_active], // op1 = (effect_flags & 0x8000000) != 0（ADV 激活）
  [0x1cc, op_get_msg_showing], // op1 = Engine[122455]（本页文本显示中）
  // ---- 字格逐字显现（序章 SN0000 / NOVEL / SYSTEM4）----
  [0x73, op_set_char_grid], // ★字格 + 逐字节拍（0x73 op10 → sub_453AD0；win+88 总门）
  [0x1ce, op_char_reveal_switch], // 逐字开关（v≠0 置 bit30+游标归零；v=0 收尾）
  [0x20a, op_window_relayout], // ★按当前状态重排并重画该窗（过去未注册 ⇒ 命中即硬报错）
  [0x82, op_gdi_repaint_window], // ★带色重画某窗的文本记录（GDI 文本族；T-0104，过去是 STUB）
  [0x1d1, op_recall_page_repaint], // ★回看页重绘（`0x82` 的孪生兄弟；语料唯一调用点 src/HISTORY.txt:1314；T-0170）
  [0x304, op_text_block_begin], // ★文本块开始（Engine[122497]=1 + 保存行游标）
  [0x305, op_text_block_end], // ★文本块结束（取回游标 + 把余下的行一次性贴出）
  // ---- 点击热点 / 路由表（决定「等待输入」如何结束）----
  [0x090, op_route_push],
  // ---- P0 参数面：几何 / 字号 / 颜色 / 描边 / 竖排 ----
  [0x70, op_window_geometry], // 窗几何 w/h/x/y + 换行边界初值
  [0x074, op_set_message_speed_field], // ★设消息速度（仅字段；`i074 0` = 立即显示，用后还原）
  [0x075, op_set_main_size], // 主字号（全局）
  [0x197, op_set_ruby_size], // 注音字号（全局）
  [0x198, op_window_pos], // 窗屏幕位置
  [0x1a5, op_set_main_face], // 主字体面名（全局）
  [0x1b5, op_set_message_speed], // ★设消息速度（字段 + 注册表；CONFIG 速度滑条走这条）
  [0x1b9, op_set_auto_message_time], // message:AutoMessageTime{idx}
  [0x2cd, op_set_advance_mes_on_wheel], // message:AdvanceMesOnWheel
  [0x2e7, op_set_auto_message_pitch], // message:AutoMessagePitch{idx}
  [0x2e8, op_set_auto_message_option], // message:AutoMessageOption
  [0x1c1, op_window_wrap], // 换行边界
  [0x260, op_vertical_rect_pad], // 竖排源矩形修正（只记录）
  [0x2bd, op_set_main_bold], // 主字体加粗（全局）
  [0x2be, op_set_ruby_bold], // 注音字体加粗（全局）
  [0x2fe, op_set_ruby_face], // 注音字体面名（全局）
  [0x2de, op_font_name_to_index], // 字体名 → 字体表下标（写回 op1；CHECKCONFIG 靠它的符号）
  [0x2dc, op_font_list_count], // 可选字体数量（写回 op1；SELFONT 分页/滚动条的分母）
  [0x2dd, op_font_list_name], // 可选字体第 idx 项的名字（写回 op1 字符串；SELFONT 逐行画候选）
  [0x303, op_align], // 对齐模式 + 行宽
  [0x079, op_text_origin], // 文字起点
  // ---- 消息窗字段 / 对象表 ----
  [0x7f, op_get_message_speed], // 读 Engine[21668] = message:MessageSpeed（★不是消息窗 α）
  [0x80, op_set_default_window], // 默认窗索引（0x6E/0x6F/0x196 的 op1=0 指它）
  [0x300, op_msgwin_slot_flags],
  [0x301, op_msgwin_slot_clear],
  [0x212, op_msgwin_obj_f100], // 对象 +100
  [0x213, op_msgwin_obj_range], // 对象 +104/+108
  [0x25d, op_msgwin_obj_range2], // 对象 +276/+280
  // ---- 消息窗对象：文本块参数 / 颜色（2026-09；`Font[win+261]`）----
  [0x7a, op_msgwin_obj_pre48], // 文本块原点覆盖（写 buf[-20]/-16；默认来自 0x79 的文字起点）
  [0x25c, op_msgwin_obj_text_block], // 对象 +224：13 dword 文本块参数
  [0x25e, op_msgwin_obj_colors], // 对象 +256/+260/+272（颜色 + ARGB）
  [0x25f, op_msgwin_obj_colors2], // 对象 +264/+268（颜色 + ARGB）
];
