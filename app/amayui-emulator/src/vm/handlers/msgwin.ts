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
import type { OpHandler } from '../step.js';
import { readIntOperand, readStringOperand, writeIntOperand, writeStringOperand } from '../operand.js';
import { ADV_ACTIVE, CHAR_REVEAL_ACTIVE, SLEEP_GATE, type Engine } from '../engine.js';
import { cfgInt } from '../../engineConfig.js';
import {
  advance,
  defaultWinStyle,
  layoutWindow,
  type FontSpec,
  type FontStyleSnapshot,
  type MsgCellFrame,
  type MsgWinStyle,
} from '../../text/layout.js';
import { ENGINE_FONT_LIST, fontListIndex, resolveFace } from '../../text/fontSet.js';
import { REVEAL_FRAME_MS } from '../msgwin.js';
import type { OpTable } from './shared.js';

const setAdv = (e: Engine): void => void (e.effectFlags |= ADV_ACTIVE);
const clearAdv = (e: Engine): void => void (e.effectFlags &= ~ADV_ACTIVE);

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
 * `0x76`/`0x77` 的 handler 在引擎里把 COLORREF(BGR) 翻成 RGB 后存入 `_this[21664]/[21665]`
 * （raw 28669/28680），emulator 的 `ENGINE_FIELD_STORE` 做了同样的重排 ⇒ 这里直接读即可。
 */
const hex6 = (rgb: number): string => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

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
} {
  const m = e.msgwin;
  const v = (k: number, d: number): number => e.engineValues.get(k) ?? d;
  const base = defaultWinStyle();
  return {
    main: {
      family: resolveFace(m.font.mainFace, e.resourceVersion).family,
      size: m.font.mainSize,
      weight: m.font.mainBold ? 700 : 400,
      fill: hex6(v(21664, 0xffffff)),
      outline: hex6(v(21665, 0x000000)),
    },
    outlineMode: (v(21667, base.outlineMode) & 3) as 0 | 1 | 2 | 3,
    outlineDx: v(21670, base.outlineDx),
    outlineDy: v(21671, base.outlineDy),
  };
}

/** 由「该窗入队时钉住的字体样式 + 该窗几何 + 该窗文本」组装排版输入（引擎 `FontVWindow` + `Font` 的快照）。 */
export function styleOfWin(e: Engine, win: number): MsgWinStyle {
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
    align: g.align,
    alignWidth: g.alignWidth,
    outlineMode: core.outlineMode,
    outlineDx: core.outlineDx,
    outlineDy: core.outlineDy,
    main: core.main,
    // 注音与本文共用填充/描边色（引擎只有一套 +1360/+1364）
    ruby: core.ruby,
    background: g.background,
    // 层序 = 引擎正文行 DrawItem id 起点（op 0x213 写的 win+104）—— 几何类，实时
    itemId: m.object(win).f104,
  };
}

/**
 * **当前全局字体/颜色快照**（入队时钉住用；`styleOfWin` 在没有快照时也回退到它）。
 *
 * 与 `globalTextStyle` 的区别：这里把注音字体与竖排一起收进来，正好是"一次排版要用到的全部样式"，
 * 而几何（位置/尺寸/换行/对齐/层序）**不在**其中 —— 那些是逐窗字段，必须实时。
 */
export function globalFontSnapshot(e: Engine): FontStyleSnapshot {
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
    },
    outlineMode: core.outlineMode,
    outlineDx: core.outlineDx,
    outlineDy: core.outlineDy,
    // 引擎 `Font+235108` bit0（0x261 写）；未写时用随包 INI 的默认值
    vertical: ((e.engineValues.get(80101) ?? (m.font.vertical ? 1 : 0)) & 1) !== 0,
  };
}

/** 把当前全局样式钉进该窗（文本入队路径专用）。 */
function captureFontStyle(e: Engine, i: number): void {
  e.msgwin.setFontStyle(i, globalFontSnapshot(e));
}

