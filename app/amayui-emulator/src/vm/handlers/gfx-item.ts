/**
 * 绘制项（DrawItem / Mesh）族：位置、pivot、平移、缩放、颜色、以及**四个动画窗**。
 *
 * Plan A 的核心约定：指令只**配置对象**，渲染器每帧 `present()` 合成整个场景图，
 * 渲染与 VM 指令解耦。因此这里全部是「读操作数 → 写渲染器里的对象」的转发。
 *
 * 四个动画窗（引擎 DrawItem 的 `+48..+88` 窗槽，见 docs/08）：
 *  - 窗1 `0x21E` 缩放（sx/sy/sz **÷100**）／窗2 `0x21F` 旋转（轴+角，**度**）
 *  - 窗3 `0x220` 平移（**不除**，像素）／窗4 `0x239` flipbook（帧数/列数/标志，bit0=保持末帧）
 * ★ 缩放的除数 100（`dbl_5201F0`）与平移到像素、旋转到度的差异，都是指令级的既有差异，切勿"统一"。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, readFloatOperand, writeIntOperand, writeFloatOperand } from '../operand.js';
import type { OpTable } from './shared.js';

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
  const handle = readIntOperand(c.e, c.frame, c.instr, 2);
  const slot = c.native.getDrawItemTexSlot?.(handle);
  writeIntOperand(c.e, c.frame, c.instr, 1, slot === undefined || slot < 0 ? -1 : slot);
};

/**
 * `0x216`（sub_430380 raw 39891-39899）：**纹理槽 → 它绑定的图像 id（imgid）**。
 *
 * 引擎：`v2 = op2`（槽号）→ `op1 = Engine[5 * v2 + 81174]`。
 * ★这个下标就是 `Scene[5 * slot + 466]`（`Engine+80708` = Scene 基址）——
 * 即 `set-texture`（0x1F9）写的**唯一槽↔图像绑定表**（`docs/10-texture-slot-to-agf-file.md`）。
 * 槽从未绑定过时该格为 0（引擎不初始化，是 bss 0）。
 * emulator 侧同一张表 = `Engine.texSlots`（`0x1F9` 写、`0x1FA` 清）。
 *
 * 语料：`src/SN0000.txt:3128 i216 (global-int a9ba) (global-int f801f)` —— 把"当前立绘用的槽"
 * 换成 imgid 存起来，供后续 `i2ff`（按 imgid 播语音/取资源）用。
 */
const op_get_slot_imgid: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.texSlots.get(slot) ?? 0);
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
  const e = c.e;
  const handle = readIntOperand(e, c.frame, c.instr, 1);
  const p = c.native.getDrawItemPivot?.(handle) ?? { x: 0, y: 0, z: 0 };
  writeFloatOperand(e, c.frame, c.instr, 2, p.x);
  writeFloatOperand(e, c.frame, c.instr, 3, p.y);
  writeFloatOperand(e, c.frame, c.instr, 4, p.z);
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
  const e = c.e;
  const handle = readIntOperand(e, c.frame, c.instr, 1);
  const p = c.native.getDrawItemPos?.(handle) ?? { x: 0, y: 0, z: 0 };
  writeFloatOperand(e, c.frame, c.instr, 2, p.x);
  writeFloatOperand(e, c.frame, c.instr, 3, p.y);
  writeFloatOperand(e, c.frame, c.instr, 4, p.z);
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
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const x = readFloatOperand(c.e, c.frame, c.instr, 2);
  const y = readFloatOperand(c.e, c.frame, c.instr, 3);
  const z = readFloatOperand(c.e, c.frame, c.instr, 4);
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
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const dur = readIntOperand(c.e, c.frame, c.instr, 3);
  const sx = readFloatOperand(c.e, c.frame, c.instr, 4) / 100; // dbl_5201F0 = 100.0
  const sy = readFloatOperand(c.e, c.frame, c.instr, 5) / 100;
  const sz = readFloatOperand(c.e, c.frame, c.instr, 6) / 100;
  c.native.setScaleAnim?.(handle, delay, dur, sx, sy, sz);
};

/**
 * **`0x21F`（sub_423D40, raw 31867，argc=7）：旋转动画窗（窗2）**。
 * 引擎：`op1`=handle、`op2`=delay、`op3`=dur、`op4/5/6`=旋转轴 (x,y,z)、`op7`=角（**度**）
 * → `sub_4AD250(Scene, handle, delay, dur, ax, ay, az, deg)`：`+64=delay`、`+84=dur`、`+104=1`、
 * 轴/角存目标 `+0x1F8..0x208`、`D3DXMatrixRotationAxis(元素+0x12C, axis, deg·π/180)`。
 */
