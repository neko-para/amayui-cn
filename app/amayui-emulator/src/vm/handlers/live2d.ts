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
 * | `0x346` | `i346 <key>` | VM | 节点复位（4 个变换矩阵 → 单位阵；**保留** flags/slot/baseOffset） |
 * | `0x347` | `i347 <key> <sx> <sy> <sz>` | VM | 立即缩放（三分量 **float** ÷100 → `record+80`） |
 * | `0x348` | `i348 <key> <ax> <ay> <az> <deg>` | VM | ★立即**旋转**（轴角 float，角**度**）—— 旧实现误当缩放 |
 * | `0x349` | `i349 <key> <x> <y> <z>` | VM | 节点平移（三分量 float，像素 → `record+336`） |
 * | `0x34A` | `i34a <key> <x> <y> <z>` | VM | 基础平移偏移（三分量 float → `record[2..4]` = `+8/+12/+16`） |
 * | `0x34B` | `i34b <key> <delay> <dur> <sx> <sy> <sz>` | VM | 缩放目标窗（窗1；delay/dur=int、三分量 float ÷100） |
 * | `0x34C` | `i34c <key> <delay> <dur> <ax> <ay> <az> <deg>` | VM | 旋转目标窗（窗2；轴/角 float） |
 * | `0x34D` | `i34d <key> <delay> <dur> <x> <y> <z>` | VM | 平移目标窗（窗3；三分量 float） |
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
 * `0x346`/`0x347`/`0x348`/`0x34A`/`0x34B`/`0x34C` 在本作语料里 **0 次**，但都登记为能力面
 * （重实现不能当它们不存在）；`0x349`（7 处）与 `0x34D`（12 处，BTL）**真被使用** ⇒ 操作数口径必须对。
 *
 * ★**未实现的消费端（诚实登记）→ 已实现**（`tickets/T-0096`）：这 7 条写的字段要经引擎的节点矩阵
 * 合成器 `sub_4A07F0`（raw **121131-121655**，含逐窗求值/颜色/`D3DXMatrix*` 组合）才会出现在画面上；
 * 该合成器已在 `live2d/nodeMatrix.ts` 逐句直译，由 `renderer/scene/ops.ts` 的 `scL2dTick`
 * 每帧每节点推进一次，`live2d/render.ts` 的 `l2dNodeTransform` 读它的结果（不再是恒单位变换）。
 * ★唯一调用方 raw 134347 **丢弃**颜色出参（立刻把它当整数槽下标用）⇒ 颜色窗的输出本作不可观测。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readFloatOperand, readIntOperand, readStringOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import type { OpTable } from './shared.js';