/** 发布一个窗（文本或样式变化后调用；排版在共享层做，宿主只光栅化）。 */
export function emitWin(e: Engine, win: number): void {
  const w = e.msgwin.resolveWin(win);
  e.native.msgWinSync?.(w, {
    style: styleOfWin(e, w),
    segments: e.msgwin.slot(w).segments,
    revealed: e.msgwin.revealedOf(w), // -1 = 全部显示
    // ★两个 DrawItem 区间（`0x213` 写 `+104/+108`、`0x25D` 写 `+276/+280`）：渲染侧的
    //   `scDetachTexture` 靠它判"脚本删掉这窗的正文图元 ⇒ 画面上的字也该消失"（见其说明）。
    itemRanges: itemRangesOf(e, w),
    cell: cellFrameOf(e, w),
  });
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
  const followText = e.engineValues.get(21672) === 1 || (geom.x <= 0 && geom.y <= 0 && geom.w >= 640 && geom.h >= 360);
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

/** 发布全部"已知"窗口（全局样式变化时用 —— 字号/颜色/描边/竖排都是全局的）。 */
export function emitAllWins(e: Engine): void {
  const wins = new Set<number>([...e.msgwin.slots.keys(), ...e.msgwin.wins.keys(), e.msgwin.defaultWin]);
  for (const w of wins) emitWin(e, w);
}

/** `message:ReadTextSkip` 当前取值：运行期覆盖（0x1CA 写入）优先，否则用启动配置，缺省 0。 */
export function readTextSkipOf(e: Engine): number {
  const m = e.msgwin;
  if (m.readTextSkip !== null) return m.readTextSkip;
  return e.config ? cfgInt(e.config, 'message:readtextskip', 0) : 0;
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
  return e.engineValues.get(21668) ?? (e.config ? cfgInt(e.config, 'message:messagespeed', 0) : 0);
}

/**
 * **ADV 位判定（三处 handler 共用）** —— 对应引擎里重复出现的那段
 * `if (GetConfig("message:ReadTextSkip")) { …sub_48E870/sub_48F000… } else { … }`。
 *
 * emulator 无文本渲染 ⇒ `sub_48F000`（"这段文本还有没有后续内容"）恒为 0 ⇒ **逐字显示立即完成**：
 *  - 清 `122455`（不再"显示中"）；`97050`（跳读/自动模式）非 0 时保留显示态（引擎 LABEL_10）。
 *  - 返回值 = 是否仍在显示中；本实现只在自动模式下为 `true`。
 *
 * ★这是引擎里 `0x8000000` 的**唯一**置位条件，因此 emulator 不再无条件置位。
 */
function advanceReveal(e: Engine): boolean {
  const m = e.msgwin;
  // 门关闭（随包 INI 默认）：引擎直接清显示态，**不置 ADV** —— 这是修掉"位卡死"的那条路径。
  // 门打开：引擎要求 `sub_48F000` 非 0（"还有内容要显示"）。emulator 无逐字渲染，用
  // 「文本刚写入 ⇒ 本帧仍在显示中（showing=1）」，由 `Engine.serviceAdv()` 在下一帧收尾。
  m.showing = readTextSkipOf(e) !== 0 ? 1 : 0;
  if (m.skipMode !== 0) m.showing = 1; // 引擎 LABEL_10：自动/跳读模式保留显示态
  return m.showing !== 0;
}

/**
 * `0x6E show-text`（sub_41EB20 raw 28307-28385）：向文本槽追加一段文本。
 * 注音/内嵌模式（`122497` bit0）走引擎的 `sub_46BE30` 分支。
 */
const op_show_text: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  const text = readStringOperand(e, c.frame, c.instr, 2);
  m.lastArg = slot;
  // ★入队即钉住当前字体/颜色（引擎 `sub_46BE30` 排版时把字形连颜色画进该窗离屏表面）
  captureFontStyle(e, slot);
  if ((m.flags & 1) !== 0) {
    m.addRuby(slot, text, '');
    m.flags |= 0x10000;
    return;
  }
  m.appendText(slot, text);
  m.flags &= ~0x10000;
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
  // 引擎（`Engine[21668]` = message:MessageSpeed 非 0 分支）：每段文本之间按该毫秒数节流
  //   ⇒ 帧让步（与 SLEEP_GATE 同义）。为 0 时引擎走同步排空（此处即"无节流"）。
  const speed = messageSpeedOf(e);
  if (speed > 0) {
    e.sleepUntil = e.nowMs + Math.max(1, speed);
    e.effectFlags |= SLEEP_GATE;
  }
};

