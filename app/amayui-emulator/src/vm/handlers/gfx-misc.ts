/**
 * 图形子系统的「其余」：灯光 / Live2D 槽 / movie 槽 / 网格槽表 / 渲染状态 / 帧刷新配置。
 *
 * 这些在 emulator 里没有对应的可视模型（无 3D 灯光、无 Live2D、无影片），
 * 但仍按引擎语义**读写 emulator 侧的槽表与渲染配置**，所以不算 no-op 插桩。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

/**
 * `0x32F`（sub_4272B0, raw 34117）：**D3D 灯光开关**（原判为"网格项清除"是错的）。
 * 引擎：读 op1 = **灯光索引 0..9** → `sub_49A150(Scene, idx)`：
 * `light_enabled[idx] = 0`（Scene+54708+4·idx）+ 设备 vtable+212 = `LightEnable(idx, FALSE)`。
 * 同族 `sub_49A080` = `SetLight`（vtable+204，填 0x68 字节 D3DLIGHT9）。
 * emulator 无灯光模型 → 记录式转发（不影响 2D 图元绘制）。
 */
const op_light_enable: OpHandler = (c) => {
  const idx = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.setLight?.(idx, false);
};

/**
 * `0x342`（sub_427C70, raw 34491）：**销毁 Live2D 模型实例槽**（不是"释放图形资源槽"）。
 * 引擎：读 op1 → `sub_4A1A60(Scene, op1)`：`v3 = objects[op1]`（Scene+55812+4·op1，10 槽），
 * 非空则 `sub_4785E0`（槽对象析构：释放纹理/子对象）+ `operator delete` + 置 0。
 */
const op_destroy_l2d_slot: OpHandler = (c) => {
  const slotIdx = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.destroyL2DSlot?.(slotIdx);
};

/**
 * `0x352`（sub_4283B0, raw 34780）：**Live2D 槽参数设置**（原判为"图形子系统"过泛）。
 * 引擎：读 op1=槽号(0..9)、op2、op3 → `sub_4A1AC0(Scene, op1, op2, op3)`：
 * `v4 = objects[op1]`，按 op2 选 `sub_478540`（置**待纹理 ID**：标志 +24、值 +28）
 * 或 `sub_478560`（置**待动作 ID**：标志 +25、值 +32）。
 */
const op_l2d_slot_set: OpHandler = (c) => {
  const slotIdx = readIntOperand(c.e, c.frame, c.instr, 1);
  const sel = readIntOperand(c.e, c.frame, c.instr, 2);
  const value = readIntOperand(c.e, c.frame, c.instr, 3);
  c.native.l2dSlotSet?.(slotIdx, sel, value);
};

/**
 * `0x23D`（sub_41A300, raw 25320）：**销毁 movie/纹理槽 42..999**（958 次循环）。
 * 对 `Engine+4*(94714+k)`（CMovieToTexture 族）调 `sub_488FB0` + vtable[0](obj,1) 析构，
 * 并对 Scene 调 `sub_49E980(Scene, i)` 卸对应网格/纹理槽。
 * ⇒ **会让引用这些槽的图元不再绘制**（是"合法的整批释放"，不是停靠标志）。
 */
const op_release_movie_slots: OpHandler = (c) => {
  c.native.releaseMovieSlots?.();
};

/**
 * `0x32B`（sub_41A4A0, raw 25411）：**清 D3DX 网格层级槽表**（Scene+50708 区，1000 槽）。
 * 引擎经 `sub_4A0750 → sub_479A50` + delete 逐项释放（与 0x23D、0x259 都不同族）。
 */
const op_clear_mesh_slots: OpHandler = (c) => {
  c.native.clearMeshSlots?.();
};

/** `0x248`（sub_4252E0, raw 32705）：`dword_55052C = op1`（渲染配置全局）。 */
const op_set_render_cfg_248: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(-248, v); // 负键：专用全局槽（非 _this 字段），避免与引擎字段号冲突
};

/**
 * **`0x259`（sub_41A3A0, raw 25357）：清两张 1000×2 组 5-DWORD 记录表**（`Engine+86176` 起、步长 5 dword，
 * 每项写 +8/+12；对应主/影数组 `+81176`/`+86176`），共 4000 dword = 16 KB。**只清记录、不 delete 对象**
 * （旧文档把它当"纹理槽释放"是错的；真正销毁 42..999 的是 `0x23D`）。
 */
const op_clear_slot_records: OpHandler = (c) => {
  c.native.clearSlotRecords?.();
};

/**
 * **`0x340`（sub_427B60 → `sub_49A2D0`, raw 34457）：渲染状态下发**。
 * 引擎：写渲染状态槽 `Scene+13948`（默认 3）并向设备 vtable+228 发 `(22, op1)`（渲染状态 #22）。
 */
const op_set_render_state: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.setRenderState?.(22, v);
};

const op_play_movie: OpHandler = (c) => {
  // 0x20F：op1=movieId。
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.playMovie?.(id);
};

/** 图形子系统的槽表/渲染配置（真实现）。 */
export const GFX_MISC_OPS: OpTable = [
  [0x23d, op_release_movie_slots], // 销毁 movie/纹理槽 42..999
  [0x32b, op_clear_mesh_slots], // 清 D3DX 网格层级槽表
  [0x259, op_clear_slot_records], // 清两张 1000×2 记录表（不 delete）
  [0x248, op_set_render_cfg_248], // dword_55052C = op1（渲染配置全局）
  [0x32f, op_light_enable], // D3D 灯光开关（LightEnable）
  [0x340, op_set_render_state], // 渲染状态下发（设备 vtable+228）
  [0x342, op_destroy_l2d_slot], // 销毁 Live2D 模型实例槽
  [0x352, op_l2d_slot_set], // Live2D 槽参数（待纹理 ID / 待动作 ID）
];

/** 图形子系统的 native 转发。 */
export const GFX_MISC_NATIVE_OPS: OpTable = [
  [0x20f, op_play_movie], // → native.playMovie
];

