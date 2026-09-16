/**
 * **A4 图元 / 网格 / 纹理 / 渲染状态族**（13 条，2026-09 落地）。
 *
 * 这一族在复评台账里的判据是「写有读者的引擎状态 / 改渲染状态」——语料用量很大：
 * `0x258` 11356 处、`0x238` 2056 处（**`0x400` 等待计时器，有读者**：`Engine.gatePending`）、
 * `0x20E` 786 处、`0x229` 716 处、`0x224` 334 处、`0x242` 350 处。
 * 它们此前一律是 `ENGINE_INTERNAL_OPS` 的纯 no-op（或 `STUB_NATIVE_OPS` 的记录式桩）。
 *
 * 实现分两档（与全项目口径一致：**能建模的建模、纯渲染侧的走宿主缝**）：
 *
 * | opcode | handler | 引擎做的事 | emulator |
 * |---|---|---|---|
 * | `0x238` | `sub_4248C0` raw 32303-32312 | `Engine[92338] = 0`、`Engine[92339] = op1` | **建模**：装载 `0x400` 等待门的计时器（`Engine.gateWaitStart/gateWaitMs`；见 `tickets/T-0024`） |
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

/**
 * `0x238`（sub_4248C0 raw 32303-32312）：**装载 `0x400` 等待门的计时器**（`tickets/T-0024`）。
 *
 * 引擎写的是 `Engine[92338] = 0`（起点清零）、`Engine[92339] = op1`（时长 ms）——
 * 这两格 = 图形池基址别名的 `_this[11630]`/`_this[11631]`（字节 369352/369356），
 * 正是 `sub_407E20`（raw 12762-12786）读的**等待计时器**。⇒ 脚本的 `i238 N` + `wait`（`0x21C`）= "等 N 毫秒"：
 * 计时器未到点 ⇒ `sub_407E20` 返回 1 ⇒ 主循环 `0x400` 分支（raw 21109-21152）不放行。
 *
 * ★2026-09 订正：原注释记的"画布/视口尺寸对"没有依据（语料 2056 处取值全是整毫秒，
 * 且 `src/SN0000.txt` 等处每条 `i238` 都紧跟 `wait`）；`engineValues` 里那两格仍照写
 * （同一份语义的第二视图，供报告/digest 与 `0x238` 的既有证据锚点使用）。
 */
const op_load_wait_timer: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  e.gateWaitStart = 0; // Engine[92338]：起点清零 ⇒ 下一帧由 sub_407E20 锁存
  e.gateWaitMs = v; // Engine[92339]：时长（ms）
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

/**
 * **`0x32`**（`i032`，`sub_41E2D0` raw 27955-28008）：**槽→槽的缩放转送**（引擎名 **StretchTexture**）。
 *
 * 十个操作数：`op1` = 源槽、`op2` = 目标槽、`op3..6` = 源矩形 `(x, y, w, h)`、`op7..10` = 目标矩形。
 * 引擎把两对 (x,y,w,h) 先化开成 `[x1,y1,x2,y2]`（raw 27974-27983），再按 `set:DrawMode` 分两条路
 * （`Engine[166964]`，raw 27982）：
 *  - `== 0`（GDI）→ 文本/2D 对象 vtable+64 的同名转送；
 *  - `!= 0`（D3D）→ `sub_4A87A0(Scene, 源槽, 目标槽, &源矩形, &目标矩形)`（raw 127933-128129）：
 *    两个矩形各自按所在 **surface 的边界**夹取（一侧被夹时另一侧按比例跟随），再缩放转送；
 *    源/目标 surface 不存在 ⇒ 打「コピー元/コピー先テクスチャが作成されていません． TEXTURE=%d」并返回 0。
 *
 * ★语料 **337 处，形态完全一致**：`i032 2 e 0 0 500 2d0 0 0 140 b4` —— 把**全屏槽 2** 的
 * `(0,0,1280,720)` 缩成**槽 0xe** 的 `(0,0,320,180)`；上下文是
 * `create-texture 2 500 2d0 2` → `i20d 2`（以槽 2 为渲染目标）→ `i20e` → `i20c` → 还原渲染目标 →
 * `create-texture e 140 b4 2` → **本指令** → `i1ae … e`（把槽 0xe 写成 `.STH` 缩略图）⇒
 * **存档缩略图的"缩屏"这一步**（`src/SC5450.txt:3009-3021` 等 337 个 ADV 脚本同型）。
 * emulator：与 `0x207` 共用宿主缝 `blitSlotToSlot`（Pixi 在两张画布间 `drawImage`；
 * headless 只把这次下发记进 `scene.render4.blits`）。守卫 `test/op-032-stretch-texture.test.ts`。
 */
