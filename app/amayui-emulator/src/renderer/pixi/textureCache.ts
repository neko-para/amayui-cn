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
import { drawStringGlyphs, TEXT_FILL_ALPHA } from '../../text/layout.js';
import { drawAliasedLayer, drawGlyphPassesOnSurface, type GlyphPass } from '../text/raster.js';
import { clampScaledBlit } from '../scene/ops.js';
import {
  DEFAULT_TILE_SIZE,
  clampFillRect,
  dividedTiles,
  slotNodeSizeOf,
  type DividedTile,
  type SlotNode,
  type SlotNodeKind,
  type SurfaceClass,
} from '../slotSurface.js';

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

/**
 * 帧屏障的**安全兜底**上限（`TextureCache.waitIdle` / `L2dTextureLibrary.waitIdle` 省略参数时用）。
 *
 * ★为什么不沿用旧版的 500 ms（`tickets/T-0102` 的 H2）：屏障后面紧跟的可能不是"画一笔"，
 * 而是 `0x208`（`sub_4302E0` 读纹理尺寸并**写回操作数**）这类 getter —— 一旦在载入完成前返回，
 * 脚本会按 `0×0` 走**与引擎不同**的分支，而且**不会回头再看**（用户实测的白底/尺寸错位即此形状）。
 * 引擎的 `set-texture` 是同步的（没有"超时"这个概念），所以这里取"够大、只用于防止真挂死"的量级：
 * 冷启动读大 AGF 有实测超过 500 ms 的情形，30 s 足以覆盖，同时仍能在 IPC 真死掉时收敛。
 */
export const BARRIER_GIVEUP_MS = 30_000;

/** 屏障等待期间的**告警间隔**：超过这么久还没等到就在日志里报一次（E4 能看出"这次等了多久"）。 */
export const BARRIER_WARN_MS = 1_000;

/** 屏障的轮询粒度（等 `Promise.allSettled` 与这个定时器赛跑，取先到者）。 */
export const BARRIER_POLL_MS = 64;

/**
 * `createTexture(slot, w, h)` 对**已有表面**的三态决策。
 *
 * ★为什么把它抽成纯函数（`tickets/T-0175` ⑤，出处 `tickets/T-0166` §4-②）：这段语义原先只活在
 * `create()` 的一个复合 `if` 里，而它**只能在有 DOM 的环境里跑**（下面要 `document.createElement`
 * 与 `PIXI.Texture.from`）⇒ Node 测试里 `old` 永远是 undefined，**"同尺寸复用 / 换尺寸入队销毁"
 * 这条接线一直没有任何断言**。抽出决策后，前两态的**语义**可以在 Node 里逐条钉住
 * （`test/texture-lifecycle.test.ts`）；真正 `push` 进 `DestroyQueue` 的那一行仍只在真宿主里走到
 * —— 这一点如实保留（见 `T-0175` 的 ⑤）。
 *
 * 三态：
 *  - `reuse-clear`：同一槽、同 `w/h`（各自 `max(1, ·)`）、同 DPR，**且有 DOM、且 w/h > 0**
 *    ⇒ 复用同一张画布并清空（= 引擎的"新空表面"，之前直绘的字随之消失）；
 *  - `replace`：有旧表面但不满足复用 ⇒ **旧纹理推入 `DestroyQueue`**（延迟到 `present()` 之后再销毁，
 *    舞台可能还挂着引用它的 Sprite）；
 *  - `fresh`：本来就没有旧表面。
 */
export type CreateTextureDecision = 'reuse-clear' | 'replace' | 'fresh';

/**
 * **画布/纹理工厂**（`tickets/T-0175` 的 ⑤ 后半，出处 `tickets/T-0166` §4-②）。
 *
 * ## 为什么需要注入点
 *
 * 「换尺寸/释放 ⇒ 旧纹理进 `DestroyQueue`」这条接线**只在有 DOM 的环境里走得到**：
 * `create()` 的建画布那一步要 `document.createElement`，Node 里 `typeof document === 'undefined'`
 * ⇒ `#canvasSlots` 永远是空的 ⇒ `decision` 永远是 `fresh` ⇒ **`push` 进 `DestroyQueue` 的那一行
 * 在任何测试里都是死角**（`test/texture-lifecycle.test.ts` 只测了 `DestroyQueue` 自己的语义，
 * 与"`create` 真的会入队"之间那段接线没有断言）。
 *
 * 抽出 `decideCreateTexture` 解决了**决策**那一半；这里补上**接线**那一半：把"建 DOM 画布"换成
 * 可注入的工厂，于是 Node 测试能真的跑 `create(slot, 旧尺寸)` → `create(slot, 新尺寸)`，
 * 并断言 `pendingDestroyCount === 1`（同尺寸复用 ⇒ 不增）。
 *
 * ★**生产行为不变**：`PixiBackend` 不传这个参数 ⇒ 走原来的 `typeof document` 分支，
 * 逐字与修前相同（这就是"可选缝"的语义：不实现 ⇒ 不抛、不变行为）。
 */
export interface CanvasFactory {
  /** 建一张画布（生产 = `document.createElement('canvas')`）。 */
  createElement(tag: 'canvas'): HTMLCanvasElement;
  /** 把画布包成 Pixi 纹理（生产 = `new Texture({ source: new CanvasSource(...) })`）。 */
  createTexture(canvas: HTMLCanvasElement, resolution: number): Texture;
}
export function decideCreateTexture(opts: {
  /** 该槽现有画布表面的尺寸（没有则 `null`）。 */
  had: { w: number; h: number; res: number } | null;
  w: number;
  h: number;
  res: number;
  /** `typeof document !== 'undefined'`。 */
  hasDom: boolean;
}): CreateTextureDecision {
  const cw = Math.max(1, opts.w | 0);
  const ch = Math.max(1, opts.h | 0);
  if (
    opts.had &&
    opts.had.w === cw &&
    opts.had.h === ch &&
    opts.had.res === opts.res &&
    opts.hasDom &&
    opts.w > 0 &&
    opts.h > 0
  ) {
    return 'reuse-clear';
  }
  return opts.had ? 'replace' : 'fresh';
}