import type { Engine, Frame } from '../engine.js';
import type { BinInstruction } from '../../script/bin.js';
import {
  l2dBindTexture,
  l2dCreateNode,
  l2dDestroySlot,
  l2dNodeBaseOffset,
  l2dNodeReset,
  l2dNodeRotation,
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
import { bindTextureToSlot, loadModelIntoSlot, startMotionOnSlot, type Live2dAssetSource, type L2dLoadFailure } from '../../live2d/assetLoader.js';
import type { FileSource } from '../../arch/fileSource.js';
import { ShowMessageError } from '../native.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 收尾批：Live2D 族（live2d），10 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：Live2D 族（live2d）走操作数计划层，但没有声明计划`);
  return p;
}


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
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：Live2D 族走操作数计划层，但没有声明计划`);
  return p.int(n);
}

/**
 * 读第 `n` 个**浮点**操作数；缺操作数时返回 `undefined`（理由同 `optInt`）。
 *
 * 为什么这一族必须用浮点读（审计 `op-9-op840`，`tickets/T-0077`）：引擎 `0x347`–`0x34D` 的
 * 变换分量一律走 `sub_41C300`（浮点读，raw 26655 起），而 `sub_41C300` 对 int 型操作数是
 * **int → float 转换**、对 float 型是位模式直读。emulator 旧实现用 `optInt` ⇒ 脚本给 float 立即数/
 * 浮点槽时读到的是**位模式**（把 1.0 读成 0x3F800000 = 1065353216）。`readFloatOperand` 的
 * 语义与 `sub_41C300` 对齐（int 型退化到 `readIntOperand`，即同一个整数当浮点用）。
 */
function optFloat(c: { e: Engine; frame: Frame; instr: BinInstruction }, n: number): number | undefined {
  if (c.instr.args.length < n) return undefined;
  return readFloatOperand(c.e, c.frame, c.instr, n);
}

/** 引擎 `dbl_5201F0` = 100.0（raw 4430）：`0x347` 的三个分量与 `0x34B` 的三个分量都要 ÷100。 */
const PERCENT = 100;

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

/**
 * `0x347` **立即节点缩放**（`sub_427E10` raw 34567-34580，argc 4）：`op1` = key(int)、
 * `op2/op3/op4` = **float** 三分量，各 ÷100（`dbl_5201F0` = 100.0，raw 4430）⇒ `sub_4AFE20`。
 *
 * 操作数类型/位数来自**计划层**（`operandPlan.ts` 的 `0x347`）：`p.int(1)` 在声明为 float 的位上会直接抛
 * ⇒ 审计 `op-9-op840` 那类"把浮点分量当 int 读（读到 0x3F800000 位模式）"的错在这里不可能再写出来。
 */
const op_l2d_node_scale: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeScale(c.e, key, (p.float(2) ?? 0) / PERCENT, (p.float(3) ?? 0) / PERCENT, (p.float(4) ?? 0) / PERCENT);
};

/**
 * ★ `0x348` **立即节点旋转（轴角）**（`sub_427EA0` raw 34583-34599，argc 5）——
 * `op1` = key(int)、`op2/op3/op4` = 轴（float，**不除 100**）、`op5` = 角度（float，**度**）⇒ `sub_4AFE90`。
 *
 * ★旧实现把 `0x348` 与 `0x347` 注册成同一个 `op_l2d_node_scale`（"缩放 + 一个额外汇总参数"），
 * 审计 `op-9-op840-348-is-rotation-not-scale` 订正：真身写轴 `+464/+468/+472`、角 `+488`，
 * 末行 `j_D3DXMatrixRotationAxis(record+208, axis, deg*π/180)`。
 */
const op_l2d_node_rotation: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeRotation(c.e, key, [p.float(2) ?? 0, p.float(3) ?? 0, p.float(4) ?? 0], p.float(5) ?? 0);
};

/** `0x349` 节点平移（`sub_427F30` raw 34602-34615，argc 4）：`op2..op4` = **float** 像素（旧实现读 int）。 */
const op_l2d_node_translate: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeTranslate(c.e, key, p.float(2) ?? 0, p.float(3) ?? 0, p.float(4) ?? 0);
};

/** `0x34A` 基础平移偏移（`sub_427FB0` raw 34618-34631，argc 4）：`op2..op4` = **float**（写到 `record[2..4]`）。 */
const op_l2d_node_base_offset: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeBaseOffset(c.e, key, p.float(2) ?? 0, p.float(3) ?? 0, p.float(4) ?? 0);
};

/**
 * `0x34B` 缩放目标窗（窗1；`sub_428030` raw 34633-34651，argc 6）：
 * `op1` = key(int)、`op2` = delay(int)、`op3` = dur(int)、`op4/op5/op6` = 缩放三分量（float，各 ÷100）。
 *
 * ★函数名保留历史名 `op_l2d_node_scale_win`（跨文件锚点 ABI，见 `tickets/T-0077` 的实现约束）：
 * 名字没改，改的是它读的操作数与落点 —— 旧实现读 `(percent=op2, delay=op3, dur=op4)` 且丢掉 op5/op6。
 */
const op_l2d_node_scale_win: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeScaleWin(
    c.e,
    key,
    p.int(2) ?? 0,
    p.int(3) ?? 0,
    (p.float(4) ?? 0) / PERCENT,
    (p.float(5) ?? 0) / PERCENT,
    (p.float(6) ?? 0) / PERCENT,
  );
};

/** `0x34C` 旋转目标窗（窗2；`sub_4280D0` raw 34655-34674，argc 7）：`op2` = delay(int)、`op3` = dur(int)、`op4..op6` = 轴（float）、`op7` = 角（float，度）。 */
const op_l2d_node_rotation_win: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeRotationWin(
    c.e,
    key,
    p.int(2) ?? 0,
    p.int(3) ?? 0,
    // ★缺 op6 时轴 z 取 **0**（引擎 `sub_4280D0` raw 34668 对 op6 是**无条件** `sub_41C300(_this, 6)`，
    //   没有任何默认值；旧实现写 `?? 1` 是宿主自造——审计 row 282）。缺操作数只可能来自测试构造
    //   （见 `optInt` 的说明），此时引擎读到的是"没写过"的位模式 ⇒ 0 比 1 更接近"未给"。
    [p.float(4) ?? 0, p.float(5) ?? 0, p.float(6) ?? 0],
    p.float(7) ?? 0,
  );
};

/** `0x34D` 平移目标窗（窗3；`sub_428170` raw 34677-34694，argc 6）：`op2` = delay(int)、`op3` = dur(int)、`op4..op6` = 平移三分量（float，像素）。 */
const op_l2d_node_translation_win: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const key = p.int(1);
  if (key === undefined) return;
  l2dNodeTranslationWin(c.e, key, p.int(2) ?? 0, p.int(3) ?? 0, p.float(4) ?? 0, p.float(5) ?? 0, p.float(6) ?? 0);
};

/** `0x34F` 纹理乘色（`sub_428400` raw 34794-34821）：`op2 < 0` 时用同一个 op1 当绘制项 handle 查工作色。 */
const op_l2d_texture_mul_color: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot === undefined) return;
  // ★`op2 < 0` 的查询回退 = 引擎的 `sub_4ADD60(Scene, op1)`（raw 34808：**同一个操作数**既当 handle
  //   又当实例槽）。本工程已经有它的宿主缝（`NativeBridge.getDrawItemColor`，`0x203` 也在用）
  //   ⇒ 查不到时缝返回 `-1`，与引擎 `sub_4ADD60` 的缺项返回值一致（raw 132585）。
  l2dTextureMulColor(c.e, slotOf(slot), optInt(c, 2) ?? 0, (h) => c.native.getDrawItemColor?.(h) ?? null);
};

/**
 * `0x350` 复位动作队列。
 *
 * ★引擎门 = `sub_478500` 的 `if (*(_DWORD*)_this)`（模型非空）⇒ 槽不存在/没模型时是 no-op
 * （审计 row 96）。
 */
const op_l2d_reset_motion: OpHandler = (c) => {
  const slot = optInt(c, 1);
  if (slot !== undefined) l2dResetMotion(c.e, slotOf(slot));
};

/**
 * `0x351` 命名参数（op3 钳到 [0,255] ⇒ 值 = op3/255；槽/模型不存在时静默 no-op，**不建槽**）。
 */
const op_l2d_named_param: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = optInt(c, 1);
  if (slot === undefined || c.instr.args.length < 2) return;
  const name = (plan.str(2) ?? '');
  l2dSetNamedParam(c.e, slotOf(slot), name, optInt(c, 3) ?? 0);
};

/**
 * `0x352` 预置值：`op2 == 0` ⇒ 纹理号、否则 ⇒ 动作号。
 *
 * ★**不建槽**（审计 row 98）：`sub_478540`/`sub_478560` 的第一句都是 `if (*(_DWORD*)_this)`
 * ⇒ 槽不存在时这条指令在引擎里不产生任何表项。
 */
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
  [0x347, op_l2d_node_scale], // 立即缩放（三分量 float ÷100 → record+80）
  [0x348, op_l2d_node_rotation], // ★立即旋转（轴角 float；旧实现误注册成"缩放"）
  [0x349, op_l2d_node_translate], // 节点平移（三分量 float）
  [0x34a, op_l2d_node_base_offset], // 基础平移偏移（三分量 float）
  [0x34b, op_l2d_node_scale_win], // 缩放目标窗（窗1：delay/dur int + 三分量 float ÷100）
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
 *
 * ★**没有宿主缝**（曾有过 `native.l2dLoadModel?.()`）：那条缝没有宿主实现，只会在**闸门 A**
 * 报一条假的「意图被丢弃」（实测控制窗显示 `l2dLoadModel` 未实现，而模型其实已装好）⇒ 已删。
 *
 * ★★**失败 = 抛 `ShowMessageError`**（`tickets/T-0160`，审计 row 87）：引擎在 handler 里
 * （`sub_427BA0` raw 34482-34491）组「L2Dモデルファイル %s の読み込みに失敗しました」并
 * `_CxxThrowException(Command_ShowMessage_Exception)` ⇒ **可观测后果是一条错误串 + 脚本停下**；
 * 旧实现只写一条 log、槽留空、脚本继续跑（沉默跳过）。
 * 引擎那条异常由本 handler 自抛，**事件循环是否中断、脚本是否继续不在体里可见**（引擎侧不可观测）
 * ⇒ emulator 走既有通路（`ShowMessageError` → `session.#onError`：粘文本 + 横幅 + 停止），
 * 与 `0xFE`/`0x10B` 一族同一条纪律，不新造机制。
 */
