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
import type { Affine } from './deform.js';
import { AFFINE_IDENTITY } from './deform.js';
import { l2dComposeNode, makeNodeWindows, syncWindowsFromFields, type L2dNodeWindows } from './nodeMatrix.js';
// ★`tickets/T-0054` 的 M3 `live2d-slot-probe`：合成判据要用"本节点的窗还在跑吗"这个**纯读**探针
//   （定义在 nodeMatrix.ts，那里才有窗的语义）⇒ 从本模块的单一出口再导一次，场景侧只依赖 runtime.js。
export { l2dNodeWindowsPending } from './nodeMatrix.js';
import type { MocModel } from './moc.js';
import {
  advanceMotion,
  attachModel,
  motionQueueFinished,
  newL2dInstance,
  resetMotionQueue,
  startMotion,
  type L2dInstance,
  type Mtn,
} from './mtn.js';
// ★眨眼那一半（实例 `+16` `EyeBlinkMotion` 与 `+23` 门控）：`sub_4783D0` raw 92605-92606 那一支，
//   与动作队列**同级独立**（没有动作装载也每帧跑）⇒ 单独一个模块，这里是它的唯一消费端。
import { BLINK_PARAM_L, BLINK_PARAM_R, blinkStep, type BlinkRng } from './blink.js';

export type { L2dInstance, Mtn, L2dNodeWindows };
// ★眨眼面从 `runtime.js` 单一出口再导（场景侧/守卫只依赖 `runtime.js`，与 `l2dNodeWindowsPending` 同规矩）：
//   `blink.ts` 的常量与推进函数，`L2dInstance.blink` 的字段语义见 `blink.ts` 文件头。
export {
  BLINK_DEFAULTS,
  BLINK_FIELDS,
  BLINK_MODE_VALUE,
  BLINK_PARAM_L,
  BLINK_PARAM_R,
  BLINK_RAND_SCALE,
  blinkJitter,
  blinkStep,
  newBlinkMotion,
} from './blink.js';
export type { BlinkMode, BlinkMotion, BlinkRng } from './blink.js';

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
 *    缩放矩阵 / `+476..492` 轴角 / `+400` 平移（`sub_4B0030`/`sub_4B0110`/`sub_4B0280`）。
 *
 * ★2026-09 按体补全（`tickets/T-0096`，`live2d/nodeMatrix.ts` 的 `sub_4A07F0` 直译）：
 * 下面这些字段原先**缺失**（消费端因此做不出节点矩阵），现在按 572B 记录逐字段补上 ——
 * `+24`(窗起点) / `+68..75`(颜色窗) / `+76`(矩阵有效位) / `+504`(alpha 门) / `+508`(基础矩阵)
 * 与 `matrix`（合成结果）。★`+24` **不是倒计时**，是**窗口序列的绝对起点(ms)**（raw 121261-121265）。
 */
