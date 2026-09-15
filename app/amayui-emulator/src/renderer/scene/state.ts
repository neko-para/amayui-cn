/**
 * 场景模型状态（= 引擎 `Scene` 在 emulator 侧的可见部分）。
 */
import type { Item, MeshObj } from '../drawItem.js';
import type { TextFrame } from '../../text/layout.js';

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
}

export function newSceneState(): SceneState {
  return {
    // ★初始为 true：第一帧必须合成一次（与 pixi 的 `sceneDirty` 初值同义）。
    dirty: true,
    drawItems: new Map<number, Item>(),
    meshes: new Map<number, MeshObj>(),
    msgWins: new Map<number, TextFrame>(),
    msgRev: new Map<number, number>(),
    msgRanges: new Map<number, { base: number; count: number }[]>(),
    slotText: new Map<number, { x: number; y: number; text: string; fill: string }[]>(),
    render4: {
      primReset: null,
      primTransform: new Map<number, number[]>(),
      blits: [],
      commits: 0,
      transitionClears: 0,
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
  };
}