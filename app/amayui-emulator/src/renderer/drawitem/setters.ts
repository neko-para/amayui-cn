/**
 * setter（指令 → 模型的写入端）。
 *
 * 每个 setter 对应一条 opcode 的引擎 handler；字段偏移见 `model.ts` 文件头的表。
 * 共同副作用：置脏由调用方（渲染后端）负责；这里只改模型。
 * 引擎里 5 个动画 setter 都会把共享起点 `+0x34` 写 0（"下一帧重新锁存"）——
 * 见 `sub_4AD0C0` raw 131970 / `sub_4AD170` 132002 / `sub_4AD250` 132047 /
 * `sub_4AD3C0` 132099 / `sub_4AD4A0` 132134。
 */
import type { Item, MeshObj } from './model.js';
import { ITEM_FLAG_ANIM_LOOP, W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from './model.js';

// ---------------------------------------------------------------------------
// setter（指令 → 模型的写入端）
//
// 每个 setter 对应一条 opcode 的引擎 handler；字段偏移见文件头的表。
// 共同副作用：置脏由调用方（渲染后端）负责；这里只改模型。
// 引擎里 5 个 setter 都会把共享起点 `+0x34` 写 0（"下一帧重新锁存"）——
// 见 `sub_4AD0C0` raw 131970 / `sub_4AD170` 132002 / `sub_4AD250` 132047 /
// `sub_4AD3C0` 132099 / `sub_4AD4A0` 132134。
// ---------------------------------------------------------------------------

/** `0x203` set-draw-color-alpha（`sub_4ACF60`）：写 `+0x30` 混合模式、`+0x60` 工作色（FROM）。 */
export function applyDrawColorAlpha(it: Item, from: number, blend = 0): void {
  it.blend = blend;
  it.from = from >>> 0;
}

/** `0x202` set-draw-color（`sub_4AD0C0`）：置 bit1、`+0x34=0`、`+0x38` delay、`+0x4C` dur、`+0x64` TO。 */
export function applyDrawColor(it: Item, delay: number, dur: number, to: number): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_COLOR] = { delay, dur, set: true };
  it.to = to >>> 0;
}

/**
 * `0x21E`（`sub_4AD170`）：置 `+0x3C` delay、`+0x50` dur、`+0xAC` 目标缩放（sx/sy/sz 已 ÷100）、
 * `+0x68 = 1`（用世界矩阵，raw 132009）。
 */
export function applyScaleAnim(it: Item, delay: number, dur: number, sx: number, sy: number, sz: number): void {
  it.flags |= 2;
  it.useWorld = true; // raw 132009
  it.animStart = 0;
  it.wins[W_SCALE] = { delay, dur, set: true };
  it.scaleTarget = { x: sx, y: sy, z: sz };
}

/**
 * `0x21F`（`sub_4AD250`）：置 `+0x40` delay、`+0x54` dur、`+0x1F8..0x208` 目标轴/角（度）、
 * `+0x68 = 1`（raw 132053）。
 */
export function applyRotationAnim(
  it: Item,
  delay: number,
  dur: number,
  ax: number,
  ay: number,
  az: number,
  deg: number,
): void {
  it.flags |= 2;
  it.useWorld = true; // raw 132053
  it.animStart = 0;
  it.wins[W_ROT] = { delay, dur, set: true };
  it.rotTarget = { axis: { x: ax, y: ay, z: az }, deg };
}

/**
 * `0x220`（`sub_4AD3C0`）：置 `+0x44` delay、`+0x58` dur、`+0x1AC` 目标平移（**不除**，像素）、
 * `+0x68 = 1`（raw 132106）。
 */
export function applyTranslationAnim(
  it: Item,
  delay: number,
  dur: number,
  x: number,
  y: number,
  z: number,
): void {
  it.flags |= 2;
  it.useWorld = true; // raw 132106
  it.animStart = 0;
  it.wins[W_TRANS] = { delay, dur, set: true };
  it.transTarget = { x, y, z };
}