/** `0x6F end-text-line`（sub_41ECE0 raw 28389-28397）：结束当前行。 */
const op_end_text_line: OpHandler = (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  e.msgwin.endLine(slot);
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
  const e = c.e;
  const m = e.msgwin;
  const slot = readIntOperand(e, c.frame, c.instr, 1); // 窗索引（0 ⇒ 默认窗；1/2/7/8/9…）
  m.lastArg = slot;
  m.alt = 0;
  const w = m.resolveWin(slot);
  // ★开始一段新消息：清该窗文本记录 + 复位显现游标（引擎 sub_45EC60，raw 74277-74281）
  m.beginNewMessage(w);
  // 同一函数还会在 `slotslot >= 0` 时置该窗的**文本项组首标记**（`Font[win+849] = 1`，raw 74267-74275）：
  // 下一条 `0x1D2`/语音记录 push 会带上"组首"位，`0x1D3`/`0x1D4`/`0x2F3` 的扫描在此处停。
  if (m.textSlotArg >= 0) e.textItems.markGroupStart(w);
  if (advanceReveal(e)) setAdv(e);
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
  const e = c.e;
  const m = e.msgwin;
  m.lastArg = readIntOperand(e, c.frame, c.instr, 1);
  const w = m.resolveWin(m.lastArg);
  // 引擎 `sub_45A940(..., -1, Engine+107705)`：把该窗字格数写进模数槽（字格未设时 win+92 = 0）。
  // ★这条查询同时是"**▼ 图标动画的武装**"：模数 = 精灵表格数 op9；`sub_453A90` 重启节拍 ⇒ 帧号归零。
  const grid = m.gridOf(w);
  m.charTotal = grid ? grid.cells : 0;
  e.engineValues.set(107705, m.charTotal);
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
      e.engineValues.set(107704, 0);
      e.effectFlags |= CHAR_REVEAL_ACTIVE;
    }
  }
  if (m.isRevealing(w)) {
    e.awaitingAdvance = true; // 门已置，但显现未完 ⇒ 由帧循环的 text-reveal 分支继续推进
    return;
  }
  if (advanceReveal(e)) return; // 仍在显示中 ⇒ 不挂起（引擎在 LABEL_17 之前就 return）
  clearAdv(e);
  // 引擎：`if (!122496 && !(mask & 0x40))` —— 0x40 = 「跳读中」（Engine[1415] 合成）
  if (m.alt === 0 && m.skipMirror === 0) m.finishPage(w);
  if ((e.effectFlags & ADV_ACTIVE) === 0) {
    e.input.consumeEdges(); // 引擎 sub_478090(Engine+258, …)
    e.awaitingAdvance = true; // ★ effect_flags |= 0x80000000
  }
};

/**
 * `0xFA poll-msg-advance`（sub_4199B0 raw 24952-24987）：消息收尾 / 快速推进。
 * 输入掩码**没有**「跳读中」位（0x40）⇒ 清 ADV 并冲掉 3 个消息槽；随后若 ADV 已清，
 * 消费输入边沿并置 bit31（等待门）。
 *
 * ★这条过去**未在任何注册表**里 —— 脚本一旦命中就抛 `NotImplementedOp` 硬报错。
 */
const op_poll_msg_advance: OpHandler = (c) => {
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
    e.awaitingAdvance = true;
  }
};

/** `0x196 display-furigana`（sub_41FC20 raw 29032-29060）：在消息文本里插注音。 */
const op_display_furigana: OpHandler = (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  // ★同样是"文本入队"（引擎 `sub_46BE30`）⇒ 追加前钉住当前样式
  //   （口径：**一页的样式 = 最后一次入队那一刻的样式**；引擎严格来说是"每段各自用当时的样式"，
  //    但全库 87324 处文本入队里，页内"文本→改样式→再文本"的出现次数是 **0** ⇒ 两者等价）
  captureFontStyle(e, slot);
  e.msgwin.addRuby(slot, readStringOperand(e, c.frame, c.instr, 2), readStringOperand(e, c.frame, c.instr, 3));
  e.msgwin.reveal.delete(e.msgwin.resolveWin(slot));
  emitWin(e, slot);
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
  const e = c.e;
  const m = e.msgwin;
  const rd = (n: number): number => readIntOperand(e, c.frame, c.instr, n);
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
  const v = readIntOperand(e, c.frame, c.instr, 1);
  m.charModeArg = v;
  e.engineValues.set(107706, v);
  if (v !== 0) {
    m.charMode = true;
    m.charCursor = 0;
    e.engineValues.set(107704, 0);
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
    if ((e.effectFlags & 0x100000) === 0) {
      for (const win of m.reveal.keys()) m.finishReveal(win);
    }
    e.endCharReveal();
    e.serviceTextReveal(e.nowMs);
  }
};

