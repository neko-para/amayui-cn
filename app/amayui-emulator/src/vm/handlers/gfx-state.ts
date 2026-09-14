/**
 * **A4 图元 / 网格 / 纹理 / 渲染状态族**（13 条，2026-09 落地）。
 *
 * 这一族在复评台账里的判据是「写有读者的引擎状态 / 改渲染状态」——语料用量很大：
 * `0x258` 11356 处、`0x238` 2056 处、`0x20E` 786 处、`0x229` 716 处、`0x224` 334 处、`0x242` 350 处。
 * 它们此前一律是 `ENGINE_INTERNAL_OPS` 的纯 no-op（或 `STUB_NATIVE_OPS` 的记录式桩）。
 *
 * 实现分两档（与全项目口径一致：**能建模的建模、纯渲染侧的走宿主缝**）：
 *
 * | opcode | handler | 引擎做的事 | emulator |
 * |---|---|---|---|
 * | `0x238` | `sub_4248C0` raw 32303-32312 | `Engine[92338] = 0`、`Engine[92339] = op1` | **建模**：写 `engineValues` |
 * | `0x258` | `sub_425D20` raw 33156-33185 | 按 op2 的 bit0/bit1 写纹理槽记录的两张镜像表（`Scene+1872+20*slot` / `+21872+20*slot`） | **建模**：`Engine.texSlotFlags` |
 * | `0x1FC` | `sub_422F80` raw 31303-31310 | `sub_4AC470(Scene, op1)`：复位该 DrawItem 的变换字段（+104/+132..+164 清零） | 宿主缝 `resetPrimTransform` |
 * | `0x1FE` | `sub_423060` raw 31330-31345 | 读 op2..op5 **4 个 float**（不除 100）→ `sub_4AC660(Scene, op1, …)` | 宿主缝 `setPrimTransform4` |
 * | `0x207` | `sub_423480` raw 31494-31521 | `sub_4A3980(Scene, op1 槽, op2 槽, src[4], dst[4])`（源/目标同尺寸矩形） | 宿主缝 `blitSlotToSlot` |
 * | `0x20E` | `sub_41A200` raw 25277-25287 | `sub_4A50C0(Scene, 0x26)` → `sub_498B60`（设备 `Clear(0,0,3,0,1.0,0)`）→ `sub_4A50C0(Scene, -1)` → `sub_498B60` | 宿主缝 `commitGraphics` |
 * | `0x224` | `sub_41A290` raw 25301-25305 | `sub_4AA180(Scene)` → `sub_4A9BE0(Scene+1048)`：清转场表 | 宿主缝 `clearTransitions` |
 * | `0x229` | `sub_423FE0` raw 31984-32001 | `sub_49A690` 复位 + `sub_49A6C0(op1, op2)` + `sub_49A6F0(f3,f4,f5)`（Scene[278/279]、[286..288]） | 宿主缝 `setDrawModeBlock` |
 * | `0x242` | `sub_4251A0` raw 32649-32658 | `sub_4AD9A0(Scene, op1, op2)`：写 DrawItem `+720` 与相邻对象 `+504` | 宿主缝 `setDrawEntryParam` |
 * | `0x256` | `sub_425C30` raw 33120-33135 | `sub_4ACD10(Scene, op1, op2, f3,f4,f5)`：按 id 找 DrawItem 后写字段 | 宿主缝 `setSlotParams` |
 * | `0x321` | `sub_426BD0` raw 33839-33850 | `sub_4AE280(Scene, op1, op2, op3)`：MeshEntry `a3 + 7` 槽 = op3 | 宿主缝 `setMeshEntryAttr` |
 * | `0x32A` | `sub_426F80` raw 34003-34010 | `sub_4A0750(Scene, op1)`：3D 模型槽析构 + delete + 置 0 | 宿主缝 `release3DSlot` |
 * | `0x32D` | `sub_427040` raw 34033-34054 | 颜色组装（op1 截断为 alpha、op2 低 3 字节为 RGB，各 ÷255）→ `sub_499DF0(Scene, r,g,b,a)` | 宿主缝 `set3DColor` |
 *
 * 说明：A4 的 11 条渲染侧指令**不会**改脚本操作数、也不改控制流（那两条建模的也不回写操作数），
 * 因此它们从 VM 视角不可观测；建模/转发的意义是"emulator 侧的渲染模型与引擎一致"，
 * 且从此不再以"无依据的 no-op"出现在 stub 台账里。
 */
