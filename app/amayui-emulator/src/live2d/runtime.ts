/**
 * **Live2D 运行态的纯逻辑层**（不含文件 I/O、不含渲染）。
 *
 * 这一层为什么独立于 `SceneState`：Live2D 的两张表（10 个实例槽 / 572B 立绘节点）
 * 由 **VM 指令直接读写**（`0x341`–`0x352`），而 `SceneState` 是**两个宿主各自持有**的一份
 * （`PixiBackend.scene` 与 `HeadlessScene.scene`）。放共享 VM 层 ⇒ 只有一份、
 * 且"节点指向的槽有没有模型"这个**绘制判据**（引擎 raw 134320）两边必然一致。
 *
 * 三张表挂在 `Engine` 上（见 `vm/engine.ts` 的字段声明），本模块只提供操作它们的纯函数。
 */
import type { MocModel } from './moc.js';
import {
  advanceMotion,
  attachModel,
  newL2dInstance,
  resetMotionQueue,
  startMotion,
  type L2dInstance,
  type Mtn,
} from './mtn.js';

export type { L2dInstance, Mtn };

/**
 * **`Scene+1096` 的 572 字节「立绘 / 变换节点」**（`0x344` 建、`0x346`–`0x34D` 写）。
 *
 * 字段照引擎：`+4` = **L2D 实例槽号**（★绘制完全依赖它）、其余是基础平移偏移与
 * 4 组动画窗（颜色/缩放/旋转/平移）。见 `live2d.md` §2 与 `opcode-table.md`。
 */
export interface L2dNode {
  /** map key（`0x344` 的 op1）。 */
  key: number;
  flags: number;
  /** `+4`：L2D 实例槽（0..9）。 */
  slot: number;
  /** `+8/+12/+16` 基础平移偏移（`0x34A`）。 */
  baseOffset: [number, number, number];
  /** `0x347/0x348`：缩放（百分数 /100）。 */
  scale: number;
  /** `0x349`：平移（像素）。 */
  translate: [number, number, number];
  /** `0x34B/0x34C/0x34D` 的目标变换（delay/dur + 目标值）。 */
  wins: {
    scale: { delay: number; dur: number; value: number };
    rotation: { delay: number; dur: number; axis: [number, number, number]; deg: number };
    translation: { delay: number; dur: number; value: [number, number, number] };
  };
  /** `0x346` 复位计数（诊断；每次 `0x346` 递增）。 */
  resets: number;
}

/** 承载 Live2D 运行态的最小宿主面（`Engine` 结构化满足它）。 */
export interface L2dHost {
  readonly l2dSlots: Map<number, L2dInstance>;
  readonly l2dNodes: Map<number, L2dNode>;
  readonly l2dMotionCache: Map<number, Mtn>;
  /**
   * **按统一文件 id 取字节**的窄缝（可选）：出画侧要它把纹理 PNG 解码成宿主纹理。
   *
   * 为什么挂在宿主上而不是另开一条参数：`Engine.fileSource` 本来就结构化满足它
   * （`FileSource.readById`），而"槽里有没有模型"这个绘制判据也在同一个对象上
   * （见 `SceneState.l2dHost` 的说明）—— 两件事同源，接线就不会分叉。
   *
   * ★缺省/未实现 ⇒ **纹理不出画**（几何与快照照常）：这与引擎"`0x345` 取不到文件 ⇒
   * 纹理号无图"是同一条静默语义（不给占位块，否则会把"没装载"伪装成"装载错了"）。
   */
  readonly fileSource?: { readById?(id: number): Promise<{ name: string; data: Uint8Array } | null> } | null;
}

function ensureSlot(host: L2dHost, slot: number): L2dInstance {
  const cur = host.l2dSlots.get(slot);
  if (cur) return cur;
  const inst = newL2dInstance(slot);
  host.l2dSlots.set(slot, inst);
  return inst;
}

