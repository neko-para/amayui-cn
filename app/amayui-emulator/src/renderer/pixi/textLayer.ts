/**
 * **消息窗图层**：把每个消息窗的排版结果光栅化成一张 Pixi 纹理，并按引擎的层序交给合成器。
 *
 * 引擎的对应物（见 `docs-new/03-engine/adv-text-rendering.md` §3）：
 *  - 每窗一张离屏表面（DD 路径 `surfaces[20+win]` / D3D 路径 `Scene` 的纹理）；
 *  - 文本**合成进场景**：D3D 路径逐行登记 DrawItem（key = `20+win`），DD 路径逐行 blit 到表面 0；
 *  - 所以重写侧的层序也用 **`20 + win`**（与引擎平面号一致），而不是"永远最上层"。
 *
 * 纹理只在**内容版本号变化**时重建（`SceneState.msgRev`），字体就绪后强制重建一次。
 */
import { CanvasSource, Sprite, Texture } from 'pixi.js';
import type { SceneState } from '../sceneModel.js';
import type { TextFrame } from '../../text/layout.js';
import { rasterFrame } from '../text/raster.js';
import { ensureFont, fontVersion } from '../text/fontLoader.js';

interface WinSprite {
  sprite: Sprite;
  texture: Texture;
  /** 上一次光栅化时的内容版本号。 */
  rev: number;
  /** 上一次光栅化时的显现游标。 */
  revealed: number;
  /** 上一次光栅化时的设备像素比（DPR 变化要重画，否则纹理会按旧比例显示）。 */
  res: number;
}

/**
 * 层序回退基址：脚本没调过 `0x213` 时用引擎的平面号 `20 + win`（`win+20` 作 DrawItem 的平面）。
 * ★正常情况下应当用 `style.itemId`（= `win+104`，`0x213` 写）——`20+win` 会落在普通图元之下。
 */
export const TEXT_LAYER_BASE = 20;

/** 本窗文本在场景里的层序：优先 `win+104`（`0x213`），未设过才回退到平面号。 */
export function layerOfFrame(win: number, frame: TextFrame): number {
  return frame.style.itemId > 0 ? frame.style.itemId : TEXT_LAYER_BASE + win;
}

export class TextLayer {
  readonly #wins = new Map<number, WinSprite>();
  /** 上一次同步时的字体版本 ⇒ 新字族注册完成那一刻整体重画一次。 */
  #fontVersionAtLastSync = -1;
  /** 已光栅化次数（诊断/测试）。 */
  rasters = 0;

  constructor(private readonly log: (msg: string) => void) {}

  /** 当前持有纹理的窗口数（诊断）。 */
  get winCount(): number {
    return this.#wins.size;
  }

  /**
   * 与模型同步：为新窗/内容变化的窗重建纹理，删掉模型里已消失的窗。
   * 返回本帧应加入场景图的精灵（按窗口索引升序）。
   *
   * 显现游标取自模型（`TextFrame.revealed`，由 VM 的 `message:MessageSpeed` 节拍推进）；
   * `revealOf` 可覆写（诊断/回放用）。
   */
  sync(
    scene: SceneState,
    revealOf: (win: number, frame: TextFrame) => number = (_w, f) => f.revealed,
  ): { win: number; layer: number; sprite: Sprite }[] {
    const fv = fontVersion();
    const fontChanged = fv !== this.#fontVersionAtLastSync;
    this.#fontVersionAtLastSync = fv;

    for (const win of [...this.#wins.keys()]) if (!scene.msgWins.has(win)) this.#dispose(win);

    const res = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const out: { win: number; layer: number; sprite: Sprite }[] = [];
    for (const [win, frame] of [...scene.msgWins].sort((a, b) => a[0] - b[0])) {
      // 空窗（无字形且无底色）不建纹理：引擎里这类窗也不会往表面上画任何东西
      if (frame.glyphCount === 0 && !frame.style.background) {
        if (this.#wins.has(win)) this.#dispose(win);
        continue;
      }
      const rev = scene.msgRev.get(win) ?? 0;
      const revealed = revealOf(win, frame);
      // 按需加载本窗用到的字族/字重（未加载完先用 fallback 画，加载完成后 fontVersion 变化会重画）
      void ensureFont(frame.style.main.family, frame.style.main.weight, this.log);
      void ensureFont(frame.style.ruby.family, frame.style.ruby.weight, this.log);
      const old = this.#wins.get(win);
      const entry =
        !old || old.rev !== rev || old.revealed !== revealed || old.res !== res || fontChanged
          ? this.#raster(win, frame, rev, revealed, res, old)
          : old;
      out.push({ win, layer: layerOfFrame(win, frame), sprite: entry.sprite });
    }
    return out;
  }

  #raster(win: number, frame: TextFrame, rev: number, revealed: number, res: number, old?: WinSprite): WinSprite {
    const canvas = rasterFrame(frame, revealed, res);
    // 显式建 CanvasSource/Texture（不走 `Texture.from` 的全局缓存：那会按 canvas 缓存，
    // 与"每次新建 canvas + 销毁旧纹理"的生命周期冲突）。
    // ★`resolution: res` 是关键：canvas 的 width/height 是**物理像素**（w×res），
    //   不告诉 Pixi 就会按 1:1 逻辑像素显示 ⇒ 在 DPR=2 的屏上文字**放大一倍且位置看起来偏移**。
    //   （上一版就是漏了这个：启动首帧 DPR 还没稳定时更明显，之后重画才"看起来正常"。）
    const texture = new Texture({ source: new CanvasSource({ resource: canvas, resolution: res }) });
    if (old) {
      const prev = old.texture;
      old.sprite.texture = texture;
      old.texture = texture;
      old.rev = rev;
      old.revealed = revealed;
      old.res = res;
      prev.destroy(true);
      this.rasters++;
      return old;
    }
    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0); // 文本坐标是"相对窗口左上角" ⇒ 锚点归零
    sprite.position.set(frame.style.x, frame.style.y);
    const entry: WinSprite = { sprite, texture, rev, revealed, res };
    this.#wins.set(win, entry);
    this.rasters++;
    this.log(
      `[text] win=${win} layer=${layerOfFrame(win, frame)} ${frame.lines.length} 行 ${frame.glyphCount} 字 ` +
        `→ 纹理 ${canvas.width}×${canvas.height} @(${frame.style.x},${frame.style.y}) ` +
        `已显示=${revealed < 0 ? frame.glyphCount : revealed}`,
    );
    return entry;
  }

  #dispose(win: number): void {
    const e = this.#wins.get(win);
    if (!e) return;
    e.sprite.removeFromParent();
    e.texture.destroy(true);
    this.#wins.delete(win);
  }

  /** 全部释放（`exit-script` 清场用）。 */
  disposeAll(): void {
    for (const win of [...this.#wins.keys()]) this.#dispose(win);
  }
}
