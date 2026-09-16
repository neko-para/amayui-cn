/**
 * **Live2D 族 opcode**（`0x341`–`0x352`）的 handler 与宿主缝。
 *
 * ## 为什么单独一个模块（而不是留在 `stubs.ts` / `gfx-texture.ts`）
 * 这 18 条 opcode 在引擎里是**一个子系统**（`sub_427BA0`–`sub_4283B0` 一族 handler →
 * `Scene+55812` 的 10 个 L2D 实例槽 + `Scene+1096` 的 572B 立绘节点）。原先它们分散在
 * 「子系统 stub」与「纹理槽族」两张表里，正是这种分散让 `0x344` 的语义被长期误读成"纹理槽变换"。
 *
 * ## 语义（全部按 `engine/天结_unpacked.exe_utf8.c` 重读；详见 `docs-new/03-engine/live2d.md`）
 * | opcode | 形态 | 归 | 说明 |
 * |---|---|---|---|
 * | `0x341` | `i341 <mocId> <slot>` | 宿主 | 装 `.MOC` 进实例槽（槽非空先析构 ⇒ 惰性重建） |
 * | `0x342` | `i342 <slot>` | VM | 销毁实例槽 |
 * | `0x344` | `i344 <key> <slot>` | VM | **建/绑 572B 立绘节点**（`record[1] = slot`）★旧文档写错 |
 * | `0x345` | `i345 <texId> <slot> <texNo>` | 宿主 | 装纹理（D3DX 直读 ⇒ 资产是 PNG） |
 * | `0x346` | `i346 <key>` | VM | 节点复位（全部变换 → 单位阵） |
 * | `0x347` | `i347 <key> <percent>` | VM | 节点缩放（百分数 /100） |
 * | `0x348` | `i348 <key> <percent> …` | VM | 同 347 + 额外汇总参数 |
 * | `0x349` | `i349 <key> <x> <y> <z>` | VM | 节点平移（像素） |
 * | `0x34A` | `i34a <key> <x> <y> <z>` | VM | 基础平移偏移（`+8/+12/+16`） |
 * | `0x34B` | … | VM | 缩放目标矩阵 + 窗1 delay/dur |
 * | `0x34C` | … | VM | 旋转目标 + 轴/角（度）+ 窗2 |
 * | `0x34D` | … | VM | 平移目标 + 窗3 |
 * | `0x34E` | `i34e <mtnId> <motionSlot> <slot> <loop>` | 宿主 | 装 `.MTN`；**装载即入队** |
 * | `0x34F` | `i34f <slot> <color>` | VM | 纹理乘色（`op2 < 0` ⇒ 取纹理色记录） |
 * | `0x350` | `i350 <slot>` | VM | 复位动作队列 |
 * | `0x351` | `i351 <slot> <name> <0..255>` | VM | 命名参数（值 = op3/255） |
 * | `0x352` | `i352 <slot> <which> <value>` | VM | 预置值：`which==0` ⇒ 纹理号、否则 ⇒ 动作号 |
 *
 * ★**运行态落在 `Engine.l2dSlots` / `Engine.l2dNodes`**（不是 `SceneState`）：这两张表由 VM 指令
 * 直接读写，且"节点指向的槽有没有模型"就是绘制判据（引擎 raw 134320）⇒ 只有一份才不会两宿主漂移。
 *
 * 语料用量：`SETL2DMOC` 家族（560+192 处）+ `BTL` 27 + `INFOEN` 5 + `TITLE` 2 + `INFOIT` 1；
 * `0x346`–`0x351` 在本作语料里 **0 次**，但都登记为能力面（重实现不能当它们不存在）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, readStringOperand } from '../operand.js';
import type { OpTable } from './shared.js';
import type { Engine, Frame } from '../engine.js';
import type { BinInstruction } from '../../script/bin.js';
import {
  l2dBindTexture,
  l2dCreateNode,
  l2dDestroySlot,
  l2dNodeBaseOffset,
  l2dNodeReset,
  l2dNodeRotationWin,
  l2dNodeScale,
  l2dNodeScaleWin,
  l2dNodeTranslate,
  l2dNodeTranslationWin,
  l2dResetMotion,
  l2dSetNamedParam,
  l2dSetPending,
  l2dTextureMulColor,
} from '../../live2d/runtime.js';
import { bindTextureToSlot, loadModelIntoSlot, startMotionOnSlot, type Live2dAssetSource } from '../../live2d/assetLoader.js';
import type { FileSource } from '../../arch/fileSource.js';

/**
 * 读第 `n` 个 int 操作数；**缺操作数时返回 `undefined`**。
 *
 * 为什么要有这道闸：Live2D 族原先大多是 `engine-internal` 的 **0 实参 no-op**，
 * 于是既有测试/工具会构造"只有 1 个（或 0 个）实参"的 `i346`/`i349` 之类指令来验分类与遥测。
 * 转真实现后若无条件读操作数就会抛 `operand N out of range`（实测：`capability-gap.test.ts`、
 * `engine-config.test.ts` 因它变红）。引擎那边这些指令**都是有实参的**，缺实参只可能来自
 * 测试构造 ⇒ 取到 `undefined` 就**按缺省值处理**（读不到 = 不写），不抛。
 */
