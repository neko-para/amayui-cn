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
import { W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from './model.js';

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

/** `0x322`（`sub_4AE280`）：mesh 顶点色 state0。 */
export function applyMeshVertexColor(m: MeshObj, state0: number): void {
  m.state0 = state0 >>> 0;
}

/** `0x323`：mesh 顶点色动画窗（`+40` delay / `+44` dur / `+52` state1），置 bit1。 */
export function applyMeshVertexColorAlpha(m: MeshObj, delay: number, dur: number, state1: number): void {
  m.flags |= 2;
  m.state1 = state1 >>> 0;
  m.anim = { start: 0, delay, dur };
}