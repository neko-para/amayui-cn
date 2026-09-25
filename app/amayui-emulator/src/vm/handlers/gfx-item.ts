/**
 * 绘制项（DrawItem / Mesh）族：位置、pivot、平移、缩放、颜色、以及**动画窗两层**。
 *
 * Plan A 的核心约定：指令只**配置对象**，渲染器每帧 `present()` 合成整个场景图，
 * 渲染与 VM 指令解耦。因此这里全部是「读操作数 → 写渲染器里的对象」的转发。
 *
 * **A 层**（`Item.flags` bit1，一次性过渡动画窗；引擎 DrawItem 的 `+48..+88` 窗槽，见 docs/08）：
 *  - 窗1 `0x21E` 缩放（sx/sy/sz **÷100**）／窗2 `0x21F` 旋转（轴+角，**度**）
 *  - 窗3 `0x220` 平移（**不除**，像素）／窗4 `0x239` flipbook（帧数/列数/标志，bit0=保持末帧）
 * ★ 缩放的除数 100（`dbl_5201F0`）与平移到像素、旋转到度的差异，都是指令级的既有差异，切勿"统一"。
 *
 * **B 层**（`Item.flags` **bit2**，无限周期/循环动画层；引擎 `+524..+576`/`+592`/`+656`，2026-09 落地）：
 *  - `0x230` 停全部 B 层通道／`0x231` 贴图换格循环／`0x232` 颜色往复
 *  - `0x233` 缩放往复（**÷100**）／`0x234` **匀速旋转**（轴 + 周期，不除）／`0x235` 平移往复（不除）
 *  - `0x244` 批量清 **A 层**窗起点（mask = 2）
 * ★六条 setter **都没有 `flags & 1` 门控**（缺项即建、不报错）；消费端 = `drawitem/eval.ts`
 *  （`flags & 4` 门 + 每通道 `period > 0` 门）；规格 = `docs-new/03-engine/b3-bit2-model-spec-2026-09.md`。
 */
