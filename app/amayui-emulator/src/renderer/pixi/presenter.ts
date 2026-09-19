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
  meshColor,
  meshVertexColor,
  type Item,
} from '../drawItem.js';
import type { SceneState } from '../sceneModel.js';
import { walkBlendSequence, type BlendEnv, type BlendState } from '../scene/blend.js';
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
    const drawItem = (it: Item, blendMode: BlendState): void => {
      // ★bit0 门：引擎渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（raw 133361）。
      //   任何"缺失即建项"的 setter（sub_4AAA50）建出的空项 flags=0 ⇒ **不画**。
      //   早前漏了这个门，空项会被当成正常项画出来（用 alpha 0 的色掩盖了症状）。
      if ((it.flags & 1) === 0) return;
      const color = itemColor(it, clock);
      const alpha = (color >> 24) & 0xff;
      if (alpha <= 0) return; // 全透明跳过

      // ★纹理解析：**槽号 = DrawItem`+4`**（`draw-texture` 的 op2）。`it.layer`/`it.handle` 是层序键。
      const { tex, imgid } = this.textures.resolve(it);
      const rect = itemSrcRect(it, clock); // flipbook 窗（窗4）会改源矩形
      const spr = tex ? cropSprite(tex, rect) : this.#placeholder(it);
      if (!tex && imgid === undefined) {
        this.log(`[present] item h=0x${it.handle.toString(16)} layer=${it.layer} 未绑定纹理槽 → 占位块`);
      }
      // 位置：DrawItem`+36/+40/+44`（由 `0x219` 写；未写时 = draw-texture 的 op7/8）。
      //
      // ★**世界矩阵门**（引擎 `sub_4A2D50` raw 123055）：`if (Scene+46532) 乘上该项的世界矩阵`，
      //   而 `Scene+46532 ← DrawItem+0x68`（raw 133391）。`+0x68` 只由变换类指令置位
      //   （`0x1FD`/`0x1FF`/`0x21E`/`0x21F`/`0x220`；`0x201` 颜色的 `0x202` 不置）。
      //   ⇒ 未置位的项走**纯 2D 路径**：只有描画位置 + 源矩形尺寸，pivot/缩放/旋转/平移**一律不参与**。
      //   漏掉这个门就会把"从没设过 pivot"的项按 pivot=(0,0) 反算成 `-pos`，把项推出画面
      //   （CONFIG1 滚动条的上/下盖正好是这种项）。
      if (it.useWorld) {
        // 世界矩阵（`0x1FD`/`0x1FF`/`0x21E`/`0x21F`/`0x220` 置位）：引擎 `sub_49AA30` 行向量序
        // `T(-pivot)·S·R·Tt·T(+pivot)` 作用在"已建在描画位置上"的四边形 ⇒
        // `v' = S·R·(v − pivot) + t + pivot`，其中 `pivot` 由 `0x217` **原样**写入（绝对值）。
        // Pixi 的 `screen(l) = position + S·R·(l − sprite.pivot)` 要与它逐项相等，必须
        // **同时**取 `position = pivot + t`、`sprite.pivot = pivot − pos`（见 `itemRenderPlacement`）。
        // ★历史上这里位置用的是 `pos`：只有 `pivot == pos` 时才等价 ⇒ 一旦脚本给出偏离 pos 的
        //   绝对 pivot（`CONFIG1` 滚动条中段的 `707ffa + 32e`），缩放项就整体平移 `(pivot − pos)`。
        const pl = itemRenderPlacement(it, clock);
        spr.pivot.set(pl.pivot.x, pl.pivot.y);
        spr.scale.set(pl.scale.x, pl.scale.y);
        spr.rotation = pl.rotRad;
        spr.position.set(pl.position.x, pl.position.y);
      } else {
        spr.position.set(it.posX, it.posY);
      }
      spr.tint = color & 0xffffff; // diffuse RGB 调制纹理（逐像素 RGB×α）
      spr.alpha = alpha / 255; // diffuse alpha 淡入
      // ★混合档（`tickets/T-0017`）：逐项复刻引擎的 blend 状态机（含"值 2 的门控"与"mesh 之后留 (ONE,ZERO)"）
      spr.blendMode = PIXI_BLEND[blendMode] as never; // 自定义档名（见上）
      this.drawRoot.addChild(spr);
      drawn++;
    };

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
      ...texts.map((t) => ({ key: t.layer, order: 1 as const, kind: 'item' as const, blend: 0, draw: (m: BlendState) => { t.sprite.blendMode = PIXI_BLEND[m] as never; this.drawRoot.addChild(t.sprite); } })),
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

  /** 缺纹理时的占位块：尺寸取源矩形，颜色由 layer 派生（便于肉眼区分是哪个项）。 */
  #placeholder(it: Item): Sprite {
    const spr = new Sprite(this.unit);
    spr.width = it.srcW;
    spr.height = it.srcH;
    spr.tint = (((it.layer * 47) % 360) << 8) | 0x6a;
    return spr;
  }

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

function cropSprite(tex: Texture, rect: { x: number; y: number; w: number; h: number }): Sprite {
  const frame = new Rectangle(rect.x, rect.y, rect.w, rect.h);
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

