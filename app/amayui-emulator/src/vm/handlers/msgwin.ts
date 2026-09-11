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
import { ADV_ACTIVE, SLEEP_GATE, type Engine } from '../engine.js';
import { cfgInt } from '../../engineConfig.js';
import type { OpTable } from './shared.js';

const setAdv = (e: Engine): void => void (e.effectFlags |= ADV_ACTIVE);
const clearAdv = (e: Engine): void => void (e.effectFlags &= ~ADV_ACTIVE);

/** `message:ReadTextSkip` 当前取值：运行期覆盖（0x1CA 写入）优先，否则用启动配置，缺省 0。 */
export function readTextSkipOf(e: Engine): number {
  const m = e.msgwin;
  if (m.readTextSkip !== null) return m.readTextSkip;
  return e.config ? cfgInt(e.config, 'message:readtextskip', 0) : 0;
}

/** `message:MesWinAlpha`（分段淡入 ms；0 = 不分段节流）。 */
function mesWinAlphaOf(e: Engine): number {
  return e.config ? cfgInt(e.config, 'message:meswinalpha', 0) : 0;
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
  // 引擎 sub_41EB20：`sub_48F000` 非 0（仍在显示）才置 ADV，否则清 122455（并保持 ADV 清除）
  if (advanceReveal(e)) setAdv(e);
  else clearAdv(e);
  // 引擎（MesWinAlpha 非 0 分支）：每段文本之间按 α 毫秒淡入 ⇒ 帧让步（与 SLEEP_GATE 同义）
  const alpha = mesWinAlphaOf(e);
  if (alpha > 0) {
    e.sleepUntil = e.nowMs + Math.max(1, alpha);
    e.effectFlags |= SLEEP_GATE;
  }
};

/** `0x6F end-text-line`（sub_41ECE0 raw 28389-28397）：结束当前行。 */
const op_end_text_line: OpHandler = (c) => {
  const e = c.e;
  e.msgwin.endLine(readIntOperand(e, c.frame, c.instr, 1));
};

/**
 * `0x71 message-show`（sub_41ED80 raw 28419-28473，**argc=1**）：`op1` = **消息窗槽号**。
 * 引擎：`v2 = read(op1)` → `sub_45EC60(文本对象, v2, 97055)`（清该槽布局/图元，准备显示）→
 * 记返还点 `frame.state_6C` → 复制两片工作区 → `sub_48FFB0` 冲消息窗队列 → 判定 ADV。
 *
 * ★修正：原实现**无条件**置 `0x8000000` 且永不清除，且把 op1 当字符串（实际是槽号、无第二操作数）。
 * 引擎只在上面的 `advanceReveal` 判为「仍在逐字显示」时才置位，且该路径受
 * `message:ReadTextSkip` 门控（随包 INI 默认 0）。文本内容由 `show-text`(0x6E) 写入本指令的槽。
 *
 * 不建模：`sub_45EC60` 的清槽布局/图元（无渲染）与 `frame.state_6C` 返还点槽（emulator 用
 * `ctx.jump`/`retStack` 承担控制流）。
 */
const op_message_show: OpHandler = (c) => {
  const e = c.e;
  e.msgwin.lastArg = readIntOperand(e, c.frame, c.instr, 1); // 消息窗槽号（1/2/7/8/9…）
  e.msgwin.alt = 0;
  if (advanceReveal(e)) setAdv(e);
  else clearAdv(e);
};

/**
 * `0x72 wait-for-input`（sub_41EEF0 raw 28482-28600）：**结束一页并挂起等玩家推进**。
 *
 * 引擎：清显示态 → 清 `0x8000000` → 若 ADV 已清则消费输入边沿 + 付托文本 +
 * **置 `0x80000000`（等待推进门）**。
 */
const op_wait_for_input: OpHandler = (c) => {
  const e = c.e;
  const m = e.msgwin;
  m.lastArg = readIntOperand(e, c.frame, c.instr, 1);
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

// ---- 以下为既有实现（引擎里是"读操作数 → 写 `_this[字段]`"，保持不变）----

/** `0x80`（sub_41F690）：`_this[21631] = op1`（消息窗当前窗格/部件索引）。 */
const op_set_msgwin_part: OpHandler = (c) => {
  c.e.engineValues.set(21631, readIntOperand(c.e, c.frame, c.instr, 1));
};

/**
 * `0x7F`（sub_42D1F0 raw 39355）：`op1 = _this[21668]`（消息窗 α）。
 * ★该**字段**在启动时由 `message:MesWinAlpha` 灌入（见 `engineConfig.ts` 的 CONFIG_FIELD_BINDINGS），
 * 所以这里读字段而不是直接读配置表 —— 与 `0x131`（直读配置注册表）不同。
 */
const op_get_msgwin_alpha: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(21668) ?? 0);
};

/** `0x300`（sub_426990）：对象旗标 `_this[122466+v] |= op2`（保留 bit16）、`_this[122476+v] = op3`。 */
const op_msgwin_slot_flags: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  const flags = readIntOperand(e, c.frame, c.instr, 2);
  const value = readIntOperand(e, c.frame, c.instr, 3);
  const slot = v + 122466;
  e.engineValues.set(slot, (flags | ((e.engineValues.get(slot) ?? 0) & 0x10000)) | 0);
  e.engineValues.set(v + 122476, value);
};

/** `0x301`（sub_4269F0）：`_this[122486+v] = 0`；引擎随后调 `sub_404F80` 重算布局（未建模）。 */
const op_msgwin_slot_clear: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(v + 122486, 0);
  e.msgwin.object(v).f132 = 0; // sub_404F80 的清 `+132` 那一步
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
  // ---- 点击热点 / 路由表（决定「等待输入」如何结束）----
  [0x090, op_route_push],
  // ---- 消息窗字段 / 对象表 ----
  [0x7f, op_get_msgwin_alpha],
  [0x80, op_set_msgwin_part],
  [0x300, op_msgwin_slot_flags],
  [0x301, op_msgwin_slot_clear],
  [0x212, op_msgwin_obj_f100], // 对象 +100
  [0x213, op_msgwin_obj_range], // 对象 +104/+108
  [0x25d, op_msgwin_obj_range2], // 对象 +276/+280
];
