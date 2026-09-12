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
import { CanvasSource, Texture } from 'pixi.js';
import type { Item } from '../drawItem.js';
import type { DrawStringStyle } from '../../vm/native.js';
import { drawStringGlyphs } from '../../text/layout.js';

/**
 * **延迟销毁队列**：纹理不能"说销毁就销毁" —— 见 `TextureCache.collectGarbage` 的说明。
 * 抽成独立小类是为了能在 Node 里单测（传假对象即可，不需要 DOM/WebGL）。
 */
export class DestroyQueue {
  #q: { destroy(destroySource?: boolean): void }[] = [];

  push(tex: { destroy(destroySource?: boolean): void }): void {
    this.#q.push(tex);
  }

  get size(): number {
    return this.#q.length;
  }

  /** 真正销毁并清空；返回销毁个数（>0 时调用方可以记一条日志）。 */
  flush(): number {
    const n = this.#q.length;
    for (const t of this.#q) t.destroy(true);
    this.#q.length = 0;
    return n;
  }
}

/** 一个"程序化槽"（`0x1F8` create-texture 建的空白表面 + `0x204` 直绘上去的文本）。 */
interface CanvasSlot {
  canvas: HTMLCanvasElement;
  tex: Texture;
  /** 逻辑尺寸（= 引擎的 surface 尺寸；`size()` 与绘制坐标都用它）。 */
  w: number;
  h: number;
  /** 光栅化用的设备像素比（画布物理尺寸 = 逻辑 × res；DPR 变化要重建）。 */
  res: number;
}

/**
 * 程序化槽画布的**物理像素**尺寸（`create-texture` 的逻辑尺寸 × DPR）。
 *
 * ★与消息窗路径（`text/raster.ts` 的 `rasterFrame`，同样 `ceil(w*res)`）**必须一致**：
 * 两条路径的纹理都会交给同一个 Pixi 舞台（logical 1280×720 @ resolution=DPR）。
 * 若这里按 1×建画布，纹理就会被**放大 DPR 倍**显示 ⇒ 直绘文本整体发虚、笔画看着变粗，
 * 而消息窗文本（按 DPR 光栅化 + `resolution: res`）是清晰的 —— 同一屏上两种"字重观感"。
 */
export function canvasPixelSize(w: number, h: number, res: number): { cw: number; ch: number } {
  return { cw: Math.max(1, Math.ceil(w * res)), ch: Math.max(1, Math.ceil(h * res)) };
}

export class TextureCache {
  /** `slot → Texture`（已绑定且已载入）。 */
  readonly slotTex = new Map<number, Texture>();
  readonly #slotImgid = new Map<number, number>();
  readonly #imgCache = new Map<number, Texture>();
  /** 在途载入（imgid → promise）——`waitIdle` 的帧屏障就等它。 */
  readonly #inflight = new Map<number, Promise<void>>();
  /** 程序化槽的画布（`0x1F8` 建、"`0x204` 画"）——与文件纹理分开存，因为要**就地改像素**。 */
  readonly #canvasSlots = new Map<number, CanvasSlot>();
  /** 待销毁的旧纹理（`present()` 之后由 `collectGarbage` 统一销毁）。 */
  readonly #pendingDestroy = new DestroyQueue();

  constructor(private readonly log: (msg: string) => void) {}

  /** 光栅化用的设备像素比（与消息窗路径同一口径：上限 2，非浏览器环境为 1）。 */
  static #dpr(): number {
    return typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  }

  /** 待销毁纹理数（诊断/单测用）。 */
  get pendingDestroyCount(): number {
    return this.#pendingDestroy.size;
  }

  /**
   * **统一销毁"这一帧已不再被舞台引用"的旧纹理**（由 `PixiBackend.present()` 在
   * `presenter.present()` **之后**调用）。
   *
   * ★为什么必须延迟（2026 实测的**黑屏**事故）：
   * Pixi 的 ticker 每帧自己 `app.render()`，而我们的 `present()` 只在 **VM 跑完一批指令之后**才重建舞台。
   * 于是存在这个窗口：VM 里执行 `create-texture`/`release-texture` 时（旧纹理被 `destroy(true)`），
   * **舞台上仍挂着上一帧那些引用它的 Sprite** ⇒ 紧接着的一次 ticker 渲染就去画一个已销毁的纹理
   * ⇒ WebGL 批次状态损坏，**此后再也画不出任何东西**（现象：切到某页后整屏只剩背景色，
   * 指令照跑、日志里也毫无异常 —— 因为异常发生在 ticker 的 render 里，不在我们的调用栈上）。
   * 所以销毁必须挪到"舞台已经换成新纹理之后"（= present 之后）执行。
   */
  collectGarbage(): number {
    return this.#pendingDestroy.flush();
  }