const op_stretch_texture: OpHandler = (c) => {
  const srcSlot = readIntOperand(c.e, c.frame, c.instr, 1);
  const dstSlot = readIntOperand(c.e, c.frame, c.instr, 2);
  const x = readIntOperand(c.e, c.frame, c.instr, 3);
  const y = readIntOperand(c.e, c.frame, c.instr, 4);
  const w = readIntOperand(c.e, c.frame, c.instr, 5);
  const h = readIntOperand(c.e, c.frame, c.instr, 6);
  const dx = readIntOperand(c.e, c.frame, c.instr, 7);
  const dy = readIntOperand(c.e, c.frame, c.instr, 8);
  const dw = readIntOperand(c.e, c.frame, c.instr, 9);
  const dh = readIntOperand(c.e, c.frame, c.instr, 10);
  // 引擎把 (x,y,w,h) 化开成 [x1,y1,x2,y2]（raw 27976-27983）
  c.native.blitSlotToSlot?.(srcSlot, dstSlot, [x, y, x + w, y + h], [dx, dy, dx + dw, dy + dh]);
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


/**
 * `0x20D` **设置渲染目标**（`sub_423770` raw 31594-31602，argc=1）：`op1` → `sub_4A50C0(Scene, op1)`
 * （raw 124819-124912）。引擎里 `-1` = 回到后台缓冲（同函数 raw 127911 / 25284 的 `0xFFFFFFFF` 用法）。
 *
 * ★**它不是"渲染侧记录"就完了**：`0x203`/`0x322` 的混合选择子**值 2 是门控的** ——
 * 只有"当前渲染目标槽指向的纹理创建模式 == 1"（= 正在往 mode-1 离屏表面画）时才设 `(ONE,ZERO)` 覆盖，
 * 否则**什么都不设**（沿用当前混合）。见 `renderer/scene/blend.ts` 与 `tickets/T-0017`。
 * 语料用量：841 处（`i20d 2` / `i20d (local-int 0)`）。
 */
const op_set_render_target: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.setRenderTarget?.(slot);
};

/**
 * `0x33F` **设置场景混合/颜色**（`sub_427A90` raw 34411-34448，argc=3）。
 *
 * 引擎：`v7 = Engine[93384]`（Scene）；`*(v7+1260) = op1`（**场景默认混合选择子**，消费点
 * `sub_4535F0` raw 65858-65889 —— 注意那里 `== 2` 时**没有门控**，无条件 `(ONE,ZERO)`）；
 * `*(v7+1264) = (α<<24)|(rgb&0xFFFFFF)`，其中 α=op2（>255 钳 255；<0 ⇒ 取 op1 所指绘制项当前 α）、
 * rgb=op3（<0 ⇒ 取该项当前色）。
 * ★**颜色那半未建模**：它在 raw 65904-65907 被下发给效果对象（`Scene+1036` vtable+12 =
 * 混合常量 + `Scene+1040` vtable+20 = `Scene+1264`），是**效果通路的 shader 常量**，emulator 没有
 * 这条通路（登记在 `tickets/T-0017` 的未收敛项）。本 handler 只承载混合选择子（它会真的改变画面）。
 * 语料用量：1 处（`src/SETWEATHER.txt:80 i33f 1 ff ffffff`）。
 */
const op_set_scene_blend: OpHandler = (c) => {
  const blend = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.setSceneBlend?.(blend);
};

/** A4 族（真实现：2 条建模 + 13 条宿主缝；★`0x20D`/`0x33F` 是 `T-0017` 加的）。 */
export const GFX_STATE_OPS: OpTable = [
  [0x1fc, op_reset_prim_transform], // 复位图元变换
  [0x1fe, op_prim_transform4], // 图元变换 4 浮点
  [0x207, op_blit_slot_to_slot], // 槽→槽 StretchRect（同尺寸）
  [0x32, op_stretch_texture], // ★i032：槽→槽**缩放**转送（StretchTexture；存档缩略图的缩屏步）
  [0x20e, op_commit_graphics], // 图形提交（Clear）
  [0x224, op_clear_transitions], // 清转场表
  [0x229, op_set_draw_mode], // 绘制模式 5 元组
  [0x238, op_load_wait_timer], // 装载 0x400 等待门的计时器（建模）
  [0x242, op_set_draw_entry_param], // DrawItem +720
  [0x256, op_set_slot_params], // 按 id 写 DrawItem 字段
  [0x258, op_set_slot_flags], // 纹理槽标志对（建模）
  [0x321, op_set_mesh_entry_attr], // MeshEntry 属性
  [0x32a, op_release_3d_slot], // 释放 3D 模型槽
  [0x32d, op_set_3d_color], // 3D 颜色
  [0x20d, op_set_render_target], // ★设置渲染目标（T-0017：混合选择子值 2 的门控依据）
  [0x33f, op_set_scene_blend], // ★场景默认混合选择子（Scene+1260）
];
