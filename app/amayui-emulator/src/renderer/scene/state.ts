/**
 * 场景模型状态（= 引擎 `Scene` 在 emulator 侧的可见部分）。
 */
import type { Item, MeshObj } from '../drawItem.js';
import type { TextFrame } from '../../text/layout.js';
import type { L2dHost } from '../../live2d/runtime.js';
import type { TransitionRuntime } from './transition.js';


/** 场景模型状态（= `Scene` 在 emulator 侧的可见部分）。 */
export interface SceneState {
  /**
   * **模型脏位**（"自上次合成以来有没有变过"）—— 由**共享层**维护：每个变更型 `sc*` 操作置 `true`
   * （只读的 getter/判据不置），`scAdvance` 只在**真的推进了某个窗**时置。
   *
   * 为什么放在共享层（`tickets/T-0003` 的 B3）：`needsRender` 的判据 `sceneNeedsRender` 已经是共享函数，
   * 而"脏"若由各宿主自己记，就又是"两个宿主各一份镜像"（同类事故见 `T-0008` 的 `waitFlags`）。
   * 清零的时机由宿主决定：pixi 在 `present()` 里清（它有自己的 `sceneDirty`，本轮不动）、
   * headless 在 `snapshot()` 里清 —— "取快照 = 消费当前状态"。
   */
  dirty: boolean;
  /**
   * **正在执行哪一帧**（emulator 记账，引擎没有这一格；`-1` = 未知）—— 由 VM 每条指令派发前下发
   * （`interpreter.ts` → `NativeBridge.setCurrentFrame`）。用途只有一个：**所有建项路径**都要把
   * "谁画的"记进 `Item.ownerFrame`，读档装载点靠它丢掉"被放弃那条调用链"画的 UI（`tickets/T-0083`）。
   */
  currentFrame: number;
  drawItems: Map<number, Item>;
  meshes: Map<number, MeshObj>;
  /**
   * **消息窗文本**（引擎里是「每窗一张离屏表面 + 逐行显现」，见
   * `docs-new/03-engine/adv-text-rendering.md` §3）。键 = 窗索引（0..9）。
   *
   * 与 drawItems 的关系：引擎在 D3D 路径下把每行文本登记成 DrawItem（平面号 = 20+win）、
   * 在 DD 路径下直接 blit 到表面 0；重写侧统一为「每窗一张纹理 + 一个 Sprite（层序 20+win）」，
   * 两种观感等价而实现单一。**文本不是 DrawItem**，所以放在这里而不是 `drawItems`。
   */
  msgWins: Map<number, TextFrame>;
  /** 每个窗的**内容版本号**：宿主据此判断纹理是否需要重新光栅化（递增即重画）。 */
  msgRev: Map<number, number>;
  /**
   * 每个窗在 Scene 里的 **DrawItem 区间**（引擎 `FontVWindow+104/+108`（`0x213` 写）与
   * `+276/+280`（`0x25D` 写）；SYSTEM4 注册 win1/win8 的正文区间 = `[105000,105500)`）。
   *
   * 用途单一但关键：脚本清文字的手段是 `0x1F7 detach-texture <base> <count>`（删掉这些图元），
   * 而重写侧的文本另有载体 ⇒ `scDetachTexture` 必须靠这张表判断"哪个窗的字该跟着消失"
   * （2026-09 用户实测：转场后 ADV 文字残留）。区间由 `scMsgWinSync` 从 `MsgWinInput.itemRanges` 刷新。
   */
  msgRanges: Map<number, { base: number; count: number }[]>;
  /**
   * **直绘进纹理槽的文本**（`0x204` draw-string → 引擎 `sub_456710` 的 GDI 整串直绘）。
   *
   * 为什么单独记：它**不是**消息窗文本（没有排版、没有逐字显现、不属于任何 win），
   * 而是往"某个纹理槽的表面"上叠一串字（`CONFIG1` 的设置行就是这么画的：先
   * `create-texture 196 628 360`，再逐行 `draw-string 196 …`，最后按行裁贴到 UI 上）。
   * 宿主据此光栅化；报告/测试据此断言"这串字确实被画进了槽 N"，而不是只能靠肉眼看画面。
   * `fill` = 直绘那一刻的**全局填充色**（引擎 `Font+1360`）—— 直绘是"立即消费全局样式"的路径
   * （与消息窗的"入队时钉住"相对），记下来才能回归"角色名颜色溢到 ADV 样例窗"这类问题。
   */
  slotText: Map<number, { x: number; y: number; text: string; fill: string }[]>;
  /**
   * **`0x20B` FillTexture 的记录**（槽 → 纯色矩形列表；`tickets/T-0076` 的 B3）。
   * 与 slotText 同源设计：Pixi 宿主真画进槽画布，headless 记录于此供报告/测试断言。
   */
  slotFills: Map<number, { x: number; y: number; w: number; h: number; argb: number; alpha: number }[]>;
  /**
   * **Live2D 运行态宿主**（`Engine` 结构化满足 `L2dHost`；调用方在 Engine 建好后挂上）。
   *
   * 为什么是"挂一个引用"而不是把三张表搬进 `SceneState`：那三张表（10 实例槽 / 572B 节点 /
   * 动作缓存）是**VM 指令直接读写**的（`0x341`–`0x352`），而 `SceneState` 是**两个宿主各自持有**
   * 一份（Pixi 一份、headless 一份）。表若放进 `SceneState` 就有两份镜像；挂引用则两边读同一份，
   * 而"节点指向的槽有没有模型"又是**绘制判据**（引擎 raw 134320）⇒ 一致性是硬要求。
   * `null` = 该宿主没接 L2D（快照 `l2d` 段为 `null`，`scL2dTick` 空转）。
   */
  l2dHost: L2dHost | null;
  /** `scL2dTick` 上一次的时钟（`-1` = 还没 tick 过 ⇒ 首帧 delta = 0）。 */
  l2dLastMs: number;
  /**
   * **A4 族的渲染状态记录**（2026-09 落地）。
   *
   * 引擎里这 11 条写的是 Scene 的字段 / DrawItem 与 MeshEntry 的属性（见 `handlers/gfx-state.ts`
   * 的对照表）。emulator 目前**只记录**：这些字段在真机上影响 D3D/DD 的绘制细节（变换复位、
   * 槽→槽 blit、Clear、转场表、绘制模式、网格属性、3D 颜色），而重写侧的 Pixi 渲染管线还没有
   * 逐条消费它们。记录下来的意义：① 不再是无依据的 no-op；② **已导出到 `scene/snapshot.ts`**
   * （`SceneSnapshot.render4` + `snapshotToText` 的 `render4（只记录…）` 行）⇒ 报告/测试可以断言
   * "脚本确实下发了这个状态"；③ 将来渲染器要消费时，数据已经在模型里。
   */
  render4: {
    /** `0x1FC` 最近一次复位过变换的图元 handle。 */
    primReset: number | null;
    /** `0x1FE` 图元变换 4 浮点（handle → [a,b,c,d]，**原样**，不除 100）。 */
    primTransform: Map<number, number[]>;
    /** `0x207` 槽→槽 blit（保留最近 16 次）。 */
    blits: Array<{ srcSlot: number; dstSlot: number; srcRect: number[]; dstRect: number[] }>;
    /** `0x20E` 图形提交次数。 */
    commits: number;
    /** `0x224` 清转场表次数。 */
    transitionClears: number;
    /**
     * **转场（wipe）记录表**（引擎 `Scene+1048`，每格 96 字节 = **24 个 dword**）：`id → 24 格记录`。
     *
     * 写入端 = `0x24F`/`0x250`/`0x251`（`handlers/gfx-state.ts`，逐格照抄引擎的 `sub_4AAE10(...)[i] = v`）；
     * 清空端 = `0x224`（引擎 `sub_4A9BE0` 逐节点 delete，raw 129282-129302）。
     * 格位语义（读体得，含 raw 锚）：`[0]` 类别（2 = 盲式擦除 / 3 = 插值转场）、`[1]` 窗口起点（首帧锁存）、
     * `[2]` 延迟 ms、`[3]` 时长 ms（0 = 非活动；到点由渲染器清 0）、`[4]` 工作纹理槽（渲染目标）、
     * `[5]`/`[7]` 绘制项 id 区间、`[9..12]` 裁剪矩形（默认 `SetRect(0,0,0,0)`，`sub_49A640` raw 117059-117077）、
     * `[13]` 子类型（类别 2：盲式类型 0..11；类别 3：0 = SlideBlur / 1 = ZoomBlur）、`[14]` 盲式分割宽度、
     * `[15]` 类别 2 的目标绘制项 handle、`[16..19]`→`[20..23]` 类别 3 的四通道起止值。
     * ★仅**建模记录**：扫描带绘制与"窗口未到点挂起 `0x400` 门"未实现（见 `handlers/gfx-state.ts` 的扩展点）。
     */
    transitions: Map<number, number[]>;
    /**
     * ★**转场窗的运行时状态**（引擎把它就地写在记录的 `[1]`/`[3]` 上：起点锁存 raw 134867-134871、
     * 到点清 `[3]` = 死记录）。emulator **刻意另存一份**：`transitions` 是写入端逐格照抄引擎的
     * **脚本语义真源**，`test/op-24f-250-251-transitions.test.ts` 对它做整条 `deepEqual`
     * ⇒ 运行期的时钟绝不能回写进去（见 `scene/transition.ts` 文件头纪律 1）。
     *
     * 生命周期 = `transitions`：`scTransitionTick` 在"一条都不活动"时把两者一起清掉
     * （引擎 raw 136840-136841 的 `sub_4A9BE0(Scene+1048)`）。见 `tickets/T-0084`。
     */
    transitionRuntime: Map<number, TransitionRuntime>;
    /** `0x229` 绘制模式 5 元组（2 int + 3 float）。 */
    drawMode: number[];
    /** `0x242` DrawItem `+720`（entry → value）。 */
    entryParams: Map<number, number>;
    /** `0x256` 按 id 的绘制项参数（slot → [int, x, y, z]）。 */
    slotParams: Map<number, number[]>;
    /** `0x321` MeshEntry 属性（mesh → index → value）。 */
    meshAttrs: Map<number, Map<number, number>>;
    /** `0x32A` 已释放的 3D 模型槽。 */
    released3D: number[];
    /** `0x32D` 3D 颜色 [r,g,b,a]（各 0..1）。 */
    color3D: number[];
    /**
     * `0x20D` **当前渲染目标纹理槽**（引擎 `Scene+46456`；`-1` = 后台缓冲）。
     *
     * ★**它不只是记录**：`0x203`/`0x322` 的混合选择子**值 2 是门控的** —— 只有当这个槽指向的纹理
     * 是 **mode-1 离屏表面**时才用 `(ONE,ZERO)` 覆盖，否则沿用当前混合（引擎 raw 123110-123115 /
     * 119381-119386）。见 `scene/blend.ts` 与 `tickets/T-0017`。
     */
    renderTargetSlot: number;
    /** `0x1F8` 的 op4 = 每个纹理槽的**创建模式**（引擎 `CTexture+1048`；mode 1/2 = 离屏渲染目标）。 */
    slotModes: Map<number, number>;
    /**
     * `0x33F` op1 = **场景默认混合选择子**（引擎 `Scene+1260`，消费点 `sub_4535F0` raw 65858-65889）。
     * 未下发时 = `0`（→ 普通 alpha），与 emulator 既有行为一致。
     */
    sceneBlend: number;
  };
  /**
   * ★**Scene 变换锚 + 它的作用层区间（引擎 `Scene+1120` 起的那个变换记录）** ——
   * 写端 = `0x22A`/`0x22C`/`0x22D`/`0x22F`（`scSetScene*`），消费端 = 两个宿主合成时的
   * `sceneLayerXform()`（`renderer/scene/ops.ts`）。
   *
   * 引擎语义（逐行读体的结论，raw 锚见各字段）：
   *  - 四条指令把 Scene **自己的**变换写进四组矩阵格（`+307` 缩放 / `+371` 平移 / `+323` 轴缩放 /
   *    `+387` 平移），**都不是对某个 DrawItem 的改动**（体内无 `sub_41BF50` 取 handle）；
   *  - `sub_4A1E90`（raw 122130-122157）把 `Scene+46600` 置**单位阵**后调 `sub_49AA30`
   *    （`this, Scene+1120, Scene+46600, …`）把该记录**合成/立刻应用**成 **Scene 世界矩阵**；
   *  - RenderScene（raw 133403-133407）的那处 `if` **门是「层号 ∉ [20,30)」**：
   *    `*(Scene+46676) || *(*(Scene+1860)+1164) != 2 || (unsigned)(层号 − 20) > 9` ⇒ 门为真 ⇒
   *    `D3DXMatrixMultiply(Scene+46536, Scene+46536, Scene+46600)`（**完整** Scene 世界矩阵乘进
   *    该项的 work 矩阵）。★**订正上一轮记录的读法**：那个乘法**不是**"只对 20..29 层生效"——
   *    真正**只作用于 `层号 ∈ [20,30)`** 的是 `else` 支（raw 133411-133438）：`D3DXMatrixDecompose`
   *    出缩放/旋转/平移后**只把 2D 缩放与平移**装回 work 矩阵（旋转项被清零，raw 133749-133765），
   *    ⇒ 该区间的项拿到的是**被压成 2D 的**Scene 世界矩阵。
   *    `层号` = 元素 `+4`（`v26[1]` / `a2[1]`，raw 133405 / 117388）。
   *  - **最终合成本身在 `sub_49AA30` 的收尾**（LABEL_72，raw 117927-117933）：
   *    `M ← M·v118·v120·v121·T(pos)`，其中 `v121` 是**上面那条 Scene 世界矩阵**
   *    （1D 支里由 `v131`/`v108` 装上，raw 117739/117920/117773），`v120` 是**旋转矩阵**。
   *    ★关键：在 `层号 ∈ [20,30)` 那一支里 `v120` 被**显式置成单位阵**
   *    （raw 117629-117631 紧跟 `v26 = 0.0; v42 = 1.0;`，再由 raw 117647-117662 的 `v26/v42`
   *    填出单位阵/单位缩放），**就是"丢掉旋转"的实现方式** —— 而 `v120`（= 单位阵）**仍然会被乘进
   *    去**（raw 117930），所以净效果正是 `v121` = 纯 2D 缩放 + 平移。这解释了为什么
   *    `0x22F` 的轴分量（→ `a2+181`/`a2[184]` → `D3DXMatrixRotationAxis`）对 20..29 层
   *    **不产生任何影响**。
   *    （副作用：`else` 支**没有**任何"矩阵是否有效"的门 ⇒ 即便四条指令一条都没下发（`Scene+46600`
   *    为单位阵），20..29 层也照样走 decompose 重建 —— 单位阵重建后仍是单位阵，结果等同。）
   *
   * ★**落地轮实测（2026-09）**：emulator 里**原来没有**这一级 —— `render4` 只是"逐条记录、渲染器
   * 不消费"，`pixi/presenter.ts` 的四路归并（item/text/mesh/L2D）也没有"Scene 根矩阵"这一层。
   * 本轮把它建出来（本节 + `ops.ts` 的 `scSetScene*`/`sceneLayerXform` + 两个宿主 + `presenter` 的
   * 归并循环），所以四条指令**有真实消费者**（不再是有写无读）。
   *
   * ★**只建模 [20,30) 这一支**：语料 20 处全部落在 `0x22A`/`0x22C`/`0x22D`/`0x22F`，
   * 而引擎把 Scene 世界矩阵**无论层号都乘进 work 矩阵**（只有"取哪一支"按层号分）。
   * 本轮只实现 [20,30) 的 2D 支（= 用户要求的合成级）；非 [20,30) 层拿到完整 3D 矩阵那一支
   * **未实现**，登记为本条的缺口（见 `opcode-gaps.json` 四条 note 与 `engine-capabilities.json`）。
   */
  sceneXform: SceneXform | null;
}