function optInt(c: { e: Engine; frame: Frame; instr: BinInstruction }, n: number): number | undefined {
  if (c.instr.args.length < n) return undefined;
  return readIntOperand(c.e, c.frame, c.instr, n);
}

/** 槽号：引擎的 10 个实例槽是 `Scene+55812 .. +55852`；引擎不做范围检查（越界即错表）⇒ 原值透传。 */
function slotOf(v: number): number {
  return v;
}

/** `0x342` 销毁实例槽。 */
const op_l2d_destroy_slot: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot !== undefined) l2dDestroySlot(c.e, slotOf(slot));
};

/**
 * `0x344` **建/绑 572B 立绘节点**（语义已订正，见模块头）。
 *
 * `key` 是 map key（图元 id，TITLE 用 14），`slot` 是 **L2D 实例槽号**（TITLE 用 0）。
 */
const op_l2d_create_node: OpHandler = (c) => {
  const key = optInt(c, 1);
  const slot = optInt(c, 2);
  if (key === undefined) return;
  l2dCreateNode(c.e, key, slotOf(slot ?? 0));
};

/** `0x346` 节点复位。 */
const op_l2d_node_reset: OpHandler = (c) => {
  const key = optInt(c, 1);
  if (key !== undefined) l2dNodeReset(c.e, key);
};

/** `0x347` / `0x348` 节点缩放（百分数 /100；348 的额外 op3 语义未细读 ⇒ 只做缩放）。 */
const op_l2d_node_scale: OpHandler = (c) => {
  const key = optInt(c, 1);
  const percent = optInt(c, 2);
  if (key !== undefined && percent !== undefined) l2dNodeScale(c.e, key, percent);
};

/** `0x349` 节点平移（像素）。 */
const op_l2d_node_translate: OpHandler = (c) => {
  const key = optInt(c, 1);
  if (key === undefined) return;
  l2dNodeTranslate(c.e, key, optInt(c, 2) ?? 0, optInt(c, 3) ?? 0, optInt(c, 4) ?? 0);
};

/** `0x34A` 基础平移偏移。 */
const op_l2d_node_base_offset: OpHandler = (c) => {
  const key = optInt(c, 1);
  if (key === undefined) return;
  l2dNodeBaseOffset(c.e, key, optInt(c, 2) ?? 0, optInt(c, 3) ?? 0, optInt(c, 4) ?? 0);
};

/** `0x34B` 缩放目标窗（窗1）。 */
const op_l2d_node_scale_win: OpHandler = (c) => {
  const key = optInt(c, 1);
  if (key === undefined) return;
  l2dNodeScaleWin(c.e, key, optInt(c, 2) ?? 100, optInt(c, 3) ?? 0, optInt(c, 4) ?? 0);
};

/** `0x34C` 旋转目标窗（窗2；角单位 = 度）。 */
const op_l2d_node_rotation_win: OpHandler = (c) => {
  const key = optInt(c, 1);
  if (key === undefined) return;
  l2dNodeRotationWin(
    c.e,
    key,
    [optInt(c, 2) ?? 0, optInt(c, 3) ?? 0, optInt(c, 4) ?? 1],
    optInt(c, 5) ?? 0,
    optInt(c, 6) ?? 0,
    optInt(c, 7) ?? 0,
  );
};

/** `0x34D` 平移目标窗（窗3）。 */
const op_l2d_node_translation_win: OpHandler = (c) => {
  const key = optInt(c, 1);
  if (key === undefined) return;
  l2dNodeTranslationWin(c.e, key, optInt(c, 2) ?? 0, optInt(c, 3) ?? 0, optInt(c, 4) ?? 0, optInt(c, 5) ?? 0, optInt(c, 6) ?? 0);
};

/** `0x34F` 纹理乘色。 */
const op_l2d_texture_mul_color: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot === undefined) return;
  l2dTextureMulColor(c.e, slotOf(slot), optInt(c, 2) ?? 0);
};

/** `0x350` 复位动作队列。 */
const op_l2d_reset_motion: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot !== undefined) l2dResetMotion(c.e, slotOf(slot));
};

/** `0x351` 命名参数（op3 : 0..255 ⇒ 值 = op3/255）。 */
const op_l2d_named_param: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot === undefined || c.instr.args.length < 2) return;
  const name = readStringOperand(c.e, c.frame, c.instr, 2);
  l2dSetNamedParam(c.e, slotOf(slot), name, optInt(c, 3) ?? 0);
};

/** `0x352` 预置值：`op2 == 0` ⇒ 纹理号、否则 ⇒ 动作号。 */
const op_l2d_set_pending: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot === undefined) return;
  const which = optInt(c, 2) ?? 0;
  const value = optInt(c, 3) ?? 0;
  l2dSetPending(c.e, slotOf(slot), which, value);
};

