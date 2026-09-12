/**
 * 菜单派发（引擎 `_this+107679` 的字符串哈希表）。
 *
 * TITLE 用**菜单项序号**（-1/0/1/2/3/4）为键，故 0xA2/0xA3 取 op1 的 DEC 值再字符串化
 * （不能用 `readStringOperand`：它对 local-int 会返回局部下标，是既有 bug）。
 *
 * ★**这三条是纯 VM 状态，不需要宿主**：表就是 `Engine.menuMap`，查表跳转（0xA3）也在本文件里完成。
 * 旧实现在这里还 `c.native.menuReset?.()/menuBind?.()` 通知宿主一句 —— 而宿主（PixiBackend）本就没有
 * 对应子系统、方法恒缺失 ⇒ 被 `withNativeTap`（闸门 A）记成"意图被丢弃"，控制面板于是显示
 * 「menuBind/menuReset 没有实现」的**假缺口**（2026-09 用户实测）。宿主确实无事可做：
 * 菜单项由脚本自己画（`set-font`/`draw-string`），宿主只认文本/绘制指令。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand } from '../operand.js';
import { labelPos } from './shared.js';
import type { OpTable } from './shared.js';

/** 0xA1 (sub_433A40)：菜单派发表复位。`sub_415530(_this+107679, 0xFFF)` 清空菜单字符串哈希表(容量 0xFFF)。 */
const op_menu_reset: OpHandler = (c) => {
  c.e.menuMap.clear();
};

/** 0xA2 (sub_434F10)：登记菜单项 key→label。读 op1(键)+op2(值=目标 label) → `sub_434D00(_this+107679, key, &value)` 插入哈希表。
 *  引擎以字符串(sub_41B640)读 key；TITLE 用菜单项序号(-1/0/1/2/3/4)为键 → emulator 取 op1 的 **DEC 值**再字符串化（不能用
 *  readStringOperand，其对 local-int 会返回局部下标，是既有 bug）。 */
const op_menu_bind: OpHandler = (c) => {
  const key = String(readIntOperand(c.e, c.frame, c.instr, 1));
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  c.e.menuMap.set(key, value);
};

/** 0xA3 (sub_429830)：按 key 查表派发。`sub_428E00(_this+107679, key)` 查；命中 `ip=str_table+4*值`(跳转)，未命中 `ip=str_table+4*op2`(回退 label)。等效 jmp 到目标指令。 */
const op_menu_dispatch: OpHandler = (c) => {
  const key = String(readIntOperand(c.e, c.frame, c.instr, 1));
  const fallback = readIntOperand(c.e, c.frame, c.instr, 2);
  const target = c.e.menuMap.get(key) ?? fallback;
  const p = labelPos(c.frame, target);
  if (p === null) return;
  c.jump(p);
};

/** 菜单派发（0xA1 复位 / 0xA2 登记 key→label / 0xA3 查表跳转）。 */
export const MENU_OPS: OpTable = [
  [0xa1, op_menu_reset],
  [0xa2, op_menu_bind],
  [0xa3, op_menu_dispatch],
];