/**
 * `0x20A <win>`（sub_423620 raw 31546-31566）：**按当前状态重排并重画该窗文本**。
 *
 * 引擎：`sub_45AD30(Font, win)`（重排该窗文本）+ 若 `(effect_flags|Engine[95779]) & 0x40000000`
 * 则用**当前** `Engine[107704]` 调 `sub_45A940(Font, win, k, 0)` 重贴当前字格（游标不动）。
 * 脚本侧 1011 处；★这条过去**未注册**（命中即 `NotImplementedOp` 硬报错）。
 */
const op_window_relayout: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  const win = m.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  // 引擎在逐字模式下会在此用**当前** `Engine[107704]` 重贴同一格 ⇒ 游标不变、内容不变：
  // 重写侧只需按当前游标重新发布一次（`emitWin` 走同一份 `revealedOf`）。
  emitWin(e, win);
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
 * `0x305`（sub_41B1C0 raw 25096-25170，argc=0）：**文本块结束**。
 * 引擎：`win+132 = win+296`（取回行游标）→ `message:ReadTextSkip`/ADV 判定 →
 * `while (!sub_45BE20(Font, 窗))`（**把余下的行一次性贴出**）→ 必要时排空/清 ADV。
 *
 * 重写侧：`finishReveal`（= 整段显示完并 emit）就是"把余下的行贴出去"的等价物；
 * 行游标的存取由 `0x304`/`0x305` 的 `lineCursorSave` 承担。
 */
const op_text_block_end: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  const win = m.resolveWin(m.lastArg);
  m.lineCursorSave.delete(win);
  for (const w of m.reveal.keys()) m.finishReveal(w);
  if (m.charMode) e.endCharReveal();
  e.serviceTextReveal(e.nowMs);
  emitWin(e, win);
};


/**
 * `0x88 message-mode`（sub_41FAB0 raw 28965-28977）：`1415 = 97050 = op1`；
 * 非 0 置 `122368 = 1`（跳读态），为 0 清 ADV。
 */
const op_message_mode: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  e.msgwin.skipMirror = v;
  e.msgwin.skipMode = v;
  if (v !== 0) e.msgwin.skipping = 1;
  else clearAdv(e);
};

/** `0x19C adv-enter`（sub_419120 raw 24546-24575）：按 `97050/122455/124331` 条件置/清 ADV。 */
const op_adv_enter: OpHandler = (c) => {
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
  c.e.msgwin.readTextSkip = readIntOperand(c.e, c.frame, c.instr, 1);
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
  writeIntOperand(c.e, c.frame, c.instr, 1, readTextSkipOf(c.e));
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
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.msgwin.skipMode);
};

/**
 * `0x1B6`（sub_42D2C0 raw 38038-38042）：`op1 = (Engine[97052] != 0)`。
 *
 * `Engine[97052]` 是**「共存消息」状态**（引擎的配置键串是 `set:CoexistMess`，raw 13706）：
 *  - 置位端 = `0x1B7`（sub_41FF20 raw 29181-29189）`97052 = (op1 != 0)`；
 *  - 引擎帧循环（raw 13699-13705）每帧看到它就 `97052 = 0` 并提前 return，
 *    同时按 `set:CoexistMess` 决定 `97050 = 0`（关掉跳读）。
 * emulator 把 97052 放在 `Engine.advFields`（与 `0x1B7` 成对，可往返测试）。
 */
const op_get_coexist_state: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.advFields.get(97052) ?? 0) !== 0 ? 1 : 0);
};

/** `0x1B7`（sub_41FF20 raw 29181-29189）：`Engine[97052] = (op1 != 0)`（`0x1B6` 的写入端）。 */
const op_set_coexist_state: OpHandler = (c) => {
  c.e.advFields.set(97052, readIntOperand(c.e, c.frame, c.instr, 1) !== 0 ? 1 : 0);
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
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.effectFlags & ADV_ACTIVE) !== 0 ? 1 : 0);
};

/**
 * `0x1CC`（sub_42D410 raw 38092-38096）：`op1 = Engine[122455]` ＝ **「本页文本正在显示中」**。
 *
 * 与 `Engine.msgwin.showing` 同一字段（`0x88`/`0x19C`/`sub_411900` 都写它）。
 * 语料同 `0x1C7`（`i1cc f7ff6`，与 `i1c7` 的 `or` 一起作为"要不要接着等"的判据）。
 */
const op_get_msg_showing: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.msgwin.showing);
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
  const e = c.e;
  const [x, y, w, h, labelA, labelB, labelC] = [1, 2, 3, 4, 5, 6, 7].map((n) => readIntOperand(e, c.frame, c.instr, n));
  const ok = e.routes.push(x!, y!, w!, h!, labelA!, labelB!, labelC!, c.frame.scriptId);
  if (!ok) throw new Error('0x090: 点击热点表已满（引擎上限 100，引擎此处抛 ShowMessage）');
};