export interface L2dNode {
  /** map key（`0x344` 的 op1）。 */
  key: number;
  /** 引擎 `record[0]`：bit0 = 已由 `0x344` 建立（★窗口指令的门，raw 134157/134202/134254）；bit1 = 窗已配置。 */
  flags: number;
  /** `+4`：L2D 实例槽（0..9）。 */
  slot: number;
  /** `+8/+12/+16` **pivot**（缩/旋转中心，`0x34A`；引擎按 **float** 读，raw 121242-121246）。 */
  baseOffset: [number, number, number];
  /** `+80`：`0x347` 的立即缩放，**三分量**（百分数已 ÷100）。 */
  scale: [number, number, number];
  /** `+336`：`0x349` 的立即平移（像素）。 */
  translate: [number, number, number];
  /** `+208`：`0x348` 的立即旋转（轴角；角度单位 = 度）。 */
  rotation: { axis: [number, number, number]; deg: number };
  /** `0x34B/0x34C/0x34D` 的目标变换 + `+24` 起点 + `+68..75` 颜色窗；受 `flags & 1` 门控。 */
  wins: L2dNodeWindows;
  /**
   * `+504` bit0：置位 ⇒ **本帧该节点 alpha 强制 0**（除非帧级 `(M[46528] & 4) != 0`）——
   * 不是"窗门"（窗门是 `flags & 1`），全窗跑完时被合成器清掉（raw 121637）。
   */
  gate504: number;
  /**
   * `+76`：「本帧节点矩阵有效」位（`0x347`-`0x34D` 置 1、`0x346` 置 0）。★与 `flags` 是**两个不同的位**；
   * 引擎在 `sub_4B0360` raw 134385 用它决定是否把节点矩阵右乘进世界矩阵。
   * ★`0x34A` **不写它**（`sub_4AFFF0` raw 134129-134140 只写 `record[2..4]` + `Scene[11627]`）。
   */
  matrixDirty: boolean;
  /**
   * **`Scene+46508`（= `Scene[11627]`）的置脏锁存** —— 引擎里 572B 节点的每一个写者都置这一格：
   * `0x344` raw 133948、`0x346` raw 134030、`0x347` raw 134052、`0x348` raw 134098、
   * `0x349` raw 134123、**`0x34A` raw 134138**、`0x34B` raw 134173、`0x34C` raw 134230、`0x34D` raw 134270。
   *
   * 为什么锁在**节点**上（而不是直接写宿主）：`Scene+46508` 的真源在 `SceneState`（两个宿主各持一份），
   * 而 VM 侧只拿得到 `Engine`（`L2dHost`）⇒ 这里记"这一格被置过"，由
   * `renderer/scene/ops.ts` 的 `scL2dTick` **消费并清**（转成 `SceneState.dirty`）——
   * 与 `0x344`–`0x34D` 在引擎里"写一格、帧函数读它决定要不要重画"同语义（多节点取并集）。
   */
  sceneDirty: boolean;
  /** `+508..571`：**基础矩阵**（`0x346` 复位成单位阵；`M_base`，raw 121649）。 */
  matrixBase: Affine;
  /**
   * **合成结果**（引擎写进 `Scene+46536` 的那块，由 `sub_4A07F0` 每帧每节点算一次）。
   * `matrixDirty` 为假时它是单位阵；坐标口径见 `live2d/nodeMatrix.ts` 头部。
   */
  matrix: Affine;
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
    // ★缺省旋转是**轴 (0,0,0) / 角 0**（`sub_49CA10` raw 118487-118490 写 `+464/+468/+472 = 0.0`、
    //   118490 写 `+488 = 0`）；旧实现写 `axis=[0,0,1]` 是自造（审计 row 88）。
    rotation: { axis: [0, 0, 0], deg: 0 },
    // `+24` 起点 / `+28..60` delay·dur / `+68..115` 目标值 / `+464..492` 轴角 —— 全部走 `sub_49CA10`
    wins: makeNodeWindows(),
    gate504: 0, // `+504`（`sub_49CA10` 置 0）
    matrixDirty: false, // `+76`
    sceneDirty: false, // `Scene+46508` 的锁存（见字段说明）
    matrixBase: AFFINE_IDENTITY, // `+508..571`
    matrix: AFFINE_IDENTITY, // 合成结果（= 引擎 `Scene+46536` 的初值：调用方每次预置单位阵）
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
 * ★`*(rec+24) = 0` 是**清窗序列起点**（下一条窗指令重新锁存 now，raw 121261-121265）；
 * `*(rec+76) = 1` 是**待重算位**（窗内插值也要重算 ⇒ 这里同步置上，`sub_4B0030` 那 5 处都写）。
 * 合成器在 `live2d/nodeMatrix.ts`（`sub_4A07F0` raw 121131-121655 的直译）。
 */
function winGate(host: L2dHost, key: number): L2dNode | null {
  const node = ensureNode(host, key);
  if ((node.flags & 1) === 0) return null;
  node.flags |= 2; // raw 134160（`*v9 |= 2u`）
  node.wins.startedAtMs = 0; // raw 134161（`*(rec+24) = 0`）
  node.wins.latched = false; // ★emulator 专有：把 `+24 = 0` 的"未锁存"语义写死（见 `L2dNodeWindows`）
  node.matrixDirty = true; // raw 134168 等（`*(rec+76) = 1`）
  node.sceneDirty = true; // raw 134173 等（`_this[11627] = 1`）
  return node;
}

/**
 * `Scene+46508`（`Scene[11627]`）= **"本帧要重画"**格：572B 节点的每个写者都置它
 * （`0x344`/`0x346`–`0x34D`，逐条 raw 见 `L2dNode.sceneDirty`）。锁在节点上由 `scL2dTick` 消费。
 */
function markSceneDirty(node: L2dNode): void {
  node.sceneDirty = true;
}

/**
 * **`0x341` 装 `.MOC`**（`sub_427BA0` → `sub_4A1860` raw 121664-121700）：`op1` = 统一文件 id、`op2` = 实例槽。
 *
 * 引擎里"槽非空 ⇒ 先析构旧实例 + delete"再重建（**惰性重建**）—— `sub_4A1860` raw 121674-121681
 * 逐字：`if (旧) { sub_4785E0(旧); operator delete(旧); _this[槽] = 0; }`，随后才 `new(0x4C)` + 解析。
 * `sub_4785E0`（raw 92745-92762）又会 `sub_478500`（= `0x350` 那一跳：清 `+20/+21/+22`）并销毁动作队列
 * ⇒ **重装同一槽 = 参数/部件显隐/动作队列/预置值/乘色全部回到新实例的缺省**（审计 row 280/281）。
 *
 * emulator 的等价做法：**整份换成一个新的 `L2dInstance` 对象**（旧对象被丢弃 = 引擎的 delete）。
 * ★不要改回"往旧实例里塞字段"：那样 `records`/`current`/`loaded` 会跨换装存活。
 */
export function l2dLoadModel(host: L2dHost, slot: number, modelId: number, model: MocModel): L2dInstance {
  const inst = newL2dInstance(slot);
  attachModel(inst, modelId, model);
  host.l2dSlots.set(slot, inst);
  return inst;
}

/**
 * **清空 L2D 运行态**（装载点用；`tickets/T-0090`）。
 *
 * 依据（为什么装载点必须清，而不是"留着看会不会自己好"）：
 *  - 存档槽的 body 布局**没有任何 L2D 字段** —— 帧镜像 + 三个池 + 三张 ip 表 + 图像清单
 *    （见 `vm/engineSlot.ts` 的布局注释）里既没有模型、也没有 `Scene+1096` 的立绘节点表
 *    ⇒ **装载后进程里的 L2D 状态必然属于上一个执行链**；
 *  - ★**引擎依据（2026-09-24 按体订正，`tickets/T-0144` ⑥）**：读档装载内核 **`sub_410160`
 *    raw 19385-19388** 就是"清 572B 节点表 + 销毁 10 个实例槽"：`sub_40BFE0(Scene+1064)` +
 *    `sub_4A9D10(Scene+1096)` + `for j<10 sub_4A1A60(Scene, j)`（与本函数清的三样一一对应）。
 *    旧注释引的 raw 19913-19915 两次 `sub_403EF0` 是**假的依据**（那是两张「仮想ディスプレイ」复位，
 *    见 `src/vm/native.ts:527-529` 的按体订正）—— 行为一直是对的，依据写错了。
 *  - ★**不要把它当成拆场的口径**：`0x1F6`/`0x1F7` 只擦 572B **节点表**、**不动实例槽**
 *    （`tickets/T-0144` 的 D1；引擎 `sub_4AB7A0` 只清两张 map）。
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

/**
 * **`0x352` 预置值**（`sub_4283B0` → `sub_4A1AC0` raw 121766-121775 → `sub_478540`/`sub_478560`）：
 * `which == 0` ⇒ 纹理号、否则 ⇒ 动作号。
 *
 * ★**引擎不建槽**（审计 row 98）：`sub_4A1AC0` 是 `v4 = _this[a2 + 13953];`（直接取表项）
 * 再交给 `sub_478540/sub_478560`，而后两者的第一句都是 `if (*(_DWORD*)_this)` —— `*_this` 是实例
 * `+0` 的模型指针 ⇒ **槽不存在或槽里没模型时整条是 no-op**，引擎不会因此产生任何表项。
 * emulator 旧实现走 `ensureSlot` ⇒ 凭空多出一个空槽（下游 `l2dNodeDrawable` 的判据也会因此不同源）。
 *
 * @returns 是否落库（`false` = 被门挡掉）。
 */
export function l2dSetPending(host: L2dHost, slot: number, which: number, value: number): boolean {
  const inst = host.l2dSlots.get(slot);
  if (!inst?.model) return false;
  if (which === 0) inst.pendingTextureNo = value;
  else inst.pendingMotionNo = value;
  return true;
}

/**
 * **`0x34E` 装 `.MTN`**（`sub_428200` → `sub_4A19F0` raw 121723-121743 → `sub_478640`）：
 * `op2` = 动作槽(0/1)、`op3` = 实例槽、`op4` = 循环位。
 *
 * ★`host.l2dMotionCache.set` **是唯一写点，读者在 `assetLoader.startMotionOnSlot`**
 * （按动作 id 复用已解析的动作对象；此前它只有 `.set()`/`.clear()` ⇒ 基线里的存量死写）。
 *
 * @param opts.parseError `sub_4BCE90()` 的等价物（见 `L2dMotionRecord.parseError`）。
 * @returns 是否真的装载（门挡掉/解析错 ⇒ `false`，handler 据此走失败支）。
 */
export function l2dStartMotion(
  host: L2dHost,
  slot: number,
  motionId: number,
  motion: Mtn,
  motionSlot: number,
  loop: boolean,
  opts?: { parseError?: boolean },
): boolean {
  host.l2dMotionCache.set(motionId, motion);
  const inst = host.l2dSlots.get(slot);
  if (!inst) return false;
  return startMotion(inst, motion, motionSlot, loop, opts?.parseError === true);
}

/**
 * **`0x350` 复位动作队列**（`sub_4282E0` → `sub_4A1AA0` → `sub_478500`）。
 *
 * @returns 是否落库（`false` = 槽不存在/槽里没模型 ⇒ 引擎 `if (*(_DWORD*)_this)` 挡掉）。
 */
export function l2dResetMotion(host: L2dHost, slot: number): boolean {
  const inst = host.l2dSlots.get(slot);
  if (!inst) return false;
  return resetMotionQueue(inst);
}

/**
 * **`0x351` 命名参数**（`sub_428320` raw 34747-34776）：`op2` = 参数名、`op3` 钳到 `[0,255]` ⇒ 值 = op3/255。
 *
 * 逐字（raw 34756-34775）：
 * ```c
 * v2 = readInt(3);  v6 = v2;
 * if (v2 <= 255) { if (v2 >= 0) goto LABEL_6; v2 = 0; } else v2 = 255;
 * v6 = v2;                     // ★钳位值覆盖除法用的局部量
 * LABEL_6: v5 = 0.0; if (v2 > 0) v5 = (double)v6 / 255.0;   // dbl_520448 = 255.0
 * sub_4A07C0(slots, op1, name, v5);   // → sub_478520：`if (v3) sub_4BD4D0(...)` ⇒ 模型非空才是门
 * ```
 * ⇒ ① **先钳位再除**（旧实现直接 `raw / 255` ⇒ 越界得到范围外的参数值，审计 row 97）；
 *    ② 槽不存在/槽里没模型 ⇒ 静默 no-op，**不建槽**（审计 row 283）。
 *
 * @returns 是否落库。
 */
export function l2dSetNamedParam(host: L2dHost, slot: number, paramId: string, raw: number): boolean {
  const inst = host.l2dSlots.get(slot);
  if (!inst?.model) return false;
  const v = clampByte(raw);
  inst.params.set(paramId, v > 0 ? v / 255 : 0);
  return true;
}

/** 引擎 `sub_428320` raw 34758-34768 的钳位（`<= 255` 且 `>= 0`，否则取端点）。 */
export function clampByte(v: number): number {
  const n = Math.trunc(v);
  if (n <= 255) return n >= 0 ? n : 0;
  return 255;
}

/**
 * **`0x34F` 纹理乘色**（`sub_428400` raw 34794-34821）：
 * `op2` = 打包颜色、`op1` = 实例槽（`op2 < 0` 时**同一个 op1 又当绘制项 handle** 去查工作色）。
 *
 * 逐字（raw 34804-34820）：
 * ```c
 * v2 = readInt(2);
 * if ( v2 < 0 ) { v3 = readInt(1); v2 = sub_4ADD60(Scene, v3); }   // 查不到 ⇒ -1
 * v6 = BYTE2(v2)/255;  v7 = BYTE1(v2)/255;  v8 = (BYTE)v2/255;      // ★解码成三个 0..1 分量
 * sub_4A0790(slots, readInt(1), v6, v7, v8);   // → sub_478590：**对 10 个纹理槽里每一个非空的**调 sub_4BD150
 * ```
 * ★三分量按引擎实参序（`sub_4BD150(tex, a3, a4, a5, 1.0)` raw 143670-143672）= `[BYTE2, BYTE1, BYTE0]`。
 *
 * @param workColor `sub_4ADD60`（raw 132579-132588：按 handle 查 `Scene+1032` 绘制项表的 `+96` 工作色，
 *                  查不到返回 **-1**）。宿主不实现 ⇒ 按"查不到"取 `-1`（= 三分量全 1 ⇒ 无着色）。
 */
export function l2dTextureMulColor(
  host: L2dHost,
  slot: number,
  color: number,
  workColorOf?: (handle: number) => number | null,
): boolean {
  const inst = host.l2dSlots.get(slot);
  // `sub_478590` 的门（raw 92729 `if (*_this)`）：模型非空
  if (!inst?.model) return false;
  let packed = color | 0;
  if (packed < 0) {
    const found = workColorOf?.(slot);
    packed = found == null ? -1 : found | 0;
  }
  const rgb = decodeL2dMulColor(packed);
  inst.mulColorRaw = packed;
  inst.mulColor = rgb;
  // ★逐纹理下发（raw 92729-92740）：**只对已有纹理槽**（`if (*v6)`）
  inst.mulColors.clear();
  for (const texNo of inst.textures.keys()) {
    if (texNo >= 0) inst.mulColors.set(texNo, rgb);
  }
  return true;
}

/**
 * 把 `0x34F` 的打包字节解码成三个 0..1 分量。
 *
 * 字节序按引擎（`[BYTE2/255, BYTE1/255, BYTE0/255]`，raw 34813-34818）—— **不是** RGBA 顺序的猜测，
 * 是 `sub_4BD150(tex, a3, a4, a5, 1.0)` 的**实参序**。
 */
export function decodeL2dMulColor(packed: number): [number, number, number] {
  const v = packed | 0;
  return [((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255];
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
  markSceneDirty(node); // raw 133948（`_this[11627] = 1`）
  return node;
}

/**
 * **`0x346` 节点复位**（`sub_427DD0` raw 34560-34564 → `sub_4AFC40` raw 133952-134032）：`+76 = 0`、4 个矩阵回单位。
 *
 * ★**只**复位 4 块矩阵 + `+76`（raw 133952-134032 逐字）：`+20..35`（缩放 from）、`+52..67`（旋转 from）、
 * `+84..99`（平移 from）、`+127..142`（基础矩阵 `M_base`），以及 `+76 = 0`。
 * 它**不碰** `+4`(slot)、`+8..16`(pivot)、`record[0]`(flags)、`+24`/delay/dur（`+28..60`）、颜色（`+68..75`）、
 * 轴角（`+464..492`）、to 矩阵（`+144`/`+272`/`+400`）、`+504`。
 *
 * ★2026-09 订正（`tickets/T-0096`）：旧实现用 `makeNode()` **重建整个节点** ⇒ 把 `wins`
 * （delay/dur/目标值/起点）也清掉了 —— 那是**偏差**（引擎语义 = 保留）。这里改成**只**改该改的字段，
 * 并保留对象身份（节点不会被换掉，跨帧持有它的引用不会失效）。
 *
 * ★2026-09 再订正（`tickets/T-0160`，审计 row 88）：**旋转也不在清点里**。旧实现写
 * `node.rotation = { axis: [0,0,1], deg: 0 }` 是自造 —— `+52..67` 是**旋转 from 的矩阵**（`v4[52..67]`
 * 落在字节 `+208..271`），而 `0x348` 写的轴角在 `+464..492`，两者不是同一块。`0x346` 之后
 * 「`0x348` 之前刚设过的轴角」必须保持原值。
 * 另：raw 134030 的 `_this[11627] = 1` 要一起复现（见 `L2dNode.sceneDirty`）。
 */
export function l2dNodeReset(host: L2dHost, key: number): L2dNode {
  const node = ensureNode(host, key);
  node.scale = [1, 1, 1]; // `+20..35` ← 单位阵（对角三元组）
  // ★不碰 node.rotation：`+464..492` 不在 `sub_4AFC40` 的写点里
  node.translate = [0, 0, 0]; // `+84..99`
  node.matrixBase = AFFINE_IDENTITY; // `+127..142`
  node.matrixDirty = false; // `+76 = 0`（raw 133961）
  node.matrix = AFFINE_IDENTITY;
  markSceneDirty(node); // raw 134030（`_this[11627] = 1`）
  node.resets += 1;
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
  node.matrixDirty = true; // `+76 = 1`（`0x347` raw 134048）
  markSceneDirty(node); // raw 134052（`_this[11627] = 1`）
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
  node.matrixDirty = true; // `+76 = 1`（`0x348` raw 134119）
  markSceneDirty(node); // raw 134098（`_this[11627] = 1`）
  return node;
}

/** **`0x349` 立即节点平移**（`sub_427F30` raw 34602-34615 → `sub_4AFF80` raw 134106-134125）：`op2..op4` = float 像素。 */
export function l2dNodeTranslate(host: L2dHost, key: number, x: number, y: number, z: number): L2dNode {
  const node = ensureNode(host, key);
  node.translate = [x, y, z];
  node.matrixDirty = true; // `+76 = 1`（`0x349` raw 134119 同族；见 `sub_4AFF80`）
  markSceneDirty(node); // raw 134123（`_this[11627] = 1`）
  return node;
}

/**
 * **`0x34A` 基础平移偏移**（`sub_427FB0` → `sub_4AFFF0` raw 134129-134140 写 `record[2..4]`）；`op2..op4` = float。
 *
 * ★审计 row 89（`tickets/T-0160`）：`sub_4AFFF0` 的**唯一**副作用除三格外就是 `_this[11627] = 1`
 * （raw 134138）—— 它**不写** `record+76`。旧实现既不置 `matrixDirty` 也不通知宿主置脏
 * ⇒ 这一条单独发生时（没有别的窗/写者在跑）引擎会强制重画、emulator 不会。
 * 修法按体：`record[2..4]` + `Scene+46508` 的锁存（`matrixDirty` **不置**，与引擎同）。
 */
export function l2dNodeBaseOffset(host: L2dHost, key: number, x: number, y: number, z: number): L2dNode {
  const node = ensureNode(host, key);
  node.baseOffset = [x, y, z];
  markSceneDirty(node); // raw 134138（`_this[11627] = 1`）★注意：**不置** `+76`
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
  syncWindowFromImmediate(node);
  node.wins.scale.delay = delay; // `+32`（raw 134163）
  node.wins.scale.dur = dur; // `+52`（raw 134165）
  node.wins.scale.to = [sx, sy, sz];
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
  syncWindowFromImmediate(node);
  node.wins.rotation.delay = delay; // `+36`（raw 134208）
  node.wins.rotation.dur = dur; // `+56`（raw 134210）
  node.wins.rotation.to = { axis, deg };
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
  syncWindowFromImmediate(node);
  node.wins.translation.delay = delay; // `+40`（raw 134260）
  node.wins.translation.dur = dur; // `+60`（raw 134262）
  node.wins.translation.to = [x, y, z];
  return node;
}

/**
 * **把节点的立即值灌进窗的 `from` 侧** —— 见 `nodeMatrix.ts` 的 `syncWindowsFromFields`
 * （引擎里它们是同一块内存：`0x347`/`0x348`/`0x349` 写 `+20`/`+52`/`+84`，窗读的也是它）。
 * 三个窗 setter 在写 `to` 之前都要先转一次（窗的 from = 这条窗指令之前节点当前的立即变换）。
 *
 * ★反向（合成器吸附后把 from 写回立即字段）由合成器自己在收尾处做（`syncWindowsBack`），
 * 不在这里再暴露一个只有一处调用者的函数。
 */
export function syncWindowFromImmediate(node: L2dNode): void {
  syncWindowsFromFields(node);
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
 * **跑一次节点矩阵合成器**（`sub_4A07F0`，raw 121131-121655）—— 逐节点、每帧一次。
 *
 * 唯一应当在**帧末、绘制之前**调用它（引擎里合成就发生在逐节点绘制里：`sub_4B0360` raw 134341）：
 * `renderer/scene/ops.ts` 的 `scL2dTick` 是落点。返回值里的 `color` 是引擎的 `*a4`，
 * **唯一调用方丢弃它**（raw 134347）⇒ 调用方不要读（见 `nodeMatrix.ts` 头部）。
 *
 * @param frame 帧级标志（`M[46512]` 的 winSkip / `M[46528] & 4` 的 alpha 门）—— emulator 暂无对应字段，
 *              缺省 `false`（= 不跳过动画、不关 alpha 门），与引擎缺省一致。
 * @param slot 实例槽：只用来读**当前 alpha**（引擎 `+64`/`+124` 那条休眠通道，本作语料不可达）；
 *              不传 ⇒ 用引擎缺省 1.0。合成结果里的 `alpha` **当前没有消费端**
 *              （`render.ts` 的批次 opacity 来自模型自己的 `pivotOpacities`），登记为未接线。
 */
export function l2dComposeNodeAt(
  node: L2dNode,
  nowMs: number,
  frame?: { winSkip?: boolean; alphaGateDisabled?: boolean },
  slot?: { alpha?: number },
): { matrix: Affine; color: number; alpha: number; windowsFinished: boolean } {
  return l2dComposeNode(node, nowMs, frame ?? {}, slot);
}

/**
 * **推进所有在播的 L2D 动作**（= 引擎"节点绘制那一次调用"里的 `sub_4BCB50`）。
 *
 * ★必须**在绘制节点时**调用（能力条目 `live2d-node-draw-advance`）：引擎**没有**独立逐帧 tick，
 * 只画不推进 ⇒ 动作永不动（同样不报错）。
 *
 * ★★**装载标志 `+21`/`+22` 的门与结算**（`tickets/T-0160`，审计 row 96/19 的后半）：
 * 引擎唯一的动作推进入口 `sub_4783D0`（raw 92578-92615）逐字是
 * ```c
 * if ( *_this ) {
 *   if ( +21 == 1 || +22 == 1 ) {                 // ★只有"有动作刚装载"时才进这一块
 *     if ( sub_4BCCA0(_this[3]) ) {               // 队列那一跳（见 motionQueueFinished 的说明）
 *       if ( +22 ) +22 = 0;                       // 槽 1：播完就结算，**不重入队**
 *       else if ( +20 ) sub_4BCA20(_this[3], _this[1], 1);   // 槽 0 且循环位在 ⇒ 重入队
 *       else +21 = 0;
 *     }
 *     sub_4BCB50(_this[3], *_this);               // 推进（用当前时间更新参数）
 *   }
 *   …
 * ```
 * ⇒ 旧实现"对每个可画节点的槽无条件 `advanceMotion`"少了这层门与结算。
 * 本作语料 4 处 `i34e` 的 `op2` **全是 0** ⇒ 都走槽 0、都消费 `op4=1`（循环）⇒ 语料行为不变
 * （★审计 row 92 把语料数写成"op2 = 0/0/0/2、只有 1 处走不消费支线"是**读错了一格**：
 * 那组值其实是各条的 `op3`（实例槽），四条 `op2` 都是 0 —— 见 changes 的订正表）。
 *
 * ★★**眨眼那一支**（`tickets/T-0166`，raw 92605-92606）：引擎在**同一个 `if (*_this)` 块里**、
 * **动作那个 `if (+21/+22)` 块之外**还有一句
 * ```c
 * if ( *((_BYTE *)_this + 23) )
 *   sub_4BC550(_this[4], (_DWORD **)*_this);   // _this[4] = +16 的 EyeBlinkMotion
 * ```
 * ⇒ 它 ① 不要求 `+21/+22`（没有动作装载也跑）、② 只要**这一帧真的画了**这个节点就跑一次
 * （调用点正是 `sub_4B0360` raw 134389 的逐节点绘制）。本函数按同一次遍历把两者串起来：
 * 先动作（`sub_4BCB50`）、再眨眼（`sub_4BC550`），后者的写回**并进同一份 overrides**
 * （同一帧里对同一参数的后写覆盖先写，与引擎"用同一条 `sub_4BD490` 往模型参数表上写"同序）。
 *
 * ★门控 `+23` **缺省关**（= 随包二进制的真实行为：全库没有任何写者，见 `blink.ts` 文件头）。
 * 打开它只对"将来有数据能置这一格"的情形有意义 —— 详情与重新评估条件见
 * `tickets/T-0166/changes-c166-blink.md` §5。
 *
 * @param nodeKeys 本帧要绘制的节点 key；缺省 = 全部节点。
 * @param opts.clockMs 引擎时钟（`sub_4BF8D0()` = `clock()` 毫秒）。眨眼的时间轴是**真实时间**，
 *                     与 `$fps`（动作曲线采样间隔）无关；缺省 = 内部按 `deltaMs` 累计（与宿主
 *                     每帧给 delta 的现状一致）。
 * @param opts.rng 随机源（引擎 `rand() * (1/32767)`；只用于排下一次眨眼）。缺省 `Math.random`。
 */
export function l2dAdvance(
  host: L2dHost,
  deltaMs: number,
  nodeKeys?: number[],
  opts?: { clockMs?: number; rng?: BlinkRng },
): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const slots = new Set<number>();
  for (const k of nodeKeys ?? [...host.l2dNodes.keys()]) {
    const n = host.l2dNodes.get(k);
    if (n) slots.add(n.slot);
  }
  for (const slot of slots) {
    const inst = host.l2dSlots.get(slot);
    if (!inst) continue;
    // ★门：`+21`/`+22` 都没置 ⇒ 队列不在被跟踪（`0x34E` 没装载过，或已结算）⇒ 不推进。
    if (inst.loaded[0] || inst.loaded[1]) {
      // ★结算（`if (sub_4BCCA0(队列))` 那一跳）：槽 1 先结算；否则槽 0 的循环位在 ⇒ 重入队，否则清标志。
      if (motionQueueFinished(inst)) {
        if (inst.loaded[1]) {
          inst.loaded[1] = false;
        } else if (inst.loop) {
          const rec = inst.records.get(0);
          if (rec) inst.current = { motion: rec.motion, elapsedMs: 0, loop: true };
        } else {
          inst.loaded[0] = false;
        }
      }
      const overrides = advanceMotion(inst, deltaMs);
      if (overrides.size > 0) {
        for (const [k, v] of overrides) inst.params.set(k, v);
        out.set(slot, overrides);
      }
    }
    // ★眨眼（raw 92605-92606）：**在动作门之外**，门是 `+23`（缺省关）。
    // ★模型非空也是门：引擎这一支的**唯一**调用点在 `sub_4B0360` 的逐节点绘制里，而那个块的门
    //   就是 `if (v28[v29[1] + 13953])`（槽里有实例，raw 134320）—— 实例的 `sub_4783D0` 第一句又是
    //   `if (*_this)`（`+0` = 模型，raw 92584）⇒ 没有模型时连 `sub_4BC550` 都不会被调到。
    const blink = l2dBlinkTick(inst, deltaMs, opts);
    if (blink) {
      const m = out.get(slot) ?? new Map<string, number>();
      for (const [paramId, v] of blink) m.set(paramId, v);
      out.set(slot, m);
    }
  }
  return out;
}

/**
 * **眨眼那一支的唯一入口**（引擎 `sub_4783D0` raw 92605-92606：
 * `if (*((_BYTE*)_this + 23)) sub_4BC550(_this[4], *_this);`）—— 门、时钟与写回都在这一处。
 *
 * 引擎逐字（`sub_4783D0` 的两层门）：
 * ```c
 * if ( *_this ) {                       // ① 实例 +0 的模型指针非空（raw 92584）
 *   …动作那一块（+21/+22）…
 *   if ( *((_BYTE *)_this + 23) )       // ② 眨眼门控（非 0 即真，raw 92605）
 *     sub_4BC550(_this[4], *_this);     // ③ +16 的 EyeBlinkMotion 推进一步
 * }
 * ```
 * 而调用点那层还有"槽里有实例"（`sub_4B0360` raw 134320）⇒ 无模型时连 ③ 都到不了。
 *
 * @param deltaMs 本拍时长（引擎没有这个参数 —— 它的时钟是全局 `clock()`；emulator 按实例累计）。
 * @param opts.clockMs 直接给绝对时钟（给了就不再用内部累计；守卫/诊断用）。
 * @returns 本拍要写的 `参数名 → 值`（左眼 `w`、右眼 `+32` 决定取负）；**门关 ⇒ `null`**
 *          （一拍都不推进，连 `+16`/`+8` 都不动）。
 */
export function l2dBlinkTick(
  inst: L2dInstance,
  deltaMs: number,
  opts?: { clockMs?: number; rng?: BlinkRng },
): Map<string, number> | null {
  if (!inst.blinkEnabled || !inst.model) return null;
  const now = opts?.clockMs ?? blinkClockOf(inst, deltaMs);
  const w = blinkStep(inst.blink, now, opts?.rng);
  // `w === undefined` = 引擎那一拍把两边都置成 1.0（"无覆盖"）⇒ 不产生写回。
  if (w === undefined) return null;
  const out = new Map<string, number>();
  // `sub_4BD490(model, PARAM_EYE_L_OPEN, w, 1.0)` + `(…, R, ±w, 1.0)`（raw 143123-143131）；
  // `+32`（`negateRight`）决定右眼那一份是否取负（raw 143125-143126 的 `v6 = -v6`）。
  for (const [paramId, v] of [
    [BLINK_PARAM_L, w],
    [BLINK_PARAM_R, inst.blink.negateRight ? -w : w],
  ] as const) {
    // ★只有模型**真的声明了**该参数才写（`sub_4BD3E0` raw 143791-143801 那条路对
    //   "参数不存在"的后果是 `_CxxThrowException(aOutOfRangeMode)` —— 引擎会**抛**）。
    //   emulator 用 Map ⇒ 退化为"写进去也没人读"，但那样会让"没有眨眼数据的模型"凭空多出
    //   两个参数（幽灵写）⇒ 这里按引擎的"参数表里得有这一格"口径跳过（见 changes §5）。
    if (declaresParam(inst, paramId)) {
      out.set(paramId, v);
      inst.params.set(paramId, v);
    }
  }
  return out.size > 0 ? out : null;
}

/**
 * **每个实例各自累计的眨眼时钟**（毫秒）。
 *
 * 引擎用的是**全局** `clock()`（`sub_4BF8D0`），一次调用一个值 ⇒ 同一帧里所有实例看到同一个数。
 * 宿主（`scL2dTick`，属别的单元，本单元只读）只给 `deltaMs` ⇒ 这里按实例累计；
 * 差值只在该帧内"多个槽是否共用同一读法"上可见（同一帧所有实例累加的 delta 相同 ⇒ 结果一致）。
 * ★`scL2dTick` 只在 `delta > 0` 时调 `l2dAdvance` ⇒ **delta = 0 的那一拍眨眼不推进**（引擎会推）。
 * 这一格登记为近似（见 changes §4），不在这里补（会改到调用点语义）。
 */
const blinkClocks = new WeakMap<L2dInstance, number>();
function blinkClockOf(inst: L2dInstance, deltaMs: number): number {
  const next = (blinkClocks.get(inst) ?? 0) + deltaMs;
  blinkClocks.set(inst, next);
  return next;
}

/**
 * 模型是否**声明**了这个参数名（= 引擎"参数表里有没有这一格"的等价物，`sub_4C4FD0`）。
 *
 * ★为什么眨眼这条要问、而 `0x351` / 动作曲线那条不问：引擎那两条路的落点不同 ——
 * `sub_478520`（`0x351`）与 `sub_4BCB50`（动作）走 `sub_4BD4D0`，其失败支只是 `if (v5 >= 0)`
 * **静默跳过**（raw 143838-143839）；而眨眼走的 `sub_4BD490` → `sub_4BD3E0` 对缺格是
 * **抛异常**（raw 143795-143799 `_CxxThrowException(aOutOfRangeMode)`）。
 * emulator 不复现"抛"（那会把整个场景打断），退化为"跳过这一格"，并把差别登记在
 * `tickets/T-0166/changes-c166-blink.md` §5。模型为 `null` 时按"没有参数表"处理。
 */
function declaresParam(inst: L2dInstance, paramId: string): boolean {
  return inst.model?.params.some((p) => p.id?.name === paramId) === true;
}