import type { OpHandler, StepCtx } from '../step.js';
import type { Engine, Frame } from '../engine.js';
import type { Ref } from '../ref.js';
import { readIntOperand, readFloatOperand, writeIntOperand, writeFloatOperand, refFromOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { readRef, refAt } from '../ref.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**；缺计划 = 编程错误（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 *
 * ★本族（`tickets/T-0082` 批次"绘制项/场景变换族"）**31 条一次迁完**：形状虽比音频族杂
 * （int handle 与 float 分量混排、5 条 getter 会**写操作数**、`0x320` 有 7 个**指针位**），
 * 但每条的读/写形状都由语义列 + 原 handler 的实际读法逐条定死，再由「计划 ⟷ 实现」逐位核对背书。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：绘制项/场景变换族走操作数计划层，但没有声明计划`);
  return p;
}

// ---------------------------------------------------------------------------
// 绘制项 / 纹理槽的**查询**指令族（`sub_4303xx` / `sub_4304xx`）
//
// ★判据与 `0x208`（纹理尺寸 getter）相同：这四条 handler 体都很短，但**每条都回写操作数**
//   （`sub_42B4B0` 写 int / `sub_42BA00` 写 float）。当 no-op 跳过时脚本拿到的是上一轮的旧值
//   ⇒ 属于「脚本层逻辑错误」，不只是画面问题。2026 实测：SN0000 首文案路径上它们命中 4 条
//   （`SN0000.txt:1029/1030/1040` 与 `...:3125/3128/3153/3469…` 的立绘/图元摆放例程）。
// ---------------------------------------------------------------------------

/**
 * `0x215`（sub_430340 raw 39880-39889）：**绘制项 → 它当前用的纹理槽号**。
 *
 * 引擎：`v2 = op2`（图元 handle）→ `sub_4ADC20(Scene, v2)`：
 * 在 DrawItem map（`Scene+1032`）里找 key；**找不到、或 `flags & 1 == 0`（未创建）⇒ 返回 −1**；
 * 否则返回 `DrawItem+4` ＝ **纹理槽号**（`draw-texture` 的 op2 写进去的那个）。
 * ⇒ `op1 = 槽号` 或 `−1`。
 *
 * 语料：`src/SN0000.txt:3125 i215 (global-int f801f) 18a9c`（问"handle 0x18a9c 现在挂在哪个槽"），
 * 紧接着 `i216` 用这个槽去查 imgid —— 这一对就是**立绘/图元→资源的反查**。
 */
const op_get_draw_texture_slot: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(2) ?? 0);
  const slot = c.native.getDrawItemTexSlot?.(handle);
  plan.setInt(1, slot === undefined || slot < 0 ? -1 : slot);
};

/**
 * `0x216`（sub_430380 raw 39891-39899）：**纹理槽 → 它绑定的图像 id（imgid）**。
 *
 * 引擎：`v2 = op2`（槽号）→ `op1 = Engine[5 * v2 + 81174]`。
 * ★这个下标就是 `Scene[5 * slot + 466]`（`Engine+80708` = Scene 基址）——
 * 即 `set-texture`（0x1F9）写的**唯一槽↔图像绑定表**（`docs/10-texture-slot-to-agf-file.md`）。
 * ★槽从未绑定过时引擎答 **−1**：建 Scene 的 `sub_499BC0`（raw 116333-116352）先 `memset` 再按步长 5
 * 把 1000 格的 imgid **逐格写成 −1**（raw 116348），随后把同一份表 `memcpy` 到 `_this + 5466`（raw 116353）
 * ⇒ **−1 是「该格没有 imgid」的正式值**（不是未初始化）。`0x1FA`（raw 119594）、`0x249`（raw 123377）、
 * `0x1F8`（raw 122847）也都往这一格写 −1 ⇒ emulator 的 `Engine.texSlots` 缺省必须答 −1
 * （`0x1F9` 写 imgid、其余三条写 −1）。
 *
 * 语料：`src/SN0000.txt:3128 i216 (global-int a9ba) (global-int f801f)` —— 把"当前立绘用的槽"
 * 换成 imgid 存起来，供后续 `i2ff`（按 imgid 播语音/取资源）用。★**紧跟 `jcc`**（`:3129` /
 * `:3698` 的 `ne … (global-int f8006)`）：答 0 与答 −1 会走**不同的分支** ⇒ 该格是**有观测差**的。
 */
const op_get_slot_imgid: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = (plan.int(2) ?? 0);
  // ★raw 116348：未绑定的槽在引擎里是 −1（不是 0）—— 缺省值照引擎给 −1。
  plan.setInt(1, c.e.texSlots.get(slot) ?? -1);
};

/**
 * `0x218`（sub_4303C0 raw 39902-39913）：**绘制项的 pivot（旋转/缩放中心）三元组**（float getter）。
 *
 * 引擎：`v2 = op1`（handle）→ `sub_4ADCF0(Scene, v4, v2)` 取 DrawItem 的 `v5[6..8]` =
 * `DrawItem+24/+28/+32` = **pivot**（正是 `0x217` 写的那个三元组；项不存在 ⇒ 全 0）
 * → `sub_42BA00(this, 2/3/4, …)` **写回 op2/op3/op4**。
 *
 * ★与 `0x21A`（描画位置）是**两个不同的 float 三元组**，不可互换（见 `0x217`/`0x219` 的说明）。
 * 语料：`src/SN0000.txt:1030/1040`（取当前 pivot ⇒ 先校正再设回去，做"围绕人物中心"的摆放）。
 */
const op_get_draw_pivot: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const handle = (plan.int(1) ?? 0);
  const pivot = c.native.getDrawItemPivot?.(handle) ?? { x: 0, y: 0, z: 0 };
  plan.setFloat(2, pivot.x);
  plan.setFloat(3, pivot.y);
  plan.setFloat(4, pivot.z);
};

/**
 * `0x21A`（sub_430450 raw 39916-39927）：**绘制项的描画位置三元组**（float getter）。
 *
 * 引擎：`v2 = op1`（handle）→ `sub_4ADC80(Scene, v4, v2)` 取 DrawItem 的 `v5[9..11]` =
 * `DrawItem+36/+40/+44` = **描画位置**（`0x219` 写的那个三元组；项不存在 ⇒ 全 0）
 * → 写回 **op2/op3/op4**。
 *
 * 语料：`src/SN0000.txt:1029` —— `i21a` 取当前位置 → 按屏幕尺寸加偏移 → `i219` 写回，
 * 即"把立绘从预置位置挪到目标位置"；跳过 `i21a` 会让偏移量基于 0 计算 ⇒ 立绘位置全错。
 */
const op_get_draw_pos: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const handle = (plan.int(1) ?? 0);
  const pos = c.native.getDrawItemPos?.(handle) ?? { x: 0, y: 0, z: 0 };
  plan.setFloat(2, pos.x);
  plan.setFloat(3, pos.y);
  plan.setFloat(4, pos.z);
};

/**
 * **`0x219`（sub_423BA0, raw 31807）：写绘制项的「描画位置 (x,y,z)」**。
 * 引擎：`f2/f3/f4 = readFloatOperand(2/3/4)`、`handle = readIntOperand(1)` →
 * `sub_4ACEE0(Scene, handle, f2, f3, f4)`：在元素 1（DrawItem）里写 `result[9..11]` =
 * **DrawItem+36/+40/+44 = 描画位置**。绘制期由 `sub_4AEEA0` 读 `&v26[9]` 交 `CTexture::Draw`。
 * ★原实现把它记成 0x21E 且注释写"变换槽"，已按**派发表反查**修正（`sub_423BA0` 注册偏差 678144 ⇒ 0x219）。
 * emulator：转发 `native.setDrawPivot`（渲染器写 DrawItem 的 pivot，供 present 用）。
 */
const op_set_draw_pos: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const x = (plan.float(2) ?? 0);
  const y = (plan.float(3) ?? 0);
  const z = (plan.float(4) ?? 0);
  c.native.setDrawPos?.(handle, x, y, z);
};

/**
 * **`0x21E`（sub_423CA0, raw 31846，argc=6）：缩放动画窗（窗1）**。
 * 引擎：`op1`=handle、`op2`=delay、`op3`=dur、`op4/5/6`=sx/sy/sz（`sub_41C300(...) / dbl_5201F0`，
 * **÷100** —— `dbl_5201F0 = 100.0`，raw 4430；脚本里 `64` 就是 100%）
 * → `sub_4AD170(Scene, handle, delay, dur, sx, sy, sz)`：`|=2`、`+52=0`、`+60=delay`、`+80=dur`、`+104=1`、
 * `D3DXMatrixScaling(元素+0xAC, sx, sy, sz)`（目标矩阵）。窗末 `work(+0x6C) ← target(+0xAC)`。
 * ★订正：早前 emulator 按 **÷256** 实现（并把 `dbl_5201F0` 误记为 256.0），导致所有缩放窗幅度差 2.56 倍。
 */
const op_set_scale_matrix: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const delay = (plan.int(2) ?? 0);
  const dur = (plan.int(3) ?? 0);
  const sx = (plan.float(4) ?? 0) / 100; // dbl_5201F0 = 100.0
  const sy = (plan.float(5) ?? 0) / 100;
  const sz = (plan.float(6) ?? 0) / 100;
  c.native.setScaleAnim?.(handle, delay, dur, sx, sy, sz);
};

/**
 * **`0x21F`（sub_423D40, raw 31867，argc=7）：旋转动画窗（窗2）**。
 * 引擎：`op1`=handle、`op2`=delay、`op3`=dur、`op4/5/6`=旋转轴 (x,y,z)、`op7`=角（**度**）
 * → `sub_4AD250(Scene, handle, delay, dur, ax, ay, az, deg)`：`+64=delay`、`+84=dur`、`+104=1`、
 * 轴/角存目标 `+0x1F8..0x208`、`D3DXMatrixRotationAxis(元素+0x12C, axis, deg·π/180)`。
 */
const op_set_rotation_anim: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const delay = (plan.int(2) ?? 0);
  const dur = (plan.int(3) ?? 0);
  const ax = (plan.float(4) ?? 0);
  const ay = (plan.float(5) ?? 0);
  const az = (plan.float(6) ?? 0);
  const deg = (plan.float(7) ?? 0);
  c.native.setRotationAnim?.(handle, delay, dur, ax, ay, az, deg);
};

/**
 * **`0x220`（sub_423DE0, raw 31889，argc=6）：平移动画窗（窗3）**。
 * 引擎：`op1`=handle、`op2`=delay、`op3`=dur、`op4/5/6`=位移 (x,y,z)（**不除 256**，与 0x21E 不同）
 * → `sub_4AD3C0`：`+68=delay`、`+88=dur`、`+104=1`、`D3DXMatrixTranslation(元素+0x1AC, x, y, z)`。
 */
const op_set_translation_anim: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const delay = (plan.int(2) ?? 0);
  const dur = (plan.int(3) ?? 0);
  const x = (plan.float(4) ?? 0);
  const y = (plan.float(5) ?? 0);
  const z = (plan.float(6) ?? 0);
  c.native.setTranslationAnim?.(handle, delay, dur, x, y, z);
};

/**
 * **`0x239`（sub_424900, raw 32315，argc=6）：flipbook 动画窗（窗4）**。
 * 引擎：`op1`=handle、`op2`=delay(`+0x48`)、`op3`=dur(`+0x5C`)、`op4`=总帧数(`+0x238`)、
 * `op5`=每行列数(`+0x23C`)、`op6`=标志(`+0x234`，bit0 = 窗末**保持末帧**)
 * → `sub_4AD4A0`。逐帧把帧序号写成**源矩形**偏移（引擎 raw 117797-117831），不是 UV。
 */
const op_set_flipbook: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const delay = (plan.int(2) ?? 0);
  const dur = (plan.int(3) ?? 0);
  const frames = (plan.int(4) ?? 0);
  const cols = (plan.int(5) ?? 0);
  const flags = (plan.int(6) ?? 0);
  c.native.setFlipbook?.(handle, delay, dur, frames, cols, flags);
};

/**
 * **`0x1FD`（sub_422FD0, raw 31313）：立即缩放**（无动画窗）。
 * 引擎：`op1`=handle、`op2/3/4` = sx/sy/sz（`sub_41C300(...) / dbl_5201F0`，**÷100**
 * —— `dbl_5201F0 = 100.0`，raw 4430；脚本里 `64`=100% 即 1.0）→ `sub_4AC5F0`：
 * `+0x68 = 1`（用世界矩阵）+ `D3DXMatrixScaling(元素+0x6C, …)`（缩放 **work** 矩阵）+ 置脏。
 *
 * ★**不是"记录式转发"**：`0x1FD` 是引擎里唯一的"立刻设定缩放"指令（`0x21E` 走动画窗）。
 * 缺了它不会报错，只会让"1px 贴片靠缩放撑开"的九宫格/三段式控件失去中段
 * （实测 CONFIG1 右侧滚动条拇指：上盖 27×23 + 中段 27×1 放大到 209 + 下盖 27×24）。
 */
const op_set_scale: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const sx = (plan.float(2) ?? 0) / 100; // dbl_5201F0 = 100.0
  const sy = (plan.float(3) ?? 0) / 100;
  const sz = (plan.float(4) ?? 0) / 100;
  c.native.setScale?.(handle, sx, sy, sz);
};

/**
 * **`0x1FF`（sub_4230F0 → `sub_4AC750`, raw 31348，argc=4）：DrawItem 的像素平移**。
 * 引擎：`op1` = DrawItem id、`op2/op3/op4` = float 平移 x/y/z（**像素单位**，无 /100、无 /256）→
 * `sub_4AAA50` 保证项存在 → `DrawItem+0x68 = 1`（**用世界矩阵**）→
 * `D3DXMatrixTranslation(元素+0x16C, x, y, z)` 写**平移 work 矩阵**（与 `0x220` 的窗版写 target 不同：
 * 这条**立即生效、无动画窗**）。置脏 `Scene+46508`。
 * ★与 `0x1FD` 对照：**平移用像素、缩放用百分数**（0x1FD 的 op2..op4 经 `/dbl_5201F0`）。
 */
const op_set_draw_translation: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const x = (plan.float(2) ?? 0);
  const y = (plan.float(3) ?? 0);
  const z = (plan.float(4) ?? 0);
  c.native.setDrawTranslation?.(handle, x, y, z);
};

// ---------------------------------------------------------------------------
// ★Scene 级世界矩阵四条（`0x22A`/`0x22C`/`0x22D`/`0x22F`）—— 2026-09 落地
//
// 这四条**不是**"改某一个绘制项"，而是改 **Scene 自己的变换块**（引擎 `Scene+1120` 起的记录）：
// 体内三条/五条操作数**没有任何 handle 查表**（`sub_41BF50` 只在 `0x22D`/`0x22F` 的 op1/op2 出现，
// 且那两个 int 落进 `Scene[295]/[300]` 与 `[297]/[302]` 两个**轴/掩码格**，不是图元 id）。
// 消费链（读体确证）：`sub_4A1E90` raw 122130-122157 → `sub_49AA30` raw 117239 起合成
// **Scene 世界矩阵 `Scene+46600`** → RenderScene raw 133407 `D3DXMatrixMultiply(work, work, Scene+46600)`
// → **只作用于「层号 ∈ [20,30)」的项**（raw 133405 的 `(层号 − 20) > 9` 取反那支）。
// 落地形态 = `SceneState.sceneXform` + 两个宿主合成时的 `sceneXform2D`（见 `scene/state.ts`）。
// ---------------------------------------------------------------------------

/**
 * **`0x22A`（sub_424080, raw 32003-32016）：Scene 级立即缩放**。
 * 逐字：`arity 槽 = 7`；`v3/v4/v5 = readFloatOperand(1/2/3) / dbl_5201F0`（= **100.0**）
 * → `sub_49A720(Engine+80708, v3, v4, v5)`；被调体（raw 117117-117126）=
 * `Scene[306] = 1` + `D3DXMatrixScaling(Scene+307)` + `Scene[11627] = 1`（置脏）。
 * ★**订正筛体**：`op1` **不是 handle**（三条读全是 `sub_41C300`，体内无 handle 查表）。
 * 语料 2 处（`FIELD.txt:14360` / `LOOK.txt:108` ⇒ 缩放 (1,1,1)）。
 */
const op_scene_scale: OpHandler = (c) => {
  const plan = planFor(c);
  const sx = (plan.float(1) ?? 0) / 100; // dbl_5201F0 = 100.0
  const sy = (plan.float(2) ?? 0) / 100;
  const sz = (plan.float(3) ?? 0) / 100;
  c.native.setSceneScale?.(sx, sy, sz);
};

/**
 * **`0x22C`（sub_424180, raw 32034-32046）：Scene 级立即平移**。
 * `arity 槽 = 7`；`v3/v4/v5 = readFloatOperand(1/2/3)`（**不除** = 像素）
 * → `sub_49A820(Engine+80708, …)`；被调体（raw 117153-117162）= `Scene[306] = 1` +
 * `D3DXMatrixTranslation(Scene+371)` + `Scene[11627] = 1`。
 * ★**订正筛体**：`op1` 同样不是 handle；也**不是** `0x1FF` 的"同字段族"——`0x1FF` 改的是**某项**的
 * work 矩阵（按 handle 查表），本条改的是 **Scene 自己的变换块**。
 */
const op_scene_translation: OpHandler = (c) => {
  const plan = planFor(c);
  const x = (plan.float(1) ?? 0);
  const y = (plan.float(2) ?? 0);
  const z = (plan.float(3) ?? 0);
  c.native.setSceneTranslation?.(x, y, z);
};

/**
 * **`0x22D`（sub_4241F0, raw 32048-32064）：Scene 级带轴缩放**。
 * `arity 槽 = 11`；`v5/v6/v7 = readFloatOperand(3/4/5) / dbl_5201F0`（**÷100**）、
 * `v4 = readIntOperand(2)`、`v2 = readIntOperand(1)` → `sub_49A870(Engine+80708, v2, v4, v5, v6, v7)`；
 * 被调体（raw 117165-117179）= `Scene[280] |= 2`、`Scene[293] = 0`、`Scene[295] = op1`、
 * `Scene[300] = op2`、`Scene[306] = 1`、`D3DXMatrixScaling(Scene+323)`、`Scene[11627]/[11629] = 1`。
 * ★`op1`/`op2` 是**轴/掩码类 int**（语料 `i22d 0 258 …` / `i22d 0 12c …` 的 op1 恒为 0），不是 handle。
 */
const op_scene_axis_scale: OpHandler = (c) => {
  const plan = planFor(c);
  const a = (plan.int(1) ?? 0);
  const b = (plan.int(2) ?? 0);
  const sx = (plan.float(3) ?? 0) / 100; // dbl_5201F0 = 100.0
  const sy = (plan.float(4) ?? 0) / 100;
  const sz = (plan.float(5) ?? 0) / 100;
  c.native.setSceneAxisScale?.(a, b, sx, sy, sz);
};

/**
 * **`0x22F`（sub_424330, raw 32087-32103）：Scene 级带轴平移**。
 * `arity 槽 = 11`；`v5/v6/v7 = readFloatOperand(3/4/5)`（**不除** = 轴分量）、
 * `v4 = readIntOperand(2)`、`v2 = readIntOperand(1)` → `sub_49A9C0(Engine+80708, v2, v4, v5, v6, v7)`；
 * 被调体（raw 117222-117236）= `Scene[280] |= 2`、`Scene[293] = 0`、`Scene[297] = op1`、
 * `Scene[302] = op2`、`Scene[306] = 1`、**`D3DXMatrixTranslation(Scene+387)`**、`Scene[11627]/[11629] = 1`。
 * ★**以体订正筛体**：筛体记的是"`Scene+323` + `D3DXMatrixScaling`"——那是 **`0x22D` 的 `sub_49A870`**；
 * 本条体内是 `+387` + **`D3DXMatrixTranslation`**（`sub_49A9C0` 里 `D3DXMatrixScaling` 一次都没有）。
 */
const op_scene_axis_translation: OpHandler = (c) => {
  const plan = planFor(c);
  const a = (plan.int(1) ?? 0);
  const b = (plan.int(2) ?? 0);
  const x = (plan.float(3) ?? 0);
  const y = (plan.float(4) ?? 0);
  const z = (plan.float(5) ?? 0);
  c.native.setSceneAxisTranslation?.(a, b, x, y, z);
};


/**
 * **`0x1F6`（sub_41A130, raw 25239）：清/重置绘制容器** `sub_4AB7A0(_this+80708)`。
 * 引擎里这是**唯一**会整批释放绘制项/网格的指令（扫描容器并 delete）；emulator 的等价语义 = 清空
 * `drawItems` + `meshes`（**保留纹理槽**）。★注意：这才是"合法的整批清场"，与"换脚本就清"无关。
 */
const op_clear_draw_container: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.clearDrawContainer?.();
};

/**
 * **`0x228`（`sub_430650` raw 39973-39988，argc=5）：绘制项 → 它当前被平移了多少**（getter）。
 *
 * 引擎逐字：
 * ```
 * _this[30*cur + 95805] = 11;                    // arity 槽 = 11 ⇒ argc 5 有据
 * v2 = readIntOperand(2);                        // op2 = 图元 handle
 * if (!sub_4AA060(Scene, v2, &v6, &v5, &v4))     // 表（Scene+1032）里查项；查不到 ⇒ 返回 0
 *     return writeInt(1, 1);                     // ★失败：op1 = 1，op3..5 不动
 * writeFloat(3, v6); writeFloat(4, v5); writeFloat(5, v4);
 * return writeInt(1, 0);                         // 成功：op1 = 0
 * ```
 * `sub_4AA060`（raw 130115 起）把元素 `+0x16C`（**平移 work 矩阵**）`D3DXMatrixDecompose` 后取平移分量
 * ⇒ 本指令返回的是 `0x1FF`（立即平移）/ `0x220`（平移窗）写的那个量，**不是** `0x21A` 的描画位置（`+0x24`）。
 *
 * ★语料用法（`src/SC0500.txt:1358-1363`）：先 `i228` 取当前平移，再按返回值算 `i220` 的窗目标
 *   （`add (local-int 0) 64 (global-int f803b)` = 平移 x + 100）⇒ 这是一种"从当前位置滑到位"的写法。
 * ★为什么必须实现（审计 P0 `op-4-01`）：语料 **1097 处**，且每处后面紧跟 `eq ... 0` + `jcc` 读 op1；
 *   未实现时命中即 `NotImplementedOp`，按桩跳过则 op1 留旧值 ⇒ 分支走错（静默逻辑错误）。
 */
const op_get_item_translation: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(2) ?? 0);
  const t = c.native.getDrawItemTranslation?.(handle);
  if (t === undefined) {
    // 引擎失败分支：op1 = 1，且**不写** op3/op4/op5（保持旧值）
    plan.setInt(1, 1);
    return;
  }
  plan.setFloat(3, t.x);
  plan.setFloat(4, t.y);
  plan.setFloat(5, t.z);
  plan.setInt(1, 0);
};

/**
 * **`0x223`**（`sub_423F00` raw 31936-31958 → `sub_4ADDB0` raw 132590-132635，argc 8）：
 * **转场记录表 `Scene+1048` 的写入端 · 类别 0（全屏交叉淡化）**。`op1` = 记录键。
 *
 * 引擎逐字：
 * ```
 * _this[30 * cur + 95805] = 17;                    // arity 槽 ⇒ argc 8（有据）
 * v10..v2 = read(8..1);                            // 引擎自 op8 **递减**读到 op1（v2=op1, v4=op2 … v10=op8）
 * sub_4ADDB0(_this + 80708, v2, v4, v5, v6, v7, v8, v9, v10);   // Scene = Engine + 80708（dword）
 * // sub_4ADDB0：
 * //  ① sub_4AAAF0(Scene, op1) = 按 key=op1 **确保转场记录存在**
 * //     （缺则先 sub_49A640 建 24 格默认记录：raw 117059-117077，[4] = -1、[9..12] = SetRect(0,0,0,0)）；
 * //  ② 全部写入都经 `sub_4AAE10(_this + 262, &key)` —— `_this + 262` 是 **dword 下标 262 = 字节 1048**，
 * //     即**转场记录表 `Scene+1048`**（与 0x24f/0x250/0x251 同一张表，raw 132618-132635）；
 * //  ③ 写集：[0]=0、[1]=0、[2]=a8=op7、[3]=a9=op8、[4]=a3=op2、[5]=a4=op3、
 * //          [7]=a5=op4、[6]=a6=op5、[8]=a7=op6；末尾 Scene[11627]=1（置脏）。
 * ```
 * `[0] = 0` ⇒ **类别 0 = 全屏交叉淡化**（帧渲染器 `sub_4B06D0` 按 `[0]` 分四类：0 淡入淡出 /
 * 1 分块淡入淡出 / 2 盲帘 / 3 插值模糊；见 `docs-new/03-engine/transition-render-spec-2026-09.md` §2.2、§3.3）。
 *
 * ★**订正（`tickets/T-0087`）**：旧实现把这 9 个数存进 emulator 私有的 `Engine.itemRegions`
 * （`Map<number, number[]>`）—— **数据对、容器错**：① 那是没有任何生产读者的「死模型」；
 * ② 转场记录表 `render4.transitions` 才是 `0x24f`/`0x250`/`0x251` 走的容器 ⇒ 类别 0 的转场
 * （语料 **178 处 / 178 文件**，每个脚本一处）对渲染端完全不可见；③ 手写 9 格数组连引擎的
 * **记录长度（24）与默认值**都丢了。现改走同一条路径：`native.setTransition` → `scSetTransition`
 * （`s.render4.transitions.get(id) ?? scTransitionDefaultRecord()` ⇒ 24 格默认 + 逐格覆盖）。
 * ★类别 0 的**渲染端**仍未建模（记在 `tickets/T-0076`）。
 */
const op_set_transition_fade: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  // ★引擎**无条件读满 op1..op8**（`sub_41BF50` ×8，raw 31949-31956）**且在调用之前** ⇒ 先全读进局部量。
  // 为什么不把 `readIntOperand` 直接写进下面可选调用的实参表：`f?.(…)` 在 `f` 为 `undefined` 时**不求值实参**
  // ⇒ 宿主没有 `setTransition` 缝（`StubNative`）时整批操作数根本不会被读（`test/opcode-operands.test.ts` 会红）。
  const key = (plan.int(1) ?? 0); // op1 = 记录键（引擎 a2）
  const texSlot = (plan.int(2) ?? 0); // op2 → [4]（a3：工作纹理槽，兼惰性建层用）
  const p3 = (plan.int(3) ?? 0); // op3 → [5]（a4）
  const p4 = (plan.int(4) ?? 0); // op4 → [7]（a5）
  const p5 = (plan.int(5) ?? 0); // op5 → [6]（a6）
  const p6 = (plan.int(6) ?? 0); // op6 → [8]（a7）
  const p7 = (plan.int(7) ?? 0); // op7 → [2] = 延迟 ms（a8）
  const p8 = (plan.int(8) ?? 0); // op8 → [3] = 时长 ms（a9）
  c.native.setTransition?.(key, [
    [0, 0], // 类别 0 = 全屏交叉淡化（帧渲染器按 [0] 分派）
    [1, 0], // 窗口起点：指令只写 0，首帧由消费端锁存
    [2, p7],
    [3, p8],
    [4, texSlot],
    [5, p3],
    [6, p5], // ★[6] ← op5 与 [7] ← op4 是**交叉**的（raw 132628/132630），照引擎写
    [7, p4],
    [8, p6],
  ]);
};

/**
 * `0x217`（sub_423B20, raw 31791）：**对象变换 pivot** —— 读 op1=handle、op2/op3/op4 三个 float，
 * 调 `sub_4ACF20(_this+80708, handle, f2, f3, f4)`：`sub_4AAA50` 保证 key 存在 → `map[key]` →
 * 写元素下标 `6/7/8` = DrawItem`+24/+28/+32` = **回転/拡大縮小の中心（pivot）**，并置脏 `_this[11627]=1`。
 * 绘制期 `sub_49AA30` 用 `T(-pivot) → 动画矩阵 → T(+pivot)` 把它夹在动画矩阵外侧 ⇒ 只改基准点、不改位置。
 * ★与 `0x219`（sub_4ACEE0，写 `+36/+40/+44` = 描画位置）是**两个不同的 float 三元组**，不可混用同一 native 方法。
 */
const op_set_object_transform: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const a = (plan.float(2) ?? 0);
  const b = (plan.float(3) ?? 0);
  const d = (plan.float(4) ?? 0);
  c.native.setDrawPivot?.(handle, a, b, d);
};

/**
 * `dbl_51D7F8 = 0.5`（raw 4197）—— 引擎给顶点位置做的**半像素偏移**（见 `op_mesh_create` 的订正 1：
 * `sub_4A1F00` raw 122235-122238）。单独取名是为了让"这个魔数是什么、从哪来"在调用点一眼可见。
 */
const HALF_PIXEL = 0.5;

/**
 * **`0x320` create-mesh**（`sub_432150` raw 41012-41078，argc=10）：建顶点四边形 + 逐顶点色。
 *
 * 操作数布局（**全是"数组基址"**，引擎用取址读法 `sub_42BF60`/`sub_42AEA0` 而不是取值读法）：
 *  - op1 = handle、op9 = vcount、op10 = layer（`entry[6]`）；
 *  - op2/op3/op4 = x/y/z 的**浮点数组基址**（= 全局 float 槽号），第 i 个顶点取 `slot+i`；
 *  - op5/op6 = 逐顶点**颜色数组基址**（全局 int 槽号）：op5 供 alpha（`dec(key)·<<24`）、
 *    op6 供 rgb（`dec(key) & 0xFFFFFF`）；
 *  - op7/op8 = u/v 的浮点数组基址（每个顶点取 `slot+i`）。
 * `vcount <= 0` 时引擎打「頂点数%dは不正です．」并**不建几何**（⇒ 不画）。
 * 语料里所有站点都是同一个满屏四边形：x=(0,1280,0,1280)、y=(0,0,720,720)（十六进制 0x500/0x2d0），
 * 颜色数组来自 INIT2 的 `copy-local-array (global-int f8c48/f8c4c)` = 逐顶点 `0xFFFFFFFF`（不透明白）。
 *
 * ★**订正（`tickets/T-0155`）**：**顶点位置要减 0.5**。引擎这一段在**被调体里**
 *   （raw 41069 → `sub_4ADFE0` raw 132786 → `sub_4A1F00` raw 122235-122238）逐顶点做
 *   `pos.x -= dbl_51D7F8; pos.y -= dbl_51D7F8;`（`dbl_51D7F8 = 0.5`，raw 4197；同一句也出现在
 *   DrawPrimitive 路径 `sub_4A3590` raw 123309-123316）⇒ 满屏四边形在真机上是
 *   `(−0.5,−0.5)..(1279.5,719.5)`。修前直接取数组值 ⇒ 整块几何偏 (+0.5,+0.5)。
 *   **z 不减**（体里只动 `a2+0`/`a2+4` 两格）。
 *   守卫 `test/gfx-state-operand-io.test.ts`（合成指令 + 录制型宿主，逐顶点断言）。
 */
const op_mesh_create: OpHandler = (c) => {
  const plan = planFor(c);
  const { e, frame, instr } = c;
  const handle = (plan.int(1) ?? 0);
  const layer = (plan.int(10) ?? 0);
  const vcount = (plan.int(9) ?? 0);
  const xRef = plan.ptr(2)!;
  const yRef = plan.ptr(3)!;
  const zRef = plan.ptr(4)!;
  const aRef = plan.ptr(5)!;
  const cRef = plan.ptr(6)!;
  const uRef = plan.ptr(7)!;
  const vRef = plan.ptr(8)!;
  const verts = [];
  const baseColors = [];
  for (let i = 0; i < Math.max(0, vcount); i++) {
    verts.push({
      // ★raw 122235-122238（`sub_4A1F00`）：x/y 各减 `dbl_51D7F8 = 0.5`（raw 4197），z 不动。
      x: floatArrayAt(e, frame, xRef, i) - HALF_PIXEL,
      y: floatArrayAt(e, frame, yRef, i) - HALF_PIXEL,
      z: floatArrayAt(e, frame, zRef, i),
      u: floatArrayAt(e, frame, uRef, i),
      v: floatArrayAt(e, frame, vRef, i),
    });
    // 引擎：`(unsigned)(dec(alphaWord)) << 24 | (dec(rgbWord) & 0xFFFFFF)`（raw 41054-41058）
    const a = readRef(e, frame, refAt(aRef, i)) >>> 0;
    const rgb = readRef(e, frame, refAt(cRef, i)) >>> 0;
    baseColors.push((((a << 24) >>> 0) | (rgb & 0xffffff)) >>> 0);
  }
  c.native.createMesh?.({ handle, layer, vcount, verts, baseColors });
};

/**
 * 读某个"数组基址"操作数的第 i 个浮点元素。
 *
 * 引擎 `sub_42BF60` 对全局/局部 float 操作数返回**地址** `基址 + 4*payload` ⇒ 数组基址槽号就是
 * 操作数的 payload；emulator 的 float 池按槽号存 JS 数（`readRef` 对 float 返回位模式，故不能用）。
 */
function floatArrayAt(e: Engine, frame: Frame, r: Ref, i: number): number {
  if (r.kind !== 'float') return floatBitsOf(readRef(e, frame, refAt(r, i)) >>> 0);
  const idx = r.index + i;
  return r.scope === 'global' ? (e.globals.float.get(idx) ?? 0) : (frame.locals.float.get(idx) ?? 0);
}

/** u32 位模式 → float32（数组元素若是 int 槽里的位模式，按引擎"内存里就是 float"解释）。 */
function floatBitsOf(bits: number): number {
  return new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0]!;
}

/**
 * `0x322` set-vertex-color（`sub_426C20` raw 33852-33885，argc=4）：
 * op1=handle、op2=entry[9]、op3=alpha、op4=rgb。**负值 = 用当前 state0 的对应通道**
 * （引擎 raw 33865-33881），且 alpha>255 夹到 255 —— 回退在宿主侧做（见 `scene/ops.ts`）。
 */
const op_set_vertex_color: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const index = (plan.int(2) ?? 0);
  const alpha = (plan.int(3) ?? 0);
  const rgb = (plan.int(4) ?? 0);
  c.native.setVertexColor?.(handle, index, alpha, rgb);
};
/**
 * `0x323` set-vertex-color-alpha（`sub_426CF0` raw 33888-33921，argc=5）：
 * `op4` = α、`op5` = rgb（与 `0x322` 同款 clamp / 负值回退：α>255⇒255、α<0⇒当前 α、rgb<0⇒当前 rgb；
 * 规整在 `scene/ops.ts` 的 `vertexColorArg`），`op2`/`op3` 由 handler **原样透传**给被调
 * `sub_4AE330(Scene, op1, op2, op3, argb)`（raw 132826-132846）—— **不是** handler 自己解释成
 * delay/count：在被调体里 `[10] = 0`（窗起点）、`[11] = op2`、`[12] = op3`、`[14] = argb`、`flags |= 2`
 * （与 `0x22D`/`0x234` 同形的「窗起点 + 两个窗参数」写入）。负值回退取的是 `sub_4AE3C0(Scene, op1)`
 * = **多边形记录 `[13]`**（raw 132848-132856；`Scene+1064` 那张表，emulator 侧对应 `mesh.state0`）。
 * ★审计 P2 `op-4-05` 的订正点（`tickets/T-0077`）：读顺序按体是 **op4/op5 先、再 op1/op2/op3**；
 * `delay`/`count` 只是**被调记录字段**的名字，handler 侧只做透传 —— 这条写在这里，免得下次又被
 * 读成「handler 把 op2 当 delay」。语料 `i323` **0 处** ⇒ 用合成指令守（`test/mesh-vertex-quad.test.ts`）。
 */
const op_set_vertex_color_alpha: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const delay = (plan.int(2) ?? 0); // 透传 → sub_4AE330 的 record[11]
  const count = (plan.int(3) ?? 0); // 透传 → sub_4AE330 的 record[12]
  const alpha = (plan.int(4) ?? 0);
  const rgb = (plan.int(5) ?? 0);
  c.native.setVertexColorAlpha?.(handle, delay, count, alpha, rgb);
};
/**
 * `0x202` set-draw-color（`sub_4231F0` raw 31381-31416，argc=5）：`op1`=图元、`op2`=delay、
 * `op3`=dur、`op4`=α、`op5`=颜色 —— 启动/重设**颜色动画窗**（`sub_4AD0C0(Scene, handle, delay, dur, TO)`，
 * 引擎侧：门控 `flags & 1`（元素必须已创建）→ `flags |= 2`、`+0x34 = 0`、`+0x64 = TO`）。
 *
 * ★★**负值回退必须实现**（引擎逐字 raw 31395-31411）：
 * ```
 * if (α <= 255) { if (α < 0) α = (unsigned)sub_4ADD60(Scene, handle) >> 24; } else α = 255;
 * if (color < 0) color = sub_4ADD60(Scene, handle);            // 整份 ARGB（写回只取低 24 位）
 * ```
 * `sub_4ADD60` = 按 handle 查绘制项、**查不到返回 −1**、否则读 `DrawItem+0x60`（= `Item.from`）。
 * ⇒ `set-draw-color <h> 0 <dur> -1 -1` 的语义是「**动画到当前色**」，不是"动画到白"。
 *
 * ★**T-0102 的「ADV 窗口白底」就是这个缺回退造成的**：窗口例程每帧先
 * `set-draw-color-alpha <win> 0 (f807d) (a9db)`（= 半透明**黑**，`a9db` 默认 0、`f807d`∈{0xc0,0xa0,0x80}），
 * 再发 `set-draw-color <win> 0 800 -1 -1`（淡入到当前色）。缺回退时 `-1/-1` 被拼成
 * `0xFFFFFFFF`（**白不透明**）⇒ 窗口淡入成**白**；引擎淡入成半透明黑 ⇒ 真机是黑窗。
 * 逐字取证见 `tickets/T-0102/evidence/texture-absent-draw-policy.md` 与轮 21 的日志段。
 */
const op_set_draw_color: OpHandler = (c) => {
  // 0x202：op1=handle, op2=delay, op3=count, op4=alpha, op5=rgb → to (ARGB)。
  const p = operandsFor(c);
  if (!p) return;
  const handle = p.int(1) ?? 0;
  const delay = p.int(2) ?? 0;
  const count = p.int(3) ?? 0;
  let a = p.int(4) ?? 0;
  let b = p.int(5) ?? 0;
  // ★回退源（`sub_4ADD60`）：与 `0x203` 同一个宿主缝 —— **读绘制项当前色**，项不存在 ⇒ −1。
  //   ★顺序照引擎：回退必须在写入之前取（`sub_4AD0C0` 会覆写 `+0x60`/`+0x64`）。
  const current = (): number => c.native.getDrawItemColor?.(handle) ?? -1;
  if (a > 255) a = 255; // raw 31403-31406
  else if (a < 0) a = current() >>> 24; // raw 31397-31401
  if (b < 0) b = current(); // raw 31407-31411
  c.native.setDrawColor?.(handle, delay, count, (((a & 0xff) << 24) | (b & 0xffffff)) >>> 0);
};
/**
 * ★`0x203` set-draw-color-alpha（`sub_4232C0` raw 31419-31451，argc 4）：
 * `op1` = handle、`op2` = blend（`DrawItem+0x30`）、`op3` = α、`op4` = 颜色（RGB）。
 *
 * 引擎逐字（`v2 = op3`、`v3 = op4`）：
 * ```
 * raw 31431-31442  if (α <= 255) { if (α < 0) α = (unsigned)sub_4ADD60(Scene, handle) >> 24; }
 *                  else α = 255;
 * raw 31443-31447  if (color < 0) color = sub_4ADD60(Scene, handle);      // 整份 ARGB（含 α）
 * raw 31450        sub_4ACF60(Scene, handle, op2, (α & 0xff) << 24 | (color & 0xffffff))
 * ```
 * `sub_4ADD60`（raw 132579-132588）= 按 handle 查绘制项、**查不到返回 −1**、否则读 `DrawItem+0x60`
 * （= 本工程 `Item.from`，`0x203` 自己写的那格）⇒ 所以回退必须在**写入之前**取。
 *
 * ★2026-09 按体订正（审计 P2 `op-4-06`，`tickets/T-0077`）：旧实现只有自造的 `(alpha & 0xff)`，
 *  ⇒ `op3 ≥ 256` 时给 α = 0（引擎 = 255）、`op3 < 0` / `op4 < 0` 时丢掉整个回退分支。
 */
const op_set_draw_color_alpha: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const handle = p.int(1) ?? 0;
  const blend = p.int(2) ?? 0; // → DrawItem+0x30（引擎 raw 131878）
  let alpha = p.int(3) ?? 0;
  let color = p.int(4) ?? 0;
  // 回退源（`sub_4ADD60`）：本宿主缝**读的是绘制项当前色**，不是参数；项不存在 ⇒ −1（引擎原样）。
  const current = (): number => c.native.getDrawItemColor?.(handle) ?? -1;
  if (alpha > 255) alpha = 255; // raw 31439-31442
  else if (alpha < 0) alpha = current() >>> 24; // raw 31433-31437（`(unsigned)x >> 24` ⇒ x = −1 时 255）
  if (color < 0) color = current(); // raw 31443-31447
  const argb = (((alpha & 0xff) << 24) | (color & 0xffffff)) >>> 0; // raw 31450 的位拼装
  c.native.setDrawColorAlpha?.(handle, argb, blend);
};

/**
 * **`0x21D` CopyScene**（`sub_423C60` raw 31834-31843）：`op1` = 源 handle、`op2` = 目标 handle
 * （引擎取值顺序：先 op2 后 op1，随后 `sub_4AC0D0(Scene, op1, op2)`）。
 *
 * 引擎把源绘图项（以及同 key 的网格）**整块复制**到目标 handle；两张都找不到 ⇒ 打错误串
 * 「関数：CopyScene エラー：コピー元のシーンが存在しません．%d」并返回 0。
 * 语料用途：把预置的「全屏过渡幕布」（handle 0）复制成临时 handle 再单独改色做淡入淡出
 * （`ROOM.txt:83/391`、`MMODE.txt:71/763`），ADV 里也用它复制 CG 图元做缩放绘制。
 */
const op_copy_scene: OpHandler = (c) => {
  const plan = planFor(c);
  const src = (plan.int(1) ?? 0);
  const dst = (plan.int(2) ?? 0);
  const r = c.native.copyScene?.(src, dst);
  if (r === false) {
    // 引擎打错误串（可见日志），emulator 同样留痕、不静默。
    c.log(`  [CopyScene] 复制源不存在：src=0x${src.toString(16)} dst=0x${dst.toString(16)}（引擎「コピー元のシーンが存在しません」）`);
  }
};

/**
 * **`0x214`**（`sub_423AE0` raw 31779-31788 → `sub_4ABEF0` raw 131084-131143）：**交换两条绘图项记录**。
 *
 * 引擎体极短：
 * ```
 * obj = Engine + 80708;                    // = Scene（绘制对象，byte 322832）
 * v4 = readIntOperand(2); v2 = readIntOperand(1);
 * sub_4ABEF0(obj, v2, v4);                 // ★op1/op2 是「两个 handle」，没有别的操作数
 * ```
 * `sub_4ABEF0`：在绘图项表（`obj+1032` = `_this+258` dwords）里把 **key=op1 与 key=op2 的记录整块互换**
 * （`qmemcpy` 两条 × 0x2E4 = 740 字节，raw 131135-131139），并置脏位 `obj[11627] = 1`；
 * 某一侧缺键 ⇒ 先 `sub_40C910` 建一条全 0 记录（`flags` 无 bit0 ⇒ 不画）再搬；两侧都缺 ⇒ 只置脏位。
 * ⇒ **键（handle）不动**：纹理槽 / 源矩形 / 描画位置 / pivot / 5 个动画窗 / 颜色 / 矩阵 / flipbook 全换，
 * **绘制次序不变**（层序 = map key，见 `draw-texture` 的注释）。
 * ★只碰绘图项表；网格表（`obj+1064`）不动 —— 与 `0x21D` CopyScene（两张表都拷）不同。
 * ★引擎没有任何错误串 ⇒ 两侧都不存在是**合法无操作**，emulator 不得把它当失败。
 *
 * 语料 229 处：ADV 各脚本的收场块把两套立绘句柄基址（`global f8023..f8028`）里第 i 个互换，
 * 再把脚本自己的记账表 `3f54` 的两列也换掉（`$1$SC0330.txt:6324-6336`、`SC0000.txt:6885-6895` 同型）。
 */
const op_swap_items: OpHandler = (c) => {
  const plan = planFor(c);
  const a = (plan.int(1) ?? 0); // 引擎先读 op2 再读 op1（顺序无语义影响）
  const b = (plan.int(2) ?? 0);
  c.native.swapItems?.(a, b);
};

/**
 * **`0x230`（sub_4243B0, raw 32105-32113, argc=1）：停绘制项的 B 层（bit2）周期动画层**。
 *
 * 引擎体（raw 32110-32112）：`arity 槽 = 3`（⇒ argc 1）、`v2 = op1`（int，绘制项 handle）→
 * `sub_4AD580(_this + 80708, v2)`。`sub_4AD580`（raw 132151-132217）体内真实分支：
 * `*v4 &= ~4u`（raw 132173 清 bit2）+ 循环清 `{540,544,548,552,556,560}`（raw 132174-132215）。
 * ★**没有 `flags & 1` 门控**（`sub_4AAA50` 缺失即建项 ⇒ 对不存在的 handle 也成功，不报错）；
 * ★**不置 Scene 脏位**（该族唯一一条）—— emulator 侧由 `scResetDrawItemLoop` 置脏并写明这一差异。
 */
const op_reset_draw_item_loop: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  c.native.setDrawItemLoop?.({ op: 'reset', handle });
};

/**
 * **`0x231`（sub_4243F0, raw 32115-32129, argc=4）：贴图换格循环动画**。
 * 引擎：op1=handle、op2=周期 ms（`+560`）、op3=总格数（`+568`）、op4=每行列数（`+572`）
 * → `sub_4AD690`（raw 132219-132239：`|= 4u`、`+540=0`、`+560/568/572 = op2/3/4`、置脏）。
 * ★`+568/+572` 与 A 层 `0x239` **共用**（两个分支都在 `eval.ts` 里）。
 */
const op_set_flipbook_loop: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const period = (plan.int(2) ?? 0);
  const frames = (plan.int(3) ?? 0);
  const cols = (plan.int(4) ?? 0);
  c.native.setDrawItemLoop?.({ op: 'flipbook', handle, period, frames, cols });
};

/**
 * **`0x232`（sub_424440, raw 32131-32164, argc=4）：颜色往复动画**。
 * 引擎：op1=handle、op2=周期 ms（`+544`）、op3=**alpha**、op4=**rgb**（组装 `+576 = α<<24|rgb`）
 * → `sub_4AD730`（raw 132241-132258）。raw 32144-32160 有 clamp/回退：`op3 > 255 ⇒ 255`、
 * `op3 < 0`/`op4 < 0` ⇒ 取**当前色 `+96`**（`sub_4ADD60` raw 132583-132587，缺项返回 −1）
 * —— 回退在 `scene/ops.ts` 的 `scSetColorLoop` 里做（只有它持有 `Item.from`）。
 */
const op_set_color_loop: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const period = (plan.int(2) ?? 0);
  const alpha = (plan.int(3) ?? 0);
  const rgb = (plan.int(4) ?? 0);
  c.native.setDrawItemLoop?.({ op: 'color', handle, period, alpha, rgb });
};

/**
 * **`0x233`（sub_424510, raw 32166-32182, argc=5）：缩放往复动画**。
 * 引擎：op1=handle、op2=周期 ms（`+548`）、op3/op4/op5 = sx/sy/sz（raw 32176-32178 **各 ÷100**，
 * `dbl_5201F0`）→ `sub_4AD7B0`（raw 132260-132286：`|= 4u`、`+528=0`、`+548=op2`、
 * `D3DXMatrixScaling(元素+592, …)`）。
 * ★订正：旧注写"图元尺寸动画"**是错的**（那是 A 层 `0x21E` 的语义；本条是 B 层缩放通道）。
 */
const op_set_scale_loop: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const period = (plan.int(2) ?? 0);
  const sx = (plan.float(3) ?? 0) / 100; // dbl_5201F0 = 100.0
  const sy = (plan.float(4) ?? 0) / 100;
  const sz = (plan.float(5) ?? 0) / 100;
  c.native.setDrawItemLoop?.({ op: 'scale', handle, period, sx, sy, sz });
};

/**
 * **`0x234`（sub_4245B0, raw 32185-32201, argc=5）：匀速旋转动画**。
 * 引擎：op1=handle、op2=周期 ms（`+552`）、op3/op4/op5 = **旋转轴**（float，**不除**；写
 * `元素[145..147]` = `+580/584/588`）→ `sub_4AD850`（raw 132289-132314）。
 *
 * ★★**订正（以体为准）**：旧注/筛体文档把本条记成"**平移窗（窗3）**、`+532=0` + `+552=op2` 是时长、
 *   与 `0x220` 同字段"——**字段名对、结论错**：`+532/+552/+580..588` 在消费端（raw 118222-118228）
 *   是**旋转通道**（`D3DXMatrixRotationAxis`，角度 = `360·((now−start) % period)/period`）。
 *   平移往复是 `0x235`（`+536/+556/+656`）。语料印证：`src/SC0000.txt:16096` 的轴是 `(0,0,±1)`。
 */
const op_set_rotation_loop: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const period = (plan.int(2) ?? 0);
  const ax = (plan.float(3) ?? 0);
  const ay = (plan.float(4) ?? 0);
  const az = (plan.float(5) ?? 0);
  c.native.setDrawItemLoop?.({ op: 'rotate', handle, period, ax, ay, az });
};

/**
 * **`0x235`（sub_424630, raw 32203-32219, argc=5）：平移往复（ping-pong）动画**。
 * 引擎：op1=handle、op2=周期 ms（`+556`）、op3/op4/op5 = 位移（float，**不除**）→ `sub_4AD900`
 * （raw 132316-132343：`|= 4u`、`+536=0`、`+556=op2`、`D3DXMatrixTranslation(元素+656, …)`）。
 * 消费端 raw 118232-118341 = 三角波。
 */
const op_set_translation_loop: OpHandler = (c) => {
  const plan = planFor(c);
  const handle = (plan.int(1) ?? 0);
  const period = (plan.int(2) ?? 0);
  const tx = (plan.float(3) ?? 0);
  const ty = (plan.float(4) ?? 0);
  const tz = (plan.float(5) ?? 0);
  c.native.setDrawItemLoop?.({ op: 'translate', handle, period, tx, ty, tz });
};

/**
 * **`0x244`（sub_41A370, raw 25349-25355, argc=0）：批量清 A 层动画窗起点**。
 *
 * 引擎体极短：`arity 槽 = 1`（⇒ argc 0）、`return sub_4AD9F0(_this + 80708, 2)`。
 * `sub_4AD9F0`（raw 132364-132503）遍历 **Scene 的三张表**，对 `(2 & flags) != 0` 的元素把窗起点清 0：
 *  - `Scene+1036`（绘制项 740B）⇒ `*(elem + 52) = 0`（raw 132401-132403）= **`Item.animStart`**；
 *  - `Scene+1084` / `Scene+1100`（两张 572B 表）⇒ `*(node + 24) = 0`（raw 132438-132440 / 132476-132478）。
 *
 * ★本条**不是** no-op（它此前被登记在 `ENGINE_INTERNAL_OPS`）；语义 = "让所有还挂着的 A 层动画窗
 *   重新计时"（`winPhase` 下一帧重新锁存 now）。emu 侧落 `scClearDrawItemAnimStarts`。
 * ★两张 572B 表**未建模**（`L2dNode` 没有"起点"字段）⇒ 如实记缺口（见 `scene/ops.ts` 的注释）。
 * ★语料：全库仅 1 处（`src/CALLBACK_LOAD.txt:18` 的 `i244`，读档收尾那一跳）。
 */
const op_clear_draw_item_anim_starts: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.clearDrawItemAnimStarts?.(2); // 引擎立即数 2（raw 25353）
};

/**
 * 绘制项位置/变换/颜色/几何。
 *
 * ★两张表的分界**不是**"有没有转发 native"（这些全都转发），而是**注册在哪个 handler 表**：
 * `OPS`(implemented) 与 `NATIVE_OPS`(native) 的区别会体现在 StepTrace.handlerKind 上，
 * 是既有口径，拆文件时**逐条照搬**、不作重新分类。
 */
export const GFX_ITEM_OPS: OpTable = [
  [0x219, op_set_draw_pos], // 描画位置 (x,y,z) → native（DrawItem+36/+40/+44）
  [0x21e, op_set_scale_matrix], // 缩放动画窗（窗1；sx/sy/sz ÷100，`dbl_5201F0` raw 4430）→ native.setScaleAnim
  [0x21f, op_set_rotation_anim], // 旋转动画窗（窗2；轴+角度）→ native.setRotationAnim
  [0x220, op_set_translation_anim], // 平移动画窗（窗3）→ native.setTranslationAnim
  [0x239, op_set_flipbook], // flipbook 动画窗（窗4；帧数/列数/标志）→ native.setFlipbook
  // ---- B 层（`Item.flags` bit2）周期/循环动画层（2026-09，B3；见 handlers/gfx-item.ts 各 handler 注释）----
  [0x230, op_reset_draw_item_loop], // 停全部 B 层通道 → native.setDrawItemLoop({op:'reset'})
  [0x231, op_set_flipbook_loop], // 贴图换格循环（周期/格数/列数）→ native.setDrawItemLoop({op:'flipbook'})
  [0x232, op_set_color_loop], // 颜色往复（周期 + α/rgb，负值回退当前色）→ {op:'color'}
  [0x233, op_set_scale_loop], // 缩放往复（周期 + sx/sy/sz ÷100）→ {op:'scale'}
  [0x234, op_set_rotation_loop], // 匀速旋转（周期 + 轴，不除）→ {op:'rotate'}
  [0x235, op_set_translation_loop], // 平移往复（周期 + 位移，不除）→ {op:'translate'}
  [0x244, op_clear_draw_item_anim_starts], // 批量清 A 层窗起点（mask=2）→ native.clearDrawItemAnimStarts
  [0x1f6, op_clear_draw_container], // 整批释放绘制项/网格 → native.clearDrawContainer
  [0x1fd, op_set_scale], // 3D 缩放变换（百分数）→ native.setScale
  [0x1ff, op_set_draw_translation], // DrawItem 像素平移（+0x68 用世界矩阵 / +0x16C work 矩阵）→ native
  // ---- ★Scene 级世界矩阵四条（2026-09）：改的是 Scene 自己的变换块，只作用于层号 ∈ [20,30) 的项 ----
  [0x22a, op_scene_scale], // Scene 立即缩放（三 float ÷100）→ native.setSceneScale
  [0x22c, op_scene_translation], // Scene 立即平移（三 float 不除）→ native.setSceneTranslation
  [0x22d, op_scene_axis_scale], // Scene 带轴缩放（op1/2 int + 三 float ÷100）→ native.setSceneAxisScale
  [0x22f, op_scene_axis_translation], // Scene 带轴平移（op1/2 int + 三 float 不除）→ native.setSceneAxisTranslation
  [0x214, op_swap_items], // i214：交换两条绘图项记录（键不动；只碰绘图项表）→ native.swapItems
  [0x21d, op_copy_scene], // CopyScene（源项 → 目标 handle 整份复制）→ native.copyScene
  // ---- 转场记录表 `Scene+1048`（帧渲染器 `sub_4B06D0` 按 `[0]` 分四类；同表的 0x24F/0x250/0x251 在 gfx-state.ts）----
  [0x223, op_set_transition_fade], // ★类别 0（全屏交叉淡化）写入端：键=op1、写 [0]=0/[1]=0/[2]=op7…[8]=op6 → native.setTransition
  // ---- 查询族（回写操作数；见文件头「查询指令族」说明）----
  [0x215, op_get_draw_texture_slot], // op1 = DrawItem(op2).纹理槽号 / −1
  [0x216, op_get_slot_imgid], // op1 = 纹理槽 op2 绑定的 imgid（Engine[5*slot+466]）
  [0x218, op_get_draw_pivot], // op2/3/4 = DrawItem(op1) 的 pivot (x,y,z)
  [0x21a, op_get_draw_pos], // op2/3/4 = DrawItem(op1) 的描画位置 (x,y,z)
  [0x228, op_get_item_translation], // op1 = 成功标志、op3/4/5 = DrawItem(op2) 当前**平移**（`+0x16C` work 矩阵）
];

/** 绘制项的 native 路由表（`handlerKind === 'native'`）。 */
export const GFX_ITEM_NATIVE_OPS: OpTable = [
  [0x217, op_set_object_transform], // 对象变换 pivot → native.setDrawPivot（DrawItem+24/+28/+32）
  [0x320, op_mesh_create], // → native.createMesh（顶点缓冲/几何）
  [0x322, op_set_vertex_color], // → native.setVertexColor（mesh state0）
  [0x323, op_set_vertex_color_alpha], // → native.setVertexColorAlpha（动画窗）
  [0x202, op_set_draw_color], // → native.setDrawColor（delay/count/to）
  [0x203, op_set_draw_color_alpha], // → native.setDrawColorAlpha（from）
];