/** 变换种类（引擎 `Scene+306` = 记录内 dword 306−280；`0x22A`/`0x22D`/`0x22F` 都写 1）。 */
export type SceneXformKind = 'scale' | 'translate' | 'axis-scale';

/**
 * **Scene 变换锚**（引擎 `Scene+1120` 起的变换记录的可见部分；`null` = 从未下发过）。
 *
 * 四个 opcode 写的是**各自那一组**矩阵格，所以这里也逐组记（而不是合成一个矩阵）：这样
 * "`0x22F` 到底写的是哪个矩阵函数"这种问题可以在快照里一眼核对。
 *
 * ★**已披露的近似（一处，语料里未触发）**：引擎那四组矩阵格是**互相独立**的 ——
 * `0x22A`(+0x1228 缩放) / `0x22C`(+0x1358 平移) / `0x22D`(+0x1430 轴缩放) / `0x22F`(+0x1548 轴平移)
 * 各写各的，`D3DXMatrixScaling/Translation` 都作用于 16 个 f32 的**独立**区块
 * （所以 `sub_49AA30` 的 `v121` 里会同时体现）；而本模型用**一个 `kind`** 表达
 * "最近一次指令是哪一种"，因此**只应用最近一次设的那一种**。
 * 依据（为什么这样可接受）：语料 20 处里，四条**从不同时生效** ——
 * `i22a`/`i22d` 的缩放恒为 `(1,1,1)`（`64` = 100 与 `global-int b234`），`i22c`/`i22f` 是纯平移，
 * 且每个脚本每次只下发其中一条。真要同时生效时需要把 `kind` 改成"四组各自的有效位"。
 */