/** `0x212`（sub_423A30 raw 31742-31754）：消息窗对象 `+100 = op2`（op1 = 对象索引）。 */
const op_msgwin_obj_f100: OpHandler = (c) => {
  const e = c.e;
  const idx = readIntOperand(e, c.frame, c.instr, 1);
  e.msgwin.object(idx).f100 = readIntOperand(e, c.frame, c.instr, 2);
};

/** `0x213`（sub_423A80 raw 31758-31775）：消息窗对象 `+104 = op2`、`+108 = op3`。 */
const op_msgwin_obj_range: OpHandler = (c) => {
  const e = c.e;
  const idx = readIntOperand(e, c.frame, c.instr, 1);
  const a = readIntOperand(e, c.frame, c.instr, 2);
  const o = e.msgwin.object(idx);
  o.f104 = a;
  o.f108 = readIntOperand(e, c.frame, c.instr, 3);
};

/** `0x25D`（sub_425EF0 raw 33248-33265）：消息窗对象 `+276 = op2`、`+280 = op3`。 */
const op_msgwin_obj_range2: OpHandler = (c) => {
  const e = c.e;
  const idx = readIntOperand(e, c.frame, c.instr, 1);
  const a = readIntOperand(e, c.frame, c.instr, 2);
  const o = e.msgwin.object(idx);
  o.f276 = a;
  o.f280 = readIntOperand(e, c.frame, c.instr, 3);
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
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const o = e.msgwin.object(win);
  o.pre48a = readIntOperand(e, c.frame, c.instr, 2);
  o.pre48b = readIntOperand(e, c.frame, c.instr, 3);
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
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const [, o2, o3, o4, o5, o6, o7, o8] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    readIntOperand(e, c.frame, c.instr, n),
  );
  const o = e.msgwin.object(win);
  o.block224 = [1, o4!, o5!, o6!, o7! + o5!, o8! + o6!, o2!, o3!, 0, 0, 0, -1, -1];
};

/** `0x25E`（`sub_425F50` raw 33269-33288 → `sub_456590`）：窗对象 `+256=op2`、`+260=op3`、`+272=ARGB`。 */
const op_msgwin_obj_colors: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const o = e.msgwin.object(win);
  o.f256 = readIntOperand(e, c.frame, c.instr, 2);
  o.f260 = readIntOperand(e, c.frame, c.instr, 3);
  // 引擎：v2 = op4（>255 截断）当 alpha，op5 取 RGB ⇒ `(a<<24)|(b2<<16)|(b1<<8)|b0`
  o.f272 = packArgb(readIntOperand(e, c.frame, c.instr, 4), readIntOperand(e, c.frame, c.instr, 5));
};

/** `0x25F`（`sub_425FF0` raw 33291-33308 → `sub_4565D0`）：窗对象 `+264=op2`、`+268=ARGB`。 */
const op_msgwin_obj_colors2: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const o = e.msgwin.object(win);
  o.f264 = readIntOperand(e, c.frame, c.instr, 2);
  o.f268 = packArgb(readIntOperand(e, c.frame, c.instr, 3), readIntOperand(e, c.frame, c.instr, 4));
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

/** `0x70 <win> <w> <h> <x> <y>`（sub_41ED20 → sub_45D660 raw 73132-73193）：窗口几何。 */
const op_window_geometry: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const w = readIntOperand(e, c.frame, c.instr, 2);
  const h = readIntOperand(e, c.frame, c.instr, 3);
  const x = readIntOperand(e, c.frame, c.instr, 4);
  const y = readIntOperand(e, c.frame, c.instr, 5);
  const g = e.msgwin.geom(win);
  g.w = w;
  g.h = h;
  g.x = x;
  g.y = y;
  // 引擎同函数把 w/h 也写进换行边界 win+36/+40（raw 73162-73163）；底色随表面重建设置
  g.wrapRight = w;
  g.wrapBottom = h;
  emitAllWins(e);
};

/** `0x198 <win> <x> <y>`（sub_41FE10 → sub_456400 raw 68263-68279）：窗口屏幕位置。 */
const op_window_pos: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const g = e.msgwin.geom(win);
  g.x = readIntOperand(e, c.frame, c.instr, 2);
  g.y = readIntOperand(e, c.frame, c.instr, 3);
  emitWin(e, win);
};

