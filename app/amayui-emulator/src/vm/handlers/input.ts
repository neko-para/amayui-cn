/**
 * 鼠标/键盘/手柄输入子系统 opcode（语义见 `docs/re/engine/` 输入系统篇 + src/vm/input.ts）。
 *
 * 两套 bit 位**不可混用**（见 input.ts 顶部注释）：
 *  - `readButtons()`（0x108）用 bit0=左 / bit1=右；
 *  - `flush()` 生成的输入掩码（0x100/0x101）用 bit4=鼠标左 / bit5=鼠标右 / bit(4+i)=手柄 i。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, operandArg, refFromOperand } from '../operand.js';
import { readRef, refAt } from '../ref.js';
import { labelPos } from './shared.js';
import type { OpTable } from './shared.js';

// ---- 鼠标/输入子系统 opcodes（已读 handler 体；语义见 ../docs-new/03-engine/input-system.md）----

/** `read-mouse-button` (0x108, sub_42EDC0)：`op1 = 鼠标按钮值`。bit0=左、bit1=右（sub_477220 约定）。 */
const op_read_mouse_button: OpHandler = (c) => {
  const b = c.e.input.readButtons();
  writeIntOperand(c.e, c.frame, c.instr, 1, b);
};

/** `read-mouse-pos` (0x109, sub_42EE10)：`op1=X, op2=Y`（虚拟坐标；未初始化/出窗 = -100000）。 */
const op_read_mouse_pos: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.readX());
  writeIntOperand(c.e, c.frame, c.instr, 2, c.e.input.readY());
};

/**
 * `read-mouse-wheel` (0x10D, sub_42EF50)：**读鼠标滚轮增量（一次性消费）** → `op1`。
 * 引擎体（raw 39114-39122，本工程分析见 analysis/functions.json 的 op_read_mouse_wheel_42EF50）：
 *   `_this[30*cur+95805]=3;  v2 = _this[1949];  _this[1949] = 0;  writeIntOperand(1, v2);`
 * 即：取 `mouse_wheel_residual`(0x1E74) → **立即清零** → 写 op1。
 * 值语义：自上次读取以来 WM_MOUSEWHEEL 的增量累计（引擎单位：一格 ±120，**上滚正/下滚负**）。
 * 脚本用法（40+ 菜单/列表）：进入时 `read-mouse-wheel` 丢弃残量，主循环反复 `read-mouse-wheel` + `jcc (local) <翻页label>`
 *   → 非 0 即翻页；`gr (local 403) 0` 区分上/下滚（src/$3$AGENCY.txt:258/283/548）。
 * ⚠️与消息泵耦合：引擎的 ADV 推进分支（raw 13938）读同一累加器且**仅 <0（下滚）**才推进文本；
 *   脚本先 read-mouse-wheel 取走 ⇒ 累加器归零 ⇒ 泵侧不再推进（"脚本优先接管滚轮"）。
 *   emulator 的 0xCD get-input-type 走的是「时间节流/ADV 激活」而非滚轮值（见 input.getInputType 注释），
 *   故此处不做泵侧联动；若日后要让滚轮推进 ADV 文本，应在那里按 `<0` 消费。
 */
const op_read_mouse_wheel: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.consumeWheelDelta());
};

/** `mouse-callback` (0xCC, sub_421980)：注册鼠标跳转目标。op2=label。 */
const op_mouse_callback: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const target = operandArg(c.instr, 2).raw; // label 值（与 jmp/call 同尺度）
  c.e.input.mouseSlot = slot;
  c.e.input.mouseJump = target;
};

/** 0xFB (joy_callback, sub_421B80)：注册手柄跳转目标 op2。op1∈[0,32)。 */
const op_joy_callback: OpHandler = (c) => {
  const btn = readIntOperand(c.e, c.frame, c.instr, 1);
  if (btn < 0 || btn >= 32) throw new Error(`joy_callback: 按钮 ${btn} 越界 [0,32)`);
  const target = operandArg(c.instr, 2).raw;
  c.e.input.joyJump[btn] = target;
};

