/**
 * **Live2D 纹理库**：统一文件 id → Pixi `Texture`（普通 PNG，**不是** AGF）。
 *
 * ## 为什么不能走 `TextureCache`
 * `TextureCache` 的键是**引擎纹理槽号**（`set-texture` 建的 `slot → imgid`），值经
 * `window.api.image()` 取 —— 那条通道只会解 AGF（`decodeAgfRgba`）。而 Live2D 的纹理是
 * **普通 PNG**（引擎 `D3DXCreateTextureFromFileInMemory`，见 `docs-new/03-engine/live2d.md`），
 * 且绑定关系是"模型内纹理号 → 文件 id"（`L2dInstance.textures`），与槽号无关。
 *
 * ## 生命周期
 *  - 载入是**异步**的（IPC + PNG 解码）；未就绪时调用方**不画**（而不是画占位块 ——
 *    标题立绘上糊一块白比什么都不画更难查）；
 *  - 载入完成时通过 `onReady` 通知宿主置脏 ⇒ 下一帧自动补画（不需要调用方轮询）；
 *  - `waitIdle()` 供帧屏障用：新绑的纹理要在**同一帧**可见（对齐引擎 `set-texture` 的同步语义）。
 */
import { Texture } from 'pixi.js';

/** 取字节的窄缝（`IpcFileSource.readById` 满足它）。 */
export interface L2dByteSource {
  readById(id: number): Promise<{ name: string; data: Uint8Array } | null>;
}

export class L2dTextureStore {
  readonly #byId = new Map<number, Texture>();
  readonly #inflight = new Map<number, Promise<void>>();
  /** 已经报过失败的 id（避免每帧刷屏）。 */
  readonly #failed = new Set<number>();

  constructor(
    private readonly src: L2dByteSource,
    private readonly log: (msg: string) => void,
    /** 新纹理就绪（宿主据此置脏，让下一帧补画）。 */
    private readonly onReady: () => void,
  ) {}

  /** 已就绪的纹理数（诊断）。 */
  get loadedCount(): number {
    return this.#byId.size;
  }

  /** 仍在载入的纹理数（帧屏障 `texturesIdle` 用）。 */
  get pendingCount(): number {
    return this.#inflight.size;
  }

  /** 已就绪的纹理（未就绪返回 `undefined` —— 调用方据此"这一帧不画"）。 */
  get(fileId: number): Texture | undefined {
    return this.#byId.get(fileId);
  }

  /**
   * 确保这些文件 id 的纹理**已在载入中**（幂等；失败只记一次日志）。
   *
   * 引擎在 `0x345` 里是同步读文件 + `D3DXCreateTextureFromFileInMemory`，
   * 重写侧异步 ⇒ 这里只是"发起"，真正的补画靠 `onReady`。
   */
  ensure(fileIds: (number | null)[]): void {
    for (const id of fileIds) {
      if (id === null || this.#byId.has(id) || this.#inflight.has(id) || this.#failed.has(id)) continue;
      const task = (async () => {
        try {
          const r = await this.src.readById(id);
          if (!r) {
            this.#failed.add(id);
            this.log(`[l2d] 纹理 id 0x${id.toString(16)} 取不到 ⇒ 该纹理号不出画（引擎同口径：绑定失败即无图）`);
            return;
          }
          const tex = await pngToTexture(r.data);
          this.#byId.set(id, tex);
          this.log(`[l2d] 纹理 0x${id.toString(16)} → ${r.name} (${tex.source.width}x${tex.source.height})`);
          this.onReady();
        } catch (e) {
          this.#failed.add(id);
          this.log(`[l2d] 纹理 0x${id.toString(16)} 解码失败：${(e as Error).message}`);
        } finally {
          this.#inflight.delete(id);
        }
      })();
      this.#inflight.set(id, task);
    }
  }

  /** 等所有在途纹理载入完成（帧屏障；超时兜底，绝不把帧循环挂死）。 */
  async waitIdle(timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.#inflight.size > 0) {
      const left = deadline - Date.now();
      if (left <= 0) {
        this.log(`[l2d] 纹理载入超时（仍有 ${this.#inflight.size} 张）→ 本帧先合成`);
        return;
      }
      await Promise.race([
        Promise.allSettled([...this.#inflight.values()]),
        new Promise((resolve) => setTimeout(resolve, left)),
      ]);
    }
  }

  /** 清空（宿主关闭/重启时；纹理交给 Pixi 的 GC，**不**在这里 destroy —— 舞台可能还挂着引用）。 */
  clear(): void {
    this.#byId.clear();
    this.#failed.clear();
  }
}

/** PNG 字节 → Pixi 纹理（top-down；D3D 与 WebGL 的纹理原点都在左上 ⇒ 不翻转）。 */
async function pngToTexture(data: Uint8Array): Promise<Texture> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap 不可用（非浏览器环境？）');
  }
  const blob = new Blob([data as unknown as BlobPart], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  return Texture.from(bmp);
}
