/**
 * 场景模型状态（= 引擎 `Scene` 在 emulator 侧的可见部分）。
 */
import type { Item, MeshObj } from '../drawItem.js';
import type { TextFrame } from '../../text/layout.js';
import type { L2dHost } from '../../live2d/runtime.js';
import type { TransitionRuntime } from './transition.js';
import type { Effect3DManagerState, Effect3DSlots } from './weather.js';
import { newEffect3DSlots, newWeatherManager } from './weather.js';
import type { SceneCommitRequest } from './commit.js';
import { SCENE_SCRATCH_SLOT_A, SCENE_SCRATCH_SLOT_B, sceneScratchMode } from './effectLevel.js';


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
   * ★**池挂起位 `Scene+46516` 的场景侧锁存**（审计 §4.2 #2 `bullet-dirty-from-freeze-or-pending`，P1）。
   *
   * 引擎的**唯一**语义读点是一句收尾（`sub_4B4040` raw 136718-136719，`sub_4B4460` 同族）：
   * ```c
   * if ( *(_QWORD *)(_this + 46512) )   // 46512 强制冻结 | 46516 池挂起（8 字节一起判）
   *   *(_DWORD *)(_this + 46508) = 1;   // 46508 = "本遍要重画"
   * ```
   * ⇒ **「上一遍绘制时还有元素在动」= 本遍必须再合成一次**。修前这条只喂 `0x400` 等待门
   * （`Engine.scenePending` → `Engine.gatePending`），`sceneNeedsRender` 的判据里**没有它**
   * ⇒ 「绘制期置了 46516、但窗判据此刻已为假」的组合会漏掉一帧终态（不报错、只是画面少动一下）。
   *
   * 为什么落在 `SceneState` 而不是 `Engine`：判据 `sceneNeedsRender` 是**共享函数**，两个宿主
   * （`pixiBackend` / `headlessScene`）必须读同一份量（`tickets/T-0003` 的 B3 纪律：模型状态只存共享层，
   * 宿主各存一份镜像就是 `T-0008` 的 `waitFlags` 事故）。宿主在每帧末 `advanceModel` 之后把
   * `Engine.scenePending` 的值**锁存**进这里（见 `scSetScenePending`），下次合成消费后由宿主清零。
   */
  pending: boolean;
  /**
   * ★★**渲染冻结总闸 `Scene+46676`**（审计 §4.2 #24 `scene-render-freeze-46676`，P1）。
   *
   * 引擎里它是一个**只读帧级门**（全文件 105 处读、**0 处写** ⇒ 由非脚本路径置位）：
   *  - `sub_4B06D0` raw 134898 / `sub_49AA30` raw 117375：非 0 ⇒ **整段 2D 提交/逐项提交被跳过**；
   *  - `sub_4AF1C0` raw 133547：非 0 ⇒ 网格的顶点锁定 + 缩放整段跳过；
   *  - 文本行绘制 raw 71833/72266 与 draw-item 混合覆盖 raw 123117：同为门；
   *  - `sub_4B4040` raw 136790 / `sub_4B4460` raw 137033：非 0 ⇒ 连"进 mode-38 渲染目标"都不做。
   *
   * ⇒ 语义 = **本帧整个渲染提交不进行**（画面停在上一帧、窗也不按墙钟推进）。emulator 侧此前只有一个
   * 窗口级的近似（`scAdvance` 的 `freeze` 形参 = `Scene+46512` 强制收尾），**没有**帧级跳过。
   *
   * 消费点（两处，都读同一个字段，口径**一处**实现）：
   *  - `scAdvance`：非 0 ⇒ 直接 return（不推进任何窗，与引擎"整段跳过"同观测）；
   *  - `sceneNeedsRender`：非 0 ⇒ 恒假（`46508` 也不会被置位 ⇒ 引擎那一帧确实不重画）。
   * 置位端 = `scSetSceneFrozen`（宿主缝；反编译里无写点 ⇒ 由驱动/实测注入，默认 `false`）。
   */
  frozen: boolean;
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
   * `sceneAffine2DOf`（`renderer/scene/ops.ts`）。
   *
   * 引擎语义（逐行读体的结论，raw 锚见各字段）：
   *  - 四条指令把 Scene **自己的**变换写进四组矩阵格（`+307` 缩放 / `+371` 平移 / `+323` 轴缩放 /
   *    `+387` 平移），**都不是对某个 DrawItem 的改动**（体内无 `sub_41BF50` 取 handle）；
   *  - `sub_4A1E90`（raw 122130-122157）把 `Scene+46600` 置**单位阵**后调 `sub_49AA30`
   *    （`this, Scene+1120, Scene+46600, …`）把该记录**合成/立刻应用**成 **Scene 世界矩阵**；
   *  - RenderScene（raw 133403-133407）的那处 `if` **门是「层号 ∉ [20,30)」**：
   *    `*(Scene+46676) || *(*(Scene+1860)+1164) != 2 || (unsigned)(层号 − 20) > 9` ⇒ 门为真 ⇒
   *    `D3DXMatrixMultiply(Scene+46536, Scene+46536, Scene+46600)`（**完整** Scene 世界矩阵乘进
   *    该项的 work 矩阵）；门假（层号 ∈ [20,30)）⇒ `D3DXMatrixDecompose` 后按
   *    `raw 133421-133438` 重建：`S(scale.x, scale.y, 1)` → `RotationAxis(Scene+1844, Scene[1856])`
   *    → `T(pos.x·k, pos.y·k, pos.z)`（k = `0x18D0` 侧的 2D 视口比，见 raw 117394-117410）。
   *  - **最终合成本身在 `sub_49AA30` 的收尾**（LABEL_72，raw 117927-117933）：
   *    `M ← M·v118·v120·v121·T(pos)`，其中 `v118`/`v120`/`v121` 是元素的**三块 current 矩阵**
   *    （`+0x6C` 缩放 / `+0xEC` 旋转 / `+0x16C` work），四块 Scene 矩阵靠 raw 117496/117646 的
   *    `qmemcpy` 与 117425-117431 的 pivot 平移进入其中。
   *
   *  ★**2026-09 第二轮订正（本文件原注释有一处读错，留档）**：原文写「在 `层号 ∈ [20,30)` 那一支里
   *    `v120` 被**显式置成单位阵**（raw 117629-117631 紧跟 `v26 = 0.0; v42 = 1.0;`）… 这解释了为什么
   *    `0x22F` 的轴分量对 20..29 层**不产生任何影响**」。**体与此不符**：
   *    ① raw 117624-117632 在层号支里做的恰恰相反 —— 它用 `j_D3DXMatrixRotationAxis(v120, a2 + 181,
   *       a2[184])` **重建了非单位的 `v120`**，随后 117930 把 `v120` 乘进 work；
   *    ② 紧跟其后的 `v26 = 0.0; v42 = 1.0;` 是给**后面 `+0x1B0` 那块矩阵**（raw 117647-117662 用
   *       `v26`/`v42` 填零/一，再 `qmemcpy(v121, a2 + 91)`）用的**零/一填充**，不是"把 `v120` 置单位阵"。
   *    ⇒ 层 20..29 上 `0x22F` 的 op3/4/5 **是旋转轴**（角 = `a2[184]`）。修前的 emulator 把它当
   *    屏幕空间 2D 平移（`presenter.ts` 的 `tx/ty`），已于本轮按体改正。
   *
   * ★**四块矩阵互相独立**（渲染端 `raw 117123/117159/117175/117232` 各写各的 64 B 块，收尾一起乘进
   *   work）⇒ 合成不再用"最近一次 `kind` 互斥三选一"（修前跨种类混用只剩一种；`kind` 现在只是参考字段）。
   *
   * ★**落地轮实测（2026-09）**：emulator 里**原来没有**这一级 —— `render4` 只是"逐条记录、渲染器
   *   不消费"，`pixi/presenter.ts` 的四路归并（item/text/mesh/L2D）也没有"Scene 根矩阵"这一层。
   *   本轮把它建出来（本节 + `ops.ts` 的 `scSetScene*`/`sceneAffine2DOf` + 两个宿主 + `presenter`
   *   的归并循环），所以四条指令**有真实消费者**（不再是有写无读）。
   *
   * ★**只建模 [20,30) 这一支**：语料 20 处全部落在 `0x22A`/`0x22C`/`0x22D`/`0x22F`，
   * 而引擎把 Scene 世界矩阵**无论层号都乘进 work 矩阵**（只有"取哪一支"按层号分）。
   * 本轮只实现 [20,30) 的 2D 支（= 用户要求的合成级）；非 [20,30) 层拿到完整 3D 矩阵那一支
   * **未实现**，登记为本条的缺口（见 `opcode-gaps.json` 四条 note 与 `engine-capabilities.json`）。
   */
  sceneXform: SceneXform | null;
  /**
   * ★**Scene 自己的"绕轴旋转"角（弧度）** —— 引擎 RenderScene 层号支 raw 133427 的第二个实参
   * `*(float *)(Scene + 1856)`（= dword 464），配套轴在 `Scene + 1844`（= dword 461，三 float）。
   *
   * **为什么是独立一格而不是 `i22f` 的操作数**：`i22f` 只写"轴"（`Scene+387` 的平移分量同时兼作
   * 元素 `a2[181..183]` 的轴），**角来自元素自己的 `a2[184]`**（raw 117630），其写点是动画块
   * （raw 117616）与瞬时写（raw 117255）—— `i22f` 一次都不碰。
   *
   * ★**卡点（如实披露）**：`Scene+1844/+1856` 在反编译里**只有 raw 133427 一个读点、没有任何写点**
   * （全文件检索 `1844`/`1856`/dword `461`/`464` 均无写）⇒ 它的运行期取值无法静态判定。
   * 默认 `0`（恒等旋转 ⇒ 与修前逐字节相同）是本轮最保守的取法；宿主可用
   * `scSetSceneRotationRad` 注入实测值/回归值。**这是本条唯一未解析出的字段**。
   */
  sceneRotRad: number;
  /**
   * ★★**3D 天气/粒子效果管理器**（引擎 `Scene+50704`，`operator new(0x4F4)`，`sub_4530B0` 构造；
   * 创建点 = `sub_4A6EE0` raw 126541-126545）—— 审计 §4.2 #21 / #18 的核心缺口。
   *
   * 引擎里它每帧被推进两次：
   *  - `sub_4535F0(管理器, -1)`（raw 136828-136829 / 137169-137170）：按三表归并的**节点键**做销毁判据
   *    （`[+0x4D8]`/`[+0x4DC]` 两个阈值，写端 = `0x325`）；
   *  - `sub_453540(管理器)`（raw 65806-65812，体在 `scene/weather.ts`）：**按墙钟 `timeGetTime()` 推进**，
   *    每帧对三路效果对象（`[258]` Rain / `[259]` Snow / `[260]` Leaf）各推进**上限 100 次**。
   *
   * 为什么放在 `SceneState`（= 两个宿主共享）：推进是**模型**行为（脚本 `SETWEATHER` 族写参数、
   * 帧循环推进时相），若各宿主自己推就会漂移（`tickets/T-0003` 的 B3 纪律）。Pixi 宿主负责把
   * `particles` 画成点精灵（`presenter` 的天气层），headless 只把它导出进快照。
   */
  weather: Effect3DManagerState;
  /**
   * ★**`0x222` 点名的提交区间队列**（`[op1, op1+op2)`；审计 §4.2 #19）。
   *
   * 为什么在共享模型里：`0x222` 是**脚本时序**的事件，而引擎的提交发生在**渲染时序**
   * （`sub_4B4460` 的三表归并）。emulator 的渲染时序入口 = 宿主 `advanceModel` ⇒ 脚本入队、
   * 帧末出队（`renderer/scene/commit.ts` 的 `scSceneCommitRange`）。
   *
   * ★**当前生产路径没有人入队**：把 `0x222` 的两个 int 操作数送到这里需要一条 `NativeBridge` 缝
   * （`src/vm/native.ts` + `nativeTap.ts` 在别的执行者所有权里）。见 `handlers/scene-commit.ts`
   * 的重开条件 ①。队列空时提交仍照做（对全部 mesh 走一遍 bit0 分派）。
   */
  commitQueue: SceneCommitRequest[];
  /**
   * ★★**3D 效果等级 `Scene+46668`**（审计 §4.2 #20 `scene-3d-effect-level-writer`，P1）。
   *
   * 引擎里它是 **0 / 1 / 2** 三档，由 D3D 版本能力决定、也可由构造实参显式给
   * （`sub_4A6EE0` raw 126548-126562）：
   * ```c
   * if (a3 < -1 || a3 > 2 || a3 == -1) {                 // 没显式给 ⇒ 读设备能力
   *   if (v13 < 0xFFFF0200) Scene+46668 = (v13 >= 0xFFFF0100);   // 0 或 1
   *   else                  Scene+46668 = 2;
   * } else Scene+46668 = a3;
   * if (Scene+46668 >= 2) { sub_4A2C10(Scene, 36, …, 1); sub_4A2C10(Scene, 37, …, 1); }   // ★mode 1
   * else                  { sub_4A2C10(Scene, 36, …, 2); sub_4A2C10(Scene, 37, …, 2); }   // ★mode 2
   * ```
   * 它的**持续后果**（本轮建模的三条，全部可断言）：
   *  1. **36/37 两个 scratch 槽的 mode** 跟着等级（`>=2 ⇒ 1`、否则 `2`）—— `sceneScratchMode`；
   *  2. 三个 `ID3DXEffect` 惰性建（`Scene+46480` ⇒ 等级≥2 资源 201 / ≥1 资源 200；
   *     `Scene+46492` ⇒ 等级 **>1** 资源 203）—— `weather.ts` 的 `ensureEffect3DSlots`；
   *  3. `0x326` 的**共享**效果（资源 202）与 Snow 重建带 `>=1` 门 —— `ensureSharedEffect3D`。
   *
   * ★初值取 **2**（不是 0）：emulator 的呈现后端是 WebGL（Pixi）——它**没有** D3D9 的
   * `0xFFFF0100` 版本上限，等价于"设备能力满档"。取 0 会让 `>=2` 的那条支永远走不到，
   * 恰好复刻审计点名的"恒等于等级 0 的无效果支"。守卫：`test/scene-3d-effect-level.test.ts`。
   */
  effect3DLevel: number;
  /** 三个 3D 效果槽（`Scene+46480`/`+46492`/`+46496`）—— 见 `weather.ts` 的 `Effect3DSlots`。 */
  effect3DSlots: Effect3DSlots;
}