import type { OpHandler } from '../step.js';
import { readFloatOperand, readIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

/** `0x238`（sub_4248C0 raw 32303-32312）：`Engine[92338]=0`、`[92339]=op1`（画布/视口尺寸对）。 */
const op_set_canvas_size: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(92338, 0);
  e.engineValues.set(92339, v);
};

/** `0x258`（sub_425D20 raw 33156-33185）：纹理槽标志对（bit0/bit1 各写两张镜像表）。 */
const op_set_slot_flags: OpHandler = (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  const flags = readIntOperand(e, c.frame, c.instr, 2);
  e.texSlotFlags.set(slot, flags & 0x3);
};

/** `0x1FC`（sub_422F80）：复位图元的变换（DrawItem 的缩放/旋转/平移字段清零）。 */
const op_reset_prim_transform: OpHandler = (c) => {
  const e = c.e;
  const handle = readIntOperand(e, c.frame, c.instr, 1);
  c.native.resetPrimTransform?.(handle);
};

/** `0x1FE`（sub_423060）：图元变换 4 浮点（op2..op5 **原样**，与 0x1FD 的 ÷100 不同）。 */
const op_prim_transform4: OpHandler = (c) => {
  const e = c.e;
  const handle = readIntOperand(e, c.frame, c.instr, 1);
  const a = readFloatOperand(e, c.frame, c.instr, 2);
  const b = readFloatOperand(e, c.frame, c.instr, 3);
  const d = readFloatOperand(e, c.frame, c.instr, 4);
  const f = readFloatOperand(e, c.frame, c.instr, 5);
  c.native.setPrimTransform4?.(handle, a, b, d, f);
};

/** `0x207`（sub_423480 raw 31494-31521）：槽→槽 StretchRect（源/目标矩形同尺寸）。 */
const op_blit_slot_to_slot: OpHandler = (c) => {
  const e = c.e;
  const src = readIntOperand(e, c.frame, c.instr, 1);
  const dst = readIntOperand(e, c.frame, c.instr, 2);
  const x = readIntOperand(e, c.frame, c.instr, 3);
  const y = readIntOperand(e, c.frame, c.instr, 4);
  const w = readIntOperand(e, c.frame, c.instr, 5);
  const h = readIntOperand(e, c.frame, c.instr, 6);
  const dx = readIntOperand(e, c.frame, c.instr, 7);
  const dy = readIntOperand(e, c.frame, c.instr, 8);
  // 引擎：src = {op3, op4, op3+op5, op4+op6}、dst = {op7, op8, op7+op5, op8+op6}
  c.native.blitSlotToSlot?.(src, dst, [x, y, x + w, y + h], [dx, dy, dx + w, dy + h]);
};

/** `0x20E`（sub_41A200 raw 25277-25287）：图形提交（渲染状态 38 包裹 + 设备 Clear）。 */
const op_commit_graphics: OpHandler = (c) => {
  const e = c.e;
  // 引擎：`if (Engine[80684] == 1 && Engine[92322] == -1)` 才做状态包裹，但**两条路径都会**调 `sub_498B60`。
  c.native.commitGraphics?.();
  void e;
};

/** `0x224`（sub_41A290 raw 25301-25305）：清转场表。 */
const op_clear_transitions: OpHandler = (c) => {
  c.native.clearTransitions?.();
};

/** `0x229`（sub_423FE0 raw 31984-32001）：绘制模式 5 元组（2 int + 3 float）。 */
const op_set_draw_mode: OpHandler = (c) => {
  const e = c.e;
  const a = readIntOperand(e, c.frame, c.instr, 1);
  const b = readIntOperand(e, c.frame, c.instr, 2);
  const x = readFloatOperand(e, c.frame, c.instr, 3);
  const y = readFloatOperand(e, c.frame, c.instr, 4);
  const z = readFloatOperand(e, c.frame, c.instr, 5);
  c.native.setDrawModeBlock?.(a, b, x, y, z);
};