const op_set_rotation_anim: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const dur = readIntOperand(c.e, c.frame, c.instr, 3);
  const ax = readFloatOperand(c.e, c.frame, c.instr, 4);
  const ay = readFloatOperand(c.e, c.frame, c.instr, 5);
  const az = readFloatOperand(c.e, c.frame, c.instr, 6);
  const deg = readFloatOperand(c.e, c.frame, c.instr, 7);
  c.native.setRotationAnim?.(handle, delay, dur, ax, ay, az, deg);
};

/**
 * **`0x220`（sub_423DE0, raw 31889，argc=6）：平移动画窗（窗3）**。
 * 引擎：`op1`=handle、`op2`=delay、`op3`=dur、`op4/5/6`=位移 (x,y,z)（**不除 256**，与 0x21E 不同）
 * → `sub_4AD3C0`：`+68=delay`、`+88=dur`、`+104=1`、`D3DXMatrixTranslation(元素+0x1AC, x, y, z)`。
 */
const op_set_translation_anim: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const dur = readIntOperand(c.e, c.frame, c.instr, 3);
  const x = readFloatOperand(c.e, c.frame, c.instr, 4);
  const y = readFloatOperand(c.e, c.frame, c.instr, 5);
  const z = readFloatOperand(c.e, c.frame, c.instr, 6);
  c.native.setTranslationAnim?.(handle, delay, dur, x, y, z);
};

/**
 * **`0x239`（sub_424900, raw 32315，argc=6）：flipbook 动画窗（窗4）**。
 * 引擎：`op1`=handle、`op2`=delay(`+0x48`)、`op3`=dur(`+0x5C`)、`op4`=总帧数(`+0x238`)、
 * `op5`=每行列数(`+0x23C`)、`op6`=标志(`+0x234`，bit0 = 窗末**保持末帧**)
 * → `sub_4AD4A0`。逐帧把帧序号写成**源矩形**偏移（引擎 raw 117797-117831），不是 UV。
 */
const op_set_flipbook: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const dur = readIntOperand(c.e, c.frame, c.instr, 3);
  const frames = readIntOperand(c.e, c.frame, c.instr, 4);
  const cols = readIntOperand(c.e, c.frame, c.instr, 5);
  const flags = readIntOperand(c.e, c.frame, c.instr, 6);
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
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const sx = readFloatOperand(c.e, c.frame, c.instr, 2) / 100; // dbl_5201F0 = 100.0
  const sy = readFloatOperand(c.e, c.frame, c.instr, 3) / 100;
  const sz = readFloatOperand(c.e, c.frame, c.instr, 4) / 100;
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
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const x = readFloatOperand(c.e, c.frame, c.instr, 2);
  const y = readFloatOperand(c.e, c.frame, c.instr, 3);
  const z = readFloatOperand(c.e, c.frame, c.instr, 4);
  c.native.setDrawTranslation?.(handle, x, y, z);
};


/**
 * **`0x1F6`（sub_41A130, raw 25239）：清/重置绘制容器** `sub_4AB7A0(_this+80708)`。
 * 引擎里这是**唯一**会整批释放绘制项/网格的指令（扫描容器并 delete）；emulator 的等价语义 = 清空
 * `drawItems` + `meshes`（**保留纹理槽**）。★注意：这才是"合法的整批清场"，与"换脚本就清"无关。
 */
const op_clear_draw_container: OpHandler = (c) => {
  c.native.clearDrawContainer?.();
};

/**
 * `0x217`（sub_423B20, raw 31791）：**对象变换 pivot** —— 读 op1=handle、op2/op3/op4 三个 float，
 * 调 `sub_4ACF20(_this+80708, handle, f2, f3, f4)`：`sub_4AAA50` 保证 key 存在 → `map[key]` →
 * 写元素下标 `6/7/8` = DrawItem`+24/+28/+32` = **回転/拡大縮小の中心（pivot）**，并置脏 `_this[11627]=1`。
 * 绘制期 `sub_49AA30` 用 `T(-pivot) → 动画矩阵 → T(+pivot)` 把它夹在动画矩阵外侧 ⇒ 只改基准点、不改位置。
 * ★与 `0x219`（sub_4ACEE0，写 `+36/+40/+44` = 描画位置）是**两个不同的 float 三元组**，不可混用同一 native 方法。
 */
const op_set_object_transform: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const a = readFloatOperand(c.e, c.frame, c.instr, 2);
  const b = readFloatOperand(c.e, c.frame, c.instr, 3);
  const d = readFloatOperand(c.e, c.frame, c.instr, 4);
  c.native.setDrawPivot?.(handle, a, b, d);
};