/** `0x239`（`sub_4AD4A0`）：置 `+0x48` delay、`+0x5C` dur、`+0x238` 帧数、`+0x23C` 列数、`+0x234` 标志。 */
export function applyFlipbook(
  it: Item,
  delay: number,
  dur: number,
  frames: number,
  cols: number,
  flags: number,
): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_FLIPBOOK] = { delay, dur, set: true };
  it.fbFrames = frames;
  it.fbCols = cols;
  it.fbFlags = flags;
}

// ---------------------------------------------------------------------------
// **B 层（`Item.flags` bit2）周期/循环动画层** —— opcode `0x230`–`0x235`
//
// 六条 setter 全部（依据 = 逐条读体）：
//  - **没有 `flags & 1` 门控** ⇒ "项不存在时建一个 bit0=0（不可见）的项"并把动画配上，不报错
//    （`sub_4AAAD50`/`sub_4AAA50` 的缺失即建项，见 `scene/ops.ts` 的 `scEnsureItem`）；
//  - **不写 `+104`（useWorld）**：引擎只在**渲染期**强制"世界矩阵有效"（raw 133395），
//    对应的 emulator 侧判据是 `itemUsesWorld()`（见 `eval.ts`）；
//  - 除 `0x230`（`sub_4AD580` **不置脏**）之外五条都置 `Scene+46508`（raw 132237/132256/132284/132312/132340）。
//
// 消费端 = `sub_49BCC0`（raw 117944-118365，5 条通道各自 `if (周期 > 0)`），见 `eval.ts`。
// 规格文档：`docs-new/03-engine/b3-bit2-model-spec-2026-09.md`。
// ---------------------------------------------------------------------------

/**
 * `0x230`（`sub_4243B0` raw 32105-32113 → `sub_4AD580` raw 132151-132217）：**停全部 B 层通道**。
 *
 * 引擎逐字：`*v4 &= ~4u`（bit2，raw 132173）→ 循环 `do { *(elem + v5-4) = 0; *(elem + v5) = 0; v5 += 4; }
 * while (v5 < 564)`，`v5 = 544,548,552,556,560` ⇒ **实际写的格子 = {540,544,548,552,556,560}**
 * （= 5 条通道的周期 + `W_FLIPBOOK` 的起点槽）。
 *
 * ★两处必须与体一致、不能"顺手清干净"：
 *  - **`+524/+528/+532/+536` 四个起点槽不清**（循环下界是 544，它们的值留给各自的 setter 重置）；
 *  - **不碰 bit1 + 5 个 A 层窗**（`sub_4AD580` 全程没有 `|= 2`/`&= ~2`）⇒"停掉全部动画窗"的说法不准确，
 *    它停的是 **B 层（bit2）**。
 */
export function applyDrawItemLoopReset(it: Item): void {
  it.flags &= ~ITEM_FLAG_ANIM_LOOP; // raw 132173
  for (const l of it.loops) l.period = 0; // raw 132174-132215：周期 544/548/552/556/560
  it.loops[W_FLIPBOOK]!.start = 0; // 同循环的 `v5-4 = 540`（唯一被清的起点槽）
}

/**
 * `0x231`（`sub_4243F0` raw 32115-32129 → `sub_4AD690` raw 132219-132239）：**贴图换格循环**。
 * `|= 4u`（132229）、`+540 = 0`（132230，起点槽）、`+560 = op2`（周期 ms，132232）、
 * `+568 = op3`（总格数，132234）、`+572 = op4`（每行列数，132236）。
 * ★`+568/+572` 与 A 层 `0x239` **共用**（引擎如此），模式靠 bit1/bit2 区分 ⇒ 两层分支都要在。
 */
export function applyFlipbookLoop(it: Item, period: number, frames: number, cols: number): void {
  it.flags |= ITEM_FLAG_ANIM_LOOP; // raw 132229
  it.loops[W_FLIPBOOK]!.start = 0; // raw 132230
  it.loops[W_FLIPBOOK]!.period = period; // raw 132232
  it.fbFrames = frames; // raw 132234（与 A 层共用）
  it.fbCols = cols; // raw 132236（与 A 层共用）
}

