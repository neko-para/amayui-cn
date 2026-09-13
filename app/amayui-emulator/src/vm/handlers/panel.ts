/**
 * **A5（消息面 / 面板表面）**：`0x93` / `0x94` / `0x97`。
 *
 * 这三条作用在**面板对象**上（引擎 `Engine+0x55D8`，即 `_this + 5494` 的 dword 下标；
 * 该对象同时也是点击热点/路由表的宿主，见 `../route.ts`）。它们**都不回写脚本操作数**，
 * 但改的是 emulator 里**有读者**的状态：`effect_flags` 的位、面板的填充色/待填充标记、
 * 以及路由游标（`[7468]` = `RouteTable.cursor`）。
 *
 * ## 引擎实证（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 * | opcode | handler | 语义 |
 * |---|---|---|
 * | `0x93` | `sub_4191D0` raw 24589-24601 | `effect_flags &= ~0x800000`（清"消息面显示"位）→ `sub_403EF0(面板)` 复位面板游标态（`[258]=0`、`[959]=-1`、`[960]=0`、`[7464]=0`、`[7466]=0`、`[7467]=-1`、`[7468]=-1`）→ **toggle**：`Engine[12957] ? =0 : Engine[12956]=1` |
 * | `0x94` | `sub_419230` raw 24604-24609 | `Engine[12957] = 1`；`sub_404020(面板, 10000)`＝若已初始化（`[7465]`）则置填充色 `[960]=10000` + 待填充 `[7464]=1`，否则初始化并**按当前鼠标坐标重做一次命中测试**（`sub_403C50`） |
 * | `0x97` | `sub_420910` raw 29596-29612 | 5 操作数：矩形 `{op1, op2, op1+op3, op2+op4}` + 模式 `op5` → `sub_403D10(面板, rect, 模式)`（**填矩形**） |
 *
 * 语料：`i93`/`i94`/`i97` 在 941 个脚本里 **0 处**（只在引擎内部/未来语料用到），
 * 但它们是"面板表面"这套状态的唯一写入端 ⇒ 按复评台账 A5 实现，而不是当无依据的 no-op。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

/** 面板对象在 `_this` 里的基址（dword 下标）：`Engine+0x55D8` = `_this + 5494`。 */
export const PANEL_BASE = 5494;

/** 面板对象字段 → 引擎 dword 下标（`obj[k]` ⇒ `_this[PANEL_BASE + k]`）。 */
const F = (k: number): number => PANEL_BASE + k;

/** `0x93`（sub_4191D0 raw 24589）：清消息面显示位 + 复位面板游标态 + toggle `12956/12957`。 */
const op_message_surface_off: OpHandler = (c) => {
  const e = c.e;
  e.effectFlags &= ~0x800000;
  // `sub_403EF0(面板)`：复位游标/锁存字段（**不清**路由条目表本身）
  e.engineValues.set(F(258), 0);
  e.engineValues.set(F(959), -1);
  e.engineValues.set(F(960), 0);
  e.engineValues.set(F(7464), 0);
  e.engineValues.set(F(7466), 0);
  e.engineValues.set(F(7467), -1);
  e.routes.cursor = -1; // `[7468]`：命中游标（emulator 的 RouteTable.cursor）
  // toggle：引擎 `if (_this[12957]) _this[12957] = 0; else _this[12956] = 1;`
  if ((e.engineValues.get(12957) ?? 0) !== 0) e.engineValues.set(12957, 0);
  else e.engineValues.set(12956, 1);
};

/** `0x94`（sub_419230 raw 24604）：置显示标记 + 面板填充色（首次还会按鼠标重做命中测试）。 */
const op_message_surface_fill: OpHandler = (c) => {
  const e = c.e;
  e.engineValues.set(12957, 1);
  if ((e.engineValues.get(F(7465)) ?? 0) !== 0) {
    // 已初始化：只记填充色 + 待填充标记（引擎 `*(_DWORD*)(this+3840) = a2; *(this+29856) = 1;`）
    e.engineValues.set(F(960), 10000);
    e.engineValues.set(F(7464), 1);
    return;
  }
  // 未初始化：置标志后按**当前鼠标坐标**做一次命中测试（引擎 GetCursorPos + ScreenToClient + sub_403C50）
  e.engineValues.set(F(7465), 1);
  const x = e.input?.x ?? -100000;
  const y = e.input?.y ?? -100000;
  if (e.input?.hasCursor) e.routes.hitTest(x, y);
};

/** `0x97`（sub_420910 raw 29596）：面板填矩形（`rect = {op1, op2, op1+op3, op2+op4}`、模式 op5）。 */
const op_message_surface_rect: OpHandler = (c) => {
  const e = c.e;
  const x = readIntOperand(e, c.frame, c.instr, 1);
  const y = readIntOperand(e, c.frame, c.instr, 2);
  const w = readIntOperand(e, c.frame, c.instr, 3);
  const h = readIntOperand(e, c.frame, c.instr, 4);
  const mode = readIntOperand(e, c.frame, c.instr, 5);
  c.native.fillPanelRect?.(x, y, x + w, y + h, mode);
};

/** A5 的面板表面族（真实现）。 */
export const PANEL_OPS: OpTable = [
  [0x93, op_message_surface_off],
  [0x94, op_message_surface_fill],
  [0x97, op_message_surface_rect],
];
