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
 *
 * ★2026-09 按体订正（审计 `op-9-op840` / `op-6-01`，`tickets/T-0077`）：
 *  - `+80` 的立即缩放是 `D3DXMatrixScaling(rec+80, sx, sy, sz)`（`sub_4AFE20` raw 134051）⇒ **三分量**；
 *  - `+464/+468/+472` 是**旋转轴**、`+488` 是角度（度）（`sub_4AFE90` raw 134085-134097）；
 *  - 窗1/2/3 的 delay/dur 落在 `+32/+52`、`+36/+56`、`+40/+60`，目标值落在 `+144`/`+272`/`+400`
 *    缩放矩阵 / `+476..+492` 轴角 / `+400` 平移（`sub_4B0030`/`sub_4B0110`/`sub_4B0280`）。
 */
export interface L2dNode {
  /** map key（`0x344` 的 op1）。 */
  key: number;
  /** 引擎 `record[0]`：bit0 = 已由 `0x344` 建立（★窗口指令的门，raw 134157/134202/134254）；bit1 = 窗已配置。 */
  flags: number;
  /** `+4`：L2D 实例槽（0..9）。 */
  slot: number;
  /** `+8/+12/+16` 基础平移偏移（`0x34A`；引擎按 **float** 读，raw 121242-121246）。 */
  baseOffset: [number, number, number];
  /** `+80`：`0x347` 的立即缩放，**三分量**（百分数已 ÷100）。 */
  scale: [number, number, number];
  /** `+336`：`0x349` 的立即平移（像素）。 */
  translate: [number, number, number];
  /** `+208`：`0x348` 的立即旋转（轴角；角度单位 = 度）。 */
  rotation: { axis: [number, number, number]; deg: number };
  /** `0x34B/0x34C/0x34D` 的目标变换（delay/dur + 目标值）；受 `flags & 1` 门控。 */
  wins: {
    scale: { delay: number; dur: number; value: [number, number, number] };
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

/**
 * 缺省节点。
 *
 * `flags` 由调用方给：`0x344`（`sub_4AFBF0` raw 133938-133947）= `record[0] |= 1` ⇒ **1**；
 * 而 `sub_4AACA0`（raw 130129-130146，"取不到就建"）建的记录走 `sub_49CA10`（raw 118402-118513）⇒ **0**
 * （`*(_DWORD *)a1 = 0`）。这个区别不是细节：窗指令（`0x34B`/`0x34C`/`0x34D`）都以 `record[0] & 1` 为门
 * （raw 134157/134202/134254），所以"只被窗指令隐式建出来的记录"**收不到窗口**。
 */
function makeNode(key: number, slot: number, flags: number): L2dNode {
  return {
    key,
    flags,
    slot,
    baseOffset: [0, 0, 0],
    scale: [1, 1, 1],
    translate: [0, 0, 0],
    rotation: { axis: [0, 0, 1], deg: 0 },
    wins: {
      scale: { delay: 0, dur: 0, value: [1, 1, 1] },
      rotation: { delay: 0, dur: 0, axis: [0, 0, 1], deg: 0 },
      translation: { delay: 0, dur: 0, value: [0, 0, 0] },
    },
    resets: 0,
  };
}

/**
 * **"取不到就建"**（引擎 `sub_4AACA0` raw 130129-130146）：`0x346`–`0x34D` 每一条的第一句都是它。
 * 建出来的记录走 `sub_49CA10` 的缺省（flags = **0**、slot = 0、单位阵）⇒ 建出来的记录**不画**、
 * 也**收不到窗**（见 `makeNode`）。
 */
function ensureNode(host: L2dHost, key: number): L2dNode {
  const cur = host.l2dNodes.get(key);
  if (cur) return cur;
  const node = makeNode(key, 0, 0);
  host.l2dNodes.set(key, node);
  return node;
}

/**
 * 窗指令的公共前置（`sub_4B0030`/`sub_4B0110`/`sub_4B0280` 的第一段）。
 *
 * 引擎逐字（以 `sub_4B0030` raw 134155-134161 为例）：
 * `sub_4AACA0(this, key)`（取不到就建）→ `if ((*rec & 1) == 0) return;` → `*rec |= 2; *(rec+24) = 0;`
 * ⇒ 返回 `null` = **本次窗口写入被门挡掉**（记录已建出来，但没配窗）。
 * ★未建模：`*(rec+24) = 0`（窗起点锁存）与 `*(rec+76) = 1`（待重算位）—— 引擎的窗口求值器
 * `sub_4A07F0`（raw 121131-121520）整体未实现，见 `live2d/render.ts` 的 `l2dNodeTransform` 说明。
 */
function winGate(host: L2dHost, key: number): L2dNode | null {
  const node = ensureNode(host, key);
  if ((node.flags & 1) === 0) return null;
  node.flags |= 2; // raw 134160（`*v9 |= 2u`）
  return node;
}

/**
 * **`0x341` 装 `.MOC`**（`sub_427BA0` → `sub_4A1860` raw 121664-121700）：`op1` = 统一文件 id、`op2` = 实例槽。
 *
 * 引擎里"槽非空 ⇒ 先析构旧实例 + delete"再重建（**惰性重建**）⇒ `attachModel` 把参数与部件显隐重置回缺省。
 */
export function l2dLoadModel(host: L2dHost, slot: number, modelId: number, model: MocModel): void {
  attachModel(ensureSlot(host, slot), modelId, model);
}

/**
 * **清空 L2D 运行态**（装载点用；`tickets/T-0090`）。
 *
 * 依据（为什么装载点必须清，而不是"留着看会不会自己好"）：
 *  - 存档槽的 body 布局**没有任何 L2D 字段** —— 帧镜像 + 三个池 + 三张 ip 表 + 图像清单
 *    （见 `vm/engineSlot.ts` 的布局注释）里既没有模型、也没有 `Scene+1096` 的立绘节点表
 *    ⇒ **装载后进程里的 L2D 状态必然属于上一个执行链**；
 *  - 引擎在装载段复位显示容器（raw 19913-19915 的两次 `sub_403EF0`），那一层没了，立绘节点
 *    也跟着不再出画。
 *
 * ★实测症状（槽 79，2026-09）：不清的话，读档后仍挂着 **TITLE 的 node `0x14` + 它的模型 + 60 个批次**
 * （`TITLE.txt:590` 的 `i344 14 0` 建的），而 `SN0000` **一条 L2D 指令都没有** ⇒ 上一个画面的立绘/天空件
 * （模型里有 `D_MY_PARTS_SORA_*` 这种满屏件）继续画在 SN0000 上 —— 用户实测「背景渲染完全混乱、
 * 很多图元缩放错误」。
 *
 * @returns 被清掉的 {槽数, 节点数}（宿主拿去记一条日志 —— 静默清掉会让人以为是"画面自己好了"）
 */
export function l2dResetHost(host: L2dHost): { slots: number; nodes: number } {
  const slots = host.l2dSlots.size;
  const nodes = host.l2dNodes.size;
  host.l2dSlots.clear();
  host.l2dNodes.clear();
  host.l2dMotionCache.clear();
  return { slots, nodes };
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
  const node = host.l2dNodes.get(key) ?? makeNode(key, slot, 0);
  node.flags |= 1;
  node.slot = slot;
  host.l2dNodes.set(key, node);
  return node;
}

/** **`0x346` 节点复位**（`sub_427DD0` raw 34560-34564 → `sub_4AFC40` raw 133952-134032）：`+76 = 0`、4 个矩阵回单位。 */
export function l2dNodeReset(host: L2dHost, key: number): L2dNode {
  const cur = ensureNode(host, key);
  const node = makeNode(key, cur.slot, cur.flags);
  // 引擎复位只写 float 下标 20..35 / 52..67 / 84..99 / 127..142（4 个矩阵）⇒ **不碰**
  // `+4`(slot)、`+8/+12/+16`(baseOffset)、`record[0]`(flags)（raw 133963-134029）。
  node.baseOffset = cur.baseOffset;
  node.resets = cur.resets + 1;
  host.l2dNodes.set(key, node);
  return node;
}

/**
 * **`0x347` 立即节点缩放**（`sub_427E10` raw 34567-34580 → `sub_4AFE20` raw 134035-134053）。
 *
 * handler 侧：`op2/op3/op4` = **float** 三分量，各 ÷100（`dbl_5201F0` = 100.0，raw 4430）。
 * 落到 `D3DXMatrixScaling(record+80, sx, sy, sz)`（无 `flags & 1` 门 —— 与窗指令不同）。
 */
export function l2dNodeScale(host: L2dHost, key: number, sx: number, sy: number, sz: number): L2dNode {
  const node = ensureNode(host, key);
  node.scale = [sx, sy, sz];
  return node;
}

/**
 * **`0x348` 立即节点旋转（轴角）**（`sub_427EA0` raw 34583-34599 → `sub_4AFE90` raw 134058-134100）。
 *
 * handler 侧：`op2/op3/op4` = 轴（float，**不除 100**）、`op5` = 角度（float，**度**）。
 * 落到 `+464/+468/+472`（轴）、`+488`（角）与 `D3DXMatrixRotationAxis(record+208, axis, deg*π/180)`
 * （`dbl_526C98`/`dbl_5263F0` = π/180，raw 4713/4637）。★旧实现把 `0x348` 注册成"缩放"是错的。
 */
export function l2dNodeRotation(
  host: L2dHost,
  key: number,
  axis: [number, number, number],
  deg: number,
): L2dNode {
  const node = ensureNode(host, key);
  node.rotation = { axis, deg };
  return node;
}

/** **`0x349` 立即节点平移**（`sub_427F30` raw 34602-34615 → `sub_4AFF80` raw 134106-134125）：`op2..op4` = float 像素。 */
export function l2dNodeTranslate(host: L2dHost, key: number, x: number, y: number, z: number): L2dNode {
  const node = ensureNode(host, key);
  node.translate = [x, y, z];
  return node;
}

/** **`0x34A` 基础平移偏移**（`sub_427FB0` → `sub_4AFFF0` raw 134129-134140 写 `record[2..4]`）；`op2..op4` = float。 */
export function l2dNodeBaseOffset(host: L2dHost, key: number, x: number, y: number, z: number): L2dNode {
  const node = ensureNode(host, key);
  node.baseOffset = [x, y, z];
  return node;
}

/**
 * **`0x34B` 缩放目标窗（窗1）**（`sub_428030` raw 34633-34651 → `sub_4B0030` raw 134143-134177）。
 *
 * handler 侧：`op1` = key(int)、`op2` = **delay(int)**、`op3` = **dur(int)**、`op4/op5/op6` = 缩放三分量
 * （float，各 ÷100）。落到 `+32` delay / `+52` dur / `D3DXMatrixScaling(record+144, …)`，且**有 `flags & 1` 门**。
 * ★旧实现读成 `(key, percent=op2, delay=op3, dur=op4)` 并把 op4..op6 全丢掉（审计 P1 `op-6-01`）。
 *
 * @returns 被门挡掉时返回 `null`（记录建出来了、但没配窗）。
 */
export function l2dNodeScaleWin(
  host: L2dHost,
  key: number,
  delay: number,
  dur: number,
  sx: number,
  sy: number,
  sz: number,
): L2dNode | null {
  const node = winGate(host, key);
  if (!node) return null;
  node.wins.scale = { delay, dur, value: [sx, sy, sz] };
  return node;
}

/**
 * **`0x34C` 旋转目标窗（窗2）**（`sub_4280D0` raw 34655-34674 → `sub_4B0110` raw 134181-134234）。
 *
 * handler 侧：`op2` = delay(int)、`op3` = dur(int)、`op4/op5/op6` = 轴（float）、`op7` = 角（float，度）。
 * 落到 `+36` delay / `+56` dur / `+476..+484` 轴 / `+492` 角 / `D3DXMatrixRotationAxis(record+272, …)`；
 * 同样有 `flags & 1` 门。★旧实现把 op2/3/4 当轴、op5 当角、op6/7 当 delay/dur（整体错位一格）。
 */
export function l2dNodeRotationWin(
  host: L2dHost,
  key: number,
  delay: number,
  dur: number,
  axis: [number, number, number],
  deg: number,
): L2dNode | null {
  const node = winGate(host, key);
  if (!node) return null;
  node.wins.rotation = { delay, dur, axis, deg };
  return node;
}

/**
 * **`0x34D` 平移目标窗（窗3）**（`sub_428170` raw 34677-34694 → `sub_4B0280` raw 134240-134274）。
 *
 * handler 侧：`op2` = delay(int)、`op3` = dur(int)、`op4/op5/op6` = 平移三分量（float，像素）。
 * 落到 `+40` delay / `+60` dur / `D3DXMatrixTranslation(record+400, …)`；同样有 `flags & 1` 门。
 * ★旧实现（`(x,y,z,delay,dur)` 参数序 + `optInt(2..6)`）把 delay/dur 与平移值整体错位。
 */
export function l2dNodeTranslationWin(
  host: L2dHost,
  key: number,
  delay: number,
  dur: number,
  x: number,
  y: number,
  z: number,
): L2dNode | null {
  const node = winGate(host, key);
  if (!node) return null;
  node.wins.translation = { delay, dur, value: [x, y, z] };
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