/**
 * `0x232`（`sub_424440` raw 32131-32164 → `sub_4AD730` raw 132241-132258）：**颜色往复**。
 * `|= 4u`（132250）、`+524 = 0`（起点槽）、`+544 = op2`（周期）、`+576 = argb`（目标色）。
 *
 * ★**操作数**：op3 = **alpha**、op4 = **rgb**（handler raw 32142-32163：`v2=op3` 按 alpha 夹/回退、
 *   `v3=op4` 按 rgb 回退），组装 `(alpha<<24)|(r<<16)|(g<<8)|b`。
 * ★**回退分支**（`sub_4ADD60` = 取元素 `+96` 当前色，raw 132583-132587；项缺失返回 −1）：
 *   `op3 < 0` ⇒ alpha 取当前色 alpha（= 0xff 当项缺失）；`op4 < 0` ⇒ rgb 取当前色 rgb（= 0xffffff）。
 *   `op3 > 255` ⇒ 夹到 255。回退在 `scene/ops.ts` 的 `scSetColorLoop` 里做（它持有 `Item.from`）。
 */
export function applyColorLoop(it: Item, period: number, to: number): void {
  it.flags |= ITEM_FLAG_ANIM_LOOP; // raw 132250
  it.loops[W_COLOR]!.start = 0; // raw 132251（+524）
  it.loops[W_COLOR]!.period = period; // raw 132253（+544）
  it.loopTo = to >>> 0; // raw 132255（+576）
}

/**
 * `0x233`（`sub_424510` raw 32166-32182 → `sub_4AD7B0` raw 132260-132286）：**缩放往复**。
 * `|= 4u`、`+528 = 0`（起点槽）、`+548 = op2`（周期）、`D3DXMatrixScaling(+592, op3,op4,op5)`
 * —— handler raw 32176-32178 三个操作数**各 ÷100**（`dbl_5201F0`）。
 * ★订正：旧注写"图元尺寸动画"是**错的**（这里是 B 层缩放通道，与 `0x21E` 的 A 层缩放窗同语义不同层）。
 */
export function applyScaleLoop(it: Item, period: number, sx: number, sy: number, sz: number): void {
  it.flags |= ITEM_FLAG_ANIM_LOOP; // raw 132274
  it.loops[W_SCALE]!.start = 0; // raw 132275（+528）
  it.loops[W_SCALE]!.period = period; // raw 132279（+548）
  it.loopScale = { x: sx, y: sy, z: sz }; // raw 132283（+592 缩放矩阵）
}

/**
 * `0x234`（`sub_4245B0` raw 32185-32201 → `sub_4AD850` raw 132289-132314）：**匀速旋转**。
 * `|= 4u`（132301）、`+532 = 0`（起点槽，132302）、`+552 = op2`（周期，132306）、
 * `元素[145..147] = op3/op4/op5`（float，**不除**，132309-132311；元素下标 145..147 × 4 字节 = `+580/584/588`）。
 *
 * ★★**订正（体为准）**：旧注/筛体文档把 `0x234` 记成"**平移窗（窗3）**、与 `0x220` 同字段、消费端
 *   raw 118232-118238"——**与体不符**。逐字段核对：`+532` 是旋转通道的起点槽、`+552` 是旋转通道的周期、
 *   `+580/584/588` 是**旋转轴**（`sub_49BCC0` raw 118225-118228 用它们做 `D3DXMatrixRotationAxis`）；
 *   平移往复用的是 `+536/+556/+656`，写它们的是 `0x235`（`sub_4AD900`）。
 *   ⇒ `0x234` = **匀速旋转 B 层通道**（角度由周期推：raw 118227
 *   `angle = 360·((now−start) % period)/period`，即**每个周期转一圈**）。
 */
export function applyRotationLoop(it: Item, period: number, ax: number, ay: number, az: number): void {
  it.flags |= ITEM_FLAG_ANIM_LOOP; // raw 132301
  it.loops[W_ROT]!.start = 0; // raw 132302（+532）
  it.loops[W_ROT]!.period = period; // raw 132306（+552）
  it.loopAxis = { x: ax, y: ay, z: az }; // raw 132309-132311（+580/584/588）
}