/** `0x1C1 <win> <right> <bottom>`（sub_420070 → sub_4563D0 raw 68248-68261）：换行边界。 */
const op_window_wrap: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const g = e.msgwin.geom(win);
  g.wrapRight = readIntOperand(e, c.frame, c.instr, 2);
  g.wrapBottom = readIntOperand(e, c.frame, c.instr, 3);
  emitWin(e, win);
};

/** `0x79 <win> <x> <y>`（sub_41F490 → sub_4563A0 raw 68233-68246）：文字起点。 */
const op_text_origin: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const g = e.msgwin.geom(win);
  g.originX = readIntOperand(e, c.frame, c.instr, 2);
  g.originY = readIntOperand(e, c.frame, c.instr, 3);
  emitWin(e, win);
};

/** `0x303 <win> <mode> <width>`（sub_426A90 → sub_456600 raw 68405-68418）：对齐模式 + 行宽。 */
const op_align: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.resolveWin(readIntOperand(e, c.frame, c.instr, 1));
  const g = e.msgwin.geom(win);
  const mode = readIntOperand(e, c.frame, c.instr, 2);
  g.align = (mode === 1 ? 1 : mode === 2 ? 2 : 0) as 0 | 1 | 2;
  g.alignWidth = readIntOperand(e, c.frame, c.instr, 3);
  emitWin(e, win);
};

/** `0x80 <win>`（sub_41F690 raw 28786-28796）：设默认窗（`Font+1228`）。 */
const op_set_default_window: OpHandler = (c) => {
  const e = c.e;
  const win = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(21631, win);
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
  const name = readStringOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, fontListIndex(name));
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
  const n = ENGINE_FONT_LIST.length;
  writeIntOperand(c.e, c.frame, c.instr, 1, n > 0 ? n : -1);
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
  const idx = readIntOperand(c.e, c.frame, c.instr, 2);
  const name = idx >= 0 && idx < ENGINE_FONT_LIST.length ? ENGINE_FONT_LIST[idx]! : '';
  writeStringOperand(c.e, c.frame, c.instr, 1, name);
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
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(21668, v);
  setConfigValue(c.e, 'message:messagespeed', v);
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
  c.e.engineValues.set(21668, readIntOperand(c.e, c.frame, c.instr, 1));
};

/** `0x1B9 <idx> <ms>`（sub_41FF60 raw 29191-29220）：`message:AutoMessageTime{idx}`（自动翻页基础时长）。 */
const op_set_auto_message_time: OpHandler = (c) => {
  const idx = readIntOperand(c.e, c.frame, c.instr, 1);
  setConfigValue(c.e, `message:automessagetime${idx === 1 ? 1 : 0}`, readIntOperand(c.e, c.frame, c.instr, 2));
};

/** `0x2E7 <idx> <ms>`（sub_426540 raw 33534-...）：`message:AutoMessagePitch{idx}`（自动翻页每行附加时长）。 */
const op_set_auto_message_pitch: OpHandler = (c) => {
  const idx = readIntOperand(c.e, c.frame, c.instr, 1);
  setConfigValue(c.e, `message:automessagepitch${idx === 1 ? 1 : 0}`, readIntOperand(c.e, c.frame, c.instr, 2));
};

/** `0x2E8 <v>`（sub_4265E0 raw 33565-33577）：`message:AutoMessageOption`。 */
const op_set_auto_message_option: OpHandler = (c) => {
  setConfigValue(c.e, 'message:automessageoption', readIntOperand(c.e, c.frame, c.instr, 1));
};

/** `0x2CD <v>`（sub_426390 raw 33463-33475）：`message:AdvanceMesOnWheel`（滚轮是否推进消息）。 */
const op_set_advance_mes_on_wheel: OpHandler = (c) => {
  setConfigValue(c.e, 'message:advancemesonwheel', readIntOperand(c.e, c.frame, c.instr, 1));
};

/**
 * `0x75 <size>`（sub_41F350 → sub_4185F0 raw 24057-24082）：主字号（全局）。
 *
 * ★**只改"下一次排版用哪套样式"，不重绘任何已排版的窗**（引擎：`sub_4185F0` 写
 * `Font+201684/+1232/+101972` 再 `sub_459F40` **重建 GDI 字体对象/字宽**，已画进各窗离屏表面的字形
 * 一点都不动）。因此这里**不再** `emitAllWins` —— 那会把晚到的全局样式糊到先前排好的窗上
 * （用户实测：`CONFIG2` 逐行设的角色名颜色溢到设置界面下方的 ADV 样例窗）。
 * 脚本想换样式重画时会**重新入队**（`i071` + `show-text`，如 `CONFIG.txt:171-179`）。
 */
