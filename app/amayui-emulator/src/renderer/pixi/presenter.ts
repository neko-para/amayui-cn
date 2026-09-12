/**
 * **每帧合成**：把共享场景模型（`SceneState`）画成 Pixi 场景图。
 *
 * 分工：本模块只读模型、不写模型（除了 `advanceWindows` 的窗锁存——引擎语义要求绘制期推进）；
 * 任何"指令 → 模型"的改动都在 `scene/ops.ts`。因此"报告里的模型"与"画面上的模型"不可能漂移。
 *
 * 合成顺序（与引擎一致）：
 *  1. 逐帧推进所有 draw-item 的 5 个动画窗；
 *  2. draw-items 按 `layer` 升序、再 `handle` 升序；**`flags & 1` 是绘制门**（空项不画）；
 *  3. meshes（顶点色黑覆盖层）按 `handle` 升序叠在最上层。
 */
import { Container, Rectangle, Sprite, Texture, type ContainerChild } from 'pixi.js';
import {
  advanceWindows,
  calcDiffuse,
  itemColor,
  itemRenderPlacement,
  itemSrcRect,
  type Item,
} from '../drawItem.js';
import type { SceneState } from '../sceneModel.js';
import { VIEW_H, VIEW_W } from '../viewport.js';
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

    // 2) meshes（顶点色黑覆盖层）：按 handle 升序，叠在图之上。
    const meshes = [...scene.meshes.values()].sort((a, b) => a.handle - b.handle);
    for (const m of meshes) {
      const diffuse = calcDiffuse(m, clock);
      const a = (diffuse >> 24) & 0xff;
      if (a <= 0) continue;
      const ov = new Sprite(this.unit);
      ov.width = VIEW_W;
      ov.height = VIEW_H;
      ov.tint = 0x000000;
      ov.alpha = a / 255;
      this.drawRoot.addChild(ov);
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
      .map((m) => `${(m.handle & 0xf).toString(16)}:a${(calcDiffuse(m, clock) >> 24) & 0xff}`)
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