/** 变换种类（引擎 `Scene+306` = 记录内 dword 306−280；`0x22A`/`0x22D`/`0x22F` 都写 1）。 */
export type SceneXformKind = 'scale' | 'translate' | 'axis-scale';

/**
 * **Scene 变换锚**（引擎 `Scene+1120` 起的变换记录的可见部分；`null` = 从未下发过）。
 *
 * 四个 opcode 写的是**各自那一组**矩阵格，所以这里也逐组记（而不是合成一个矩阵）：这样
 * "`0x22F` 到底写的是哪个矩阵函数"这种问题可以在快照里一眼核对。
 *
 * ★**四块矩阵互相独立、可叠加**（引擎 `raw 117123/117159/117175/117232` 各写各的 64 B 块，
 * 收尾 `raw 117927-117933` 一起乘进 work）⇒ 合成走 `sceneAffine2DOf` 的四块矩阵乘积。
 * `kind` **只是"最近一次下发的是哪一种"的参考字段**（引擎 `Scene[306] = 1`，四条都写 1、体上不可区分），
 * **不再是合成选择子** —— 修前 `applySceneXformToPlacement` 按它三选一，跨种类混用（如 `i22a` 之后再
 * `i22f`）会把前者的分量整体丢掉。那一处近似（P2）已在本轮改成"两个/四个分量叠加"。
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
  /**
   * `0x22F`（`sub_49A9C0` raw 117222-117236）：`D3DXMatrixTranslation(Scene+387)` 的三分量（不除）。
   * ★**层号 ∉ [20,30)** 的项看到的就是这一块（平移）；层 20..29 看到的是同一三格当旋转轴（见 `axis`）。
   */
  axisTranslate: { x: number; y: number; z: number };
  /**
   * ★**`0x22F` 的 op3/4/5 当"旋转轴"的那一份**（层 20..29 的路径；raw 117630 的 `a2 + 181`）。
   *
   * 与 `axisTranslate` **是同一个三格**（引擎里元素 +724/+728/+732），只是两条消费路径的语义不同：
   * `axisTranslate` = 非 [20,30) 的完整世界矩阵支（平移），`axis` = [20,30) 的 2D 支（旋转轴，
   * 角 = `SceneState.sceneRotRad`）。**修前 emulator 只有前者、且把它当屏幕空间 2D 平移用**。
   */
  axis: { x: number; y: number; z: number };
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
  const st: SceneState = {
    // ★初始为 true：第一帧必须合成一次（与 pixi 的 `sceneDirty` 初值同义）。
    dirty: true,
    // ★`Scene+46516` 的场景侧锁存（见字段说明）：初值 false（还没跑过任何一遍绘制）。
    pending: false,
    // ★`Scene+46676` 渲染冻结总闸：反编译里**无写点** ⇒ 默认 false（与修前逐字节相同）。
    frozen: false,
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
    // ★Scene 变换锚：`null` = 四条指令一条都没下发 ⇒ `sceneAffine2DOf` 回单位变换，
    //   20..29 层的合成结果与"没有这一级"逐字节相同（所以接线本身不会改变既有画面）。
    sceneXform: null,
    // ★Scene 自己的"绕轴旋转"角（引擎 `Scene+1856`，raw 133427）：反编译里**无写点** ⇒ 默认 0
    //   （恒等旋转 = 与修前逐字节相同），由宿主经 `scSetSceneRotationRad` 注入实测值。见 `sceneRotRad` 说明。
    sceneRotRad: 0,
    // ★3D 天气/粒子管理器（`Scene+50704`）：新建场景 = 管理器已建、三效果槽全空（`sub_4530B0` raw 65353-65355）。
    weather: newWeatherManager(),
    // ★`0x222` 的区间队列（见字段说明）：新场景 = 没有脚本点名过任何区间。
    commitQueue: [],
    // ★`Scene+46668` 的初值 = 2（= "设备能力满档"，见字段说明）；槽全未建（惰性建由绘制期做）。
    effect3DLevel: 2,
    effect3DSlots: newEffect3DSlots(),
  };
  // ★等级 ⇒ 36/37 两个 scratch 槽的 mode（`>=2 ⇒ 1`、否则 `2`；`sub_4A6EE0` raw 126563-126572）：
  //   与 `0x1F8` 写的 `slotModes` 是同一张表（`scene/slotMode.ts` 的 `sceneScratchMode`）。
  //   守卫 = `test/scene-3d-effect-level.test.ts` 的三档断言。
  const mode = sceneScratchMode(st.effect3DLevel);
  st.render4.slotModes.set(SCENE_SCRATCH_SLOT_A, mode);
  st.render4.slotModes.set(SCENE_SCRATCH_SLOT_B, mode);
  return st;
}