/**
 * **每帧合成**：把共享场景模型（`SceneState`）画成 Pixi 场景图。
 *
 * 分工：本模块只读模型、不写模型（除了 `advanceWindows` 的窗锁存——引擎语义要求绘制期推进）；
 * 任何"指令 → 模型"的改动都在 `scene/ops.ts`。因此"报告里的模型"与"画面上的模型"不可能漂移。
 *
 * 合成顺序（与引擎一致）：
 *  1. 逐帧推进所有 draw-item 的 5 个动画窗；
 *  2. draw-items 按 `layer` 升序、再 `handle` 升序；**`flags & 1` 是绘制门**（空项不画）；
 *  3. meshes（顶点色四边形）与 **Live2D 三角批次**也进**同一次归并**（键分别是 `handle` 与
 *     572B 节点的 key）—— 引擎 `sub_4B06D0` 就是"图元表 / mesh 表 / 立绘节点表"三路归并
 *     （raw 135560-135614），等键次序为 **item → text → mesh → L2D 节点**。
 */
import { Container, Graphics, Mesh, MeshGeometry, Rectangle, Sprite, Texture, type ContainerChild } from 'pixi.js';
import {
  advanceWindows,
  calcDiffuse,
  itemColor,
  itemRenderPlacement,
  itemSrcRect,
  itemUsesWorld,
  meshColor,
  meshVertexColor,
  type Item,
} from '../drawItem.js';
import type { SceneState } from '../sceneModel.js';
import { applySceneXformToPlacement, sceneLayerAffected } from '../scene/ops.js';
// ★消息窗正文行的 id 区间（`0x213`/`0x25D` 登记）：那批 id 上的 DrawItem 是"文本行"而不是图元
//   （emulator 的文本由 `textLayer` 画）⇒ 无纹理槽时不能当图元画成白块。见 `T-0102`。
import { inMsgTextRange } from '../drawitem/msgTextRange.js';
import { walkBlendSequence, type BlendEnv, type BlendState } from '../scene/blend.js';
import { scTransitionMarkedHandles, type TransitionRenderItem } from '../scene/transition.js';
import type { TextureCache } from './textureCache.js';
import { l2dBatches, type L2dMeshBatch } from '../../live2d/render.js';
import { VIEW_H, VIEW_W } from '../viewport.js';

/**
 * 抽象混合档 → Pixi 的 `BLEND_MODES`（`tickets/T-0017`）。
 *
 * ★为什么是这张表（Pixi 的颜色是**预乘**的）：
 *  - `'add'`    = `[ONE, ONE]`      ⇔ 引擎 `(SRCALPHA, ONE)`（预乘后等价）
 *  - `'normal'` = `[ONE, ONE_MINUS_SRC_ALPHA]` ⇔ 引擎 `(SRCALPHA, INVSRCALPHA)`
 *  - `'subtract'` = `max(0, dst − src·sa)` ⇔ 引擎 `BLENDOP_REVSUBTRACT + (SRCALPHA, ONE)`（公式一致）
 *  - `'none'`   = 关混合（dst = src）≈ 引擎 `(ONE, ZERO)`；**唯一近似**：α<255 时 Pixi 写的是预乘色，
 *    引擎写的是未预乘的 `tex×diffuse`（要彻底对齐需要非预乘的着色路径，登记在 `tickets/T-0017`）。
 */
const PIXI_BLEND: Record<BlendState, string> = {
  normal: 'normal',
  add: 'add',
  // ★两个字面量名是**自定义档**（`pixiBackend.ts` 的 `installD3DBlendModes` 注册到 `blendModesMap`）：
  //   Pixi 内建的 `'none'` 是 `[0, 0]` = **画黑**，不是引擎的 `(ONE, ZERO)`「覆盖」。
  none: 'd3d-opaque',
  subtract: 'd3d-rev-subtract',
};

/** 合成诊断摘要的节流间隔（ms）。 */
const SUMMARY_MS = 500;

/**
 * 出画需要的 **L2D 纹理库窄缝**（`L2dTextureStore` 满足它）。
 *
 * 只声明"读得到什么"，不声明"谁提供" —— 这样 presenter 不必依赖文件读取/IPC
 * （测试可以塞一个假库，headless 直接传 `null`）。
 */
export interface L2dTextureLookup {
  get(fileId: number): Texture | undefined;
  /** 已就绪的纹理数（诊断）。 */
  readonly loadedCount: number;
}

export class ScenePresenter {
  #lastSummary = -1;
  /** 已经记过"L2D 批次缺纹理"日志的批次签名（避免每帧刷屏）。 */
  #l2dNoTexWarned = new Set<string>();
  /**
   * 已经记过"某项回落到占位块"的签名（`handle/imgid`；`tickets/T-0102` 的 H4）。
   *
   * 为什么要有它：`!tex` 会**每帧**成立（载入窗口 + 缓存被丢弃那两类）⇒ 不按项签名去重就会把
   * `status.trace` 刷满；而这两类正是"白底"症状的形状，**恰恰不能静默**（修前只在
   * `imgid === undefined` 时记，于是"imgid 已知但纹理没就位"完全无痕，E4 日志里归因不到项）。
   */
  #missingTexLogged = new Set<string>();