  /** 已绑定纹理的槽数（诊断用）。 */
  get slotCount(): number {
    return this.slotTex.size;
  }

  /** 仍在载入的图像数（帧屏障用，见 `waitIdle`）。 */
  get pendingCount(): number {
    return this.#inflight.size;
  }

  /**
   * **等待所有在途图像载入完成**（帧屏障）。
   *
   * 引擎的 `set-texture`(0x1F9) 是**同步**的：`sub_422CB0` 内直接走
   * `sub_4559C0`（CreateFile/ReadFile 读 AGF）+ 解码，指令返回时图像已在内存里
   * ⇒ 同一帧"绑定 + 画"必然一致。
   * 重写侧走 `window.api.image()`（IPC + 主进程解码）是**异步**的，若不在这里补齐，
   * 就会出现「新一屏的文本已经画上来、背景还没切换（旧背景/空白）」的时序错位（2026 实测：
   * 首次从主界面进设置时 ADV 样例文案先出现，CONFIG 背景晚几帧）。
   *
   * @param timeoutMs 兜底上限（载入异常时不至于把帧循环挂死）
   */
  async waitIdle(timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.#inflight.size > 0) {
      const left = deadline - Date.now();
      if (left <= 0) {
        this.log(`texturesIdle 超时（仍有 ${this.#inflight.size} 张在载入）→ 本帧先合成`);
        return;
      }
      await Promise.race([
        Promise.allSettled([...this.#inflight.values()]),
        new Promise((resolve) => setTimeout(resolve, left)),
      ]);
    }
  }

  /** `slot → imgid`（未绑定返回 undefined）。 */
  imgidOf(slot: number): number | undefined {
    return this.#slotImgid.get(slot);
  }

  /**
   * 按 imgid 预载图像（幂等：已在缓存或已在途则直接返回同一个 promise）。
   * 失败只记日志——引擎在取不到图时也只是画不出来，不改变控制流。
   */
  async preloadImage(imgid: number): Promise<void> {
    if (this.#imgCache.has(imgid)) return;
    const inflight = this.#inflight.get(imgid);
    if (inflight) return inflight;
    const task = (async () => {
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
        this.#inflight.delete(imgid);
      }
    })();
    this.#inflight.set(imgid, task);
    return task;
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
   * 引擎先释放该槽旧纹理对象、再**新建**一张（脚本给尺寸/模式 ⇒ 程序化/空白表面，非文件图像）。
   *
   * emulator 建模：**真的建一张空白 canvas 纹理**（尺寸 = op2/op3，初始全透明）。
   * ★这里必须建，而不是"什么都不做"：`CONFIG1` 的设置行就是
   *   ① `create-texture 196 628 360 0` → ② 逐行 `draw-string 196 …` → ③ 把该槽按行裁贴到行上。
   *   早前这里只记日志 ⇒ 该槽没有纹理 ⇒ 渲染器退回"1×1 白纹理占位" ⇒ **整条中间一片纯白**
   *   （用户实测："设置界面中间的项目的文字没有渲染，而是全是纯白色"）。
   *
   * ★**尺寸不变时复用画布**（只清空 + 重传）：引擎的语义是"新建空表面"，用同一张画布清零后
   * 像素结果完全一致，但避免了每页重建时的纹理销毁/新建（以及随之而来的销毁时序问题，见 `collectGarbage`）。
   *
   * ★**画布按 DPR 光栅化**（`canvasPixelSize` + `CanvasSource.resolution = res`）：文本直绘路径曾按 1× 建画布，
   * 于是整张纹理在 Pixi 舞台上被放大 DPR 倍显示 ⇒ 直绘文本发虚、笔画看着比消息窗文本粗
   * （用户实测："非 ADV 窗口的文字整体像是粗体"）。两条路径现在同口径。
   */
  create(slot: number, w: number, h: number, mode: number): void {
    const bound = this.#slotImgid.get(slot);
    if (bound !== undefined) {
      const tex = this.#imgCache.get(bound);
      if (tex) this.slotTex.set(slot, tex);
    }
    const cw = Math.max(1, w | 0);
    const ch = Math.max(1, h | 0);
    const res = TextureCache.#dpr();
    const old = this.#canvasSlots.get(slot);
    if (old && old.w === cw && old.h === ch && old.res === res && typeof document !== 'undefined' && w > 0 && h > 0) {
      // 同尺寸同 DPR ⇒ 复用：清空（= 引擎的新空表面，之前直绘的字随之消失）。清空要用物理尺寸。
      const ctx = old.canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, old.canvas.width, old.canvas.height);
      }
      old.tex.source.update();
      this.slotTex.set(slot, old.tex);
      this.log(`createTexture slot=${slot} ${w}x${h} mode=${mode} @${res}x (复用空白表面：清空)`);
      return;
    }
    // 尺寸/DPR 变了（或首次）⇒ 换一张画布；旧纹理**延迟到 present 之后**再销毁（见 collectGarbage）
    if (old) {
      this.slotTex.delete(slot);
      this.#pendingDestroy.push(old.tex);
      this.#canvasSlots.delete(slot);
    }
    if (typeof document !== 'undefined' && w > 0 && h > 0) {
      const { cw: pw, ch: ph } = canvasPixelSize(cw, ch, res);
      const canvas = document.createElement('canvas');
      canvas.width = pw;
      canvas.height = ph; // 全透明（引擎新表面未初始化 ⇒ 不遮挡下层素材）
      // ★resolution: res —— 画布物理尺寸是 逻辑×res，不告诉 Pixi 就会被按 1:1 逻辑像素显示（放大/偏移）
      const tex = new Texture({ source: new CanvasSource({ resource: canvas, resolution: res }) });
      this.#canvasSlots.set(slot, { canvas, tex, w: cw, h: ch, res });
      this.slotTex.set(slot, tex);
    }
    this.log(
      `createTexture slot=${slot} ${w}x${h} mode=${mode} @${res}x` +
        (bound !== undefined ? ` (沿用已绑定 imgid=0x${bound.toString(16)})` : ' (新建空白表面)'),
    );
  }