/** 0xFF (u00415A10, sub_419A90)：重置掩码并重刷当前按住态（键盘+鼠标），重置扫描游标。 */
const op_input_reset: OpHandler = (c) => {
  // 引擎：_this[174802]=0; sub_4780D0(键盘+鼠标)；emulator 简化为按当前按住态重建掩码
  c.e.input.flush();
};

/** 0x100 (u00415A60, sub_419AF0)：消息跳读/按键推进派发。扫掩码最低位、按注册表跳转。 */
const op_input_dispatch: OpHandler = (c) => {
  const mask = c.e.input.flush();
  if (mask === 0) return; // 无输入，落回
  let b = 0;
  while (((mask >> b) & 1) === 0) b++;
  // 鼠标位（4/5）→ 鼠标目标；否则按 joy 表（掩码位 = 4 + buttonIndex，故用 b-4）
  const t =
    (b === 4 || b === 5) && c.e.input.mouseJump !== -1
      ? c.e.input.mouseJump
      : c.e.input.joyJump[b - 4] ?? -1;
  if (t === -1 || t === 0xffffffff) return;
  const p = labelPos(c.frame, t);
  if (p !== null) {
    c.e.input.consumeEdges();
    c.jump(p);
  }
};

/** 0x101 (poll-input, sub_419CC0)：刷掩码后复位（清待处理输入）。 */
const op_poll_input: OpHandler = (c) => {
  c.e.input.flush();
  c.e.input.consumeEdges();
};

/** 0xCD (get-input-type, sub_41ACD0)：消息/ADV"点击推进"门。
 * 引擎：`if (now - lastAdvance >= throttle || adv_active)` 才推进（throttle=_this[429812]，adv_active=effect_flags&0x8000000）。
 * **核实：`_this[429812]` 全工程无写入 → bss 0 → 条件恒真 → 引擎 get-input-type 实际不节流（始终推进）**；
 *   emulator 旧 200ms 节流会引入 ~200ms 输入迟滞，故 advanceThrottle=0（见 input.ts）。
 * 推进即：压返回地址 + CALL 注册的 mouseJump 目标（handler 的 ret 回到循环）。**不读/不消费鼠标移动或按下沿**；
 * 未注册目标(==-1/0xFFFFFFFF) → 原地不跳。emulator 旧实现"有鼠标移动/按下才触发"为错。 */
const op_get_input_type: OpHandler = (c) => {
  const input = c.e.input;
  const target = input.getInputType(c.e.nowMs, c.e.advActive);
  if (target === null) return; // 未到节流/未激活/未注册 → 不推进（也不动鼠标/手把边沿）
  const p = labelPos(c.frame, target);
  if (p === null) return;
  c.frame.retStack.push(c.frame.ip + 1); // 压返回地址：handler 的 ret 回到循环下一条
  c.jump(p);
};

/**
 * 0x2FC (sub_431BA0)：读**触摸/手势触点** + 虚拟坐标。
 * 引擎：sub_477980(_this+258,&Point,&a3,&a4) 从**触摸/手势缓冲**取触点（非 GetCursorPos）→ 有触点写 op1=1、op2=虚屏X、op3=虚屏Y、
 *   op4=触点旗标(v9[4]=dwFlags)、op5=触点项[3](v9[3]=dwID)；**无触点写 op1=0**，handler 随即落回 read-mouse-pos/read-mouse-button 读**光标**。
 * emulator：只建模【鼠标光标】，**没有触摸/手势触点缓冲**；故**恒 op1=0（无触点）**——坐标/按钮由 label_0000047c 里的 read-mouse-pos/read-mouse-button
 * （读光标位置/按钮）提供，从而不误把光标当"触点按下"（引擎桌面鼠标下 0x2FC 返回 0）。 */
