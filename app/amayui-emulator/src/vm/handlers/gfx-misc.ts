/**
 * 图形子系统的「其余」：灯光 / Live2D 槽 / movie 槽 / 网格槽表 / 渲染状态 / 帧刷新配置。
 *
 * 这些在 emulator 里没有对应的可视模型（无 3D 灯光、无 Live2D、无影片），
 * 但仍按引擎语义**读写 emulator 侧的槽表与渲染配置**，所以不算 no-op 插桩。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 批次：图形杂项族（gfx-misc），6 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：图形杂项族（gfx-misc）走操作数计划层，但没有声明计划`);
  return p;
}


/**
 * `0x32F`（sub_4272B0, raw 34117）：**D3D 灯光开关**（原判为"网格项清除"是错的）。
 * 引擎：读 op1 = **灯光索引 0..9** → `sub_49A150(Scene, idx)`：
 * `light_enabled[idx] = 0`（Scene+54708+4·idx）+ 设备 vtable+212 = `LightEnable(idx, FALSE)`。
 * 同族 `sub_49A080` = `SetLight`（vtable+204，填 0x68 字节 D3DLIGHT9）。
 * emulator 无灯光模型 → 记录式转发（不影响 2D 图元绘制）。
 */
const op_light_enable: OpHandler = (c) => {
  const plan = planFor(c);
  const idx = (plan.int(1) ?? 0);
  c.native.setLight?.(idx, false);
};

/**
 * `0x23D`（sub_41A300, raw 25320）：**销毁 movie/纹理槽 42..999**（958 次循环）。
 * 对 `Engine+4*(94714+k)`（CMovieToTexture 族）调 `sub_488FB0` + vtable[0](obj,1) 析构，
 * 并对 Scene 调 `sub_49E980(Scene, i)` 卸对应网格/纹理槽。
 * ⇒ **会让引用这些槽的图元不再绘制**（是"合法的整批释放"，不是停靠标志）。
 */
const op_release_movie_slots: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.releaseMovieSlots?.();
};

/**
 * `0x32B`（sub_41A4A0, raw 25411）：**清 D3DX 网格层级槽表**（Scene+50708 区，1000 槽）。
 * 引擎经 `sub_4A0750 → sub_479A50` + delete 逐项释放（与 0x23D、0x259 都不同族）。
 */
const op_clear_mesh_slots: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.clearMeshSlots?.();
};

/** `0x248`（sub_4252E0, raw 32705）：`dword_55052C = op1`（渲染配置全局）。 */
const op_set_render_cfg_248: OpHandler = (c) => {
  const plan = planFor(c);
  const v = (plan.int(1) ?? 0);
  c.e.engineValues.set(-248, v); // 负键：专用全局槽（非 _this 字段），避免与引擎字段号冲突
};

/**
 * **`0x259`（sub_41A3A0, raw 25357）：复位「每槽记录的标志两位」**（主/影两张镜像表，1000 槽全覆盖）。
 *
 * 引擎体逐位（raw 25357-25374）：
 * ```c
 * result = _this + 86176;              // Engine+344704 = 影表记录的 [+8]
 * v2 = 1000;
 * do {
 *   *(result - 5000) = 0;   // Engine+324704 = Scene+0x750 = tex_slot_flag_a（0x258 的 bit0 位）
 *   *result = 0;            // Engine+344704 = 影表同一格
 *   *(result - 4999) = 0;   // Engine+324708 = Scene+0x754 = tex_slot_flag_b（0x258 的 bit1 位）
 *   result[1] = 0;          // Engine+344708 = 影表同一格
 *   result += 5;            // 步长 5 dword = 20 B/槽
 *   --v2;
 * } while ( v2 );
 * ```
 * `Scene+20*slot` 的 dword 468/469 正是 `0x258`（`sub_425D20` raw 33156-33185）按 op2 的
 * bit0/bit1 写的那两格（`fields.json` 的 `Scene/0x750`/`Scene/0x754`）。
 * ⇒ **`0x259` 是 `0x258` 的整表复位器**：它**不碰** imgid（`Scene/0x748`，`0x1F9` 写）
 * 、也不碰槽对象（`Scene+4*slot+42456`）。旧注"清**前两个** dword / 清 imgid"是**错的**
 * （`tickets/T-0102` 订正：那条口径让 emulator 抹掉了槽 17 的绑定 ⇒ ADV 窗口回落 1×1 白占位块）。
 * 真正销毁 42..999 槽对象的是 `0x23D`。
 */
const op_clear_slot_records: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.texSlotFlags.clear(); // 引擎清的就是「按槽设置的标志两位」（0x258 写入、此处整表归零）
  c.native.clearSlotRecords?.();
};

/**
 * **`0x340`（sub_427B60 → `sub_49A2D0`, raw 34457）：渲染状态下发**。
 * 引擎：写渲染状态槽 `Scene+13948`（默认 3）并向设备 vtable+228 发 `(22, op1)`（渲染状态 #22）。
 */
const op_set_render_state: OpHandler = (c) => {
  const plan = planFor(c);
  const v = (plan.int(1) ?? 0);
  c.native.setRenderState?.(22, v);
};

const op_play_movie: OpHandler = (c) => {
  // `0x20F`（`sub_4237B0` raw 31604-31670；arity 槽 = 7 ⇒ argc=3）：
  //   op1 = 影片资源 id、op2 = **影片槽**（`[4*slot+378688]` 的对象表）、op3 = **音量/模式选择子**。
  // ★此前只读 op1（op2/op3 被丢弃）—— 审计 P3 的「凭空/错读」条目（守卫 `test/opcode-operands.test.ts` 也据此报红）。
  //   现在三个都照读并上报宿主缝；真正的播放/音量仍是缺口（emulator 无影片子系统）。
  const p = operandsFor(c);
  if (!p) return;
  c.native.playMovie?.(p.int(1) ?? 0, p.int(2) ?? 0, p.int(3) ?? 0);
};

/** 图形子系统的槽表/渲染配置（真实现）。 */
export const GFX_MISC_OPS: OpTable = [
  [0x23d, op_release_movie_slots], // 销毁 movie/纹理槽 42..999
  [0x32b, op_clear_mesh_slots], // 清 D3DX 网格层级槽表
  [0x259, op_clear_slot_records], // 清两张 1000×2 记录表（不 delete）
  [0x248, op_set_render_cfg_248], // dword_55052C = op1（渲染配置全局）
  [0x32f, op_light_enable], // D3D 灯光开关（LightEnable）
  [0x340, op_set_render_state], // 渲染状态下发（设备 vtable+228）
  // ★`0x342`/`0x352` **已移出本表**（2026-09）：它们属 Live2D 族（`handlers/live2d.ts` 的 `LIVE2D_OPS`）。
  //   留在这里时虽然被后注册的 `LIVE2D_OPS` 覆盖（`handlers/index.ts` 的顺序），但两个只调**没人实现**的
  //   宿主缝的"影子 handler"会让**闸门 A** 报假缺口（实测：控制窗显示 `destroyL2DSlot`/`l2dSlotSet` 未实现）。
];

/** 图形子系统的 native 转发。 */
export const GFX_MISC_NATIVE_OPS: OpTable = [
  [0x20f, op_play_movie], // → native.playMovie
];