const op_l2d_load_model: OpHandler = async (c) => {
  const plan = planFor(c);
  const id = (plan.int(1) ?? 0);
  const slot = slotOf((plan.int(2) ?? 0));
  const src = assetSource(c);
  if (src) {
    await loadModelIntoSlot(src, c.e, id, slot, (m) => c.native.log(m), (f: L2dLoadFailure) => {
      throw new ShowMessageError(f.engineText, c.instr.opcode, f.detail);
    });
  }
};

/** `0x345` 装纹理（`op1` = 纹理文件 id、`op2` = 实例槽、`op3` = 模型内纹理号）。同上：无宿主缝。 */
const op_l2d_bind_texture: OpHandler = async (c) => {
  const plan = planFor(c);
  const id = (plan.int(1) ?? 0);
  const slot = slotOf((plan.int(2) ?? 0));
  const texNo = (plan.int(3) ?? 0);
  // 槽表先在 VM 层落库（"模型内纹理号 → 文件 id"这层语义与图像解码无关）
  l2dBindTexture(c.e, slot, id, texNo);
  const src = assetSource(c);
  if (src) await bindTextureToSlot(src, c.e, id, slot, texNo, (m) => c.native.log(m));
};

/**
 * `0x34E` 装 `.MTN`（`op1` = 文件 id、`op2` = 动作槽、`op3` = 实例槽、`op4` = 循环位）。同上：无宿主缝。
 *
 * ★**失败 = 抛 `ShowMessageError`**（`tickets/T-0160`，审计 row 90）：引擎 `sub_428200`
 * raw 34722-34731 组「L2Dモーションファイル %s の読み込みに失敗しました」并
 * `_CxxThrowException(Command_ShowMessage_Exception)`；旧实现只记一条 log 后 `return null`。
 * 两条失败路（取不到文件 / `sub_478640` 返回 0）在引擎里**都**落到这条抛点 ⇒ 这里统一走 `onFail`。
 */
const op_l2d_start_motion: OpHandler = async (c) => {
  const plan = planFor(c);
  const id = (plan.int(1) ?? 0);
  const motionSlot = (plan.int(2) ?? 0);
  const slot = slotOf((plan.int(3) ?? 0));
  const loop = (plan.int(4) ?? 0) !== 0;
  const src = assetSource(c);
  if (src) {
    await startMotionOnSlot(src, c.e, id, slot, motionSlot, loop, (m) => c.native.log(m), (f: L2dLoadFailure) => {
      throw new ShowMessageError(f.engineText, c.instr.opcode, f.detail);
    });
  }
};

/**
 * 把 `Engine.fileSource` 适配成 Live2D 资产源。
 *
 * `FileSource.readById` 是**可选**能力（Electron 渲染侧经 IPC、Node 侧直接读 ALF 切片）⇒
 * 宿主没实现时返回 `null`：装载被跳过（槽保持为空 ⇒ 节点不出画，与引擎门控一致），
 * 并记一条日志说明"该宿主不支持按 id 直读资源"。
 */
function assetSource(c: { e: { fileSource: FileSource | null }; native: { log(m: string): void } }): Live2dAssetSource | null {
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