  /**
   * **记一次「某项回落到占位块」的签名**；返回 true = 这是第一次见到它（调用方据此打日志）。
   *
   * ★为什么不直接 `if (!set.has(k)) set.add(k)`（`tickets/T-0102` 2026-09-22 订正）：
   * 上游曾用 `if (set.size > 64) set.clear()` 来"防刷屏"，那会**把已经记过的键一起抹掉**
   * ⇒ **只发生一次的占位块**（正是"白底那一帧"的形状）可能在清理之后不再复现、于是**一条日志都不留**
   * —— 这就是 §5.2 那次复现里"两类日志各 0 条、却确实有白底"的原因。
   * 现在改为 **一次性键 + 只停止新增**：满了以后不再记新键（不会刷屏），但**已记的永不遗忘**。
   */
  #noteMissing(key: string): boolean {
    if (this.#missingTexLogged.has(key)) return false;
    if (this.#missingTexLogged.size >= 64) return false; // 满了：不再新增，但也不清空（证据优先）
    this.#missingTexLogged.add(key);
    return true;
  }
  /**
   * **合成间隔的滚动窗口**（诊断"卡顿"用）。
   *
   * 为什么要有它：动画的时间基准是**墙钟**（`Engine.nowMs`）⇒ 动作速度永远是对的；用户看到的
   * "卡顿"只可能是**帧间隔不匀**。只说"卡"无法定位，所以这里把 `帧间隔 avg/max` 与
   * "> 25ms 的帧占比"打进诊断行（25ms ≈ 丢一帧 @60Hz）。
   */
  #dt: number[] = [];
  #lastPresentMs = -1;
  /** 本帧 `present()` 自身的耗时（诊断；与"帧间隔"区分开：间隔大但这里小 ⇒ 卡在别处）。 */
  #slow = { dt: 0, presentMs: 0, batches: 0 };
  /**
   * L2D 批次的**可复用渲染对象**（键 = `节点 key:网格 id`）。
   *
   * 见 `drawL2d` 里的说明：TITLE 有 60 个网格，每帧新建 geometry 会造成周期性的 170-200ms 顿卡。
   */
  #l2dMeshes = new Map<
    string,
    { mesh: Mesh; geom: MeshGeometry; positions: Float32Array; uvs: Float32Array; indices: Uint32Array; tex: Texture }
  >();
  /** 本帧出现过的批次键（帧末回收没出现的）。 */
  #l2dLive = new Set<string>();

  constructor(
    private readonly drawRoot: Container<ContainerChild>,
    private readonly textures: TextureCache,
    /** 1×1 白纹理（占位块与 mesh 覆盖层共用）。 */
    private readonly unit: Texture,
    private readonly log: (msg: string) => void,
    /** 逻辑显示尺寸（引擎 `Scene+1100/+1104`；L2D 的画布居中平移要用它）。 */
    private readonly viewW: number = VIEW_W,
    private readonly viewH: number = VIEW_H,
    /**
     * **L2D 纹理库**（统一文件 id → Texture）。`null` = 宿主没接（纯 headless 用法）⇒
     * 批次几何照算（快照能断言），但**不画**（缺纹理时宁可空着也不糊占位块）。
     */
    private readonly l2dTex: L2dTextureLookup | null = null,
  ) {}

  /**
   * 返回本帧实际加入场景图的 draw-item 数（诊断）。
   *
   * `textSprites` = 消息窗文本的精灵（层序 = `20+win`，与引擎平面号一致）。
   * **文本与 draw-item 按同一个 layer 排序合并** —— 引擎里文本本来就是 DrawItem（D3D 路径）
   * 或直接 blit 到表面 0（DD 路径），所以"文本永远最上层"是错的。
   */
  present(
    scene: SceneState,
    clock: number,
    waitFlags: number,
    textSprites: { win: number; layer: number; sprite: Sprite }[] = [],
    /**
     * ★本帧 tick 交给宿主的**转场交付快照**（`scTransitionTick().render`；`tickets/T-0091` 的 D2/D3）。
     * 用途只有一个：让**排除集**（`scTransitionMarkedHandles`）也覆盖**到期帧**那几条 ——
     * 引擎在到期帧仍走转场遍（同样给区间项置 `|0x10000`），而 emulator 的记录在那一帧已被清掉，
     * 光查表会漏掉这一帧（表现 = 原图与终值合成结果同时可见，闪一帧）。
     */
    transitionRender: readonly TransitionRenderItem[] = [],
  ): number {
    this.drawRoot.removeChildren();
    this.#l2dLive.clear();
    const tPresent0 = performance.now();

    // 帧间隔采样（诊断；见 `#dt` 的说明）
    if (this.#lastPresentMs >= 0) {
      const d = clock - this.#lastPresentMs;
      if (d > 0) {
        this.#dt.push(d);
        if (this.#dt.length > 240) this.#dt.shift();
      }
    }
    this.#lastPresentMs = clock;

    // 0) 逐帧驱动：推进所有 draw-item 的 5 个动画窗（窗末 work ← target；全窗结束清动画位）。
    for (const it of scene.drawItems.values()) advanceWindows(it, clock);

    this.#logSummary(scene, clock, waitFlags);

    // 1) **三路归并**：draw-item / 消息窗文本 / mesh 按**同一个层序键**排序后依次合成。
    //
    // ★2026-09 修（用户实测：ADV 文字被半透明暗幕盖住）：旧实现把 mesh **一律画在最上层**，
    //   于是 SN0000 序章的 50% 暗幕（`0x19640` = 104000）盖住了 ADV 文字。
    //   引擎的合成是**按对象 id 归并**：`sub_4B06D0` 对「绘图项表 / mesh 表」三路归并、取小的
    //   sort-key 先画（`rendering.md` §3.1；LOGO 的 mesh 0x30d42/43 > 图 0x30d40/41 ⇒ 幕布在上）。
    //   SN0000 的键序：背景 101000 → **暗幕 104000** → 立绘 104501+ → **正文文本 105000**
    //   （win 8 的文本项 id = `SYSTEM4.txt:69 i213 8 19a28 1f4` = 0x19a28 = 105000，见 `layerOfFrame`）。
    //   键相同者按 item → text → mesh 排（引擎三路归并的等键次序；语料里等键极罕见）。
    let drawn = 0;
    const items = [...scene.drawItems.values()].sort((a, b) => a.layer - b.layer || a.handle - b.handle);
    const texts = [...textSprites].sort((a, b) => a.layer - b.layer || a.win - b.win);
    const meshes = [...scene.meshes.values()].sort((a, b) => a.handle - b.handle);
    // ★D3（`tickets/T-0091`）：**本帧被转场占用（画进 scratch 36/37）的项不进屏幕 pass** ——
    //   引擎给它们置 `|0x10000`，屏幕 pass 只画 `(flags & 0x10001) == 1` 的项
    //   （`sub_4B4040` 的四处判据 raw 136905/136915/136926/136936；`0x222` 路径 137210/137220/137252）
    //   ⇒ 转场期间玩家看到的是记录 `[4]` 那个槽的合成结果，**不是**原图与新图的叠加。
    const marked = scTransitionMarkedHandles(scene, transitionRender);
    // ★键口径：引擎的标记打在**表节点**上（`node+12` = 容器键 = 脚本给的 handle，raw 136853/136863/136873/136878）
    //   ⇒ 这里按 `handle` 比（语料里 `layer === handle`，见 `handlers/gfx-texture.ts` 的「层序 = map key = op1」）。
    const skipped = (key: number): boolean => marked.has(key);
    const drawItem = (it: Item, blendMode: BlendState): void => {
      if (skipped(it.handle)) return;
      const spr = this.itemSprite(scene, it, clock, blendMode);
      if (!spr) return;
      this.drawRoot.addChild(spr);
      drawn++;
    };
    // 画法本体已抽成类方法（`itemSprite`）—— 与「子集离屏合成」（`renderItemSubset`）共用一份，
    // 否则转场的 scratch 层与主合成会各画一套（`tickets/T-0084` 的路线 D 第一块）。

    // 2) meshes（顶点色四边形）：按 handle 升序，叠在图之上。
    //
    // ★这里画的是**引擎的真实几何与颜色**（2026-09 修）：
    //   - 几何 = `0x320 create-mesh` 的顶点（op2/op3/op4 的 x/y/z 浮点数组，屏幕像素）；
    //   - 颜色 = 逐顶点基础色 × CalcDiffuse 插值态色（`mulArgb` 逐通道 ×/255）；
    //   - `flags & 1` 是绘制门（`sub_4AF1C0` raw 133502）—— 只有 `0x322/0x323` 碰过、
    //     没有顶点缓冲的 mesh **不画**。
    //   旧实现把**每个** mesh 画成 `width=VIEW_W; tint=0x000000` 的全屏不透明黑，且忽略
    //   RGB（永远黑），于是 SN0000 序章被"50% 黑幕"涂成整屏黑（背景与首文案一起消失）。
    const drawMesh = (m: typeof meshes[number], blendMode: BlendState): void => {
      if ((m.flags & 1) === 0 || m.verts.length < 3) return; // 无几何 ⇒ 引擎不画
      // ★D3：mesh 表（`Scene+1064`）同样被打 `|0x10000`（raw 135772/135995/136301…）⇒ 也要排除
      if (skipped(m.handle)) return;
      const state = calcDiffuse(m, clock);
      const color = meshColor(m, state);
      const alpha = (color >>> 24) & 0xff;
      if (alpha <= 0) return;
      const g = new Graphics();
      const box = meshBBox(m);
      if (isAxisAlignedQuad(m)) {
        // ★语料里所有 `0x320` 站点都是轴对齐的满屏四边形（x=(0,1280,0,1280)、y=(0,0,720,720)）。
        //   这条路径必须走 `rect()`：Pixi v8 的 `poly()` 把点按**给定顺序**连成一圈，
        //   条带序 (v0,v1,v2,v3) 连起来是自交的"蝴蝶结"（填充只剩上下两片）⇒ 画面上会出现
        //   一条贯穿全屏的大 X（实测：2026-09 用 `poly` 画满屏幕布时）。
        g.rect(box.x, box.y, box.w, box.h).fill({ color: color & 0xffffff, alpha: alpha / 255 });
      } else {
        // 非轴对齐（语料里没有）：按条带三角扇逐片填，逐顶点色取三角形均值近似。
        for (let i = 1; i + 1 < m.verts.length; i++) {
          const idx = [0, i, i + 1] as const;
          const pts: number[] = [];
          let a = 0;
          let r = 0;
          let gg = 0;
          let b = 0;
          for (const k of idx) {
            const v = m.verts[k]!;
            pts.push(v.x, v.y);
            const c = meshVertexColor(m, state, k);
            a += (c >>> 24) & 0xff;
            r += (c >>> 16) & 0xff;
            gg += (c >>> 8) & 0xff;
            b += c & 0xff;
          }
          const tri =
            (((Math.round(a / 3) & 0xff) << 24) |
              ((Math.round(r / 3) & 0xff) << 16) |
              ((Math.round(gg / 3) & 0xff) << 8) |
              (Math.round(b / 3) & 0xff)) >>>
            0;
          g.poly(pts).fill({ color: tri & 0xffffff, alpha: ((tri >>> 24) & 0xff) / 255 });
        }
      }
      g.blendMode = PIXI_BLEND[blendMode] as never; // 自定义档名（见上）
      // ★Scene 世界矩阵那一级（引擎 raw 133407 的 `work ← work · Scene+46600`，只作用于层 20..29）：
      //   mesh 的顶点是**屏幕像素坐标**，与绘制项走同一条式子
      //   `屏幕点 ← 屏幕点 × (sx,sy) + (tx,ty)`。用 `Graphics` 自身的变换实现（绕屏幕原点缩放 +
      //   平移），避免改动几何顶点（`0x322` 那条"顶点色"路径仍按原坐标求值）。
      const xf = sceneXform2D(scene, m.layer);
      if (xf) {
        g.scale.set(xf.sx, xf.sy);
        g.position.set(xf.tx, xf.ty);
      }
      this.drawRoot.addChild(g);
    };

    // 三路归并（键 = item.layer / text.layer / mesh.handle；等键按 item→text→mesh）
    // ★`kind`/`blend` 是给混合状态机用的（`tickets/T-0017`）：必须与**绘制顺序**一致 —— 引擎的
    //   blend state 是全局的、会泄漏（见 `scene/blend.ts` 头部第 2 条）。
    //
    // ★2026-09（`tickets/T-0054`）加**第四路：Live2D 节点**。引擎的归并是三张有序表
    //   （图元表 `Scene+1080` / mesh 表 `Scene+1048` / 立绘节点表 `Scene+1096`）取最小键先画
    //   （raw 135560-135614）；立绘节点的**归并键就是 `0x344` 的 op1**（那里同时也是
    //   `sub_4AAEC0` 的查表键，raw 135610 的 `a5`）。TITLE 的静态立绘是 `draw-texture 14 5`
    //   （键 = op1 = 0x14），L2D 支是 `i344 14 0` ⇒ **两条支路占同一个归并槽**（`src/TITLE.txt`）。
    //   等键次序：引擎里节点输给 item 与 mesh（raw 135586-135614 的三个分支）⇒ 这里 order=3。
    const l2dBatchList = scene.l2dHost ? l2dBatches(scene.l2dHost, this.viewW, this.viewH) : [];
    const drawL2d = (b: L2dMeshBatch, blendMode: BlendState): void => {
      if (b.vertexCount < 3 || b.triangleCount < 1) return;
      // ★D3：立绘节点也在转场的排除集里（引擎 1096 表同样被打 `|0x10000`，raw 135798/135988/136003）
      if (skipped(b.key)) return;
      const tex = b.textureFileId === null ? undefined : this.l2dTex?.get(b.textureFileId);
      if (!tex) {
        // ★缺纹理时**不画**（也不糊占位块）：引擎那条链在绑定时就失败了（`0x345` 取不到文件 ⇒
        //   纹理号无图），屏幕上就是"这一块没有"。糊一块白反而会把"没装载"伪装成"装载错了"。
        const sig = `0x${b.key.toString(16)}/${b.textureNo}`;
        if (!this.#l2dNoTexWarned.has(sig)) {
          this.#l2dNoTexWarned.add(sig);
          this.log(
            `[present] l2d 批次 key=0x${b.key.toString(16)} 纹理号=${b.textureNo} ` +
              (b.textureFileId === null ? '未绑定文件 id（0x345 没执行？）' : `文件 id 0x${b.textureFileId.toString(16)} 未就绪`) +
              ` ⇒ 本帧不画（几何 ${b.vertexCount} 顶点仍在快照里）`,
          );
        }
        return;
      }
      // ★几何直接来自 `live2d/render.ts`（与快照**同源**）：positions 已含画布居中平移、
      //   uvs 是 `.moc` 的 `+60` 原样（不翻转）、indices 是三角形列表。
      //
      // ★**复用 `Mesh`/`MeshGeometry`（按 `节点 key:网格 id` 缓存）**，不再每帧新建。
      //   为什么必须复用（实测）：TITLE 有 **60 个网格** ⇒ 每帧新建 60 个 geometry 会带来
      //   60 次 `gl.bufferData` + 60 个 VAO 创建，以及 Pixi 那边同样数量的 GPU 对象待回收
      //   ⇒ 帧间隔 avg 正常但**周期性出现 170-200ms 的顿卡**（用户报的"卡顿不均匀"）。
      //   复用后每帧只做 `TypedArray.set` + 重新赋值（`Buffer.data` setter 会 bump `_updateID`
      //   ⇒ 只上传数据、不重建缓冲）。
      //   `.moc` 里每个 DrawData 的 `pointCount`/`polygonCount`/UV 数都是**常量** ⇒ 尺寸不会变，
      //   正常路径永远命中缓存（尺寸不符时重建一次，属防御）。
      const cacheKey = `${b.key}:${b.id}`;
      let e = this.#l2dMeshes.get(cacheKey);
      if (e && (e.positions.length !== b.positions.length || e.indices.length !== b.indices.length)) {
        // 防御：尺寸变了 ⇒ 旧对象作废（`Mesh.destroy` 不销毁 geometry，要显式 destroy(true)）
        const old = e.geom;
        e.mesh.destroy({ texture: false, textureSource: false });
        old.destroy(true);
        this.#l2dMeshes.delete(cacheKey);
        e = undefined;
      }
      if (!e) {
        const positions = b.positions.slice();
        const uvs = b.uvs.slice();
        const indices = b.indices.slice();
        const geom = new MeshGeometry({ positions, uvs, indices, topology: 'triangle-list', shrinkBuffersToFit: false });
        const mesh = new Mesh({ geometry: geom, texture: tex });
        e = { mesh, geom, positions, uvs, indices, tex };
        this.#l2dMeshes.set(cacheKey, e);
      } else {
        e.positions.set(b.positions);
        e.uvs.set(b.uvs);
        e.indices.set(b.indices);
        // 重新赋值同一个数组 ⇒ 走 `Buffer.data` setter（bump `_updateID`）⇒ 本帧上传新数据
        e.geom.positions = e.positions;
        e.geom.uvs = e.uvs;
        e.geom.indices = e.indices;
        if (e.tex !== tex) {
          e.mesh.texture = tex;
          e.tex = tex;
        }
      }
      // 该网格的 alpha（= 引擎写进它每个顶点的那个 opacity；见 `live2d/render.ts` 的批次粒度说明）
      e.mesh.alpha = b.opacity;
      e.mesh.blendMode = PIXI_BLEND[blendMode] as never;
      this.drawRoot.addChild(e.mesh);
      this.#l2dLive.add(cacheKey);
    };

    // 四路归并（键 = item.layer / text.layer / mesh.handle / l2d 节点 key）
    const entries: {
      key: number;
      order: 0 | 1 | 2 | 3;
      kind: 'item' | 'mesh';
      blend: number;
      draw: (mode: BlendState) => void;
    }[] = [
      ...items.map((it) => ({ key: it.layer, order: 0 as const, kind: 'item' as const, blend: it.blend, draw: (m: BlendState) => drawItem(it, m) })),
      // 文本在引擎里就是一个 DrawItem（`+0x30` 不会被 `0x203` 写 ⇒ 恒 0 ⇒ "不改状态"）：
      //   `src/SYSTEM4.txt:69 i213 8 19a28 1f4` 建的文本项 id = 0x19a28 = 105000。
      ...texts.map((t) => ({ key: t.layer, order: 1 as const, kind: 'item' as const, blend: 0, draw: (m: BlendState) => {
        t.sprite.blendMode = PIXI_BLEND[m] as never;
        // ★消息窗文本正是**层号 20..29**（`textLayer.ts` 的 `20 + win` / `win + 104`）⇒ 它就是
        //   Scene 世界矩阵的主要作用对象（引擎里文本本来就是 DrawItem，同样过 raw 133405 那道判据）。
        //   ★**不能就地改 sprite.position/scale**：文本精灵是跨帧复用的（`TextLayer.#wins` 缓存），
        //   就地改会让变换逐帧累乘。这里用一个临时 `Container` 承载那一级（sprite 的自身变换不动）。
        const xf = sceneXform2D(scene, t.layer);
        if (!xf) {
          this.drawRoot.addChild(t.sprite);
          return;
        }
        const wrap = new Container();
        wrap.scale.set(xf.sx, xf.sy);
        wrap.position.set(xf.tx, xf.ty);
        wrap.addChild(t.sprite);
        this.drawRoot.addChild(wrap);
      } })),
      ...meshes.map((m) => ({ key: m.handle, order: 2 as const, kind: 'mesh' as const, blend: m.blend, draw: (mode: BlendState) => drawMesh(m, mode) })),
      // L2D 节点：引擎里它是**独立一张表**（不参与图元的 blend 状态机 —— `sub_4783D0` 自己设
      // D3D 状态，raw 92607-92613 收尾时也不把 blend 留在可复用的档上）⇒ `blend: 0`
      // 表示"沿用当前状态"，不推进状态机（与文本项同一处置）。
      ...l2dBatchList.map((b) => ({ key: b.key, order: 3 as const, kind: 'mesh' as const, blend: 0, draw: (mode: BlendState) => drawL2d(b, mode) })),
    ];
    entries.sort((a, b) => a.key - b.key || a.order - b.order);
    const env: BlendEnv = {
      renderTargetSlot: scene.render4.renderTargetSlot,
      slotMode: (slot) => scene.render4.slotModes.get(slot),
    };
    const modes = walkBlendSequence(
      entries.map((e) => ({ kind: e.kind, blend: e.blend })),
      env,
      scene.render4.sceneBlend,
    );
    for (let i = 0; i < entries.length; i++) entries[i]!.draw(modes[i]!);

    // ★回收本帧没出现的 L2D 缓存（节点被撤/网格隐藏）。`Mesh.destroy` **不**销毁 geometry
    //   ⇒ 显式 `destroy(true)` 释放顶点/索引缓冲（否则只能等 Pixi 的 GCManagedHash 慢慢回收）。
    if (this.#l2dMeshes.size > this.#l2dLive.size) {
      for (const [k, e] of this.#l2dMeshes) {
        if (this.#l2dLive.has(k)) continue;
        const g = e.geom;
        e.mesh.destroy({ texture: false, textureSource: false });
        g.destroy(true);
        this.#l2dMeshes.delete(k);
      }
    }

    // 诊断：记下窗口里最慢那一帧的"间隔 / 合成耗时 / 批次数"
    const presentMs = performance.now() - tPresent0;
    const lastDt = this.#dt.length > 0 ? this.#dt[this.#dt.length - 1]! : 0;
    if (lastDt > this.#slow.dt) this.#slow = { dt: lastDt, presentMs, batches: l2dBatchList.length };
    return drawn;
  }

  /**
   * **画一个绘制项 → Sprite**（`present` 与「子集离屏合成」共用**唯一一份**）。
   *
   * 为什么必须共用：转场的 scratch 层（引擎 36/37）装的**就是**记录那两条 item 区间里的项
   * （raw 136014-136176 的两趟重绘）—— 若子集渲染另写一套画法，"主画面"与"转场用的那一层"
   * 迟早会漂移（本工程已有多次同类事故）。`null` = 该项不该画（`flags & 1` 门 / 全透明）。
   */
  itemSprite(scene: SceneState, it: Item, clock: number, blendMode: BlendState): Sprite | null {
      // ★bit0 门：引擎渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（raw 133361）。
      //   任何"缺失即建项"的 setter（sub_4AAA50）建出的空项 flags=0 ⇒ **不画**。
      //   早前漏了这个门，空项会被当成正常项画出来（用 alpha 0 的色掩盖了症状）。
      if ((it.flags & 1) === 0) return null;
      const color = itemColor(it, clock);
      const alpha = (color >> 24) & 0xff;
      if (alpha <= 0) return null; // 全透明跳过

      // ★纹理解析：**槽号 = DrawItem`+4`**（`draw-texture` 的 op2）。`it.layer`/`it.handle` 是层序键。
      const { tex, imgid } = this.textures.resolve(it);
      // ★★**消息窗正文行的区间里、没有纹理槽的项 = 文本行本身，交给文本层画**（`tickets/T-0102`）：
      //   引擎里"屏幕上的字就是 Scene 的 DrawItem"（正文行 id = 行号 + `win+104`，`0x213` 登记
      //   `[105000,105500)`），而 emulator 的文本另有载体（`textLayer` + `msgWins`）⇒ 这批 id 上的
      //   DrawItem 若当图元画，就是 `#placeholder` 的**纯白矩形** —— 用户实测"ADV 窗口背景是白色"
      //   在 E4 日志里的形状（`item h=0x19a28 layer=105000 未绑定纹理槽`，当时那一支会画占位块 ×28）。
      if (imgid === undefined && inMsgTextRange(scene.msgRanges.values(), it.handle)) {
        const key = `text-line h${it.handle.toString(16)}`;
        if (this.#noteMissing(key)) {
          this.log(
            `[present] item h=0x${it.handle.toString(16)} layer=${it.layer} 在消息窗正文区间内且无纹理槽` +
              ` → **跳过**（文本由文本层画，见 T-0102）`,
          );
        }
        return null;
      }
      const rect = itemSrcRect(it, clock); // flipbook 窗（窗4）会改源矩形
      // ★★★**没有纹理 ⇒ 整项不画**（`tickets/T-0102` 轮 20：按引擎语义订正，**不再是白占位块**）。
      //
      // 引擎证据（`engine/天结_unpacked.exe_utf8.c`）：
      //  · **入队侧不校验**：`0x1FB draw-texture` 的 handler `sub_422E70`（raw 31271-31300）只读操作数
      //    再 `sub_4ACE50(...)` 建绘制项 —— 槽有没有纹理它不管。
      //  · **出画侧才校验**：渲染器 `sub_4A2D50`（raw 122890 起）取 `CTexture* = Scene[slot]`，
      //    为 0 时 `sprintf_s("関数：DrawTexture エラー：描画元テクスチャが作成されていません． TEXTURE=%d")`
      //    + `sub_4034D0` + **`return 0`**（raw 122952-122963）⇒ **这一笔什么都不画，也没有任何替代纹理**。
      //  · 那不是致命错：`sub_4034D0`→`sub_4976A0`（加脚本行号）→`sub_497620`→`sub_438CC0`
      //    = `WriteFile` 到 `Error.log`（`aErrorLog = "Error.log"`，`CreateFileA(..., OPEN_ALWAYS)`）。
      //    不抛、不弹窗、不退出。同型"未创建纹理 ⇒ 报一行 + 跳过"的串在全引擎有 25+ 处
      //    （BlendTexture/CopyTexture/StretchTexture/FillTexture/BlurTexture/MosaicTexture/
      //    MonoToneTexture/MirrorTexture/CaptureTexture/SetClipRectTexture/Set3DEffectSnow/…），
      //    `draw-string` 同样是"三个门，缺纹理整条不做"（raw 68478-68480）。
      //  ⇒ 引擎**没有"替代纹理/占位块"这个概念**。此前 emulator 用 1×1 白占位块顶上，
      //    是"引擎什么都不画"的场合**多画了一块白的** —— 这正是 `T-0102` 那一类"白底"的来源。
      //
      // ★两种"没有"要分清（都按引擎语义**跳过**，但日志要能区分，否则缺口又变静默）：
      //  ① `imgid === undefined`：该槽**从未绑过图**（引擎：CTexture* = 0 ⇒ 跳过）；
      //  ② 绑过但宿主还没就位：**引擎里不存在这个态**（`set-texture` `sub_422CB0` 当场读 AGF + 解码，
      //     是同步的）⇒ 这是 emulator 异步载入的自己人问题，正解是**在屏障处等**（T-0102 的
      //     H2/H3/H4 + `BARRIER_*`），**不是**画白块掩盖。
      if (!tex) {
        const key = `h${it.handle.toString(16)}/i${imgid === undefined ? 'none' : imgid.toString(16)}`;
        if (this.#noteMissing(key)) {
          this.log(
            (imgid === undefined
              ? `[present] item h=0x${it.handle.toString(16)} layer=${it.layer} 槽 ${it.tex ?? 0} 未绑定`
              : `[present] item h=0x${it.handle.toString(16)} layer=${it.layer} 槽 ${it.tex ?? 0} 绑定了 imgid=0x${imgid.toString(16)} 但宿主纹理未就位`) +
              ' ⇒ **按引擎语义跳过该项**（引擎 DrawTexture 报错 + return 0，raw 122952-122963；无替代纹理）',
          );
        }
        return null;
      }
      const spr = cropSprite(tex, rect);
      // 位置：DrawItem`+36/+40/+44`（由 `0x219` 写；未写时 = draw-texture 的 op7/8）。
      //
      // ★**世界矩阵门**（引擎 `sub_4A2D50` raw 123055）：`if (Scene+46532) 乘上该项的世界矩阵`，
      //   而 `Scene+46532 ← DrawItem+0x68`（raw 133391）。`+0x68` 只由变换类指令置位
      //   （`0x1FD`/`0x1FF`/`0x21E`/`0x21F`/`0x220`；`0x201` 颜色的 `0x202` 不置）。
      //   ⇒ 未置位的项走**纯 2D 路径**：只有描画位置 + 源矩形尺寸，pivot/缩放/旋转/平移**一律不参与**。
      //   漏掉这个门就会把"从没设过 pivot"的项按 pivot=(0,0) 反算成 `-pos`，把项推出画面
      //   （CONFIG1 滚动条的上/下盖正好是这种项）。
      //
      // ★**bit2 强制有效**（2026-09，B3）：引擎在 B 层命中时 raw 133395 把 `Scene+46532` 强制置 1
      //   （`sub_49BCC0` 算出的矩阵必须参与合成）⇒ 判据是 `itemUsesWorld(it)` 而不是裸 `it.useWorld`。
      if (itemUsesWorld(it)) {
        // 世界矩阵（`0x1FD`/`0x1FF`/`0x21E`/`0x21F`/`0x220` 置位）：引擎 `sub_49AA30` 行向量序
        // `T(-pivot)·S·R·Tt·T(+pivot)` 作用在"已建在描画位置上"的四边形 ⇒
        // `v' = S·R·(v − pivot) + t + pivot`，其中 `pivot` 由 `0x217` **原样**写入（绝对值）。
        // Pixi 的 `screen(l) = position + S·R·(l − sprite.pivot)` 要与它逐项相等，必须
        // **同时**取 `position = pivot + t`、`sprite.pivot = pivot − pos`（见 `itemRenderPlacement`）。
        // ★历史上这里位置用的是 `pos`：只有 `pivot == pos` 时才等价 ⇒ 一旦脚本给出偏离 pos 的
        //   绝对 pivot（`CONFIG1` 滚动条中段的 `707ffa + 32e`），缩放项就整体平移 `(pivot − pos)`。
        const pl = applySceneXformToPlacement(scene, it.layer, itemRenderPlacement(it, clock));
        spr.pivot.set(pl.pivot.x, pl.pivot.y);
        spr.scale.set(pl.scale.x, pl.scale.y);
        spr.rotation = pl.rotRad;
        spr.position.set(pl.position.x, pl.position.y);
      } else {
        // ★无世界矩阵的项也**照样**吃 Scene 那一级（引擎 raw 133407 的乘法在 `Scene+46532` 门**之外**：
        //   那一门只管项自己的 work 矩阵，Scene 世界矩阵是另一个矩阵）。引擎里"没设过变换"的项
        //   work = 单位阵·sceneWorld = sceneWorld，屏幕上就是"描画位置被 Scene 平移推走"。
        const pl = applySceneXformToPlacement(scene, it.layer, {
          position: { x: it.posX, y: it.posY },
          scale: { x: 1, y: 1 },
        });
        spr.position.set(pl.position.x, pl.position.y);
        if (pl.scale.x !== 1 || pl.scale.y !== 1) spr.scale.set(pl.scale.x, pl.scale.y);
      }
      spr.tint = color & 0xffffff; // diffuse RGB 调制纹理（逐像素 RGB×α）
      spr.alpha = alpha / 255; // diffuse alpha 淡入
      // ★混合档（`tickets/T-0017`）：逐项复刻引擎的 blend 状态机（含"值 2 的门控"与"mesh 之后留 (ONE,ZERO)"）
      spr.blendMode = PIXI_BLEND[blendMode] as never; // 自定义档名（见上）
      return spr;
  }

  /**
   * ★**子集离屏合成**（`tickets/T-0084` 的路线 D 第一块）：把**指定的那组绘制项**画进给定容器。
   *
   * 引擎依据：`sub_4B06D0` 在转场前跑两趟 ——
   * `for (v60 = 0; v60 < 2; ++v60) { SetTarget(36+v60); Clear; BeginScene; 把该趟的 item 画进去; EndScene; }`
   * （raw 136014-136176；asm 循环体 `0x4B1232`、回跳 `0x4B179B`）。第 0 趟画区间 A（记录 `[5]` 起）、
   * 第 1 趟画区间 B（记录 `[6]` 起），两趟都排除另一条区间（raw 135577/135591/135605），
   * 且**先 Clear 再画** ⇒ **转场的可见范围只覆盖这两组项**（其余是透明）。
   * 层序与混合与主合成同口径（`walkBlendSequence` + 项自己的 `blend`）。
   *
   * @returns 真的画出来的项数（0 = 该层空白 —— 引擎那层就是 `Clear` 后的透明）
   */
  renderItemSubset(
    scene: SceneState,
    clock: number,
    handles: ReadonlySet<number>,
    into: Container,
  ): number {
    const items = [...scene.drawItems.values()]
      .filter((it) => handles.has(it.handle))
      .sort((a, b) => a.layer - b.layer || a.handle - b.handle);
    const env: BlendEnv = {
      renderTargetSlot: scene.render4.renderTargetSlot,
      slotMode: (slot) => scene.render4.slotModes.get(slot),
    };
    const modes = walkBlendSequence(
      items.map((it) => ({ kind: 'item' as const, blend: it.blend })),
      env,
      scene.render4.sceneBlend,
    );
    let drawn = 0;
    for (let i = 0; i < items.length; i++) {
      const spr = this.itemSprite(scene, items[i]!, clock, modes[i]!);
      if (!spr) continue;
      into.addChild(spr);
      drawn++;
    }
    return drawn;
  }

  // ★**`#placeholder`（缺纹理画 1×1 白块）已于 `tickets/T-0102` 轮 20 删除**：
  //   引擎对没有纹理的槽是"报一行 + 什么都不画"（`DrawTexture` raw 122952-122963 + 25+ 处同型），
  //   **没有替代纹理这个概念** ⇒ 占位块是"多画一块白的"，正是"白底"那一类症状的来源。
  //   缺纹理的情形现在在 `itemSprite` 里**跳过**并留一条日志（见那里的长注释）。

  /** 节流诊断：每 ~500ms 记一次 scene 合成状态（看动画推进 + 是否有 item/mesh/纹理）。 */
  #logSummary(scene: SceneState, clock: number, waitFlags: number): void {
    if (clock - this.#lastSummary < SUMMARY_MS) return;
    this.#lastSummary = clock;
    const itemInfo = [...scene.drawItems.values()]
      .map((it) => `${it.layer}:a${(itemColor(it, clock) >>> 24) & 0xff}`)
      .join(' ');
    const meshInfo = [...scene.meshes.values()]
      .map((m) => {
        const c = meshColor(m, calcDiffuse(m, clock));
        const rect = m.verts.length >= 4 ? `${m.verts[0]!.x},${m.verts[0]!.y}..${m.verts[3]!.x},${m.verts[3]!.y}` : '无几何';
        return `0x${m.handle.toString(16)}:${(c >>> 24) & 0xff}/#${(c & 0xffffff).toString(16).padStart(6, '0')}(${rect})`;
      })
      .join(' ');
    this.log(
      `[present ${Math.round(clock)}ms] items={${itemInfo || '无'}} meshes={${meshInfo || '无'}} slotTex=${
        this.textures.slotCount
      }${this.#l2dSummary(scene)}${this.#framePacing()} wait=0x${waitFlags.toString(16)}`,
    );
  }

  /**
   * 帧间隔摘要（诊断"卡顿"）：`avg` / `max` / `>25ms 的占比`。
   *
   * 判读：@60Hz 时 `avg ≈ 16.7`。若 `max` 远大于 `avg`（且占比 > 0）⇒ **不均匀卡顿**
   * （某一帧干了太多活）；若 `avg` 整体偏高（如 30ms）⇒ 每帧都超预算（稳定地慢，不是"卡"）。
   */
  #framePacing(): string {
    const n = this.#dt.length;
    if (n < 8) return '';
    let sum = 0;
    let max = 0;
    let jank = 0;
    for (const d of this.#dt) {
      sum += d;
      if (d > max) max = d;
      if (d > 25) jank++;
    }
    const avg = sum / n;
    // ★"最慢帧"的分解是定位卡顿的关键：`间隔` 大而 `合成` 小 ⇒ 卡在 present 之外
    //   （VM/其它宿主动作/GPU 驱动），不是合成代码的问题。
    const slow = this.#slow.dt > 0 ? ` 最慢帧 间隔=${this.#slow.dt.toFixed(0)}ms 合成=${this.#slow.presentMs.toFixed(1)}ms 批=${this.#slow.batches}` : '';
    const s = ` 帧间隔 avg=${avg.toFixed(1)}ms max=${max.toFixed(0)}ms 丢帧=${((jank / n) * 100).toFixed(0)}%(n=${n})${slow}`;
    this.#slow = { dt: 0, presentMs: 0, batches: 0 };
    return s;
  }

  /**
   * 诊断摘录：L2D 的槽/节点概况（**不**求值几何 —— 那由 `live2dBatches` 在合成时做）。
   *
   * 只报"有几个活槽、几个节点、几个可画"，因为这三者正好对应三种**症状相同**的故障：
   * 没建节点 / 建了节点但槽是空的 / 有模型但没出画（引擎门控 raw 134320 不报错）。
   */
  #l2dSummary(scene: SceneState): string {
    const host = scene.l2dHost;
    if (!host) return ' l2d=未接';
    const slots = [...host.l2dSlots.values()].filter((i) => !!i.model).length;
    const nodes = [...host.l2dNodes.values()];
    const drawable = nodes.filter((n) => (n.flags & 1) !== 0 && !!host.l2dSlots.get(n.slot)?.model).length;
    if (slots === 0 && nodes.length === 0) return ' l2d=无';
    // ★`缓存` 必须**稳定**（TITLE = 60）：它 = 复用的 Mesh/geometry 数。若它随帧数增长，
    //   就是又回到了"每帧新建 geometry"那条路 —— Pixi 的 GPU 资源 GC 要 60s 才回收（见
    //   `#l2dMeshes` 的说明），几千个/秒的堆积会造成周期性长顿卡。
    return ` l2d={槽${slots} 节点${nodes.length} 可画${drawable} 纹理${this.l2dTex?.loadedCount ?? '-'} 缓存${this.#l2dMeshes.size}}`;
  }
}

/**
 * **Scene 世界矩阵在「层号 ∈ [20,30)」那一支的 2D 形式**（引擎 raw 133411-133438 的 `else` 支：
 * `D3DXMatrixDecompose` 后**只把 2D 缩放与平移装回**；旋转那一项被显式置成**单位阵**
 * `v120`（raw 117629-117631 + 117647-117662），而这个单位阵**仍会**被乘进最终合成
 * （`sub_49AA30` 的 LABEL_72，raw 117930）⇒ 净效果就是纯 2D 缩放 + 平移）。
 *
 * 返回 `null` = 这一层不吃 Scene 变换（层号不在区间内）或四条指令一条都没下发过。
 * 注意调用方**不能就地改跨帧复用的对象**（见文本精灵那处的说明）。
 */
function sceneXform2D(
  scene: SceneState,
  layer: number,
): { sx: number; sy: number; tx: number; ty: number } | null {
  if (!sceneLayerAffected(layer)) return null;
  const x = scene.sceneXform;
  if (!x) return null;
  switch (x.kind) {
    case 'scale':
      return { sx: x.scale.x, sy: x.scale.y, tx: 0, ty: 0 };
    case 'translate':
      return { sx: 1, sy: 1, tx: x.translate.x, ty: x.translate.y };
    case 'axis-scale':
      return { sx: x.axisScale.x, sy: x.axisScale.y, tx: x.axisTranslate.x, ty: x.axisTranslate.y };
  }
}

function cropSprite(tex: Texture, rect: { x: number; y: number; w: number; h: number }): Sprite {  const frame = new Rectangle(rect.x, rect.y, rect.w, rect.h);
  const cropped = new Texture({ source: tex.source, frame });
  return new Sprite(cropped);
}

/** mesh 顶点几何的外接矩形（屏幕像素）。 */
function meshBBox(m: { verts: { x: number; y: number }[] }): { x: number; y: number; w: number; h: number } {
  const xs = m.verts.map((v) => v.x);
  const ys = m.verts.map((v) => v.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** 顶点是否恰好是外接矩形的四个角（⇒ 可以用 `rect()` 精确填充，避开 `poly()` 的自交顺序陷阱）。 */
function isAxisAlignedQuad(m: { verts: { x: number; y: number }[] }): boolean {
  if (m.verts.length !== 4) return false;
  const { x, y, w, h } = meshBBox(m);
  return m.verts.every(
    (v) => (v.x === x || v.x === x + w) && (v.y === y || v.y === y + h) && w > 0 && h > 0,
  );
}