const op_mesh_create: OpHandler = (c) => {
  // u0043AA20 (0x320)：op1=handle, op9=vcount, op10=layer/tail；顶点源暂用默认满屏四边形。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const layer = readIntOperand(c.e, c.frame, c.instr, 10);
  const vcount = readIntOperand(c.e, c.frame, c.instr, 9);
  const verts = Array.from({ length: Math.max(0, vcount) }, () => ({ x: 0, y: 0, u: 0, w: 1, diffuse: 0xffffffff }));
  c.native.createMesh?.({ handle, layer, vcount, verts });
};
const op_set_vertex_color: OpHandler = (c) => {
  // 0x322：op1=handle, op3=alpha, op4=rgb → state0 (ARGB)。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const a = readIntOperand(c.e, c.frame, c.instr, 3);
  const b = readIntOperand(c.e, c.frame, c.instr, 4);
  c.native.setVertexColor?.(handle, ((a & 0xff) << 24) | (b & 0xffffff));
};
const op_set_vertex_color_alpha: OpHandler = (c) => {
  // 0x323：op1=handle, op2=delay, op3=count, op4=alpha, op5=rgb → state1 (ARGB)。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const count = readIntOperand(c.e, c.frame, c.instr, 3);
  const a = readIntOperand(c.e, c.frame, c.instr, 4);
  const b = readIntOperand(c.e, c.frame, c.instr, 5);
  c.native.setVertexColorAlpha?.(handle, delay, count, ((a & 0xff) << 24) | (b & 0xffffff));
};
const op_set_draw_color: OpHandler = (c) => {
  // 0x202：op1=handle, op2=delay, op3=count, op4=alpha, op5=rgb → to (ARGB)。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const count = readIntOperand(c.e, c.frame, c.instr, 3);
  const a = readIntOperand(c.e, c.frame, c.instr, 4);
  const b = readIntOperand(c.e, c.frame, c.instr, 5);
  c.native.setDrawColor?.(handle, delay, count, ((a & 0xff) << 24) | (b & 0xffffff));
};
const op_set_draw_color_alpha: OpHandler = (c) => {
  // 0x203 (sub_4232C0)：op1=handle, op2=blend(+48), op3=alpha(clamp/回退), op4=color(回退) → ARGB。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const alpha = readIntOperand(c.e, c.frame, c.instr, 3);
  const color = readIntOperand(c.e, c.frame, c.instr, 4);
  const argb = ((alpha & 0xff) << 24) | (color & 0xffffff);
  c.native.setDrawColorAlpha?.(handle, argb);
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
  const src = readIntOperand(c.e, c.frame, c.instr, 1);
  const dst = readIntOperand(c.e, c.frame, c.instr, 2);
  const r = c.native.copyScene?.(src, dst);
  if (r === false) {
    // 引擎打错误串（可见日志），emulator 同样留痕、不静默。
    c.log(`  [CopyScene] 复制源不存在：src=0x${src.toString(16)} dst=0x${dst.toString(16)}（引擎「コピー元のシーンが存在しません」）`);
  }
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
  [0x21e, op_set_scale_matrix], // 缩放动画窗（窗1；sx/sy/sz ÷256）→ native.setScaleAnim
  [0x21f, op_set_rotation_anim], // 旋转动画窗（窗2；轴+角度）→ native.setRotationAnim
  [0x220, op_set_translation_anim], // 平移动画窗（窗3）→ native.setTranslationAnim
  [0x239, op_set_flipbook], // flipbook 动画窗（窗4；帧数/列数/标志）→ native.setFlipbook
  [0x1f6, op_clear_draw_container], // 整批释放绘制项/网格 → native.clearDrawContainer
  [0x1fd, op_set_scale], // 3D 缩放变换（百分数）→ native.setScale
  [0x1ff, op_set_draw_translation], // DrawItem 像素平移（+0x68 用世界矩阵 / +0x16C work 矩阵）→ native
  [0x21d, op_copy_scene], // CopyScene（源项 → 目标 handle 整份复制）→ native.copyScene
  // ---- 查询族（回写操作数；见文件头「查询指令族」说明）----
  [0x215, op_get_draw_texture_slot], // op1 = DrawItem(op2).纹理槽号 / −1
  [0x216, op_get_slot_imgid], // op1 = 纹理槽 op2 绑定的 imgid（Engine[5*slot+466]）
  [0x218, op_get_draw_pivot], // op2/3/4 = DrawItem(op1) 的 pivot (x,y,z)
  [0x21a, op_get_draw_pos], // op2/3/4 = DrawItem(op1) 的描画位置 (x,y,z)
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

