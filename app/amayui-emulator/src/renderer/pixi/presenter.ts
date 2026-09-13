/**
 * **每帧合成**：把共享场景模型（`SceneState`）画成 Pixi 场景图。
 *
 * 分工：本模块只读模型、不写模型（除了 `advanceWindows` 的窗锁存——引擎语义要求绘制期推进）；
 * 任何"指令 → 模型"的改动都在 `scene/ops.ts`。因此"报告里的模型"与"画面上的模型"不可能漂移。
 *
 * 合成顺序（与引擎一致）：
 *  1. 逐帧推进所有 draw-item 的 5 个动画窗；
 *  2. draw-items 按 `layer` 升序、再 `handle` 升序；**`flags & 1` 是绘制门**（空项不画）；
 *  3. meshes（顶点色四边形）按 `handle` 升序叠在最上层 —— 几何/颜色都取自模型（见 `present` 内注释）。
 */
import { Container, Graphics, Rectangle, Sprite, Texture, type ContainerChild } from 'pixi.js';
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
import type { TextureCache } from './textureCache.js';

/** 合成诊断摘要的节流间隔（ms）。 */
const SUMMARY_MS = 500;

export class ScenePresenter {
  #lastSummary = -1;

  constructor(
    private readonly drawRoot: Container<ContainerChild>,
    private readonly textures: TextureCache,
    /** 1×1 白纹理（占位块与 mesh 覆盖层共用）。 */
    private readonly unit: Texture,
    private readonly log: (msg: string) => void,
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

    // 0) 逐帧驱动：推进所有 draw-item 的 5 个动画窗（窗末 work ← target；全窗结束清动画位）。
    for (const it of scene.drawItems.values()) advanceWindows(it, clock);

    this.#logSummary(scene, clock, waitFlags);

    // 1) draw-items（图像）+ 消息窗文本：按 layer 归并（同 layer 时 draw-item 在前）
    let drawn = 0;
    const items = [...scene.drawItems.values()].sort((a, b) => a.layer - b.layer || a.handle - b.handle);
    const texts = [...textSprites].sort((a, b) => a.layer - b.layer || a.win - b.win);
    let ti = 0;
    const flushText = (upto: number): void => {
      let t = texts[ti];
      while (t && t.layer <= upto) {
        this.drawRoot.addChild(t.sprite);
        ti++;
        t = texts[ti];
      }
    };
    for (const it of items) {
      flushText(it.layer - 1); // 先把 layer 更小的文本插进去
      // ★bit0 门：引擎渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（raw 133361）。
      //   任何"缺失即建项"的 setter（sub_4AAA50）建出的空项 flags=0 ⇒ **不画**。
      //   早前漏了这个门，空项会被当成正常项画出来（用 alpha 0 的色掩盖了症状）。
      if ((it.flags & 1) === 0) continue;
      const color = itemColor(it, clock);
      const alpha = (color >> 24) & 0xff;
      if (alpha <= 0) continue; // 全透明跳过

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
      this.drawRoot.addChild(spr);
      drawn++;
      // 同 layer 的文本放在该项之后（引擎里文本是后建的 map 项）
      const sameLayer = texts[ti];
      if (sameLayer && sameLayer.layer === it.layer) {
        this.drawRoot.addChild(sameLayer.sprite);
        ti++;
      }
    }
    flushText(Number.MAX_SAFE_INTEGER); // 剩余文本（含 20+win 落在没有 draw-item 的层）

    // 2) meshes（顶点色四边形）：按 handle 升序，叠在图之上。
    //
    // ★这里画的是**引擎的真实几何与颜色**（2026-09 修）：
    //   - 几何 = `0x320 create-mesh` 的顶点（op2/op3/op4 的 x/y/z 浮点数组，屏幕像素）；
    //   - 颜色 = 逐顶点基础色 × CalcDiffuse 插值态色（`mulArgb` 逐通道 ×/255）；
    //   - `flags & 1` 是绘制门（`sub_4AF1C0` raw 133502）—— 只有 `0x322/0x323` 碰过、
    //     没有顶点缓冲的 mesh **不画**。
    //   旧实现把**每个** mesh 画成 `width=VIEW_W; tint=0x000000` 的全屏不透明黑，且忽略
    //   RGB（永远黑），于是 SN0000 序章被"50% 黑幕"涂成整屏黑（背景与首文案一起消失）。
    const meshes = [...scene.meshes.values()].sort((a, b) => a.handle - b.handle);
    for (const m of meshes) {
      if ((m.flags & 1) === 0 || m.verts.length < 3) continue; // 无几何 ⇒ 引擎不画
      const state = calcDiffuse(m, clock);
      const color = meshColor(m, state);
      const alpha = (color >>> 24) & 0xff;
      if (alpha <= 0) continue;
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
      this.drawRoot.addChild(g);
    }
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
      } wait=0x${waitFlags.toString(16)}`,
    );
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