export class TextureCache {
  /** `slot → Texture`（已绑定且已载入）。 */
  readonly slotTex = new Map<number, Texture>();
  readonly #slotImgid = new Map<number, number>();
  readonly #imgCache = new Map<number, Texture>();
  /** 在途载入（imgid → promise）——`waitIdle` 的帧屏障就等它。 */
  readonly #inflight = new Map<number, Promise<void>>();
  /** `slot → 表面世代`（`create-texture`/`release-texture` 递增；见 `#bumpEpoch`）。 */
  readonly #slotEpoch = new Map<number, number>();
  /** 程序化槽的画布（`0x1F8` 建、"`0x204` 画"）——与文件纹理分开存，因为要**就地改像素**。 */
  readonly #canvasSlots = new Map<number, CanvasSlot>();
  /** 待销毁的旧纹理（`present()` 之后由 `collectGarbage` 统一销毁）。 */
  readonly #pendingDestroy = new DestroyQueue();
  /**
   * `slot → CTexture 表面尺寸`（`0x1F8` 的 op2/op3 ⇒ 引擎的 `CTexture+1040/+1044`，raw 107024-107032）。
   *
   * 与 `#canvasSlots` 的区别：那个是**画布**（要 DOM ⇒ Node/E2E 里没有），这份是**引擎字段本身**。
   * 它只作 `size()` 的**兜底**（画布/已载入图都拿不到时才用），但 `slotNodeSize()` 拿它当
   * `0x23F` 的"对象尺寸"来源（见 `slotSurface.ts` 的 `slotNodeSizeOf`）。
   */
  readonly #surfaceSize = new Map<number, { w: number; h: number }>();
  /**
   * `slot → 表面类`（`0x1F8` 的 `mode == 3 ⇒ DividedTexture`，raw 122855-122871）。
   * `create`/`release` 都会改写它（引擎每次重建对象、释放时析构）。
   */
  readonly #slotClass = new Map<number, SurfaceClass>();
  /** `slot → DividedTexture 的子纹理表`（`sub_43A740` 建的那个 vector）。 */
  readonly #slotTiles = new Map<number, DividedTile[]>();
  /** `slot → 槽对象`（引擎 `Engine[slot + 94672]`，字节 `+378688`；`0x20F`/`0x236` 惰性建）。 */
  readonly #slotNodes = new Map<number, SlotNode>();
  /**
   * **分块边长**：引擎的 `dword_55052C`（`int dword_55052C = 256;` raw 5663），由 `0x248`
   * （`sub_4252E0` raw 32705）按 op1 改写 ⇒ **脚本可配**。`create` 时读它（`sub_43A740` raw 46675）。
   *
   * ★`0x248` 的宿主接线见 `tickets/T-0153/changes-renderer.md` 的跨域接线节：VM 侧现在只把它
   * 写进 `engineValues`（`-248`），要让它真的影响分块，需要一个 `0x248 → 宿主` 的缝。
   */
  tileSize: number = DEFAULT_TILE_SIZE;

  /**
   * @param log 日志回调。
   * @param onReady **某槽的纹理"到货"时**的通知（`tickets/T-0102` 轮 9）——宿主用它 `#markDirty()`。
   *
   * ★为什么必须有（用户实测「进 SC0000 后 ADV 窗口背景是白色，开合侧边栏刷新后才对」的机制）：
   *   引擎的 `set-texture` 是**同步**的（`sub_422CB0` 当场读 AGF + 解码），所以「绑定 → `0x208` 问尺寸 →
   *   `draw-texture`」在引擎里必然一致；重写侧走 `window.api.image()` **异步** ⇒ 首次绑定那一帧
   *   `slotTex` 还没有那张图，`draw-texture` 只能画**占位块**（`presenter` 的 `Texture.WHITE`，
   *   且 tint 被 `itemColor` 覆盖成 `Item.from` = 白）⇒ 一块**纯白矩形**。
   *   而常规 `TextureCache` 此前**没有**到货通知（只有 L2D 纹理库有，见 `pixiBackend` 的 `#l2dTextures`）
   *   ⇒ 迟到的图像自己不会让下一帧重新合成，白帧一直留到玩家做别的操作（开合侧边栏会重跑同一段
   *   `set-texture`，那时命中 `#imgCache` ⇒ 同步落盘 ⇒ 才对）。
   *   ⇒ 有它以后：图像一到货就置脏 ⇒ 下一帧重新合成 ⇒ 白帧最多存活一帧。
   */
  constructor(
    private readonly log: (msg: string) => void,
    private readonly onReady?: () => void,
    /**
     * **画布/纹理工厂**（可注入；见 {@link CanvasFactory}）——省略时用 DOM（生产路径）。
     * ★注入它**只影响"能不能在 Node 里跑通建画布那一步"**，不改变任何决策（决策在
     * `decideCreateTexture` 的纯函数里，`hasDom` 由本工厂是否可用推出）。
     */
    private readonly canvasFactory?: CanvasFactory,
  ) {}