const op_set_main_size: OpHandler = (c) => {
  const e = c.e;
  const size = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(71745, size); // Font+201684 / 4
  e.msgwin.font.mainSize = size;
};

/** `0x197 <size>`（sub_41FDD0 → sub_418680 raw 24084-24154）：注音字号（全局）。同上，不重绘。 */
const op_set_ruby_size: OpHandler = (c) => {
  const e = c.e;
  const size = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(75970, size); // Font+218584 / 4
  e.msgwin.font.rubySize = size;
};

/** `0x1A5 <name>`（sub_433290 → sub_4328F0 raw 41344-41565）：主字体面名（全局）。同上，不重绘。 */
const op_set_main_face: OpHandler = (c) => {
  const e = c.e;
  const face = readStringOperand(e, c.frame, c.instr, 1);
  e.msgwin.font.mainFace = face;
};

/** `0x2FE <name>`（sub_4332D0 → sub_432DD0 raw 41568-41798）：注音字体面名（全局）。同上，不重绘。 */
const op_set_ruby_face: OpHandler = (c) => {
  const e = c.e;
  const face = readStringOperand(e, c.frame, c.instr, 1);
  e.msgwin.font.rubyFace = face;
};

/** `0x2BD <flag>`（sub_426200 raw 33384-33402）：主字体加粗（`lfWeight` 700/0，全局）。同上，不重绘。 */
const op_set_main_bold: OpHandler = (c) => {
  const e = c.e;
  const on = readIntOperand(e, c.frame, c.instr, 1) !== 0;
  e.engineValues.set(75953, on ? 700 : 0); // Font+218516 / 4
  e.msgwin.font.mainBold = on;
};

/** `0x2BE <flag>`（sub_426260 raw 33404-33422）：注音字体加粗（全局）。同上，不重绘。 */
const op_set_ruby_bold: OpHandler = (c) => {
  const e = c.e;
  const on = readIntOperand(e, c.frame, c.instr, 1) !== 0;
  e.engineValues.set(75971, on ? 700 : 0); // Font+218588 / 4
  e.msgwin.font.rubyBold = on;
};

/**
 * `0x260 <a> <b> <c> <d>`（sub_426080 raw 33310-33328）：竖排**源矩形修正**
 * `Font+235112/235116/235120/235124 = op1/op2/op3/op4`。
 * ★这正是报告 A 里"找不到写入点"的那四个字段的写入者。重写侧直接光栅化字形、
 * 不经过离屏源矩形 ⇒ **只记录不消费**（见 ADR §7）。
 */
const op_vertical_rect_pad: OpHandler = (c) => {
  const e = c.e;
  const win = e.msgwin.defaultWin;
  const g = e.msgwin.geom(win);
  g.vPad = {
    x: readIntOperand(e, c.frame, c.instr, 1),
    dw: readIntOperand(e, c.frame, c.instr, 2),
    y: readIntOperand(e, c.frame, c.instr, 3),
    dh: readIntOperand(e, c.frame, c.instr, 4),
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
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(21668) ?? 0);
};

/** `0x300`（sub_426990）：对象旗标 `_this[122466+v] |= op2`（保留 bit16）、`_this[122476+v] = op3`。 */
const op_msgwin_slot_flags: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  const flags = readIntOperand(e, c.frame, c.instr, 2);
  const value = readIntOperand(e, c.frame, c.instr, 3);
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
 * `0x301`（sub_4269F0 → sub_404F80 raw 10741-10763）：清 `win+132`（显现游标）+ 删两段绘制项。
 *
 * ★`sub_404F80` **不清文本记录**，只把游标归零 ⇒ 闸门（`0x300`）开着时，下一次泵调用会
 * 从第一行重新贴出（这正是 CONFIG 预览"消失后重来"的那一步）。故这里在清视图的同时把
 * 显现状态重新武装到 0。
 */