/**
 * `0x235`（`sub_424630` raw 32203-32219 → `sub_4AD900` raw 132316-132343）：**平移往复**。
 * `|= 4u`（132330）、`+536 = 0`（起点槽）、`+556 = op2`（周期）、
 * `D3DXMatrixTranslation(+656, op3, op4, op5)`（float，**不除**；handler raw 32213-32215 原样读 float）。
 * 消费端 raw 118232-118341 = 三角波（ping-pong），幅度 = `(op3,op4,op5)`。
 */
export function applyTranslationLoop(it: Item, period: number, x: number, y: number, z: number): void {
  it.flags |= ITEM_FLAG_ANIM_LOOP; // raw 132330
  it.loops[W_TRANS]!.start = 0; // raw 132331（+536）
  it.loops[W_TRANS]!.period = period; // raw 132335（+556）
  it.loopTrans = { x, y, z }; // raw 132339（+656 平移矩阵）
}

/** `0x217`（`sub_4ACF20`）：写 `+0x18/+0x1C/+0x20` = pivot（旋转/缩放中心）。 */
export function applyDrawPivot(it: Item, x: number, y: number, z: number): void {
  it.pivotX = x;
  it.pivotY = y;
  it.pivotZ = z;
}

/** `0x219`（`sub_4ACEE0`）：写 `+0x24/+0x28/+0x2C` = 描画位置。 */
export function applyDrawPos(it: Item, x: number, y: number, z: number): void {
  it.posX = x;
  it.posY = y;
  it.posZ = z;
}

/**
 * `0x1FF`（`sub_4230F0` → `sub_4AC750`）：**DrawItem 的像素平移**（立即生效、无动画窗）。
 * 引擎写 `+0x68 = 1`（用世界矩阵）与 `+0x16C`（平移 **work** 矩阵）⇒ 这里把 work/target 都设为该值；
 * `itemTranslation` 在无窗时返回 target，故写入即生效。
 */
export function applyDrawTranslation(it: Item, x: number, y: number, z: number): void {
  it.useWorld = true;
  it.transWork = { x, y, z };
  it.transTarget = { x, y, z };
}

/**
 * `0x1FD`（`sub_422FD0` → `sub_4AC5F0`）：**立即缩放**（无动画窗）——
 * 引擎写 `+0x68 = 1`（用世界矩阵）与 `+0x6C`（缩放 **work** 矩阵，raw 131342-131349），
 * **不动** `+0xAC`（目标矩阵）也不开窗。除数 100（`dbl_5201F0`，raw 4430）在 handler 里做。
 *
 * ★与 `0x1FF`（像素平移）**同一取舍**：引擎渲染期用的是 work 矩阵，而 emulator 的
 *   `itemScale` 在"无窗"时返回 `scaleTarget` ⇒ 这里把 work/target 都写成该值，否则
 *   "立即生效"不成立（滚动条拇指的中段拉伸就是这么丢的：只写 work ⇒ 求值仍返回 1,1,1）。
 */
export function applyDrawScale(it: Item, sx: number, sy: number, sz: number): void {
  it.useWorld = true;
  it.scaleWork = { x: sx, y: sy, z: sz };
  it.scaleTarget = { x: sx, y: sy, z: sz };
}