  /**
   * `0x204` draw-string（sub_423390 → `sub_456710`）：把一整串文本直绘进该槽的表面。
   *
   * 引擎是 GDI `TextOutA` 到该槽的 DIB 上（**保留原有像素**、不清底、不换行）；
   * 这里用同一套字体/颜色/描边规则逐字 `fillText`（与消息窗共用 `raster` 的描边语义）。
   * 槽不存在（没先 create-texture）⇒ 引擎那条 `&&` 门会直接返回 ⇒ 这里也**不画**。
   */
  drawString(slot: number, x: number, y: number, text: string, style: DrawStringStyle): void {
    const cs = this.#canvasSlots.get(slot);
    if (!cs) {
      this.log(`drawString slot=${slot} 被忽略：该槽没有 create-texture 出来的表面（引擎同口径）`);
      return;
    }
    const ctx = cs.canvas.getContext('2d');
    if (!ctx) return;
    // ★画布是物理像素（逻辑×res）⇒ 先把坐标系缩到逻辑尺寸，之后一切坐标/字号都按逻辑值给
    ctx.setTransform(cs.res, 0, 0, cs.res, 0, 0);
    ctx.font = `${style.weight} ${style.size}px "${style.family}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // 位置/描边副本由 `text/layout.drawStringGlyphs` 决定（引擎语义，可单测）；这里只执行绘制
    for (const g of drawStringGlyphs(text, x, y, style.size, style.outlineMode, style.outlineDx, style.outlineDy)) {
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = g.role === 'fill' ? style.fill : style.outline;
      ctx.fillText(g.ch, g.x, g.y);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // 交还单位变换（同一 ctx 后续可能被别的路径用）
    cs.tex.source.update(); // 通知 Pixi 重新上传这张 canvas
    this.log(
      `drawString slot=${slot} (${x},${y}) @${cs.res}x w=${style.weight} ${JSON.stringify(text)}`,
    );
  }

  /**
   * `0x208`（sub_4302E0 → `sub_49ED60`）：**纹理尺寸查询**（getter）。
   * 引擎读该槽 `CTexture` 的 `+1040`（宽）/`+1044`（高）；槽越界或未创建 → 0/0。
   * emulator：槽 → imgid → 已载入纹理的原始尺寸；未载入时返回 0/0（与引擎"槽为空"同口径），
   * 并**触发**一次载入，使图像就绪后下一次查询能拿到真实值。
   */
  size(slot: number): { w: number; h: number } {
    const cs = this.#canvasSlots.get(slot);
    if (cs) return { w: cs.w, h: cs.h }; // 程序化表面：尺寸就是 create-texture 给的那对
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

  /** `0x1FA` release-texture：解除该槽的纹理（程序化表面一并释放）。 */
  release(slot: number): void {
    this.slotTex.delete(slot);
    const cs = this.#canvasSlots.get(slot);
    if (cs) {
      this.#pendingDestroy.push(cs.tex); // ★延迟销毁（舞台可能还挂着引用它的 Sprite）
      this.#canvasSlots.delete(slot);
    }
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