  /** 本宿主能不能建画布（生产 = 有 `document`；测试 = 注入了假工厂）。 */
  #hasCanvasFactory(): boolean {
    return this.canvasFactory !== undefined || typeof document !== 'undefined';
  }

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

  /**
   * **仍有"槽节点"的槽数**（`0x20F`/`0x236` 惰性建的对象；`releaseMovieSlots` 会清）。
   * ★与 `slotCount` 的区别：那个是"绑定了纹理的槽"，这个是"引擎眼里存在对象的槽"——
   * 两者不等（注册了对象但还没绑图的槽在前者里看不见）。诊断内存时两个都要看。
   */
  get slotNodeCount(): number {
    return this.#slotNodes.size;
  }

  /**
   * **本缓存到底留了多少像素**（`tickets/T-0181`：页面 OOM 的评估）。
   *
   * 为什么需要它：这两张表（`#imgCache` / `#canvasSlots`）**只增不减** —— 游戏跑过的每一张图、
   * 建过的每一个程序化表面都留在这里。想知道"是不是它们把堆吃满了"，就必须能报出**项数 + 像素数**
   * （而不是靠猜"300MB 大概是 Pixi 的 ImageSource"）。
   *
   * ★两张表分开报：`#imgCache` 是**文件图**（AGF 解码后的 RGBA，靠 `imgid` 复用）、
   *   `#canvasSlots` 是**程序化表面**（`0x1F8`/`0x204` 画的，靠槽号复用）。它们的释放语义不同
   *   （前者引擎永不释放，后者随 `release-texture` 走），混成一个数就分不出该动哪一边。
   *
   * @param reachableSlots 当前**还被场景引用**的槽号（可选）—— 用来把"活着"与"只留在缓存里"分开。
   *   ★这正是判"能不能回收"的判据：没有人引用的条目仍然占着内存。
   */
  stats(reachableSlots?: Iterable<number>): {
    img: { count: number; pixels: number };
    canvas: { count: number; pixels: number; reachable: number; reachablePixels: number };
    inflight: number;
    pendingDestroy: number;
  } {
    let imgPixels = 0;
    for (const tex of this.#imgCache.values()) imgPixels += sourcePixels(tex);
    let canvasPixels = 0;
    let reachable = 0;
    let reachablePixels = 0;
    const want = reachableSlots ? new Set(reachableSlots) : null;
    for (const [slot, cs] of this.#canvasSlots) {
      // 画布本身按 DPR 放大过（`canvasPixelSize`）⇒ 用逻辑尺寸 × res 算，不用 canvas.width
      // （两者本该相等，但 res 是"我们以为的"，canvas.width 是"实际的" ⇒ 取实际的更诚实）。
      const px = cs.canvas.width * cs.canvas.height;
      canvasPixels += px;
      if (want?.has(slot)) {
        reachable++;
        reachablePixels += px;
      }
    }
    return {
      img: { count: this.#imgCache.size, pixels: imgPixels },
      canvas: { count: this.#canvasSlots.size, pixels: canvasPixels, reachable, reachablePixels },
      inflight: this.#inflight.size,
      pendingDestroy: this.#pendingDestroy.size,
    };
  }

  /**
   * **已载入文件的键**（`imgid` 升序；诊断/单测用）。
   * 与 `stats()` 配对：想知道"是谁在占"就得看得见键，而不只是总数。
   */
  imgIds(): number[] {
    return [...this.#imgCache.keys()].sort((a, b) => a - b);
  }

  /** 某张已载入图的源尺寸（没载入 ⇒ null）。 */
  imgSize(imgid: number): { w: number; h: number } | null {
    const tex = this.#imgCache.get(imgid);
    if (!tex) return null;
    const s = tex.source as unknown as { width?: number; height?: number };
    return { w: s.width ?? 0, h: s.height ?? 0 };
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
   * ★**上限的语义（`tickets/T-0102` 的 H2，本轮修）**：参数**省略**时用
   * {@link BARRIER_GIVEUP_MS}（30 s）这个**安全兜底**，而**不是**旧版的 500 ms ——
   * 旧默认的危害不是"少画一帧"：紧跟屏障的可能是 `0x208`（读尺寸并**写回操作数**）这类
   * getter，脚本按 0×0 走错分支后**不会再看第二眼**（白底/尺寸错位就是这么来的，见
   * `tickets/T-0102/white-report.md` §4.2 的 H2）。显式传小上限只留给"调用方自担后果"的场合。
   *
   * @param timeoutMs 显式等待上限；**省略 = 安全兜底**（{@link BARRIER_GIVEUP_MS}）
   */
  async waitIdle(timeoutMs?: number): Promise<void> {
    const started = Date.now();
    const ceiling = timeoutMs ?? BARRIER_GIVEUP_MS;
    let nextWarn = started + BARRIER_WARN_MS;
    while (this.#inflight.size > 0) {
      const now = Date.now();
      const left = started + ceiling - now;
      if (left <= 0) {
        const names = this.#inflightNames();
        this.log(
          `★纹理屏障放弃等待（已 ${now - started} ms，仍有 ${this.#inflight.size} 张在载入：${names}）` +
            '—— 后续帧靠 `#healSlot`/到货置脏自愈，但**此刻**读尺寸/绑定号的操作数可能已按 0×0 分支（T-0102 H2）',
        );
        return;
      }
      if (now >= nextWarn) {
        nextWarn = now + BARRIER_WARN_MS;
        this.log(`纹理屏障仍在等待 ${now - started} ms（在途 ${this.#inflight.size} 张：${this.#inflightNames()}）`);
      }
      await Promise.race([
        Promise.allSettled([...this.#inflight.values()]),
        new Promise((resolve) => setTimeout(resolve, Math.min(BARRIER_POLL_MS, left))),
      ]);
    }
  }

  /** 在途图像的 imgid 清单（屏障日志用：E4 要能直接看出"卡在哪几张图上"）。 */
  #inflightNames(): string {
    return [...this.#inflight.keys()].map((id) => `0x${id.toString(16)}`).join(' ');
  }

  /** `slot → imgid`（未绑定返回 undefined）。 */
  imgidOf(slot: number): number | undefined {
    return this.#slotImgid.get(slot);
  }

  /**
   * 该槽的**表面世代**：`create-texture`(0x1F8) 与 `release-texture`(0x1FA) 各 +1。
   *
   * ★用途 = `bind` 的**陈旧回写判据**（`tickets/T-0102`）：引擎的 `set-texture`(0x1F9) 是**同步**的
   * （`sub_422CB0` 当场 CreateFile/ReadFile + 解码，指令返回时图像已在内存 ⇒ 见 `waitIdle` 的说明），
   * 而重写侧走 `window.api.image()`（IPC + 主进程解码）**异步**。于是存在这个窗口：
   *   ① `set-texture X 48`（X 未缓存 ⇒ 发起异步载入）
   *   ② 脚本 `create-texture 48`（新空白表面）+ `0x20B` 填色 ⇒ 屏上应当是**那笔填色**
   *   ③ 异步载入完成 ⇒ 旧代码无条件 `slotTex.set(48, X)` ⇒ **把②的表面换掉**（画面上变成 X）
   * 表现就是"该槽要的颜色/内容没上来，直到脚本**再跑一次**同一段（例如开合一次侧边栏）才正确" ——
   * 用户实测原话：「进入 SC0000 后 ADV 窗口背景是**白色**的，展开/收起侧边栏菜单似乎刷新了界面
   * 导致其正确变成了**半透明黑色**」。引擎里②永远晚于③（同步），所以②必须赢。
   */
  #bumpEpoch(slot: number): void {
    this.#slotEpoch.set(slot, (this.#slotEpoch.get(slot) ?? 0) + 1);
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
        const tex = await this.decodeImage(imgid);
        if (tex) this.#imgCache.set(imgid, tex);
      } catch (err) {
        this.log(`image ${imgid.toString(16)} fail: ${(err as Error).message}`);
      } finally {
        this.#inflight.delete(imgid);
      }
    })();
    this.#inflight.set(imgid, task);
    return task;
  }

  /**
   * `imgid → Texture`（默认 = `window.api.image()` 取 AGF 解码结果 → `rgbaToTexture`）。
   *
   * ★抽成**可覆写方法**的唯一动机是**可测性**：Node 里没有 `ImageData`/`createImageBitmap`/DOM，
   *   而"异步载入完成后回写槽纹理"这条竞态（见 `bind` 的世代判据）必须在合成对象上
   *   **确定性复现**才能写守卫 —— 否则只能靠真界面偶发观察（`test/texture-bind-race.test.ts`）。
   *   生产路径行为不变：全仓只有这一处实现（`rgbaToTexture` 仍是唯一解码口）。
   */
  protected async decodeImage(imgid: number): Promise<Texture | null> {
    const r = await window.api.image(imgid);
    if (!r) return null;
    this.log(`image ${imgid.toString(16)} -> ${r.name} (${r.width}x${r.height})`);
    return rgbaToTexture(r.width, r.height, r.data);
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
    // ★陈旧回写判据（`tickets/T-0102`）：记下发起时的表面世代，回来时**两个条件都要成立**才落盘——
    //   ① 该槽的表面没有被 `create-texture`/`release-texture` 重建过（世代不变）；
    //   ② 该槽的绑定仍是这次发起的那张图（没被重新 `set-texture` 成别的 imgid）。
    //   否则这次载入只进 `#imgCache`（下次绑定即命中），**不得**覆盖脚本后来画上去的表面。
    const epoch = this.#slotEpoch.get(slot) ?? 0;
    void this.preloadImage(imgid).then(() => {
      const t2 = this.#imgCache.get(imgid);
      if (!t2) return;
      if ((this.#slotEpoch.get(slot) ?? 0) !== epoch || this.#slotImgid.get(slot) !== imgid) {
        this.log(
          `  bind slot ${slot} <- imgid 0x${imgid.toString(16)} 回写丢弃（槽已被 create/release 重建或改绑）`,
        );
        return;
      }
      this.slotTex.set(slot, t2);
      // ★`tickets/T-0102` 轮 9：**迟到的到货必须让下一帧重新合成** —— 否则白占位块留在屏上
      //   （常规 TextureCache 此前没有到货通知，只有 L2D 纹理库有）。
      this.onReady?.();
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
   *
   * ★**两套类**（`T-0153` 的 `0x1F8` 条目，raw 122855-122871）：`mode == 3` ⇒ `operator new(0x460)`
   * + `sub_43A5C0` = **DividedTexture**（多出 `+1104/+1108/+1112` 的**子纹理 vector**，按
   * `dword_55052C` 分块，`sub_43A740` raw 46674-46790）；**其余任何 mode** ⇒ `operator new(0x450)`
   * + `sub_48AB20` = NormalTexture。两者在宿主侧都是"一张画布"（像素结果同一条绘制路径），
   * 但**类与子纹理表必须建出来**：否则 `0x23F` 一族按对象类型分派的查询口径无从来处，也无从分辨
   * "这个槽是分块纹理"（引擎里它的析构/重建路径都不一样，`sub_43A630` raw 46573-46598）。
   */
  create(slot: number, w: number, h: number, mode: number): void {    this.#bumpEpoch(slot); // ★该槽的表面换了 ⇒ 更早发起的异步载入不得再回写（见 #bumpEpoch）
    // ★类/子纹理表/表面尺寸：先记（与 DOM 无关的部分）——引擎在 `sub_4A2C10` 里是"先写槽记录、
    //   再建对象、最后建表面"（raw 122847-122893），与画布存在与否无关。
    const cls: SurfaceClass = mode === 3 ? 'divided' : 'normal';
    this.#slotClass.set(slot, cls);
    if (cls === 'divided') this.#slotTiles.set(slot, dividedTiles(w, h, this.tileSize));
    else this.#slotTiles.delete(slot);
    if (w > 0 && h > 0) this.#surfaceSize.set(slot, { w: w | 0, h: h | 0 });
    else this.#surfaceSize.delete(slot);
    const bound = this.#slotImgid.get(slot);
    if (bound !== undefined) {
      const tex = this.#imgCache.get(bound);
      if (tex) this.slotTex.set(slot, tex);
    }
    const cw = Math.max(1, w | 0);
    const ch = Math.max(1, h | 0);
    const res = TextureCache.#dpr();
    const old = this.#canvasSlots.get(slot);
    const decision = decideCreateTexture({
      had: old ? { w: old.w, h: old.h, res: old.res } : null,
      w,
      h,
      res,
      hasDom: this.#hasCanvasFactory(),
    });
    if (decision === 'reuse-clear') {
      // 同尺寸同 DPR ⇒ 复用：清空（= 引擎的新空表面，之前直绘的字随之消失）。清空要用物理尺寸。
      const ctx = old!.canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, old!.canvas.width, old!.canvas.height);
      }
      old!.tex.source.update();
      this.slotTex.set(slot, old!.tex);
      this.log(`createTexture slot=${slot} ${w}x${h} mode=${mode} @${res}x class=${cls} (复用空白表面：清空)`);
      return;
    }
    // 尺寸/DPR 变了（或首次）⇒ 换一张画布；旧纹理**延迟到 present 之后**再销毁（见 collectGarbage）
    // ★`decision` 由 `decideCreateTexture` 这个**纯函数**给出（`tickets/T-0175` ⑤）：它的三态语义
    //   在 Node 里可测（`test/texture-lifecycle.test.ts`），而真正 push 的那一行仍只在真宿主走到。
    if (decision === 'replace') {
      this.slotTex.delete(slot);
      this.#pendingDestroy.push(old!.tex);
      this.#canvasSlots.delete(slot);
    }
    if (this.#hasCanvasFactory() && w > 0 && h > 0) {
      const { cw: pw, ch: ph } = canvasPixelSize(cw, ch, res);
      const canvas =
        this.canvasFactory?.createElement('canvas') ??
        (document.createElement('canvas') as HTMLCanvasElement);
      canvas.width = pw;
      canvas.height = ph; // 全透明（引擎新表面未初始化 ⇒ 不遮挡下层素材）
      // ★resolution: res —— 画布物理尺寸是 逻辑×res，不告诉 Pixi 就会被按 1:1 逻辑像素显示（放大/偏移）
      const tex =
        this.canvasFactory?.createTexture(canvas, res) ??
        new Texture({ source: new CanvasSource({ resource: canvas, resolution: res }) });
      this.#canvasSlots.set(slot, { canvas, tex, w: cw, h: ch, res });
      this.slotTex.set(slot, tex);
    }
    this.log(
      `createTexture slot=${slot} ${w}x${h} mode=${mode} @${res}x class=${cls}` +
        (cls === 'divided' ? ` tiles=${this.#slotTiles.get(slot)?.length ?? 0}@${this.tileSize}` : '') +
        (bound !== undefined ? ` (沿用已绑定 imgid=0x${bound.toString(16)})` : ' (新建空白表面)'),
    );
  }

  /** `0x1F8` 建的表面是哪一套类（`undefined` = 该槽没有表面）。 */
  surfaceClassOf(slot: number): SurfaceClass | undefined {
    return this.#slotClass.get(slot);
  }

  /** DividedTexture 的子纹理表（Normal/无表面 ⇒ `[]`）。 */
  dividedTilesOf(slot: number): DividedTile[] {
    return this.#slotTiles.get(slot) ?? [];
  }

  /** 该槽的**表面**尺寸（引擎 `CTexture+1040/+1044`）：画布 → 表面记录 → 已载入图；都没有 ⇒ `undefined`。 */
  #surfaceSizeOf(slot: number): { w: number; h: number } | undefined {
    const cs = this.#canvasSlots.get(slot);
    if (cs) return { w: cs.w, h: cs.h };
    const srf = this.#surfaceSize.get(slot);
    if (srf) return srf;
    const tex = this.#healSlot(slot);
    return tex ? { w: tex.source.width, h: tex.source.height } : undefined;
  }

  /**
   * **`0x20F` play-movie / `0x236`：登记该槽的对象**（引擎 `Engine[slot + 94672]`，字节 `+378688`）。
   *
   * 引擎体（raw 31627-31644 / 32245-32264）：
   * ```c
   * if ( !_this[4 * v2 + 378688] ) {                    // ★惰性：已有对象就复用、不再 new
   *   v3 = operator new(0x480u);  obj = sub_489040(v3);  //  CMovieToTexture
   *   _this[4 * v2 + 378688] = obj;
   *   if ( !sub_488DC0(obj, hwnd, 视频表, id) ) throw;    //  装载失败 ⇒ 抛（可见）
   * }
   * ```
   * @returns 是否**新建**（`true` = 走了 `if (!obj)` 分支；`false` = 复用已有对象）。
   */
  noteSlotNode(slot: number, kind: SlotNodeKind, id: number, mode: number): boolean {
    if (this.#slotNodes.has(slot)) {
      const n = this.#slotNodes.get(slot)!;
      n.kind = kind;
      n.id = id;
      n.mode = mode;
      return false;
    }
    this.#slotNodes.set(slot, { kind, id, mode });
    return true;
  }

  /** 该槽的对象（没有 ⇒ `undefined`）。 */
  slotNodeOf(slot: number): SlotNode | undefined {
    return this.#slotNodes.get(slot);
  }

  /** 销毁该槽的对象（`0x1F8`/`0x1F9`/`0x1FA` 的"先把 `Engine[slot+94672]` 置 0"，raw 31211-31269）。 */
  clearSlotNode(slot: number): boolean {
    return this.#slotNodes.delete(slot);
  }

  /**
   * **`0x23F` 的宿主侧答案**（`sub_4307B0` raw 40019-40030）：该槽**有没有对象**决定引擎写 `−1`
   * 还是"尺寸 ×1000"（`sub_4080B0` raw 12960-12979 按 `obj[+1084]` 分派）。
   *
   * ★与 `size()`（`0x208`，读**表面**表 `Scene+4*slot+42456`）**不是同一个问题**：两张表不许混。
   */
  slotNodeSize(slot: number): { present: boolean; w: number; h: number } {
    return slotNodeSizeOf(this.#slotNodes.get(slot), this.#surfaceSizeOf(slot));
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
    const ctx = cs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    // ★画布是物理像素（逻辑×res）⇒ 先把坐标系缩到逻辑尺寸，之后一切坐标/字号都按逻辑值给
    ctx.setTransform(cs.res, 0, 0, cs.res, 0, 0);
    ctx.font = `${style.weight} ${style.size}px "${style.family}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // 位置/描边副本由 `text/layout.drawStringGlyphs` 决定（引擎语义，可单测）；这里只执行绘制
    const glyphs = drawStringGlyphs(text, x, y, style.size, style.outlineMode, style.outlineDx, style.outlineDy);
    const font = `${style.weight} ${style.size}px "${style.family}"`;
    const paint = (c: CanvasRenderingContext2D): void => {
      c.font = font;
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.globalAlpha = 1;
      for (const g of glyphs) {
        c.globalAlpha = g.alpha;
        c.fillStyle = g.role === 'fill' ? style.fill : style.outline;
        c.fillText(g.ch, g.x, g.y);
      }
      c.globalAlpha = 1;
    };
    // ★抗锯齿（引擎 `Font+1352`，`tickets/T-0035`）：引擎没开 AA ⇒ 字形画进独立图层 + 阈值化再合成
    //   （不触碰该槽里已有的像素：`draw-string` 的语义是"往已有表面上叠字"）。
    if (style.antiAlias) {
      // ★覆盖率 α 路径（`tickets/T-0042`）：槽表面是 `create-texture` 的**空白 A8R8G8B8**，引擎把
      //   每遍的覆盖率 α 写进它的 alpha（`A = max(A_dst, α)`）⇒ 之后 `draw-texture` 按该 alpha 合成，
      //   字落在 `α·RGB + (1−α)·场景` 上。canvas 的 `source-over` 会把描边+填充的 alpha **累加**
      //   （≈1 ⇒ 纯白），所以这里逐像素复现引擎的写入（见 `drawGlyphPassesOnSurface`）。
      const passes: GlyphPass[] = glyphs.map((g) => ({
        ch: g.ch,
        x: g.x,
        y: g.y,
        color: g.role === 'fill' ? style.fill : style.outline,
        weight: g.alpha,
      }));
      if (passes.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of passes) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x + style.size);
          y1 = Math.max(y1, p.y + style.size);
        }
        // 包围盒 clamp 到画布（逻辑尺寸 = cs.w/h），再留 1px 余量给边缘覆盖率
        x0 = Math.max(0, Math.floor(x0) - 1);
        y0 = Math.max(0, Math.floor(y0) - 1);
        x1 = Math.min(cs.w, Math.ceil(x1) + 1);
        y1 = Math.min(cs.h, Math.ceil(y1) + 1);
        if (x1 > x0 && y1 > y0) {
          drawGlyphPassesOnSurface(ctx, {
            res: cs.res,
            font,
            passes,
            alphaMax: TEXT_FILL_ALPHA,
            box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
          });
        }
      }
    } else {
      drawAliasedLayer(ctx, cs.canvas.width, cs.canvas.height, cs.res, paint);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); // 交还单位变换（同一 ctx 后续可能被别的路径用）
    cs.tex.source.update(); // 通知 Pixi 重新上传这张 canvas
    this.log(
      `drawString slot=${slot} (${x},${y}) @${cs.res}x w=${style.weight}${style.antiAlias ? '' : ' no-aa'} ${JSON.stringify(text)}`,
    );
  }

  /**
   * **`0x20B` FillTexture**（`sub_423690` → `sub_4A4C70`，raw 31569-31592 / 124572 起）：
   * 往**纹理槽的表面**上填一个纯色矩形（引擎的"涂一块底色/进度条底"原语）。
   *
   * 引擎语义（handler 逐字）：`op1=槽`、`op2/op3` = 左上角、`op4/op5` = **宽/高**（体里是 `x2 = x + op4`，
   * 不是"矩形右下角"）、`op6` = α（`>255` 夹到 255）、`op7` = RGB（体里组装成 `0xFFRRGGBB`，A 固定 FF，α 另走 a5）。
   * ★槽没有 `create-texture` 出来的表面时引擎打「FillTexture」错误串 ⇒ emulator 同样忽略并留痕（与 `drawString` 同口径）。
   *
   * ★**先夹取、夹空不画**（`T-0153` 的 `0x20B` 条目，`sub_4A4C70` raw 124608-124634）：
   * ```c
   * v8 = obj[263]; v18 = obj[264]; v9 = obj[265]; v10 = obj[266];   // 表面记录 = (0,0,w,h)
   * if ( *a3 < v8 ) *a3 = v8;      // 左取 max
   * if ( a3[1] < v18 ) a3[1] = v18;// 上取 max
   * if ( a3[2] > v9 ) a3[2] = v9;  // 右取 min
   * if ( a3[3] > v10 ) a3[3] = v10;// 下取 min
   * if ( *v5 >= v5[2] ) return 1;  // ★空矩形 ⇒ 直接返回，**一笔都不画**
   * if ( v5[1] >= v5[3] ) return 1;
   * ```
   * 旧实现把 `x/y/w/h` 原样交给 `ctx.fillRect` ⇒ 越界填色会画出引擎根本不会画的那一块（而且
   * 引擎那条早退连"锁表面/下发 fill"都不做）。
   */
  fillSlotRect(slot: number, x: number, y: number, w: number, h: number, argb: number, alpha: number): void {
    const cs = this.#canvasSlots.get(slot);
    if (!cs) {
      this.log(`fillSlotRect slot=${slot} 被忽略：该槽没有 create-texture 出来的表面（引擎同口径：FillTexture 错误）`);
      return;
    }
    // ★夹到该表面的记录边界（Normal/Divided 的建面路径都写 (0,0,w,h)，raw 107029-107032 / 46686-46689）
    const r = clampFillRect(cs.w, cs.h, x, y, w, h);
    if (!r) {
      this.log(`fillSlotRect slot=${slot} (${x},${y},${w}x${h}) 被夹空 ⇒ 不画（引擎 sub_4A4C70 的 *v5 >= v5[2] 早退）`);
      return;
    }
    const ctx = cs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.setTransform(cs.res, 0, 0, cs.res, 0, 0); // 逻辑坐标（同 drawString）
    ctx.globalAlpha = Math.max(0, Math.min(255, alpha)) / 255;
    ctx.fillStyle = `rgb(${(argb >>> 16) & 0xff}, ${(argb >>> 8) & 0xff}, ${argb & 0xff})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cs.tex.source.update();
    const clipped = r.x !== x || r.y !== y || r.w !== w || r.h !== h;
    this.log(
      `fillSlotRect slot=${slot} (${r.x},${r.y},${r.w}x${r.h}) color=#${(argb >>> 0).toString(16).padStart(8, '0')} alpha=${alpha}` +
        (clipped ? '（被表面边界夹取）' : ''),
    );
  }

  /**
   * **纹理自愈**（`tickets/T-0102` 登记的 H3）：槽里没有纹理、但**当前绑定**的那个 imgid
   * 已经在 `#imgCache` 里 ⇒ 同步补一次 `slotTex`。
   *
   * 为什么需要：`bind` 的陈旧回写判据（世代/绑定）会把一次回写**丢掉**，而图本身**已经解码进
   * `#imgCache`** ⇒ 该槽就永久处于"绑定已知、纹理没有"的状态，`resolve()` 每帧回落到占位块，
   * 只能靠脚本**再发一次同一条 `set-texture`**（= 用户实测的"开合侧边栏才对"）才自愈。
   * 引擎不会：它的 `set-texture` 是同步的（`sub_422CB0`），同一帧里绑定与纹理同时成立。
   *
   * ★**为什么这样补不违反那条判据**：判据要保护的是"脚本后来画的表面"（`create-texture` 的
   * 程序化表面）—— 这里先排除有画布的槽；而**改绑**的情形用的是**当前**绑定（不是被丢弃的那张图），
   * 与 `bind` 命中缓存时的行为逐字相同。⇒ 只是把"下次绑定即命中"提前到"下次读取即命中"。
   */
  #healSlot(slot: number): Texture | undefined {
    const have = this.slotTex.get(slot);
    if (have) return have;
    if (this.#canvasSlots.has(slot)) return undefined; // 程序化表面：文件图像不该占它
    const imgid = this.#slotImgid.get(slot);
    if (imgid === undefined) return undefined;
    const tex = this.#imgCache.get(imgid);
    if (!tex) return undefined;
    this.slotTex.set(slot, tex);
    this.log(`slotTex 自愈 slot=${slot} ← imgid 0x${imgid.toString(16)}（回写曾被丢弃，图已在缓存）`);
    return tex;
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
    const tex = this.#healSlot(slot);
    if (tex) return { w: tex.source.width, h: tex.source.height };
    // ★create-texture 建过面、但本宿主没有画布（Node/E2E 里的 `TextureCache`）⇒ 用引擎字段本身兜底
    //   （`CTexture+1040/+1044`，`0x208` 读的就是它；raw 119786-119795）。
    const srf = this.#surfaceSize.get(slot);
    if (srf) return { w: srf.w, h: srf.h };
    const imgid = this.#slotImgid.get(slot);
    if (imgid !== undefined) void this.preloadImage(imgid); // 首次查询触发载入
    this.log(
      `getTextureSize slot=${slot} → 0x0（纹理尚未载入${
        imgid === undefined ? '；该槽未绑定' : `，imgid=0x${imgid.toString(16)}`
      }）`,
    );
    return { w: 0, h: 0 };
  }

  /**
   * **读一个纹理槽的像素**（`0x1AE` 写 `.STH` 缩略图；`tickets/T-0036`）。
   *
   * 引擎把该槽的 surface 写成 BMP（`sub_43BF20` raw 47838）；只有 `create-texture` 出来的槽在宿主侧
   * 是 canvas（见 `create`）⇒ 只有它们能读回像素。返回的 `rgba` 是**顶行在前**（BMP 的自底向上
   * 由 `vm/bmp.ts` 负责翻转），并已按物理像素（DPR）取值 ⇒ 尺寸就是 `cs.w/h` 的逻辑尺寸。
   */
  getSlotPixels(slot: number): { w: number; h: number; rgba: Uint8Array } | null {
    const cs = this.#canvasSlots.get(slot);
    if (!cs) return null;
    const ctx = cs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const img = ctx.getImageData(0, 0, cs.canvas.width, cs.canvas.height);
    // 画布是物理像素（逻辑 × res）；这里按逻辑尺寸**逐点取样**（DPR=1 时就是原样），
    // 保证写出的 BMP 尺寸 = 脚本 `create-texture` 给的那对（引擎的 surface 尺寸同口径）。
    const w = cs.w;
    const h = cs.h;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(cs.canvas.height - 1, Math.floor(y * cs.res));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(cs.canvas.width - 1, Math.floor(x * cs.res));
        const s = (sy * cs.canvas.width + sx) * 4;
        const d = (y * w + x) * 4;
        out[d] = img.data[s]!;
        out[d + 1] = img.data[s + 1]!;
        out[d + 2] = img.data[s + 2]!;
        out[d + 3] = img.data[s + 3]!;
      }
    }
    return { w, h, rgba: out };
  }

  /**
   * **槽 → 槽转送**（`0x207` 同尺寸 StretchRect / `0x32` 缩放 StretchTexture）。
   *
   * 两个槽都必须是 `create-texture` 出来的画布槽（引擎口径：surface 不存在就报错、不转送），
   * 矩形经 `clampScaledBlit` 按各自 surface 的边界夹取（`[0,0,w,h]`），再 `drawImage` 缩放。
   * ★缩放用**平滑插值**：引擎这条路径是"取源矩形 → 缩放画进目标 surface"（`sub_4A7990` +
   * `sub_4A42C0`，raw 128125-128127），而引擎设的采样器是 `D3DSAMP_MINFILTER=LINEAR`
   * （raw 93927 的 `SetSamplerState(0, 5, 2)`）⇒ 不是 point。
   * @returns 是否真的转了像素（任一槽没有画布 ⇒ false）
   */
  blitSlotToSlot(srcSlot: number, dstSlot: number, srcRect: number[], dstRect: number[]): boolean {
    const srcCs = this.#canvasSlots.get(srcSlot);
    const dstCs = this.#canvasSlots.get(dstSlot);
    if (!srcCs || !dstCs) {
      // 引擎 `sub_4A87A0` raw 127987-128003：分别打「コピー元/コピー先テクスチャが作成されていません」
      this.log(
        `blitSlotToSlot ${srcSlot}→${dstSlot} 被忽略：` +
          (srcCs ? '' : `源槽 ${srcSlot} 没有表面（コピー元テクスチャが作成されていません）`) +
          (!srcCs && !dstCs ? '；' : '') +
          (dstCs ? '' : `目标槽 ${dstSlot} 没有表面（コピー先テクスチャが作成されていません）`),
      );
      return false;
    }
    const sx = srcRect[0] ?? 0;
    const sy = srcRect[1] ?? 0;
    const dx = dstRect[0] ?? 0;
    const dy = dstRect[1] ?? 0;
    const raw = { src: [sx, sy, srcRect[2] ?? sx, srcRect[3] ?? sy], dst: [dx, dy, dstRect[2] ?? dx, dstRect[3] ?? dy] };
    const c = clampScaledBlit([0, 0, srcCs.w, srcCs.h], [0, 0, dstCs.w, dstCs.h], raw.src as [number, number, number, number], raw.dst as [number, number, number, number]);
    if (!c) {
      this.log(`blitSlotToSlot ${srcSlot}→${dstSlot} 被忽略：矩形退化 src=[${raw.src}] dst=[${raw.dst}]`);
      return false;
    }
    const ctx = dstCs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    // 画布是物理像素（逻辑 × res）⇒ 用 1:1 变换、各边自己乘 res（源与目标的 res 可能不同）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      srcCs.canvas,
      c.src[0] * srcCs.res,
      c.src[1] * srcCs.res,
      (c.src[2] - c.src[0]) * srcCs.res,
      (c.src[3] - c.src[1]) * srcCs.res,
      c.dst[0] * dstCs.res,
      c.dst[1] * dstCs.res,
      (c.dst[2] - c.dst[0]) * dstCs.res,
      (c.dst[3] - c.dst[1]) * dstCs.res,
    );
    dstCs.tex.source.update();
    const clipped = c.src.join() !== raw.src.join() || c.dst.join() !== raw.dst.join();
    this.log(
      `blitSlotToSlot ${srcSlot}→${dstSlot} src=(${c.src.join(',')}) dst=(${c.dst.join(',')})` +
        (clipped ? '（被 surface 边界夹取）' : ''),
    );
    return true;
  }

  /**
   * **把像素写进一个纹理槽**（`0x1AF` 读 `.STH` 缩略图；`tickets/T-0036`）。
   * 只对 `create-texture` 出来的槽生效（引擎那条链也是"该槽的 surface"）；槽不存在就忽略。
   *
   * @returns **像素是否真的落地**（`tickets/T-0175` 的 ⑤ 前半，出处 `T-0159` §4.3）：
   *   `false` = 该槽没有 `create-texture` 出来的表面 —— 引擎在同情形下 `sub_40BF20`/`sub_49E9D0`
   *   已经失败 ⇒ `0x1AF` 写 `op1 = 2`。修前本方法返回 `void`、调用方**无条件**写 `op1 = 0`
   *   ⇒「脚本拿到成功、画面却空」（P3 `missing-consumer`）。
   */
  setSlotPixels(slot: number, w: number, h: number, rgba: Uint8Array): boolean {
    const cs = this.#canvasSlots.get(slot);
    if (!cs) {
      this.log(`setSlotPixels slot=${slot} 被忽略：该槽没有 create-texture 出来的表面（引擎同口径）`);
      return false;
    }
    const ctx = cs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
    // 物理像素铺满（DPR 缩放由画布自身的 resolution 承担，与 create-texture/draw-string 同口径）
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d', { willReadFrequently: true })?.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cs.canvas.width, cs.canvas.height);
    ctx.imageSmoothingEnabled = false; // 缩略图按原尺寸铺（不放大、不插值）
    ctx.drawImage(tmp, 0, 0, w, h, 0, 0, cs.canvas.width, cs.canvas.height);
    cs.tex.source.update();
    this.log(`setSlotPixels slot=${slot} ${w}x${h}（.STH 缩略图 → 纹理槽）`);
    return true;
  }

  /**
   * **把宿主合成的整帧写进某个纹理槽** —— `0x20D`（设渲染目标）+ `0x20C`（帧刷新）那条链
   * （`tickets/T-0061`；脚本用它做存档缩略图：`create-texture 2 500 2d0 2` → `i20d 2` → `i20e` → `i20c`
   * → `i20d -1` → `create-texture e 140 b4 2` → `i032 2 e …` → `i1ae … e`）。
   *
   * 引擎侧：`i20d` 把渲染目标切到该槽的 surface，`i20c`（`sub_4B4040` 帧刷新）就把**这一帧的场景**
   * 画进那个 surface；emulator 的绘制是"按保留模型每帧重新合成"⇒ 等价物就是"合成一次、把结果拷进该槽的画布"。
   * 与 `setSlotPixels` 同口径：只对 `create-texture` 出来的槽生效；物理像素由目标画布自身的 resolution 承担。
   */
  captureCanvasIntoSlot(slot: number, src: CanvasImageSource, srcW: number, srcH: number): boolean {
    const cs = this.#canvasSlots.get(slot);
    if (!cs) {
      this.log(`captureCanvasIntoSlot slot=${slot} 被忽略：该槽没有 create-texture 出来的表面`);
      return false;
    }
    const ctx = cs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cs.canvas.width, cs.canvas.height);
    ctx.imageSmoothingEnabled = true; // 引擎这条路径的采样器是 LINEAR（见 blitSlotToSlot 的说明）
    ctx.drawImage(src, 0, 0, Math.max(1, srcW), Math.max(1, srcH), 0, 0, cs.canvas.width, cs.canvas.height);
    cs.tex.source.update();
    this.log(`captureCanvasIntoSlot slot=${slot} ← 合成帧 ${srcW}x${srcH} → ${cs.canvas.width}x${cs.canvas.height}`);
    return true;
  }

  /**
   * **把一段 2D 合成画进某个程序化槽的表面**（转场用；`tickets/T-0084`）。
   *
   * 为什么需要它：引擎的转场消费端 `sub_4B06D0` 是**先 `sub_4A50C0(Scene, [4])` 把渲染目标切到
   * 记录 `[4]` 指定的那一层、`Clear` 它，再把条带/淡入淡出画进去**（raw 136174 / 134937 / 135824）；
   * 语料里那一层就是脚本自己 `create-texture` 出来的 1280×720 槽，随后由引用它的绘制项呈现
   * （`src/SC0000.txt:1337-1339`：`create-texture (global-int 3f5f) 500 2d0 1` →
   * `draw-texture … (global-int 3f5f) …` → `i251 … (global-int 3f5f) …`）。
   * 所以 emulator 的等价物 = **把合成结果画进那个槽的画布**（而不是画在屏幕上）。
   *
   * 坐标口径与 `drawString` 一致：回调拿到的是**逻辑像素**上下文（物理 DPR 已折进 `setTransform`），
   * `w`/`h` 是该槽的逻辑尺寸。画完 `source.update()` ⇒ 引用该槽的绘制项下一帧就是新内容。
   *
   * @returns 该槽没有 `create-texture` 出来的表面 ⇒ `false`（引擎那条链也是"surface 不存在就报错"）
   */
  composeIntoSlot(
    slot: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): boolean {
    const cs = this.#canvasSlots.get(slot);
    if (!cs) {
      this.log(`composeIntoSlot slot=${slot} 被忽略：该槽没有 create-texture 出来的表面`);
      return false;
    }
    const ctx = cs.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.setTransform(cs.res, 0, 0, cs.res, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true; // 引擎这条路径的采样器是 LINEAR（见 blitSlotToSlot）
    draw(ctx, cs.w, cs.h);
    // 复位（画布是复用的，别把状态留给下一位）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    cs.tex.source.update();
    return true;
  }

  /**
   * `0x259`（`sub_41A3A0`）：**槽记录标志位的整表复位**——引擎清的是主/影两张 1000×2 组 5 dword
   * 记录表里**按槽设置的那两位标志**（`Scene/0x750` = `Engine+324704`、`Scene/0x754` = `+324708`，
   * 正是 `0x258` 写入的位），**imgid 与槽对象都不动**（`tickets/T-0102` 的逐位复核）。
   *
   * ★**为什么这里什么都不清（特别是不能清 `#slotImgid`）**：
   * 引擎那张记录表的 `[0]` = 该槽绑定的统一文件 id（`Scene/0x748`，`0x1F9` 写），
   * `0x259` **不碰它**（循环只写 `+8`/`+12`）⇒ 引擎里 `0x259` 之后 `draw-texture` 照样贴得出图。
   * 而 emulator 的 `resolve()` 与 `#healSlot()` **都**靠 `#slotImgid` 把槽号翻成图像
   * ⇒ 之前把 `#slotImgid` 清掉等于**同时掐断两条取纹理的路**，表现为 `presenter.#placeholder`
   * （1×1 `Texture.WHITE` 拉伸到源矩形）接管画面 —— 用户实测的"ADV 窗口白底"
   * （`tickets/T-0102`：现场日志里 `clearSlotRecords` 之后整个日志再无 `bindTexture … slot=17`，
   * 且 `slotTex 自愈` 0 条）。标志位那半边改由 VM handler 清 `Engine.texSlotFlags`。
   *
   * 引擎里"清记录、不 delete 对象"的语义由此保持：纹理对象/画布（`slotTex`/`#canvasSlots`）
   * 与本条 `槽 → imgid` 登记**一起**留存，`resolve()`/`size()` 照常工作。
   */
  clearSlotRecords(): number {
    // ★不再 `this.#slotImgid.clear()`（见上）。保留条数只用于日志诊断。
    const n = this.#slotImgid.size;
    this.log(`clearSlotRecords：保留 ${n} 条 槽→imgid 记录（只复位标志位；保留纹理对象/画布）`);
    return n;
  }

  /**
   * `0x1FA` release-texture：解除该槽的纹理（程序化表面一并释放）。
   *
   * ★引擎体分两段（`0x1FA` = `sub_422E00` raw 31245-31268）：
   * ```c
   * v3 = _this[op1 + 94672];                 // ① 该槽的 movie 对象（`0x20F`/`0x236` 建的那张表）
   * if ( v3 ) { sub_488FB0(v3); (**v4)(v4, 1); _this[op1 + 94672] = 0; }
   * sub_49E980(_this + 80708, op1);          // ② 表面/槽记录，体 raw 119586-119603：
   * //   if ( !_this[a2 + 11676] ) {           //   ★外层门（VM 侧那条 finding）
   * //     _this[5 * a2 + 466] = -1;           //   ★槽→imgid 记录写 −1（`0x216` 读的就是这一格）
   * //     v4 = _this[a2 + 10614];             //   CTexture 表面
   * //     if ( v4 ) { (**v4)(v4, 1); _this[a2 + 10614] = 0; }   // 析构
   * //   }
   * ```
   * ⇒ 释放之后 `0x208` 必答 `0×0`（表项为 0，`sub_49ED60` raw 119786-119795）。
   * 本实现的对应物：`slotTex` / 画布 / **`#slotImgid`（槽记录）** / 表面尺寸 / 类与子纹理 / 槽对象
   * **全部**撤掉。★旧实现只删 `slotTex` 与画布而**保留 `#slotImgid`**，于是 `size()` 会走
   * `#healSlot` 用旧 imgid 自愈出**旧尺寸**（`T-0153` 的 `0x1FA` 条目：与引擎相反）。
   */
  release(slot: number): void {
    this.#bumpEpoch(slot); // ★表面被释放 ⇒ 更早发起的异步载入不得再回写（见 #bumpEpoch）
    this.slotTex.delete(slot);
    this.#slotImgid.delete(slot); // ★`Scene[5*slot+466] = -1`（raw 119594）
    this.#surfaceSize.delete(slot);
    this.#slotClass.delete(slot);
    this.#slotTiles.delete(slot);
    this.#slotNodes.delete(slot); // 该槽 movie 对象一并析构（raw 31245-31269）
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
    // ★走 `#healSlot`（`tickets/T-0102` 的 H3）：把"绑定已知 + 图已在缓存"的那一类**当帧**补上，
    //   否则它会一直回落到占位块，直到脚本再发一次同一条 `set-texture`（用户实测的"开合侧边栏才对"）。
    const tex = this.#healSlot(slot);
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

/**
 * 一张纹理的源有多少像素（**诊断用**，`stats()` 里累加）。
 *
 * ★为什么要走鸭子类型而不是 `tex.source.width`：Pixi v8 的源类型不止一种
 *   （`ImageSource` = `ImageBitmap`、`CanvasSource` = `HTMLCanvasElement`、
 *   `BufferImageSource` = `{width,height,data}`）。只读 `width/height` 对三者都成立，
 *   但**必须防 `undefined`** —— 报一个 NaN 进合计会让整份诊断失去意义（宁可为 0）。
 */
function sourcePixels(tex: Texture): number {
  const s = tex.source as unknown as { width?: number; height?: number };
  const w = typeof s.width === 'number' && Number.isFinite(s.width) ? s.width : 0;
  const h = typeof s.height === 'number' && Number.isFinite(s.height) ? s.height : 0;
  return Math.max(0, w * h);
}