/** `0x242`（sub_4251A0 raw 32649-32658）：写 DrawItem `+720`（与相邻对象的 `+504`）。 */
const op_set_draw_entry_param: OpHandler = (c) => {
  const e = c.e;
  const entry = readIntOperand(e, c.frame, c.instr, 1);
  const value = readIntOperand(e, c.frame, c.instr, 2);
  c.native.setDrawEntryParam?.(entry, value);
};

/**
 * `0x256`（sub_425C30 raw 33120-33135）→ `sub_4ACD10`（raw 131733）：
 * **按 id 区间做立即平移** —— `op1` = 起始 handle、`op2` = **count**（区间 `[op1, op1+op2)`）、
 * `op3/4/5` = 平移 x/y/z（float）。引擎对区间内**已存在**的绘制项执行
 * `+0x68 = 1`（用世界矩阵）+ `D3DXMatrixTranslation(+0x16C, …)`（写 **work** 矩阵，立即生效）+ 置脏。
 *
 * ★不是"随便写几个字段"：`DRAWCHARM.txt:182-186` 用它把收起态的侧边栏 21 个槽整体推 +0x6e
 *   （= 唯一的"收起摆位"手段）。宿主缝 `setSlotParams` 必须真的应用平移，见 `tickets/T-0028`。
 */
const op_set_slot_params: OpHandler = (c) => {
  const e = c.e;
  const handle = readIntOperand(e, c.frame, c.instr, 1);
  const count = readIntOperand(e, c.frame, c.instr, 2);
  const x = readFloatOperand(e, c.frame, c.instr, 3);
  const y = readFloatOperand(e, c.frame, c.instr, 4);
  const z = readFloatOperand(e, c.frame, c.instr, 5);
  c.native.setSlotParams?.(handle, count, x, y, z);
};

/** `0x321`（sub_426BD0 raw 33839-33850）：MeshEntry 属性（`entry[op2 + 7] = op3`）。 */
const op_set_mesh_entry_attr: OpHandler = (c) => {
  const e = c.e;
  const mesh = readIntOperand(e, c.frame, c.instr, 1);
  const index = readIntOperand(e, c.frame, c.instr, 2);
  const value = readIntOperand(e, c.frame, c.instr, 3);
  c.native.setMeshEntryAttr?.(mesh, index, value);
};

/** `0x32A`（sub_426F80 raw 34003-34010）：释放 3D 模型槽。 */
const op_release_3d_slot: OpHandler = (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  c.native.release3DSlot?.(slot);
};

/**
 * `0x32D`（sub_427040 raw 34033-34054）：**3D 颜色**。
 *
 * 引擎：`v2 = min(op1, 255)`（alpha）、`v3 = op2`（RGB，低 3 字节），
 * 组装后按四个字节各乘 `dbl_51FA60`（= 1/255）取 `(r,g,b,a)` 四个 float 调 `sub_499DF0(Scene, …)`。
 */
const op_set_3d_color: OpHandler = (c) => {
  const e = c.e;
  const a = readIntOperand(e, c.frame, c.instr, 1);
  const rgb = readIntOperand(e, c.frame, c.instr, 2);
  const alpha = (a > 255 ? 255 : a & 0xff) / 255;
  c.native.set3DColor?.(((rgb >>> 0) & 0xff) / 255, ((rgb >>> 8) & 0xff) / 255, ((rgb >>> 16) & 0xff) / 255, alpha);
};

/** A4 族（真实现：2 条建模 + 11 条宿主缝）。 */
export const GFX_STATE_OPS: OpTable = [
  [0x1fc, op_reset_prim_transform], // 复位图元变换
  [0x1fe, op_prim_transform4], // 图元变换 4 浮点
  [0x207, op_blit_slot_to_slot], // 槽→槽 StretchRect
  [0x20e, op_commit_graphics], // 图形提交（Clear）
  [0x224, op_clear_transitions], // 清转场表
  [0x229, op_set_draw_mode], // 绘制模式 5 元组
  [0x238, op_set_canvas_size], // Engine[92338]/[92339]（建模）
  [0x242, op_set_draw_entry_param], // DrawItem +720
  [0x256, op_set_slot_params], // 按 id 写 DrawItem 字段
  [0x258, op_set_slot_flags], // 纹理槽标志对（建模）
  [0x321, op_set_mesh_entry_attr], // MeshEntry 属性
  [0x32a, op_release_3d_slot], // 释放 3D 模型槽
  [0x32d, op_set_3d_color], // 3D 颜色
];