export interface SceneXform {
  /** 最近一次指令设的变换种类（引擎 `Scene[306]`：`0x22A`→缩放、`0x22D`→轴缩放；见各 op 注释）。 */
  kind: SceneXformKind;
  /** `0x22A`（`sub_49A720` raw 117117-117126）：`D3DXMatrixScaling(Scene+307)` 的三轴。 */
  scale: { x: number; y: number; z: number };
  /** `0x22C`（`sub_49A820` raw 117153-117162）：`D3DXMatrixTranslation(Scene+371)` 的三轴。 */
  translate: { x: number; y: number; z: number };
  /** `0x22D`（`sub_49A870` raw 117165-117179）：`D3DXMatrixScaling(Scene+323)` 的三轴（op3/4/5 ÷100）。 */
  axisScale: { x: number; y: number; z: number };
  /** `0x22F`（`sub_49A9C0` raw 117222-117236）：`D3DXMatrixTranslation(Scene+387)` 的三分量（op3/4/5 不除）。 */
  axisTranslate: { x: number; y: number; z: number };
  /**
   * `0x22D` 的 op1 / `0x22F` 的 op1（引擎 `a2` → `Scene[295]` / `Scene[297]`，**int**）。
   * ★`0x22C`/`0x22A` 体内没有这两个格子（所以 `null`）。
   */
  maskA: number | null;
  /**
   * `0x22D` 的 op2 / `0x22F` 的 op2（引擎 `a3` → `Scene[300]` / `Scene[302]`，**int**；
   * 语料里是 `12c`=300 / `7d0`=2000 / `1f4`=500 这类值，与 op3/4/5 的浮点轴分量配对）。
   */
  maskB: number | null;
}

