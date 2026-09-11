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
import { readIntOperand, readStringOperand, writeIntOperand } from '../operand.js';
import { ADV_ACTIVE, CHAR_REVEAL_ACTIVE, SLEEP_GATE, type Engine } from '../engine.js';
import { cfgInt } from '../../engineConfig.js';
import { defaultWinStyle, layoutWindow, type MsgWinStyle } from '../../text/layout.js';
import { fontListIndex, resolveFace } from '../../text/fontSet.js';
import { REVEAL_FRAME_MS } from '../msgwin.js';
import type { OpTable } from './shared.js';

const setAdv = (e: Engine): void => void (e.effectFlags |= ADV_ACTIVE);
const clearAdv = (e: Engine): void => void (e.effectFlags &= ~ADV_ACTIVE);

/**
 * 写引擎配置注册表（`SetConfig` 的等价物）：`Engine.config.values` 就是注册表。
 *
 * 为什么要写它：`0x1B5/0x1B9/0x2E7/0x2E8/0x2CD/0x141` 这类指令的全部作用就是"把值持久化进配置"，
 * 漏掉则"设置界面改了但下次启动又变回去"。数值本身同时也写进引擎字段（各 handler 自己负责）。
 */
export function setConfigValue(e: Engine, key: string, value: number): void {
  if (!e.config) e.config = { values: new Map(), sections: [] };
  e.config.values.set(key.toLowerCase(), value);
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

/** 由「全局样式 + 该窗几何 + 该窗文本」组装排版输入（引擎 `Font` + `FontVWindow` 的快照）。 */
export function styleOfWin(e: Engine, win: number): MsgWinStyle {
  const m = e.msgwin;
  const g = m.geom(win);
  const v = (k: number, d: number): number => e.engineValues.get(k) ?? d;
  const base = defaultWinStyle();
  const resolvedMain = resolveFace(m.font.mainFace);
  const resolvedRuby = resolveFace(m.font.rubyFace);
  return {
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    originX: g.originX,
    originY: g.originY,
    wrapRight: g.wrapRight,
    wrapBottom: g.wrapBottom,
    // 竖排是**全局**的（引擎 Font+235108；下标 80101，由 0x261 写）
    vertical: (v(80101, m.font.vertical ? 1 : 0) & 1) !== 0,
    align: g.align,
    alignWidth: g.alignWidth,
    outlineMode: (v(21667, base.outlineMode) & 3) as 0 | 1 | 2 | 3,
    outlineDx: v(21670, base.outlineDx),
    outlineDy: v(21671, base.outlineDy),
    main: {
      family: resolvedMain.family,
      size: m.font.mainSize,
      weight: m.font.mainBold ? 700 : 400,
      fill: hex6(v(21664, 0xffffff)),
      outline: hex6(v(21665, 0x000000)),
    },
    ruby: {
      family: resolvedRuby.family,
      size: m.font.rubySize,
      weight: m.font.rubyBold ? 700 : 400,
      // 注音与本文共用填充/描边色（引擎只有一套 +1360/+1364）
      fill: hex6(v(21664, 0xffffff)),
      outline: hex6(v(21665, 0x000000)),
    },
    background: g.background,
    // 层序 = 引擎正文行 DrawItem id 起点（op 0x213 写的 win+104）
    itemId: m.object(win).f104,
  };
}

/** 发布一个窗（文本或样式变化后调用；排版在共享层做，宿主只光栅化）。 */
export function emitWin(e: Engine, win: number): void {
  const w = e.msgwin.resolveWin(win);
  e.native.msgWinSync?.(w, {
    style: styleOfWin(e, w),
    segments: e.msgwin.slot(w).segments,
    revealed: e.msgwin.revealedOf(w), // -1 = 全部显示
  });
}

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
function messageSpeedOf(e: Engine): number {
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
  if ((m.flags & 1) !== 0) {
    m.addRuby(slot, text, '');
    m.flags |= 0x10000;
    return;
  }
  m.appendText(slot, text);
  m.flags &= ~0x10000;
  // 新内容入队 ⇒ 该窗的显现游标作废（引擎 `0x71` 会 idx=0 重头显示）
  e.msgwin.reveal.delete(e.msgwin.resolveWin(slot));
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
 * ⇒ 每次 `wait-for-input` 都**重新武装逐字**。文本内容与注音由 `show-text` 提前写入本窗。
 */
const op_wait_for_input: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  m.lastArg = readIntOperand(e, c.frame, c.instr, 1);
  const w = m.resolveWin(m.lastArg);
  // 引擎 `sub_45A940(..., -1, Engine+107705)`：把该窗字格数写进模数槽（字格未设时 win+92 = 0）。
  const grid = m.gridOf(w);
  m.charTotal = grid ? grid.cells : 0;
  e.engineValues.set(107705, m.charTotal);
  if (!m.isRevealing(w)) {
    const laid = layoutWindow(w, { style: styleOfWin(e, w), segments: m.slot(w).segments });
    const total = laid.glyphCount;
    if (m.skipping !== 0 || m.skipMode !== 0) m.finishReveal(w);
    else {
      // ★两条节拍：字格页用 `0x73` op10（一次一格）；普通消息页用「行数 × max(MessageSpeed, 一帧)」
      //   的预算（引擎一步 = 一行 ⇒ 整段时长 = 行数 × 节拍）。见 MsgWindow.RevealState 注释。
      const tick = m.gridTickMs(w);
      m.beginReveal(w, total, e.nowMs, messageSpeedOf(e), tick !== undefined ? { intervalMs: tick } : { lines: laid.lines.length });
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
  if (m.alt === 0 && m.skipMirror === 0) m.finishPage();
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
  const mask = e.input.flush();
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
    // `sub_453A90`：重启节拍 ⇒ 已有显现状态的下一次推进点按字格节拍（或预算）重排。
    for (const [win, st] of m.reveal) {
      if (!st.active) continue;
      if (st.intervalMs !== undefined) st.nextAt = e.nowMs + st.intervalMs;
      else {
        st.lastAt = e.nowMs;
        st.carry = 0;
      }
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
 * `0x090`（sub_420640 raw 29477-29518）：**登记点击热点/路由项**。
 * `i090 <x> <y> <w> <h> <labelA> <labelB> <labelC>` →
 * `sub_403B30(Engine+0x55D8, x, y, x+w, y+h, labelA, labelB, labelC, frame_arg)`。
 *
 * 入队失败（表满 100）时引擎抛 `Command_ShowMessage`；emulator 照抛，绝不静默。
 * ★这是「等待输入」结束后脚本能继续的**唯一**机制（见 `src/vm/route.ts`）。
 */
const op_route_push: OpHandler = (c) => {
  const e = c.e;
  const [x, y, w, h, labelA, labelB, labelC] = [1, 2, 3, 4, 5, 6, 7].map((n) => readIntOperand(e, c.frame, c.instr, n));
  const ok = e.routes.push(x!, y!, w!, h!, labelA!, labelB!, labelC!, c.frame.frameArg);
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

/** `0x75 <size>`（sub_41F350 → sub_4185F0 raw 24057-24082）：主字号（全局）。 */
const op_set_main_size: OpHandler = (c) => {
  const e = c.e;
  const size = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(71745, size); // Font+201684 / 4
  e.msgwin.font.mainSize = size;
  emitAllWins(e);
};

/** `0x197 <size>`（sub_41FDD0 → sub_418680 raw 24084-24154）：注音字号（全局）。 */
const op_set_ruby_size: OpHandler = (c) => {
  const e = c.e;
  const size = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(75970, size); // Font+218584 / 4
  e.msgwin.font.rubySize = size;
  emitAllWins(e);
};

/** `0x1A5 <name>`（sub_433290 → sub_4328F0 raw 41344-41565）：主字体面名（全局）。 */
const op_set_main_face: OpHandler = (c) => {
  const e = c.e;
  const face = readStringOperand(e, c.frame, c.instr, 1);
  e.msgwin.font.mainFace = face;
  emitAllWins(e);
};

/** `0x2FE <name>`（sub_4332D0 → sub_432DD0 raw 41568-41798）：注音字体面名（全局）。 */
const op_set_ruby_face: OpHandler = (c) => {
  const e = c.e;
  const face = readStringOperand(e, c.frame, c.instr, 1);
  e.msgwin.font.rubyFace = face;
  emitAllWins(e);
};

/** `0x2BD <flag>`（sub_426200 raw 33384-33402）：主字体加粗（`lfWeight` 700/0，全局）。 */
const op_set_main_bold: OpHandler = (c) => {
  const e = c.e;
  const on = readIntOperand(e, c.frame, c.instr, 1) !== 0;
  e.engineValues.set(75953, on ? 700 : 0); // Font+218516 / 4
  e.msgwin.font.mainBold = on;
  emitAllWins(e);
};

/** `0x2BE <flag>`（sub_426260 raw 33404-33422）：注音字体加粗（全局）。 */
const op_set_ruby_bold: OpHandler = (c) => {
  const e = c.e;
  const on = readIntOperand(e, c.frame, c.instr, 1) !== 0;
  e.engineValues.set(75971, on ? 700 : 0); // Font+218588 / 4
  e.msgwin.font.rubyBold = on;
  emitAllWins(e);
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
      e.msgwin.beginReveal(v, laid.glyphCount, e.nowMs, messageSpeedOf(e), { lines: laid.lines.length });
      emitWin(e, v);
    }
  }
};

/** 消息窗 / ADV 指令族（全部为 `OPS`＝真实现）。 */
export const MSGWIN_OPS: OpTable = [
  // ---- 文本内容与推进 ----
  [0x6e, op_show_text], // show-text：追加文本 + 分段节流
  [0x6f, op_end_text_line], // end-text-line
  [0x071, op_message_show], // message-show（修正：不再无条件置 ADV）
  [0x072, op_wait_for_input], // wait-for-input：结束一页并挂起（bit31 等待门）
  [0x0fa, op_poll_msg_advance], // poll-msg-advance（★过去未注册 ⇒ 命中即硬报错）
  [0x196, op_display_furigana], // display-furigana：记录注音
  // ---- 状态位 ----
  [0x088, op_message_mode],
  [0x19c, op_adv_enter],
  [0x19b, op_adv_exit],
  [0x1ca, op_set_read_text_skip], // SetConfig message:ReadTextSkip
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
];