/** 纯 VM 状态的 Live2D 指令（不需要宿主读文件）。 */
export const LIVE2D_OPS: OpTable = [
  [0x342, op_l2d_destroy_slot], // 销毁实例槽
  [0x344, op_l2d_create_node], // ★建/绑 572B 立绘节点（语义已订正）
  [0x346, op_l2d_node_reset], // 节点复位
  [0x347, op_l2d_node_scale], // 节点缩放
  [0x348, op_l2d_node_scale], // 节点缩放 + 汇总参数
  [0x349, op_l2d_node_translate], // 节点平移
  [0x34a, op_l2d_node_base_offset], // 基础平移偏移
  [0x34b, op_l2d_node_scale_win], // 缩放目标窗（窗1）
  [0x34c, op_l2d_node_rotation_win], // 旋转目标窗（窗2）
  [0x34d, op_l2d_node_translation_win], // 平移目标窗（窗3）
  [0x34f, op_l2d_texture_mul_color], // 纹理乘色
  [0x350, op_l2d_reset_motion], // 复位动作队列
  [0x351, op_l2d_named_param], // 命名参数
  [0x352, op_l2d_set_pending], // 预置纹理号/动作号
];

/**
 * `0x341` 装 `.MOC`：`op1` = 统一文件 id、`op2` = 实例槽。
 *
 * ★**handler 是 async 的，并且 await 文件读取**（`stepOnce` 会 await handler）：这与引擎的**同步**
 * 读文件 + 解析等价 —— 脚本在 `0x341` 的下一条指令就能依赖"模型已在槽里"。若改成 fire-and-forget
 * 的宿主缝，TITLE 的 `i341 … i344 14 0`（紧接着建节点）会看到空槽 ⇒ 节点整块不出画（且不报错）。
 * 宿主缝（`native.l2dLoadModel`）仍是**可选**的：测试/无文件环境不实现它也能跑（只是没有模型）。
 */
const op_l2d_load_model: OpHandler = async (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  const slot = slotOf(readIntOperand(c.e, c.frame, c.instr, 2));
  const src = assetSource(c);
  if (src) await loadModelIntoSlot(src, c.e, id, slot, (m) => c.native.log(m));
  c.native.l2dLoadModel?.(id, slot);
};

/** `0x345` 装纹理（`op1` = 纹理文件 id、`op2` = 实例槽、`op3` = 模型内纹理号）。 */
const op_l2d_bind_texture: OpHandler = async (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  const slot = slotOf(readIntOperand(c.e, c.frame, c.instr, 2));
  const texNo = readIntOperand(c.e, c.frame, c.instr, 3);
  // 槽表先在 VM 层落库（"模型内纹理号 → 文件 id"这层语义与图像解码无关）
  l2dBindTexture(c.e, slot, id, texNo);
  const src = assetSource(c);
  if (src) await bindTextureToSlot(src, c.e, id, slot, texNo, (m) => c.native.log(m));
  c.native.l2dBindTexture?.(id, slot, texNo);
};

/** `0x34E` 装 `.MTN`（`op1` = 文件 id、`op2` = 动作槽、`op3` = 实例槽、`op4` = 循环位）。 */
const op_l2d_start_motion: OpHandler = async (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  const motionSlot = readIntOperand(c.e, c.frame, c.instr, 2);
  const slot = slotOf(readIntOperand(c.e, c.frame, c.instr, 3));
  const loop = readIntOperand(c.e, c.frame, c.instr, 4) !== 0;
  const src = assetSource(c);
  if (src) await startMotionOnSlot(src, c.e, id, slot, motionSlot, loop, (m) => c.native.log(m));
  c.native.l2dStartMotion?.(id, slot, motionSlot, loop);
};

/**
 * 把 `Engine.fileSource` 适配成 Live2D 资产源。
 *
 * `FileSource.readById` 是**可选**能力（Electron 渲染侧经 IPC、Node 侧直接读 ALF 切片）⇒
 * 宿主没实现时返回 `null`：调用方跳过装载（槽保持为空 ⇒ 节点不出画，与引擎门控一致），
 * 但**仍然**调宿主缝（宿主可能自己会读文件）。
 */
function assetSource(c: { e: { fileSource: FileSource | null } }): Live2dAssetSource | null {
  const fs = c.e.fileSource;
  if (!fs?.readById) return null;
  return { loadById: (id) => fs.readById!(id) };
}

/** 需要宿主读文件的 Live2D 指令（`.MOC` / 纹理 / `.MTN`）。 */
export const LIVE2D_NATIVE_OPS: OpTable = [
  [0x341, op_l2d_load_model], // 装 .MOC
  [0x345, op_l2d_bind_texture], // 装纹理
  [0x34e, op_l2d_start_motion], // 装 .MTN + 入队
];