const op_msgwin_slot_clear: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(v + 122486, 0);
  e.msgwin.object(v).f132 = 0; // sub_404F80 的清 `+132` 那一步
  // 引擎 sub_404F80 同时 sub_4ABB60 删该窗两段绘制项 ⇒ 重写侧清掉该窗文本
  e.native.msgWinClear?.(v);
  const g = e.msgwin.gateOf(v);
  g.doneAt = null;
  if (g.enabled) {
    const laid = layoutWindow(v, { style: styleOfWin(e, v), segments: e.msgwin.slot(v).segments });
    if (laid.glyphCount > 0) {
      e.msgwin.beginReveal(v, laid.glyphCount, e.nowMs, messageSpeedOf(e));
      emitWin(e, v);
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
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  const x = readIntOperand(e, c.frame, c.instr, 2);
  const y = readIntOperand(e, c.frame, c.instr, 3);
  const text = readStringOperand(e, c.frame, c.instr, 4);
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
  });
};

/**
 * **`0x205`（`sub_4233E0` raw 31470-31491）：把**数值**按格式画进纹理槽（GDI 数字文本）。**
 *
 * 引擎体只有 6 步（`op2` 是 **in/out**）：
 * ```c
 * v8 = op2;  v6 = op6;  v4 = op5;  v2 = op4;         // x / 格式标志 / 字段宽 / 数值
 * sub_4072F0(_this, buf, &v8, v2, v4, v6);           // ★把数值格式化，并**回写 v8 = 新的 x**
 * v7 = op3;  sub_456710(Font, op1, buf, v8, v7);     // 用新 x 把串直绘进槽 op1（与 0x204 同一个 GDI 缝）
 * ```
 * ⇒ 脚本可观测的部分是 **`op2` 的写回**（数字排完后 x 前进到哪），其次是那张槽上出现的数字。
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
 *   左对齐 = `0`；右对齐 = `v13*cy`（全角）/`v13*cy/2`（半角）。`cy` = 一个全角格宽
 *   （引擎取 `Engine[71744] ? Engine[71745] : -Engine[21632]`，即字号；`set:BlankExtentMode == 1`
 *   时改用 GDI 字宽量测 —— **那段字宽量测未建模**，见下方"缺口"）。
 *
 * ## 缺口（明确记录）
 * `set:BlankExtentMode == 1` 分支用 `sub_404EE0` 量空格宽度；emulator 无 GDI 度量，统一用字号当格宽。
 * 对"把数字排进离屏槽"的用量（INFO/ALCHEMY 等）只影响像素级位置，不影响脚本状态。
 */
const op_draw_number_string: OpHandler = (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  const x = readIntOperand(e, c.frame, c.instr, 2);
  const y = readIntOperand(e, c.frame, c.instr, 3);
  const value = readIntOperand(e, c.frame, c.instr, 4);
  const width = readIntOperand(e, c.frame, c.instr, 5);
  const flags = readIntOperand(e, c.frame, c.instr, 6);
  // 引擎：cy = Engine[71744] ? Engine[71745] : -Engine[21632]（= 一个全角格宽）
  const cy = (e.engineValues.get(71744) ?? 0) !== 0 ? e.engineValues.get(71745) ?? 0 : -(e.engineValues.get(21632) ?? 0);
  const cell = formatNumberCell(value, width, flags);
  const halfWidth = (flags & 0x10000) !== 0;
  // 引擎的 x 前进量（全角/半角与对齐方式三档）
  const advance =
    (flags & 2) !== 0
      ? Math.trunc((cell.start * cy) / (halfWidth ? 2 : 4))
      : (flags & 4) !== 0
        ? 0
        : halfWidth
          ? Math.trunc((cell.start * cy) / 2)
          : cell.start * cy;
  const nx = x + advance;
  writeIntOperand(e, c.frame, c.instr, 2, nx); // ★op2 是 in/out
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

/** `sub_41A6C0`（raw 25539-25593）：ASCII 数字 → 全角（`'0'`→`'０'`、`'-'`→`'－'`、`'+'`→`'＋'`、`'#'`→`'＃'`）。 */
function toFullWidth(s: string): string {
  return s.replace(/[0-9A-Za-z+\-#]/g, (ch) => {
    if (ch === '-') return '－';
    if (ch === '+') return '＋';
    if (ch === '#') return '＃';
    return String.fromCharCode(ch.charCodeAt(0) + 0xfee0);
  });
}

/** 消息窗 / ADV 指令族（全部为 `OPS`＝真实现）。 */
export const MSGWIN_OPS: OpTable = [
  // ---- 文本内容与推进 ----
  [0x6e, op_show_text], // show-text：追加文本 + 分段节流
  [0x6f, op_end_text_line], // end-text-line
  [0x204, op_draw_string], // draw-string：把一整串文本直绘进某个纹理槽（不走消息窗）
  [0x205, op_draw_number_string], // ★数字直绘进纹理槽（op2 是 in/out：回写 x 前进量），313 处
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