/**
 * `0x1FE`（`sub_423060` raw 31330-31345 → `sub_4AC660` raw 131355-131398）：
 * **图元变换 4 浮点 = 绕任意轴旋转**（审计 §4.2 #8 的消费者接线）。
 *
 * 引擎逐句：
 * ```
 * sub_4AAA50(Scene, op1);                    // 缺失即建项
 * it = lookup(op1); *(it + 104) = 1;         // +0x68 = 用世界矩阵
 * *(float*)(it + 492) = op2;                 // +0x1EC 轴 x
 * *(float*)(it + 496) = op3;                 // +0x1F0 轴 y
 * *(float*)(it + 500) = op4;                 // +0x1F4 轴 z
 * *(float*)(it + 516) = op5;                 // +0x204 角（**度**）
 * D3DXMatrixRotationAxis(it + 236, &axis, op5 * π / 180);   // +0xEC = 旋转 **work** 矩阵
 * Scene[11627] = 1;                          // 置脏
 * ```
 * ⇒ 与 `0x21F`（旋转**动画窗**，写 `+0x12C` 目标矩阵）不同：本条写的是 **work** 矩阵、**立即生效**、
 * 且**不动** target、**不开窗**（与 `0x1FD` 写缩放 work / `0x1FF` 写平移 work 同一族）。
 *
 * ★emulator 的等价：`itemRotationRad` 在"无窗"时返回 `rotTarget.deg`（见 `eval.ts`）——
 * 所以这里 work/target 都写（与 `applyDrawScale` 的取舍逐字相同，理由见那里：只写 work 则求值仍返回旧值）。
 * ★轴：emulator 的 sprite 只有一个屏幕内的旋转角（`itemRotationRad` 是标量），与 `loopRotationDeg`
 * 同一处置 —— 用轴的 **z 分量符号**定方向；语料 7 处的轴恒为 `(0,0,1)`，`d` 是度。
 */
export function applyPrimAxisRotation(it: Item, ax: number, ay: number, az: number, deg: number): void {
  it.useWorld = true; // raw 131379：`*(it + 104) = 1`
  const d = az < 0 ? -deg : deg; // 标量角的近似（见说明）
  it.rotWork = { axis: { x: ax, y: ay, z: az }, deg: d };
  it.rotTarget = { axis: { x: ax, y: ay, z: az }, deg: d };
}

/**
 * ★**复位一个 DrawItem 的全部变换**（`sub_4AC470` raw 131268-131330，`0x1FC` 的体）。
 *
 * 引擎把三块 16-float 矩阵（`+0x6C` 缩放 work / `+0xEC` 旋转 work / `+0x16C` 平移 work）
 * 逐格清 0 并把对角线置 1，再把 `+104`（变换种类）清 0，最后 `Scene[11627] = 1`。
 * ⇒ emulator 侧等价 = 把 `Item` 的 work/target 三元组复位成单位（缩放 1 / 角 0 / 平移 0）。
 *
 * ★**不动 `+0x68`（`useWorld`）**：体里 `sub_4AC470` 一次都没碰它（raw 131275-131328 无 `+104` 之外的
 *   `_this` 写）⇒ 复位变换**不会**把项退出世界矩阵路径。修前 emulator 只记了一个 `primReset` 台账
 *   字段、**没有任何渲染消费者**（审计 §4.2 #8 的 `missing-consumer`）。
 */
export function resetItemTransform(it: Item): void {
  it.scaleWork = { x: 1, y: 1, z: 1 };
  it.scaleTarget = { x: 1, y: 1, z: 1 };
  it.rotWork = { axis: { x: 0, y: 0, z: 0 }, deg: 0 };
  it.rotTarget = { axis: { x: 0, y: 0, z: 0 }, deg: 0 };
  it.transWork = { x: 0, y: 0, z: 0 };
  it.transTarget = { x: 0, y: 0, z: 0 };
}

/**
 * `0x322`（`sub_4AE2C0` raw 132810-132823）：写 `entry[9] = op2`（alpha 混合模式选择子，
 * 消费者是 D3D 绘制 `sub_49E390` ⇒ emulator 未接）、`entry[13] = state0`，
 * 随后 `CalcDiffuse(entry, 0.0)` 立即烘焙（本模型按帧求值 ⇒ 等价），**不动 bit1/窗**。
 */
export function applyMeshVertexColor(m: MeshObj, blend: number, state0: number): void {
  m.blend = blend;
  m.state0 = state0 >>> 0;
}

/**
 * `0x323`（`sub_4AE330` raw 132827-132845）：`|=2`、`entry[10]=0`（窗起点，绘制期锁存）、
 * `entry[11]=op2`（delay）、`entry[12]=op3`（count/dur）、`entry[14]=state1`。
 */
export function applyMeshVertexColorAlpha(m: MeshObj, delay: number, dur: number, state1: number): void {
  m.flags |= 2;
  m.state1 = state1 >>> 0;
  m.anim = { start: 0, delay, dur };
}