/** 缺省节点（`0x344` 建、`0x346` 复位）。 */
function makeNode(key: number, slot: number): L2dNode {
  return {
    key,
    flags: 1, // bit0 = 存在（引擎 `sub_4AFBF0` 的 `record[0] |= 1`）
    slot,
    baseOffset: [0, 0, 0],
    scale: 1,
    translate: [0, 0, 0],
    wins: {
      scale: { delay: 0, dur: 0, value: 1 },
      rotation: { delay: 0, dur: 0, axis: [0, 0, 1], deg: 0 },
      translation: { delay: 0, dur: 0, value: [0, 0, 0] },
    },
    resets: 0,
  };
}

/**
 * **`0x341` 装 `.MOC`**（`sub_427BA0` → `sub_4A1860` raw 121664-121700）：`op1` = 统一文件 id、`op2` = 实例槽。
 *
 * 引擎里"槽非空 ⇒ 先析构旧实例 + delete"再重建（**惰性重建**）⇒ `attachModel` 把参数与部件显隐重置回缺省。
 */
export function l2dLoadModel(host: L2dHost, slot: number, modelId: number, model: MocModel): void {
  attachModel(ensureSlot(host, slot), modelId, model);
}

/** **`0x342` 销毁实例槽**（`sub_427C70` → `sub_4A1A60` raw 121745）：`op1` = 槽。 */
export function l2dDestroySlot(host: L2dHost, slot: number): boolean {
  return host.l2dSlots.delete(slot);
}

/** **`0x345` 装纹理**（`sub_427CF0` → `sub_4A1970`）：`op1` = 纹理文件 id、`op2` = 槽、`op3` = 模型内纹理号。 */
export function l2dBindTexture(host: L2dHost, slot: number, texFileId: number, textureNo: number): void {
  ensureSlot(host, slot).textures.set(textureNo, texFileId);
}

/** **`0x352` 预置值**（`sub_4283B0` → `sub_4A1AC0`）：`which == 0` ⇒ 纹理号、否则 ⇒ 动作号。 */
export function l2dSetPending(host: L2dHost, slot: number, which: number, value: number): void {
  const inst = ensureSlot(host, slot);
  if (which === 0) inst.pendingTextureNo = value;
  else inst.pendingMotionNo = value;
}

/** **`0x34E` 装 `.MTN`**（`sub_428200` → `sub_478640`）：`op2` = 动作槽(0/1)、`op3` = 实例槽、`op4` = 循环位。 */
export function l2dStartMotion(
  host: L2dHost,
  slot: number,
  motionId: number,
  motion: Mtn,
  motionSlot: number,
  loop: boolean,
): void {
  host.l2dMotionCache.set(motionId, motion);
  startMotion(ensureSlot(host, slot), motion, motionSlot, loop);
}

/** **`0x350` 复位动作队列**（`sub_4282E0`）。 */
export function l2dResetMotion(host: L2dHost, slot: number): void {
  const inst = host.l2dSlots.get(slot);
  if (inst) resetMotionQueue(inst);
}

/** **`0x351` 命名参数**（`sub_428320`）：`op2` = 参数名、`op3` = 0..255 ⇒ 值 = op3/255。 */
export function l2dSetNamedParam(host: L2dHost, slot: number, paramId: string, raw: number): void {
  ensureSlot(host, slot).params.set(paramId, raw / 255);
}

/** **`0x34F` 纹理乘色**（`sub_428400`）：`op1` = 槽、`op2 < 0` ⇒ 取纹理色记录。 */
export function l2dTextureMulColor(host: L2dHost, slot: number, color: number): void {
  ensureSlot(host, slot).textures.set(-1, color); // -1 号 = 乘色记录（诊断/后续渲染用）
}

/**
 * **`0x344` 建/绑 572B 立绘节点**（`sub_427CB0` → `sub_4AFBF0` raw 133937-133947）。
 *
 * ★语义订正（2026-09）：`i344 <key> <slot>` = 在 `Scene+1096` 取/建记录、`record[0] |= 1`、
 * **`record[1] = slot`**（L2D 实例槽号）。旧文档/旧实现写成"纹理槽变换"是**错的**。
 */