export function newSceneState(): SceneState {
  return {
    // ★初始为 true：第一帧必须合成一次（与 pixi 的 `sceneDirty` 初值同义）。
    dirty: true,
    currentFrame: -1,
    drawItems: new Map<number, Item>(),
    meshes: new Map<number, MeshObj>(),
    msgWins: new Map<number, TextFrame>(),
    msgRev: new Map<number, number>(),
    msgRanges: new Map<number, { base: number; count: number }[]>(),
    slotText: new Map<number, { x: number; y: number; text: string; fill: string }[]>(),
    slotFills: new Map<number, { x: number; y: number; w: number; h: number; argb: number; alpha: number }[]>(),
    l2dHost: null,
    l2dLastMs: -1,
    render4: {
      primReset: null,
      primTransform: new Map<number, number[]>(),
      blits: [],
      commits: 0,
      transitionClears: 0,
      transitions: new Map<number, number[]>(),
      transitionRuntime: new Map<number, TransitionRuntime>(),
      drawMode: [0, 0, 0, 0, 0],
      entryParams: new Map<number, number>(),
      slotParams: new Map<number, number[]>(),
      meshAttrs: new Map<number, Map<number, number>>(),
      released3D: [],
      color3D: [1, 1, 1, 1],
      // -1 = 后台缓冲（引擎 `sub_4A50C0(…, 0xFFFFFFFF)` 就是"回到后台缓冲"）。
      renderTargetSlot: -1,
      slotModes: new Map<number, number>(),
      sceneBlend: 0,
    },
    // ★Scene 变换锚：`null` = 四条指令一条都没下发 ⇒ `sceneLayerXform` 回单位变换，
    //   20..29 层的合成结果与"没有这一级"逐字节相同（所以接线本身不会改变既有画面）。
    sceneXform: null,
  };
}