const op_get_mouse_state: OpHandler = (c) => {
  const im = c.e.input;
  im.touchId = 0; // 无触点（dwID=0）
  // 无触点：仅写 op1=0。坐标/按钮由后续 read-mouse-pos(光标X/Y) + read-mouse-button(按钮) 提供（TITLE label_0000047c 的 no-touch 分支）。
  // 注意：不要把「光标存在」当「触点存在」——那会误置 local 3f2=1(左键恒按下)，破坏 hover 高亮/回退。
  writeIntOperand(c.e, c.frame, c.instr, 1, 0);
  writeIntOperand(c.e, c.frame, c.instr, 2, im.readX());
  writeIntOperand(c.e, c.frame, c.instr, 3, im.readY());
  writeIntOperand(c.e, c.frame, c.instr, 4, 0); // 无触点旗标
  writeIntOperand(c.e, c.frame, c.instr, 5, 0); // 无触点 dwID
};

/**
 * 0x12E (u0041E940, sub_42F230)：鼠标悬停命中（point-in-rect），**几何完全来自脚本数据**。
 * 引擎：op2=margin 数组、op3=x、op4=y、op5=size 盒数组（每项 4 值 dx0/dx1/dy0/dy1）、op6=base X 数组、op7=base Y 数组、op8=count。
 * 逐项判定：`dx0 <= (x - baseX[i]) <= dx1 && dy0 <= (y - baseY[i]) <= dy1` → 命中项 i（写回 op1），否则 -1。
 * 实例（TITLE `u0041E940(local3f5)(local1)(local3f0)(local3f1)(localcd)(local5)(local69)(local0)`）：
 *   baseX=local5[i]、baseY=local69[i]、size=local cd/d1/d5/d9/dd（每项 [0,0x9c,0,0x9c]）、count=local0=5。
 * 说明：不在此模拟/写死任何按钮坐标；命中矩形完全由脚本的数据数组决定。
 */
const op_hover_hittest: OpHandler = (c) => {
  const x = readIntOperand(c.e, c.frame, c.instr, 3);
  const y = readIntOperand(c.e, c.frame, c.instr, 4);
  const count = readIntOperand(c.e, c.frame, c.instr, 8);
  const sizeRef = refFromOperand(c.e, c.frame, c.instr, 5); // size 盒数组
  const bxRef = refFromOperand(c.e, c.frame, c.instr, 6); // base X 数组
  const byRef = refFromOperand(c.e, c.frame, c.instr, 7); // base Y 数组
  let idx = -1;
  for (let i = 0; i < count; i++) {
    const r = i * 4;
    const dx0 = readRef(c.e, c.frame, refAt(sizeRef, r + 0));
    const dx1 = readRef(c.e, c.frame, refAt(sizeRef, r + 1));
    const dy0 = readRef(c.e, c.frame, refAt(sizeRef, r + 2));
    const dy1 = readRef(c.e, c.frame, refAt(sizeRef, r + 3));
    const bx = readRef(c.e, c.frame, refAt(bxRef, i));
    const by = readRef(c.e, c.frame, refAt(byRef, i));
    const px = x - bx;
    const py = y - by;
    if (px >= dx0 && px <= dx1 && py >= dy0 && py <= dy1) {
      idx = i;
      break;
    }
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, idx);
};

/** 鼠标/键盘/手柄输入（真实现：读操作数 / 注册跳转目标 / 派发）。 */
export const INPUT_OPS: OpTable = [
  [0x108, op_read_mouse_button], // read-mouse-button：读鼠标按钮值 → op1
  [0x109, op_read_mouse_pos], // read-mouse-pos：读鼠标位置 → op1=X, op2=Y
  [0x10d, op_read_mouse_wheel], // read-mouse-wheel：读鼠标滚轮增量（一次性消费）→ op1
  [0xcc, op_mouse_callback],
  [0xfb, op_joy_callback],
  [0xff, op_input_reset],
  [0x100, op_input_dispatch],
  [0x101, op_poll_input],
  [0x2fc, op_get_mouse_state],
  [0xcd, op_get_input_type],
  [0x12e, op_hover_hittest], // u0041E940 悬停命中（mouse hover highlight）
];

