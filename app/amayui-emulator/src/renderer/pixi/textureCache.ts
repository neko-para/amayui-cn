/**
 * **纹理槽表 → Pixi 纹理** 的缓存与解析。
 *
 * 三层映射（引擎语义）：
 *  1. `slot → imgid`：**唯一**由 `set-texture`(0x1F9) 建立、`release-texture`(0x1FA) 清除
 *     —— 引擎里这是槽↔图像的唯一绑定；
 *  2. `imgid → Texture`：经 `window.api.image()` 取 AGF 解码结果并包成 Pixi 纹理（异步、可预载）；
 *  3. `slot → Texture`：第 1、2 步都就绪后的结果，绘制期直接查它。
 *
 * ★回归点（历史 bug）：绘制项里的槽号取自 `Item.tex`（= `draw-texture` 的 **op2**），
 * **绝不能**用 `item.layer`/`item.handle`（那是层序键）。见 `resolve()` 与 test/texture-slot-resolve.test.ts。
 */
import { Texture } from 'pixi.js';
import type { Item } from '../drawItem.js';

export class TextureCache {
  /** `slot → Texture`（已绑定且已载入）。 */
  readonly slotTex = new Map<number, Texture>();
  readonly #slotImgid = new Map<number, number>();
  readonly #imgCache = new Map<number, Texture>();
  readonly #pending = new Set<number>();

  constructor(private readonly log: (msg: string) => void) {}

  /** 已绑定纹理的槽数（诊断用）。 */
  get slotCount(): number {
    return this.slotTex.size;
  }

  /** `slot → imgid`（未绑定返回 undefined）。 */
  imgidOf(slot: number): number | undefined {
    return this.#slotImgid.get(slot);
  }

  /**
   * 按 imgid 预载图像（幂等：已在缓存或已在途则直接返回）。
   * 失败只记日志——引擎在取不到图时也只是画不出来，不改变控制流。
   */
  async preloadImage(imgid: number): Promise<void> {
    if (this.#imgCache.has(imgid) || this.#pending.has(imgid)) return;
    this.#pending.add(imgid);
    try {
      const r = await window.api.image(imgid);
      if (r) {
        const tex = await rgbaToTexture(r.width, r.height, r.data);
        this.#imgCache.set(imgid, tex);
        this.log(`image ${imgid.toString(16)} -> ${r.name} (${r.width}x${r.height})`);
      }
    } catch (err) {
      this.log(`image ${imgid.toString(16)} fail: ${(err as Error).message}`);
    } finally {
      this.#pending.delete(imgid);
    }
  }

  /** `0x1F9` set-texture：建立 `slot → imgid` 绑定；纹理未载入则异步补上 `slot → Texture`。 */
  bind(imgid: number, slot: number): void {
    this.#slotImgid.set(slot, imgid); // 记录绑定，供 create-texture 刷新缓存时重取
    this.log(`bindTexture imgid=0x${imgid.toString(16)} slot=${slot}`);
    const tex = this.#imgCache.get(imgid);
    if (tex) {
      this.slotTex.set(slot, tex);
      this.log(`  bind slot ${slot} <- imgid 0x${imgid.toString(16)}`);
      return;
    }
    void this.preloadImage(imgid).then(() => {
      const t2 = this.#imgCache.get(imgid);
      if (t2) this.slotTex.set(slot, t2);
    });
  }

  /**
   * `0x1F8` create-texture（sub_422C20 → `sub_4A2C10(_this+80708, slot, w, h, mode)`）：
   * 引擎先释放该槽旧纹理对象、再**新建**一张（脚本给尺寸/模式 ⇒ 程序化/空白纹理，非文件图像）。
   * emulator 建模：**该槽的图像缓存失效后重取**——若该槽此前由 `set-texture` 绑定过文件图像，
   * 保持绑定语义并刷新缓存；若是全新程序化纹理，则只记录（程序化纹理生成未建模）。
   */
  create(slot: number, w: number, h: number, mode: number): void {
    const bound = this.#slotImgid.get(slot);
    if (bound !== undefined) {
      const tex = this.#imgCache.get(bound);
      if (tex) this.slotTex.set(slot, tex);
    }
    this.log(
      `createTexture slot=${slot} ${w}x${h} mode=${mode}` +
        (bound !== undefined ? ` (沿用已绑定 imgid=0x${bound.toString(16)})` : ' (程序化纹理未建模)'),
    );
  }

  /**
   * `0x208`（sub_4302E0 → `sub_49ED60`）：**纹理尺寸查询**（getter）。
   * 引擎读该槽 `CTexture` 的 `+1040`（宽）/`+1044`（高）；槽越界或未创建 → 0/0。
   * emulator：槽 → imgid → 已载入纹理的原始尺寸；未载入时返回 0/0（与引擎"槽为空"同口径），
   * 并**触发**一次载入，使图像就绪后下一次查询能拿到真实值。
   */
  size(slot: number): { w: number; h: number } {
    const tex = this.slotTex.get(slot);
    if (tex) return { w: tex.source.width, h: tex.source.height };
    const imgid = this.#slotImgid.get(slot);
    if (imgid !== undefined) void this.preloadImage(imgid); // 首次查询触发载入
    this.log(
      `getTextureSize slot=${slot} → 0x0（纹理尚未载入${
        imgid === undefined ? '；该槽未绑定' : `，imgid=0x${imgid.toString(16)}`
      }）`,
    );
    return { w: 0, h: 0 };
  }

  /** `0x1FA` release-texture：解除该槽的纹理。 */
  release(slot: number): void {
    this.slotTex.delete(slot);
  }

  /**
   * **绘制项 → 纹理**：`draw-texture` 的 **op2** 是纹理槽（存进 `Item.tex`），
   * 而 `handle` 是 Scene map 的 key（= 层序）、`layer` 与之同值。
   * 返回 `{ tex }` 命中；未绑定/未载入时 `{ imgid }`（`imgid === undefined` 表示该槽从未绑定）。
   */
  resolve(it: Item): { tex?: Texture; imgid?: number } {
    const slot = it.tex ?? 0;
    const imgid = this.#slotImgid.get(slot);
    const tex = this.slotTex.get(slot);
    return { tex, imgid };
  }
}

/** RGBA 字节 → Pixi 纹理（top-down）。 */
async function rgbaToTexture(w: number, h: number, data: Uint8Array): Promise<Texture> {
  const clamped = new Uint8ClampedArray(data);
  const imageData = new ImageData(clamped, w, h);
  const bmp = await createImageBitmap(imageData);
  return Texture.from(bmp);
}