export function l2dCreateNode(host: L2dHost, key: number, slot: number): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, slot);
  node.flags |= 1;
  node.slot = slot;
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x346` 节点复位**（`sub_427DD0`）：全部变换回单位阵。 */
export function l2dNodeReset(host: L2dHost, key: number): L2dNode {
  const cur = host.l2dNodes.get(key);
  const node = makeNode(key, cur?.slot ?? 0);
  node.resets = (cur?.resets ?? 0) + 1;
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x347`/`0x348` 节点缩放**（`sub_427E10`/`sub_427EA0`，参数为百分数）。 */
export function l2dNodeScale(host: L2dHost, key: number, percent: number): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, 0);
  node.scale = percent / 100;
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x349` 节点平移**（`sub_427F30`，像素）。 */
export function l2dNodeTranslate(host: L2dHost, key: number, x: number, y: number, z: number): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, 0);
  node.translate = [x, y, z];
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x34A` 基础平移偏移**（`sub_427FB0` 写 `+8/+12/+16`）。 */
export function l2dNodeBaseOffset(host: L2dHost, key: number, x: number, y: number, z: number): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, 0);
  node.baseOffset = [x, y, z];
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x34B` 缩放目标窗**（`sub_428030`，窗1 delay/dur）。 */
export function l2dNodeScaleWin(host: L2dHost, key: number, percent: number, delay: number, dur: number): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, 0);
  node.wins.scale = { value: percent / 100, delay, dur };
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x34C` 旋转目标窗**（`sub_4280D0`，窗2 delay/dur + 轴/角（度））。 */
export function l2dNodeRotationWin(
  host: L2dHost,
  key: number,
  axis: [number, number, number],
  deg: number,
  delay: number,
  dur: number,
): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, 0);
  node.wins.rotation = { axis, deg, delay, dur };
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x34D` 平移目标窗**（`sub_428170`，窗3 delay/dur，像素）。 */
export function l2dNodeTranslationWin(
  host: L2dHost,
  key: number,
  x: number,
  y: number,
  z: number,
  delay: number,
  dur: number,
): L2dNode {
  const node = host.l2dNodes.get(key) ?? makeNode(key, 0);
  node.wins.translation = { value: [x, y, z], delay, dur };
  host.l2dNodes.set(key, node);
  return node;
}

/**
 * **一个 L2D 节点本帧该不该出画**（引擎 `sub_4B0360` raw 134310-134346）。
 *
 * 引擎判据：`节点+0 bit0` 且 `节点+4` 指向的实例**非空**（`if (v28[v29[1] + 13953])`，raw 134320）。
 * ★槽空 ⇒ **整块不出画、无日志无错误** —— 这是"脚本在跑、画面什么都没有"的成因。
 *
 * 参数只声明"读得到 `l2dSlots`"⇒ `L2dHost` / `L2dRenderHost` / `L2dSnapshotHost` 都能传。
 */
export function l2dNodeDrawable(
  host: { readonly l2dSlots: Map<number, L2dInstance> },
  node: L2dNode,
): boolean {
  if ((node.flags & 1) === 0) return false;
  const inst = host.l2dSlots.get(node.slot);
  return !!inst?.model;
}

/**
 * **推进所有在播的 L2D 动作**（= 引擎"节点绘制那一次调用"里的 `sub_4BCB50`）。
 *
 * ★必须**在绘制节点时**调用（能力条目 `live2d-node-draw-advance`）：引擎**没有**独立逐帧 tick，
 * 只画不推进 ⇒ 动作永不动（同样不报错）。
 *
 * @param nodeKeys 本帧要绘制的节点 key；缺省 = 全部节点。
 */
export function l2dAdvance(host: L2dHost, deltaMs: number, nodeKeys?: number[]): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const slots = new Set<number>();
  for (const k of nodeKeys ?? [...host.l2dNodes.keys()]) {
    const n = host.l2dNodes.get(k);
    if (n) slots.add(n.slot);
  }
  for (const slot of slots) {
    const inst = host.l2dSlots.get(slot);
    if (!inst) continue;
    const overrides = advanceMotion(inst, deltaMs);
    if (overrides.size > 0) {
      for (const [k, v] of overrides) inst.params.set(k, v);
      out.set(slot, overrides);
    }
  }
  return out;
}
