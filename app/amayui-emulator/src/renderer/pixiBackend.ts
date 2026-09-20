/**
 * PixiJS v8 渲染后端（Plan A：引擎式「配置对象 + 每帧 present 合成」）。
 *
 * ## 架构
 *  - 指令只**配置对象**（draw-item / mesh / 纹理槽 / 颜色），写进持久场景模型 `SceneState`；
 *  - 渲染帧循环每帧调用 `present()`，对**整个场景图**合成到 backbuffer——动画在此逐帧求值，
 *    与 VM 指令解耦；
 *  - 动画槽两套、正交：
 *      · 背景(2a) = mesh#1/mesh#2 的 **vertex color**（CalcDiffuse，黑覆盖层 alpha）；
 *      · 文字(2b) = draw-item 的 **diffuse alpha**（`+96` from → `+100` to，只插 alpha）。
 *  - **严格 flag**：配置/渲染读 flags 时，未知位立刻抛 `UnknownFlagError`（绝不静默忽略）。
 *
 * ## 本类只做"接线"
 * 具体职责已拆到 `./pixi/`：
 *  | 模块 | 职责 |
 *  |---|---|
 *  | `pixi/appSetup.ts`    | Application / 舞台 / drawRoot 的建立 |
 *  | `pixi/inputAttach.ts` | DOM 鼠标·滚轮 → InputManager |
 *  | `pixi/textureCache.ts`| 槽 → imgid → Texture 三层映射与解析 |
 *  | `pixi/presenter.ts`   | 每帧合成（draw-item + mesh 覆盖层） |
 *
 * 场景语义（建/删项、5 个窗、"缺失即建项"、bit0 门控）全部在 `sceneModel.ts`，
 * 与 `HeadlessScene` 共用同一份 —— 本类**不自己实现任何场景规则**。
 */
import type { Application, Container, ContainerChild, Texture } from 'pixi.js';
import { Rectangle, Sprite, Texture as PixiTexture } from 'pixi.js';
import { assertFlags, type DrawItemLoopRequest, type DrawStringStyle, type MeshCreateSpec, type NativeBridge } from '../vm/native.js';
import type { InputManager } from '../vm/input.js';
import { AudioEngine, type AudioDebugState, type AudioIntent } from '../audio/audioEngine.js';
import { WebAudioHost } from './audio/webAudioHost.js';
import { advanceWindows, calcDiffuse, itemColor, itemRotationRad, itemScale, itemSrcRect, itemTranslation, meshColor, type DrawItemConfig, type Item, type MeshObj, type Vec3 } from './drawItem.js';
import {
  newSceneState,
  scAdvance,
  scL2dTick,
  scTransitionTick,
  scTransitionsPending,
  scActiveTransitions,
  scTransitionBands,
  scTransitionTargetRect,
  scTransitionBlurPlan,
  scTransitionBlurOffsets,
  TRANSITION_BLUR_CENTER_WEIGHT,
  scPoolPending,
  sceneNeedsRender,
  scClearDrawContainer,
  scClearMeshSlots,
  scDropFrameItems,
  scSnapshotPresent,
  scRestorePresent,
  type PresentSnapshot,
  scMsgWinClear,
  scMsgWinClearAll,
  scMsgWinSync,
  scConfigureDrawItem,
  scGetDrawItemPos,
  scGetDrawItemTranslation,
  scGetDrawItemPivot,
  scGetDrawItemTexSlot,
  scCreateMesh,
  scDetachTexture,
  scDrawCgNumber,
  scDrawString,
  scCreateTextureReset,
  scSetDrawColor,
  scSetDrawColorAlpha,
  scCopyItem,
  scSwapItems,
  scSetDrawPivot,
  scSetDrawPos,
  scSetDrawTranslation,
  scSetSceneScale,
  scSetSceneTranslation,
  scSetSceneAxisScale,
  scSetSceneAxisTranslation,
  scSetFlipbook,
  scSetRotationAnim,
  scSetScale,
  scSetScaleAnim,
  scSetTranslationAnim,
  // B 层（bit2）周期/循环动画（2026-09，B3）：0x230–0x235 + 0x244
  scResetDrawItemLoop,
  scSetFlipbookLoop,
  scSetColorLoop,
  scSetScaleLoop,
  scSetRotationLoop,
  scSetTranslationLoop,
  scClearDrawItemAnimStarts,
  scSetVertexColor,
  scSetVertexColorAlpha,
  // A4 族（2026-09）：图元/网格/纹理/渲染状态
  scResetPrimTransform,
  scSetPrimTransform4,
  scBlitSlotToSlot,
  scCommitGraphics,
  scClearTransitions,
  scSetTransition,
  scSetDrawModeBlock,
  scSetDrawEntryParam,
  scSetRenderTarget,
  scSetSlotMode,
  scSetSceneBlend,
  scSetSlotParams,
  scSetMeshEntryAttr,
  scRelease3DSlot,
  scSet3DColor,
  type SceneState,
} from './sceneModel.js';
import type { L2dHost } from '../live2d/runtime.js';
import { setupPixiStage } from './pixi/appSetup.js';
import { attachMouseInput } from './pixi/inputAttach.js';
import { ScenePresenter } from './pixi/presenter.js';
import { L2dTextureStore, type L2dByteSource } from './pixi/l2dTextures.js';
import { TextLayer } from './pixi/textLayer.js';
import type { MsgWinInput } from '../text/layout.js';
import { fontFailures } from './text/fontLoader.js';
import { TextureCache } from './pixi/textureCache.js';
import { VIEW_H, VIEW_W } from './viewport.js';
import type { RenderStatus } from './renderStatus.js';

/**
 * 留帧上限（帧数）。★2026-09 用户实测"配置界面在进 SN0000 前仍闪一下"后加强：
 * 8 → 60 帧（≈1 秒），并**改掉"清容器即解除"**（见 `clearDrawContainer`）——
 * 引擎的 backbuffer 从不清屏，屏上留的就是上一帧，只有**真的画了新东西**才该换帧。
 */
const HOLD_MAX_FRAMES = 60;
/** 字格图标（▼）的层序：引擎把它直接 blit 到屏幕面 ⇒ 画在最上层。 */
const CELL_LAYER = 10_000_000; // 必须大于任何 layer/handle 键（语料里最大约 0x29bf8 = 171000）

export type { Item, MeshObj, Vec3 };
/** `RenderStatus` 由 `./renderStatus.ts` 拥有（入口与后端共用）；此处再导出以保持既有 import 路径可用。 */
export type { RenderStatus } from './renderStatus.js';

export class PixiBackend implements NativeBridge {
  private app: Application;
  private stage: Container<ContainerChild>;
  private drawRoot: Container<ContainerChild>;
  private status: RenderStatus;
  private unit: Texture;
  /** 音频宿主（Web Audio）+ 音频引擎（通道/音量/pan/延迟/语音仲裁的逻辑全在引擎里）。 */
  private audioHost!: WebAudioHost;
  private audioEngine!: AudioEngine;  /** 共享输入状态（renderer 写 / VM 读）。由 create 注入。 */
  input?: InputManager;

  /** 纹理槽表（槽 → imgid → Texture）。 */
  private readonly textures: TextureCache;
  /** 每帧合成器（Pixi 对象在 `create()` 里就绪后装配）。 */
  private presenter!: ScenePresenter;
  /** 消息窗文本图层（每窗一张光栅化纹理；层序 20+win）。 */
  private textLayer!: TextLayer;

  /**
   * **Live2D 纹理库**（统一文件 id → Pixi 纹理；`tickets/T-0054`）。
   *
   * 与 `textures`（引擎纹理槽）分开：L2D 的纹理是**普通 PNG** 且绑定关系是
   * "模型内纹理号 → 文件 id"，既不过 AGF 解码也不占引擎槽号（见 `pixi/l2dTextures.ts`）。
   */
  #l2dTextures!: L2dTextureStore;
  /**
   * 纹理库的字节来源（`Engine.fileSource`；在 `attachL2dHost` 里接上）。
   * 用"延迟解析"的闭包包一层，是因为纹理库要在 `create()` 里就装进 presenter，
   * 而 `Engine` 要到之后才建好（装配顺序见 `renderer/app/session.ts`）。
   */
  #l2dByteSource: L2dByteSource | null = null;

  /**
   * **场景模型**（与 `HeadlessScene` 共用 `sceneModel.ts` 的同一份语义）：
   * 建/删项、5 个窗、"缺失即建项"、bit0 门控都在那边实现，本类只负责画到 Pixi。
   * 这样"报告说对、画面不对"这类最难查的漂移就不可能发生。
   */
  private scene: SceneState = newSceneState();

  /**
   * **挂上 Live2D 运行态宿主**（`Engine`；`tickets/T-0054`）。
   *
   * 为什么是方法而不是 public 字段：`scene` 是 private（本类唯一的场景模型），而 L2D 的三张表
   * 挂在 `Engine` 上（VM 层，两个宿主共享唯一一份）⇒ 需要一条"把 Engine 交给场景"的窄缝。
   * 调用时机：`Engine` 建好之后立即（同 `e.fileSource = src` 那一步）。
   *
   * ★同时把 `Engine.fileSource` 接成**纹理字节来源**：没有它，L2D 的纹理 PNG 解不出来
   * （几何照算、快照照报，但屏幕上一片不画 —— 与"槽空"症状相同）。旧宿主/测试不提供
   * `fileSource` 时保持 `null`，语义 = "该宿主不支持按 id 直读资源"（`FileSource.readById` 的口径）。
   */
  attachL2dHost(host: L2dHost): void {
    this.scene.l2dHost = host;
    const fs = host.fileSource;
    this.#l2dByteSource = fs?.readById ? { readById: (id) => fs.readById!(id) } : null;
  }

  /**
   * 渲染/模型时钟（ms，引擎 `this[46500]` 的等价物）。
   * ★2026-09（`tickets/T-0008` 的 D1）：**由调用方按 Engine 的 `nowMs` 传入**（`present(nowMs)` /
   * `advanceModel(nowMs)`）—— 修前这里是"`performance.now() - wallStart`"这样一个**独立时间域**，
   * 与 `Engine.nowMs`（绝对墙钟）不同源 ⇒ "同一脚本同一时刻"在两侧不可比。
   */
  private clockMs = 0;
  /** 旧路径的墙钟起点：仅在调用方**不给** `nowMs` 时用作兜底（保留以免外部调用点全改）。 */
  private wallStart = 0;
  private frameStarted = false;
  /** 场景"脏"= 本次有配置类 op 改动过场景（引擎：present 须由脏标记 + 0x400 门控驱动）。 */
  private sceneDirty = false;
  /**
   * 本帧的时钟是否已由**驱动**注入（`advanceModel(nowMs)`）。
   * ★`tickets/T-0004` 的 B4：驱动每帧末先 `advanceModel` 再 `present` ⇒ `present()` 不能再自己算一份
   * 时钟（那就是修前那个"两个时间域"）。只有在**没人注入**时（旧调用点/测试）才退回 `performance.now()`。
   */
  #clockInjected = false;
  /** 本帧 `scL2dTick` 判定"真的要画"的 Live2D 节点 key（诊断用；绘制侧据此只画这些节点）。 */
  #l2dDrawnKeys: number[] = [];
  /** 纹理帧屏障真实等待过的次数（进 `FrameDigest.host` 段；不参与两宿主比较）。 */
  #barriers = 0;
  /** 收到的音频意图条数（含每帧 `tick`）。 */
  #audioIntents = 0;
  /** 本帧 `0x208`（纹理尺寸）的答案（`--record` 录进轨迹；见 `drainTextureSizeLog`）。 */
  #texSizeLog: { slot: number; w: number; h: number }[] = [];
  /** 撤幕留帧的剩余帧数（见 `#holdFrameAfterCurtainDrop`）。 */
  #holdFrames = 0;
  /** 字格图标 Sprite 缓存（每窗一条；换格时只换 texture 的 frame）。 */
  #cellSpritesCache = new Map<number, { sprite: Sprite; texture: Texture; k: number; src: number }>();
  /** 已经记过"源矩形被裁空"日志的窗（避免每帧刷屏）。 */
  #cellClippedWarned = new Set<number>();
  /**
   * **转场用的「旧帧」快照**（`tickets/T-0084`）：窗口开启那一帧的**合成结果**，
   * 对应引擎的两个屏幕层里的 `Scene+42600`（旧）/ `Scene+42604`（新），
   * 由消费端 `sub_4B06D0` 当作 scratch 层 36/37 的源（raw 136251 / 136259 / 134974 / 134983）。
   *
   * 生命周期 = 一次转场窗：`advanceModel` 里发现"有活动转场"且还没有快照时抓一帧；
   * 转场表被清空（= 窗结束）时释放。抓取点是**本帧 `present` 之前**，所以拿到的正是上一帧的合成结果。
   */
  #transOld: HTMLCanvasElement | null = null;

  static async create(
    status: RenderStatus,
    input?: InputManager,
    width = VIEW_W,
    height = VIEW_H,
    displayWidth = VIEW_W,
    displayHeight = VIEW_H,
  ): Promise<PixiBackend> {
    const b = new PixiBackend(status);
    b.input = input;
    const stage = await setupPixiStage(width, height, displayWidth, displayHeight);
    b.app = stage.app;
    b.stage = stage.stage;
    b.drawRoot = stage.drawRoot;
    b.unit = stage.unit;
    // L2D 纹理库（延迟解析字节来源：`Engine` 还没建，见 `#l2dByteSource` 的说明）。
    // ★`onReady` 里 `#markDirty()`：纹理是异步到的，到货那一刻必须让下一帧重新合成，
    //   否则"装载完成"这件事永远不会变成画面（表现为立绘晚很久才出现或永不出现）。
    b.#l2dTextures = new L2dTextureStore(
      { readById: (id) => b.#l2dByteSource?.readById(id) ?? Promise.resolve(null) },
      (m) => b.#pushLog(m),
      () => b.#markDirty(),
    );
    b.presenter = new ScenePresenter(b.drawRoot, b.textures, b.unit, (m) => b.#pushLog(m), width, height, b.#l2dTextures);
    installD3DBlendModes(stage.app);
    // 内置字族按需加载（TextLayer 在光栅化前调 ensureFont）；加载完成会 bump
    // fontVersion()，TextLayer 据此重画一次用 fallback 画出来的文本。
    b.textLayer = new TextLayer((m) => b.#pushLog(m));
    // 音频：宿主 = Web Audio（取字节走 IPC / `amayui-audio://` 流式），引擎 = 引擎侧通道模型
    b.audioHost = new WebAudioHost({ log: (m) => b.#pushLog(m) });
    b.audioEngine = new AudioEngine(b.audioHost, { log: (m) => b.#pushLog(m) });
    attachMouseInput(b.app.canvas, input, (line) => b.status.trace.push(line));
    return b;
  }

  private constructor(status: RenderStatus) {
    this.status = status;
    this.app = null as unknown as Application;
    this.stage = null as unknown as Container<ContainerChild>;
    this.drawRoot = null as unknown as Container<ContainerChild>;
    this.unit = null as unknown as Texture;
    this.textures = new TextureCache((m) => this.#pushLog(m));
  }

  #pushLog(msg: string): void {
    this.status.log.push(msg);
    if (this.status.log.length > 8) this.status.log.shift();
    this.status.trace.push(msg);
  }

  // ---- 纹理 ---- //

  /** 预载一张图像（启动期固定预载清单走它；幂等）。 */
  preloadImage(imgid: number): Promise<void> {
    return this.textures.preloadImage(imgid);
  }

  // ---- NativeBridge：日志/音频（供 VM 用） ---- //

  log(msg: string): void {
    this.#pushLog(msg);
  }

  /**
   * **音频意图**（`NativeBridge.audio`）：`0xB4`/`0xB5`/`0xB6`/`0xBA`/`0xB7`/`0xB9`/`0xBB`/`0xBC`/`0xBF`/
   * `0xC2`/`0xC4`/`0xC6`/`0x1BD`/`0x2BF`/`0x2C0`/`0x2F4`..`0x302` 与每帧 `tick` 都落到这里。
   * 语义/证据见 `docs-new/03-engine/sound-system.md`；实现见 `src/audio/audioEngine.ts`。
   */
  audio(intent: AudioIntent): void {
    this.#audioIntents++;
    this.audioEngine.handle(intent);
  }

  /** 音频诊断快照（控制窗/人工排查：通道占用、音量、缓存命中、流式回退次数）。 */
  debugAudio(): AudioDebugState & { host: ReturnType<WebAudioHost['info']> } {
    return { ...this.audioEngine.debug(), host: this.audioHost.info() };
  }
  playSound(id: number, volume: number): void {
    this.#pushLog(`sound#${id} vol=${volume}`);
  }
  playBgm(id: number): void {
    this.#pushLog(`bgm#${id}`);
  }
  playVoice(id: number): void {
    this.#pushLog(`voice#${id}`);
  }
  setFont(args: number[]): void {
    this.#pushLog(`setFont [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setString(s: string): void {
    this.#pushLog(`setString "${s}"`);
  }
  stringResourceId(s: string): number {
    this.#pushLog(`stringResourceId "${s}"`);
    return -1;
  }
  getInputType(): number {
    return 0;
  }
  sleep(_ms: number): void {
    /* renderer 内 no-op，帧循环自走 */
  }
  unhandled(opcode: number, name: string): void {
    this.#pushLog(`unhandled 0x${opcode.toString(16)} ${name}`);
  }

  // ---- 配置（指令 -> 场景图，Plan A） ---- //

  drawTexture(args: number[]): void {
    // raw：[tex, layer, srcX, srcY, srcW, srcH, dstX, dstY]
    const [tex = 0, layer = 0, x = 0, y = 0, w = 0, h = 0, p = 0, q = 0] = args;
    this.configureDrawItem({ handle: tex, layer, srcX: x, srcY: y, srcW: w, srcH: h, dstX: p, dstY: q, tex });
  }

  setTexture(args: number[]): void {
    // raw：[imgid, slot, color]
    const [imgid = 0, slot = 0] = args;
    this.bindTexture(imgid, slot);
  }

  configureDrawItem(cfg: DrawItemConfig): void {
    this.#markDirty();
    this.#releaseFrameHold('draw-texture');
    // 语义（建/覆盖 + 置 bit0 + 覆盖描画位置）在共享模型层；两侧（此处与 HeadlessScene）只有一份。
    const it = scConfigureDrawItem(this.scene, cfg);
    assertFlags('drawitem', it.handle, it.flags);
    this.#pushLog(`configureDrawItem h=0x${cfg.handle.toString(16)} layer=${cfg.layer} (${cfg.srcX},${cfg.srcY},${cfg.srcW}x${cfg.srcH})`);
  }

  bindTexture(imgid: number, slot: number): void {
    this.#markDirty();
    this.textures.bind(imgid, slot);
  }

  /**
   * **纹理帧屏障**（`NativeBridge.texturesIdle`）：等本帧新绑定的图像载入完成。
   * 引擎 `set-texture` 是同步读文件+解码，重写侧走 IPC 异步 ⇒ 不等就会"新文本压在旧背景上"。
   */
  async texturesIdle(): Promise<void> {
    // ★L2D 纹理也要等：它们在 `advanceModel` 里发起（见 `#ensureL2dTextures`），
    //   不等就会画出"几何有了、贴图还没到"的一帧（整块立绘看起来是空的）。
    const pendingL2d = this.#l2dTextures.pendingCount;
    if (this.textures.pendingCount === 0 && pendingL2d === 0) return;
    this.#barriers++;
    await Promise.all([this.textures.waitIdle(), this.#l2dTextures.waitIdle()]);
    this.#markDirty();
  }

  /** `0x320` create-mesh：建顶点几何 + 逐顶点基础色（`scCreateMesh` 会置 bit0=可画）。 */
  createMesh(spec: MeshCreateSpec): void {
    this.#markDirty();
    const m = scCreateMesh(this.scene, spec);
    // ★2026-09 修（用户实测："进 SN0000 时背景闪一下"）：新幕的**几何**建好时颜色还是 0（全透明，
    //   引擎里 `sub_4ADFE0` 建完 VB 后也不写色），颜色由紧随其后的 `0x322 set-vertex-color` 给。
    //   原先在这里就解除留帧 ⇒ 批边界若正好落在两条指令之间，就会呈现一帧"幕存在但还透明"的画面
    //   = 背景闪现。⇒ 只有**颜色已经可见**（alpha>0）才解除，否则继续留帧。
    this.#releaseFrameHoldIfVisible(`createMesh 0x${spec.handle.toString(16)}`, this.#meshVisible(m));
    assertFlags('mesh', m.handle, m.flags);
    const v = m.verts[0];
    this.#pushLog(
      `createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount} layer=${spec.layer}` +
        (v ? ` rect=(${v.x},${v.y})..(${m.verts[3]?.x ?? v.x},${m.verts[3]?.y ?? v.y}) base0=0x${(spec.baseColors[0] ?? 0).toString(16)}` : ' 无几何'),
    );
  }

  /** `0x1F8` create-texture：见 `TextureCache.create`（槽旧纹理失效后重取 / 新建空白表面）。 */
  /** `0x20D` 设置渲染目标（`tickets/T-0017`：混合选择子值 2 的门控依据）。 */
  setRenderTarget(slot: number): void {
    this.#markDirty();
    scSetRenderTarget(this.scene, slot);
    this.#pushLog(`setRenderTarget slot=${slot}${slot < 0 ? '（后台缓冲）' : ''}`);
  }

  /** `0x33F` op1 场景默认混合（`Scene+1260`）。 */
  setSceneBlend(blend: number): void {
    this.#markDirty();
    scSetSceneBlend(this.scene, blend);
    this.#pushLog(`setSceneBlend ${blend}`);
  }

  createTexture(slot: number, w: number, h: number, mode: number): void {
    this.#markDirty();
    this.textures.create(slot, w, h, mode);
    scSetSlotMode(this.scene, slot, mode); // ★纹理创建模式（`CTexture+1048`）：混合门控只认 mode 1
    scCreateTextureReset(this.scene, slot);
  }

  /** `0x204` draw-string：把整串文本直绘进该槽的表面（见 `TextureCache.drawString`）。 */
  drawString(slot: number, x: number, y: number, text: string, style: DrawStringStyle): void {
    this.#markDirty();
    scDrawString(this.scene, slot, x, y, text, style.fill); // 共享模型：报告/测试也能看到这串字
    this.textures.drawString(slot, x, y, text, style);
  }

  /** `0x1AE` 写 `.STH` 缩略图：读该槽画布的像素（`tickets/T-0036`）。 */
  getSlotPixels(slot: number): { w: number; h: number; rgba: Uint8Array } | null {
    return this.textures.getSlotPixels(slot);
  }

  /** `0x1AF` 读 `.STH` 缩略图：把像素铺进该槽画布（`tickets/T-0036`）。 */
  setSlotPixels(slot: number, w: number, h: number, rgba: Uint8Array): void {
    this.#markDirty();
    this.textures.setSlotPixels(slot, w, h, rgba);
  }

  /**
   * `0x1FD`（sub_422FD0 → `sub_4AC5F0`）：**立即缩放**（输入按 **100** 格除，`dbl_5201F0 = 100.0`）。
   * 走共享模型层 `scSetScale`（"缺失即建项"，引擎 `sub_4AAA50` 语义）。
   * ★这不是"记录式转发"：缺了它，靠缩放撑开的中段贴片会退回源尺寸（CONFIG1 滚动条拇指中段丢失）。
   */
  setScale(handle: number, sx: number, sy: number, sz: number): void {
    this.#markDirty();
    const o = scSetScale(this.scene, handle, sx, sy, sz);
    this.#assertItem(handle);
    this.#pushLog(`setScale h=0x${handle.toString(16)} (${sx},${sy},${sz})${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /**
   * `0x1FF`（sub_4230F0 → `sub_4AC750`）：**DrawItem 的像素平移**（立即生效、无动画窗）。
   * 引擎写 `+0x68 = 1`（用世界矩阵）与 `+0x16C`（平移 **work** 矩阵）。
   *
   * ★经共享模型层 `scSetDrawTranslation`（"缺失即建项"，引擎 `sub_4AAA50` 语义），
   * 不再自己 `get` 后"项不存在就丢弃"——那样会与 `HeadlessScene` 产生语义漂移。
   */
  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetDrawTranslation(this.scene, handle, x, y, z);
    this.#pushLog(`setDrawTranslation h=0x${handle.toString(16)} (${x},${y},${z})${o === 'applied' ? '' : ' [建空项]'}`);
  }

  // ---- ★Scene 级世界矩阵四条（`0x22A`/`0x22C`/`0x22D`/`0x22F`）----
  //   与 HeadlessScene 同一份共享语义；**真正的消费者在 `ScenePresenter.present()`**：
  //   归并循环里对 `layer ∈ [20,30)` 的项套用 `applySceneXformToPlacement`（= 引擎 RenderScene
  //   raw 133411-133438 那条「只装回 2D 缩放与平移」的支路）。

  /** `0x22A` Scene 级立即缩放（op1/2/3 各 ÷100；改的是 Scene 的变换块，不是某个 DrawItem）。 */
  setSceneScale(sx: number, sy: number, sz: number): void {
    this.#markDirty();
    scSetSceneScale(this.scene, sx, sy, sz);
    this.#pushLog(`setSceneScale (${sx},${sy},${sz}) [仅层 20..29]`);
  }

  /** `0x22C` Scene 级立即平移（像素，不除）。 */
  setSceneTranslation(x: number, y: number, z: number): void {
    this.#markDirty();
    scSetSceneTranslation(this.scene, x, y, z);
    this.#pushLog(`setSceneTranslation (${x},${y},${z}) [仅层 20..29]`);
  }

  /** `0x22D` Scene 级带轴缩放（op1/op2 = int → Scene[295]/[300]；op3/4/5 各 ÷100）。 */
  setSceneAxisScale(a: number, b: number, sx: number, sy: number, sz: number): void {
    this.#markDirty();
    scSetSceneAxisScale(this.scene, a, b, sx, sy, sz);
    this.#pushLog(`setSceneAxisScale a=${a} b=${b} s=(${sx},${sy},${sz}) [仅层 20..29]`);
  }

  /** `0x22F` Scene 级带轴平移（op1/op2 = int → Scene[297]/[302]；op3/4/5 不除）。 */
  setSceneAxisTranslation(a: number, b: number, x: number, y: number, z: number): void {
    this.#markDirty();
    scSetSceneAxisTranslation(this.scene, a, b, x, y, z);
    this.#pushLog(`setSceneAxisTranslation a=${a} b=${b} t=(${x},${y},${z}) [仅层 20..29]`);
  }

  // ---- A4 族（2026-09）：与 HeadlessScene 走同一份共享语义（`scXxx`），只额外标脏/记日志 ----

  /** `0x1FC` 复位图元变换。 */
  resetPrimTransform(handle: number): void {
    this.#markDirty();
    scResetPrimTransform(this.scene, handle);
    this.#pushLog(`resetPrimTransform h=0x${handle.toString(16)}`);
  }

  /** `0x1FE` 图元变换 4 浮点（**原样**，不除 100）。 */
  setPrimTransform4(handle: number, a: number, b: number, c: number, d: number): void {
    this.#markDirty();
    scSetPrimTransform4(this.scene, handle, a, b, c, d);
    this.#pushLog(`setPrimTransform4 h=0x${handle.toString(16)} (${a},${b},${c},${d})`);
  }

  /**
   * 槽→槽转送：`0x207`（同尺寸 StretchRect）/ `0x32`（`i032` 缩放 StretchTexture）。
   * 模型侧记一条（`scene.render4.blits`），像素由 `TextureCache` 在两张画布之间 `drawImage`（带夹取）。
   */
  blitSlotToSlot(srcSlot: number, dstSlot: number, srcRect: number[], dstRect: number[]): boolean {
    this.#markDirty();
    scBlitSlotToSlot(this.scene, srcSlot, dstSlot, srcRect, dstRect);
    const ok = this.textures.blitSlotToSlot(srcSlot, dstSlot, srcRect, dstRect);
    this.#pushLog(
      `blitSlotToSlot ${srcSlot}→${dstSlot} src=[${srcRect}] dst=[${dstRect}]${ok ? '' : '【未转送：槽没有表面】'}`,
    );
    return ok;
  }

  /** `0x20E` 图形提交（清 target+z；Pixi 每帧自绘 ⇒ 只记数）。 */
  commitGraphics(): void {
    scCommitGraphics(this.scene);
  }

  /** `0x224` 清转场表。 */
  clearTransitions(): void {
    scClearTransitions(this.scene);
  }

  /**
   * `0x24F`/`0x250`/`0x251` 转场记录逐格写入（引擎 `Scene+1048` 的 24 格记录）。
   * ★仅记进场景模型 + 置脏：扫描带绘制尚未接线（见 `handlers/gfx-state.ts` 的扩展点）。
   */
  setTransition(id: number, writes: ReadonlyArray<readonly [number, number]>): void {
    this.#markDirty();
    scSetTransition(this.scene, id, writes);
    this.#pushLog(`setTransition id=0x${id.toString(16)} writes=${JSON.stringify(writes)}`);
  }

  /** `0x229` 绘制模式 5 元组。 */
  setDrawModeBlock(a: number, b: number, x: number, y: number, z: number): void {
    scSetDrawModeBlock(this.scene, a, b, x, y, z);
  }

  /** `0x242` DrawItem `+720`。 */
  setDrawEntryParam(entry: number, value: number): void {
    scSetDrawEntryParam(this.scene, entry, value);
  }

  /** `0x256` **按 id 区间立即平移**（`sub_4ACD10`）：`[slot, slot+count)` 内已存在的项写 work+target 平移（`tickets/T-0028`）。 */
  setSlotParams(slot: number, count: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetSlotParams(this.scene, slot, count, x, y, z);
    this.#pushLog(
      `setSlotParams slot=0x${slot.toString(16)} count=0x${count.toString(16)} t=(${x},${y},${z})${o === 'applied' ? '' : ` [${o}]`}`,
    );
  }

  /** `0x321` MeshEntry 属性。 */
  setMeshEntryAttr(mesh: number, index: number, value: number): void {
    scSetMeshEntryAttr(this.scene, mesh, index, value);
  }

  /** `0x32A` 释放 3D 模型槽（同时从场景模型里删掉该 mesh）。 */
  release3DSlot(slot: number): void {
    this.#markDirty();
    scRelease3DSlot(this.scene, slot);
  }

  /** `0x32D` 3D 颜色（四分量 0..1）。 */
  set3DColor(r: number, g: number, b: number, a: number): void {
    scSet3DColor(this.scene, r, g, b, a);
  }

  /**
   * `0x208`：纹理尺寸 getter（写回脚本操作数由 opcode 侧负责）。
   *
   * ★每次调用都记进 `#texSizeLog`（`--record` 把它录进回放轨迹；见 `drainTextureSizeLog`）。
   * 为什么必须录：这个答案**依赖宿主的加载状态**（IPC 异步 ⇒ 图还没到就是 0×0），
   * 而脚本拿它算源矩形/描画位置 ⇒ 它直接改变**场景状态**。回放侧没有纹理，等于把"宿主给出的尺寸"
   * 当输入数据（与时钟、输入同类）。见 `tickets/T-0005/notes.md` 的"0x208 的答案算输入"。
   */
  getTextureSize(slot: number): { w: number; h: number } {
    const sz = this.textures.size(slot);
    this.#texSizeLog.push({ slot, w: sz.w, h: sz.h });
    return sz;
  }

  /** 取走本帧的 `0x208` 答案记录（录制用；取走即清空 ⇒ 一条记录只属于一帧）。 */
  drainTextureSizeLog(): { slot: number; w: number; h: number }[] {
    const out = this.#texSizeLog;
    this.#texSizeLog = [];
    return out;
  }

  /** `0x215`（sub_4ADC20）：绘制项 → 纹理槽号；项不存在或未创建（`flags&1==0`）⇒ −1。 */
  getDrawItemTexSlot(handle: number): number {
    return scGetDrawItemTexSlot(this.scene, handle);
  }

  /** `0x218`（sub_4ADCF0）：绘制项 pivot 三元组（项不存在 ⇒ 全 0）。 */
  getDrawItemPivot(handle: number): { x: number; y: number; z: number } {
    return scGetDrawItemPivot(this.scene, handle);
  }

  /** `0x21A`（sub_4ADC80）：绘制项描画位置三元组（项不存在 ⇒ 全 0）。 */
  getDrawItemPos(handle: number): { x: number; y: number; z: number } {
    return scGetDrawItemPos(this.scene, handle);
  }

  /** `0x228`（sub_4AA060）：绘制项当前**平移**三元组（`+0x16C` work 矩阵）；项不存在 ⇒ `undefined`（⇒ op1=1）。 */
  getDrawItemTranslation(handle: number): { x: number; y: number; z: number } | undefined {
    return scGetDrawItemTranslation(this.scene, handle);
  }

  /**
   * `0x23B`（sub_424970）：**按 CG 数字条画数值**。
   * 忠实复刻引擎几何（raw 32381-32503）：先按 `[id, id+digits)` 删 DrawItem/Mesh，再逐位建 DrawItem。
   * 记录 `rec`：`[0]` 纹理槽、`[1]` x0、`[2]` y0、`[3]` 单字宽、`[4]` 字高、`[5]` 字内空隙、`[6]` 字距。
   * 三种对齐（`flags`）：bit1 居中、bit2 左对齐，否则右对齐；bit0 = 补前导零。
   */
  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    const created = scDrawCgNumber(this.scene, id, rec, value, x, y, digits, flags);
    this.#pushLog(`drawCgNumber id=0x${id.toString(16)} value=${value} digits=${digits} flags=${flags} → 建 ${created} 项（槽 ${rec[0] ?? 0}）`);
  }

  /** `0x219`（sub_423BA0 → `sub_4ACEE0`）：写绘制项的**描画位置**（DrawItem`+36/+40/+44`）。 */
  setDrawPos(handle: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetDrawPos(this.scene, handle, x, y, z);
    this.#pushLog(`setDrawPos h=0x${handle.toString(16)} (${x},${y},${z})${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /** `0x217`（sub_423B20 → `sub_4ACF20`）：写**旋转/缩放中心 pivot**（DrawItem`+24/+28/+32`）。 */
  setDrawPivot(handle: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetDrawPivot(this.scene, handle, x, y, z);
    this.#pushLog(`setDrawPivot h=0x${handle.toString(16)} (${x},${y},${z})${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /** `0x21E`（sub_423CA0 → `sub_4AD170`）：**缩放动画窗（窗1）**，sx/sy/sz 已 ÷100。 */
  setScaleAnim(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void {
    this.#markDirty();
    const o = scSetScaleAnim(this.scene, handle, delay, dur, sx, sy, sz);
    this.#assertItem(handle);
    this.#pushLog(`setScaleAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} s=(${sx},${sy},${sz})${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /** `0x21F`（sub_423D40 → `sub_4AD250`）：**旋转动画窗（窗2）**（轴 + 角，度）。 */
  setRotationAnim(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void {
    this.#markDirty();
    const o = scSetRotationAnim(this.scene, handle, delay, dur, ax, ay, az, deg);
    this.#assertItem(handle);
    this.#pushLog(`setRotationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} axis=(${ax},${ay},${az}) θ=${deg}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /** `0x220`（sub_423DE0 → `sub_4AD3C0`）：**平移动画窗（窗3）**（不除，像素）。 */
  setTranslationAnim(handle: number, delay: number, dur: number, x: number, y: number, z: number): void {
    this.#markDirty();
    const o = scSetTranslationAnim(this.scene, handle, delay, dur, x, y, z);
    this.#assertItem(handle);
    this.#pushLog(`setTranslationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} t=(${x},${y},${z})${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /** `0x239`（sub_424900 → `sub_4AD4A0`）：**flipbook 窗（窗4）**（bit0 = 窗末保持末帧）。 */
  setFlipbook(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void {
    this.#markDirty();
    const o = scSetFlipbook(this.scene, handle, delay, dur, frames, cols, flags);
    this.#assertItem(handle);
    this.#pushLog(`setFlipbook h=0x${handle.toString(16)} d=${delay} dur=${dur} frames=${frames} cols=${cols} flags=${flags}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /**
   * **B 层（bit2）周期/循环动画**（`0x230`–`0x235`）：按 `req.op` 分派到共享层的 `scXxx`
   * （与 `HeadlessScene.setDrawItemLoop` 逐字同一份语义）。
   * ★六条都**没有 `flags & 1` 门控**（缺项会被建出来、配好动画、不报错）⇒ 六个 op 一律 `#assertItem`。
   */
  setDrawItemLoop(req: DrawItemLoopRequest): void {
    this.#markDirty();
    const h = `h=0x${req.handle.toString(16)}`;
    let o: string;
    let detail = '';
    switch (req.op) {
      case 'reset':
        o = scResetDrawItemLoop(this.scene, req.handle);
        break;
      case 'flipbook':
        o = scSetFlipbookLoop(this.scene, req.handle, req.period, req.frames, req.cols);
        detail = ` period=${req.period} frames=${req.frames} cols=${req.cols}`;
        break;
      case 'color':
        o = scSetColorLoop(this.scene, req.handle, req.period, req.alpha, req.rgb);
        detail = ` period=${req.period} a=${req.alpha} rgb=0x${(req.rgb >>> 0).toString(16)}`;
        break;
      case 'scale':
        o = scSetScaleLoop(this.scene, req.handle, req.period, req.sx, req.sy, req.sz);
        detail = ` period=${req.period} s=(${req.sx},${req.sy},${req.sz})`;
        break;
      case 'rotate':
        o = scSetRotationLoop(this.scene, req.handle, req.period, req.ax, req.ay, req.az);
        detail = ` period=${req.period} axis=(${req.ax},${req.ay},${req.az})`;
        break;
      case 'translate':
        o = scSetTranslationLoop(this.scene, req.handle, req.period, req.tx, req.ty, req.tz);
        detail = ` period=${req.period} t=(${req.tx},${req.ty},${req.tz})`;
        break;
    }
    this.#assertItem(req.handle);
    this.#pushLog(`setDrawItemLoop ${req.op} ${h}${detail}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /** **`0x244`**（`sub_41A370` → `sub_4AD9F0`）：清 `flags & mask` 的绘制项的 A 层窗起点（返回命中数）。 */
  clearDrawItemAnimStarts(mask: number): number {
    this.#markDirty();
    const n = scClearDrawItemAnimStarts(this.scene, mask);
    this.#pushLog(`clearDrawItemAnimStarts mask=${mask} → ${n} 项（窗起点清 0 ⇒ 下一帧重新计时）`);
    return n;
  }

  /**
   * `0x322`（`sub_426C20`）：mesh 顶点色 state0 + entry[9]。★缺失即建项、无门控，但**不置 bit0**
   * （没有几何 ⇒ 不画）。`alpha/rgb` 为负 = 取当前 state0 的对应通道（引擎 raw 33865-33884）。
   */
  setVertexColor(handle: number, index: number, alpha: number, rgb: number): void {
    this.#markDirty();
    const o = scSetVertexColor(this.scene, handle, index, alpha, rgb);
    // ★幕的**颜色**落地这一刻才是"新内容真的可见"⇒ 解除留帧（见 `createMesh` 处说明）
    const mAfter = this.scene.meshes.get(handle);
    if (mAfter) this.#releaseFrameHoldIfVisible(`setVertexColor 0x${handle.toString(16)}`, this.#meshVisible(mAfter));
    this.#assertMesh(handle);
    const m = this.scene.meshes.get(handle);
    this.#pushLog(
      `setVertexColor h=0x${handle.toString(16)} idx=${index} a=${alpha} rgb=0x${(rgb >>> 0).toString(16)} → state0=0x${(m?.state0 ?? 0).toString(16)}${o === 'applied' ? '' : ' [建空项]'}`,
    );
  }

  /** `0x323`（`sub_426CF0`）：mesh 顶点色动画窗（delay/count + state1，同样有负值回退）。 */
  setVertexColorAlpha(handle: number, delay: number, count: number, alpha: number, rgb: number): void {
    this.#markDirty();
    const o = scSetVertexColorAlpha(this.scene, handle, delay, count, alpha, rgb);
    this.#assertMesh(handle);
    const m = this.scene.meshes.get(handle);
    this.#pushLog(
      `setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} a=${alpha} rgb=0x${(rgb >>> 0).toString(16)} → state1=0x${(m?.state1 ?? 0).toString(16)}${o === 'applied' ? '' : ' [建空项]'}`,
    );
  }

  setDrawColorAlpha(handle: number, from: number, blend: number): void {
    this.#markDirty();
    const o = scSetDrawColorAlpha(this.scene, handle, from, blend);
    this.#assertItem(handle);
    this.#pushLog(`setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)} blend=${blend}${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /**
   * `0x1F7` detach-texture (sub_422BC0)：删单/区间图元。读 op1=handle、op2=count；按 count 分派：
   *  - count ≤ 1 → `sub_4AB950`：**移除该 handle 单图元**。TITLE 的 hover 回退就用它移除上一步 hover
   *    画出的 normal 图元，让按钮回退到 highlight（emulator 先前是 no-op ⇒ normal 残留 → "始终 hover"）。
   *  - count > 1 → `sub_4ABB60`：**按 handle 区间批量移除** `[handle, handle+count)` 的全部绘制项/网格
   *    （SYSTEM4/LOGO/TITLE 开机大量用，用于批量清掉一段特效/网格）。
   */
  detachTexture(handle: number, count: number): void {
    this.#markDirty();
    // 撤幕判定必须在删之前做（删完就看不出它是不是满屏幕布了）
    const droppedCurtain = this.#coversViewportMeshInRange(handle, count);
    const r = scDetachTexture(this.scene, handle, count);
    if (droppedCurtain) this.#holdFrameAfterCurtainDrop(handle);
    // ★被删区间与某窗登记的 DrawItem 区间相交 ⇒ 该窗的字也消失（转场清 ADV 文字，见 scDetachTexture）
    const wins = r.clearedWins.length > 0 ? ` 文本窗清=${r.clearedWins.join(',')}` : '';
    if (count <= 1) {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} REMOVE (drawItems=${r.drawItems}, meshes=${r.meshes})${wins}`);
    } else {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} RANGE-REMOVE [0x${handle.toString(16)},0x${(handle + count).toString(16)}) (drawItems=${r.drawItems}, meshes=${r.meshes})${wins}`);
    }
  }

  /**
   * `[handle, handle+count)` 区间里是否有**满屏覆盖幕**（顶点四边形铺满视口）。
   *
   * 用途见 `#holdFrameAfterCurtainDrop`。
   */
  #coversViewportMeshInRange(handle: number, count: number): boolean {
    const hi = count <= 1 ? handle + 1 : handle + count;
    for (const m of this.scene.meshes.values()) {
      if (m.handle < handle || m.handle >= hi) continue;
      if ((m.flags & 1) === 0 || m.verts.length < 3) continue;
      const xs = m.verts.map((v) => v.x);
      const ys = m.verts.map((v) => v.y);
      if (Math.min(...xs) <= 0 && Math.min(...ys) <= 0 && Math.max(...xs) >= VIEW_W && Math.max(...ys) >= VIEW_H) {
        return true;
      }
    }
    return false;
  }

  /**
   * **撤幕帧的"留帧"策略**（bug：配置界面→SN0000 切换时黑屏后配置界面闪一下）。
   *
   * 引擎的 present 由"场景脏 + 动画待播"驱动，而**它从不整屏清 backbuffer**
   * （`ClearTarget` 被 `_this+46460&1` 守卫、该字段恒 0）⇒ 撤掉黑幕那一帧在引擎里**不会被呈现**，
   * 屏上留的是"上一帧的黑"。emulator 的重写是"每批指令后整帧重合成"，
   * 而批边界（`SAFETY_PER_FRAME`）可能正好落在"幕已撤、旧场景图元还没清、新幕还没建"的
   * 脚本级 teardown 中间 ⇒ 画出一帧**没有覆盖幕的旧场景**（实测：`.tmp` 日志里
   * `[meshsig 17480ms] meshes={0:0} items=29`，29 个图元正是 GAMESTART 配置界面）。
   *
   * 处理：撤掉满屏幕布后**先留帧**，直到有新内容建立（`createMesh`/`draw-texture`/`copyScene`）
   * 或容器被整批清空（`clearDrawContainer`，此时画面本就该是空的/黑的）；最多留 `HOLD_MAX` 帧，
   * 防止"幕撤了但确实什么都不画"的场景被永久冻住。
   */
  #holdFrameAfterCurtainDrop(handle: number): void {
    this.#holdFrames = HOLD_MAX_FRAMES;
    this.#pushLog(`[frame-hold] 满屏幕布 0x${handle.toString(16)} 被撤 → 留帧最多 ${HOLD_MAX_FRAMES} 帧（等新内容）`);
  }

  /** 新内容建立 ⇒ 解除留帧。 */
  #releaseFrameHold(what: string): void {
    if (this.#holdFrames > 0) this.#pushLog(`[frame-hold] ${what} → 解除留帧（剩 ${this.#holdFrames} 帧）`);
    this.#holdFrames = 0;
  }

  /**
   * **只在"新内容已经可见"时解除留帧**（`state0` 的 alpha > 0）。
   *
   * 为什么不能"建了项就解除"：引擎建项与设色是**两条指令**（如 `0x320 create-mesh` 后紧跟
   * `0x322 set-vertex-color`），中间那一帧的项还是全透明 ⇒ 解除留帧就会把**旧画面/空画面**呈现出来
   * （用户实测：进 SN0000 时背景闪一下）。上限 `HOLD_MAX_FRAMES` 兜住"新内容长期不可见"的极端情形。
   *
   * ★**判据必须无时钟、无副作用**（`tickets/T-0004` 的 G3 实测修）：旧实现用 `#meshVisibleColor`
   * = `calcDiffuse(m, this.clockMs)`，而帧内 `clockMs` 还是**上一帧**的值（只有 `advanceModel` 才刷新）
   * ⇒ 它会给共享模型的动画窗**锁存起点**成上一帧的时钟：Electron 的 `anim.start` 比 headless 早一帧，
   * 插值色差 1/255 —— 这种"宿主渲染策略污染共享模型"正是 G3 要抓的。
   */
  #releaseFrameHoldIfVisible(what: string, visible: boolean): void {
    if (this.#holdFrames <= 0) return;
    if (!visible) {
      this.#pushLog(`[frame-hold] ${what} 颜色仍透明 → 继续留帧（剩 ${this.#holdFrames} 帧）`);
      return;
    }
    this.#pushLog(`[frame-hold] ${what} → 新内容可见，解除留帧（剩 ${this.#holdFrames} 帧）`);
    this.#holdFrames = 0;
  }

  /**
   * 幕"此刻是否已经有颜色"（**无时钟、不碰共享状态**）。
   *
   * 用 `state0` 的 alpha：无动画窗时它就是可见色；有窗时它是插值的起点（插值结果的 alpha ≥ 两端较小者
   * ⇒ 用它判"可见"是**保守**的，只会多留几帧，不会提前露出未完成的新画面）。
   */
  #meshVisible(m: MeshObj): boolean {
    return ((m.state0 >>> 24) & 0xff) > 0;
  }

  /**
   * `0x202` set-draw-color（`sub_4AD0C0`）：建项 → **门控 `flags & 1`** → `|=2`/delay/dur/to。
   * ★项不存在时只建空项，本 op 不生效（引擎构造器 flags=0）。
   */
  setDrawColor(handle: number, delay: number, count: number, to: number): void {
    this.#markDirty();
    const o = scSetDrawColor(this.scene, handle, delay, count, to);
    this.#assertItem(handle);
    this.#pushLog(`setDrawColor h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${to.toString(16)}${o === 'applied' ? '' : ` [${o}]`}`);
  }

  /**
   * `0x21C set-wait-flag`：引擎往 `Engine[174801]` 置位（`0x400` 动画等待门等）。
   *
   * ★2026-09（`tickets/T-0008`）：**宿主不再保存这份镜像** —— 修前这里有 `private waitFlags`，
   * 由本方法置位而**全文件没有任何清除点**（清的是 `Engine.waitFlags`，见 `session.#serviceAnimGate`）
   * ⇒ 一旦执行过 `0x21C`，`needsRender()` 就**永久为真**（"引擎式 present"退化成"每次迭代都 present"）。
   * 门状态的唯一真源是 `Engine.waitFlags`；这里只标脏 + 记日志。
   */
  setWaitFlag(mask: number): void {
    this.#markDirty();
    this.#pushLog(`setWaitFlag 0x${mask.toString(16)}（宿主不保存镜像；门状态见 Engine.waitFlags）`);
  }

  /**
   * `0x214`（`sub_423AE0` → `sub_4ABEF0`）：**交换两条绘图项记录**（键不动）。
   * 与 `copyScene` 不同：只碰绘图项表、引擎无错误串（两侧都不存在也只是置脏位）；
   * 也**不解除留帧**（交换不是"新内容建立"，见 `#releaseFrameHold` 的说明）。
   */
  swapItems(a: number, b: number): boolean {
    const swapped = scSwapItems(this.scene, a, b);
    this.#markDirty();
    this.#pushLog(`swapItems 0x${a.toString(16)} ↔ 0x${b.toString(16)}${swapped ? '' : '（两侧都不存在）'}`);
    return swapped;
  }

  /**
   * `0x21D` CopyScene（`sub_4AC0D0`）：源绘图项 + 网格整份复制到目标 handle，并标脏重绘。
   * 源不存在 ⇒ 返回 false（引擎打「コピー元のシーンが存在しません．%d」错误串）。
   */
  copyScene(srcHandle: number, dstHandle: number): boolean {
    const r = scCopyItem(this.scene, srcHandle, dstHandle);
    this.#markDirty();
    if (r.copied) this.#releaseFrameHold('CopyScene');
    this.#pushLog(
      `CopyScene 0x${srcHandle.toString(16)} → 0x${dstHandle.toString(16)}` +
        (r.copied ? `（drawItem=${r.drawItem} mesh=${r.mesh}）` : '【源不存在】'),
    );
    return r.copied;
  }

  releaseTexture(layer: number): void {
    this.#markDirty();
    this.textures.release(layer);
    this.#pushLog(`releaseTexture layer=${layer}`);
  }

  /** `0x20B` FillTexture：往槽表面填纯色矩形（走 TextureCache 的画布表面）。 */
  fillSlotRect(slot: number, x: number, y: number, w: number, h: number, argb: number, alpha: number): void {
    this.#markDirty();
    this.textures.fillSlotRect(slot, x, y, w, h, argb, alpha);
  }

  playMovie(id: number, slot: number, mode: number): void {
    this.#markDirty();
    this.#pushLog(`playMovie id=0x${id.toString(16)} slot=${slot} mode=${mode}`);
  }

  /**
   * `0x1F6`（sub_41A130 → `sub_4AB7A0(_this+80708)`）：**整批释放绘制项/网格**。
   * 等价语义 = 清空 `drawItems` + `meshes`，**保留纹理槽绑定**（引擎这里只释放图元/网格对象）。
   */
  // ---- 消息窗文本 ----

  /** 引擎「每窗一张离屏表面」的等价物：排版在共享层做，这里只标脏（纹理在 present 时重建）。 */
  msgWinSync(win: number, input: MsgWinInput): void {
    const f = scMsgWinSync(this.scene, win, input);
    this.#pushLog(`[msgwin] win=${win} ${f.lines.length} 行 ${f.glyphCount} 字 ${f.style.vertical ? '竖排' : '横排'} ${f.style.main.size}px`);
    this.#markDirty();
  }

  msgWinClear(win: number): void {
    scMsgWinClear(this.scene, win);
    this.#markDirty();
  }

  msgWinClearAll(): void {
    scMsgWinClearAll(this.scene);
    this.#markDirty();
  }

  /**
   * VM 每条指令派发前下发"正在执行哪一帧"（建项归属用；见 `SceneState.currentFrame`）。
   * 纯记账 ⇒ 不标脏（画面本身没变）。
   */
  setCurrentFrame(frame: number): void {
    this.scene.currentFrame = frame;
  }

  /**
   * 丢掉"某一帧画的"绘制项（读档装载点用；见 `native.dropFrameItems` 的依据说明）。
   *
   * ★与 `clearDrawContainer` 不同：**这里解除留帧**（`#releaseFrameHold`）—— 本次丢掉的是
   * "上一屏那一层 UI"，剩下的模型（ADV 层）应当在下一帧如实呈现，不能让旧像素继续压着。
   */
  dropFrameItems(frame: number): number {
    const r = scDropFrameItems(this.scene, frame);
    this.#markDirty();
    if (r.items > 0) {
      this.#pushLog(`dropFrameItems: 丢掉帧 ${frame} 画的绘制项 ${r.items} 个（handle ${r.handles.join(',')}）`);
    }
    // ★诊断（读档画面残留定位用）：丢掉之后，剩下的绘制项按"哪一帧画的"分桶（`d` = 其中**可绘制**的）。
    const census = new Map<number, { n: number; d: number }>();
    for (const it of this.scene.drawItems.values()) {
      const e = census.get(it.ownerFrame) ?? { n: 0, d: 0 };
      e.n += 1;
      if ((it.flags & 1) !== 0) e.d += 1;
      census.set(it.ownerFrame, e);
    }
    if (census.size > 0) {
      const s = [...census.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([f, e]) => `${f}:${e.n}${e.d !== e.n ? `/可绘制${e.d}` : ''}`)
        .join(' ');
      this.#pushLog(`dropFrameItems: 剩余绘制项按归属帧分桶 = {${s}}`);
    }
    return r.items;
  }

  /**
   * 释放「留帧」（`tickets/T-0083` 的 (A) 步）：读档装载点调用 —— 引擎装载路径复位显示态，**不留旧像素**。
   */
  releaseFrameHold(): void {
    this.#releaseFrameHold('读档装载点（引擎复位显示态 ⇒ 不留旧像素）');
  }

  clearDrawContainer(): void {
    const wins = this.scene.msgWins.size;
    const r = scClearDrawContainer(this.scene);
    // ★2026-09 改：清容器**不再解除留帧**。理由 = 引擎的 present **从不整屏清 backbuffer**
    //   （`ClearTarget` 被恒 0 的 `Scene+46460&1` 守卫）⇒ 屏上留的是上一帧，直到**新内容被画出来**。
    //   若在这里解除，批边界一旦落在"已清容器、新场景还没画"之间，就会呈现一帧空场景/旧场景
    //   （用户实测：进 SN0000 前配置界面闪一下）。解除点只剩"真的建了新内容"（见 `#releaseFrameHold` 的调用方）。
    this.#holdFrames = Math.max(this.#holdFrames, HOLD_MAX_FRAMES);
    this.#pushLog(`[frame-hold] clearDrawContainer → 继续留帧（最多 ${HOLD_MAX_FRAMES} 帧，等新内容）`);
    this.#markDirty();
    this.#pushLog(`clearDrawContainer: 释放 drawItems=${r.drawItems} meshes=${r.meshes} 文本窗=${wins}→0（保留纹理槽）`);
  }

  /** `0x32B`（sub_41A4A0）：清网格槽表（引擎逐项 delete；emulator = 清 `scene.meshes`）。 */
  clearMeshSlots(): void {
    const n = scClearMeshSlots(this.scene);
    if (n > 0) this.#pushLog(`clearMeshSlots: 释放 meshes=${n}`);
    this.#markDirty();
  }

  /**
   * `0x259`（sub_41A3A0 raw 25357-25376）：清 1000×2 条**槽记录**的前两个 dword
   * （"槽 → 统一文件 id" + 邻居）。**不碰绘制项、不 delete 对象** ⇒ 只丢记录（`tickets/T-0063`）。
   */
  clearSlotRecords(): void {
    this.textures.clearSlotRecords();
  }

  /** 取场景呈现态快照（`tickets/T-0063`：读档还原画面用；模型是纯数据 ⇒ 直接深拷贝）。 */
  snapshotPresent(): unknown {
    return scSnapshotPresent(this.scene);
  }

  /** 还原场景呈现态快照（读档）：模型换掉后置脏，文本层按 `msgRev` 重新光栅化。 */
  restorePresent(snap: unknown): void {
    const r = scRestorePresent(this.scene, snap as PresentSnapshot);
    this.#pushLog(`restorePresent：绘制项 ${r.drawItems} / 网格 ${r.meshes} / 文本窗 ${r.msgWins}`);
    this.#markDirty();
  }

  /** `0x20C`（sub_41A1A0 → `sub_4B4040(_this+80708)`）：帧刷新。渲染循环自行 present，这里只标脏。 */
  frameTick(): void {
    this.#markDirty();
    const slot = this.scene.render4.renderTargetSlot;
    if (slot < 0) return;
    try {
      this.present(); // 与渲染循环同一条合成路径（文本层 + 字格 + drawRoot）
      // ★必须给**屏幕矩形**：`extract` 默认按 target 的 local bounds 出图，而 drawRoot/stage 的子节点
      //   可能落在视口之外（宽背景、屏外精灵…）⇒ 那样得到的画布比屏幕大、内容整体错位，
      //   再被 `i032` 缩进 320×180 就是"素材拼贴 + 各处缩放不一致"（2026-09 用户实测的混乱缩略图）。
      const frame = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
      const canvas = this.app.renderer.extract.canvas({
        target: this.stage,
        frame,
        resolution: 1, // 槽画布自己按 DPR 承担缩放；这里要的是逻辑尺寸的整帧
      }) as HTMLCanvasElement;
      // 取整张画布（万一宿主忽略了 `frame`，画布尺寸会≠屏幕 ⇒ 记一条日志便于定位，别静默拼贴）
      const aspect = canvas.width / Math.max(1, canvas.height);
      if (Math.abs(aspect - frame.width / frame.height) > 0.05) {
        this.#pushLog(
          `[render-target] 捕获画布 ${canvas.width}x${canvas.height} 与屏幕 ${frame.width}x${frame.height} 宽高比不符（extract 可能忽略了 frame）`,
        );
      }
      this.textures.captureCanvasIntoSlot(slot, canvas, canvas.width, canvas.height);
    } catch (err) {
      this.#pushLog(`[render-target] 把帧捕获进槽 ${slot} 失败：${String(err)}`);
    }
  }

  // ---- 转场（`tickets/T-0084`）---- //

  /** 抓一帧**当前舞台的合成结果**（转场的新/旧帧来源；与 `frameTick` 同一条 `extract.canvas`）。 */
  #captureStageCanvas(): HTMLCanvasElement | null {
    try {
      const frame = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
      return this.app.renderer.extract.canvas({
        target: this.stage,
        frame,
        resolution: 1,
      }) as HTMLCanvasElement;
    } catch (err) {
      this.#pushLog(`[transition] 抓帧失败：${String(err)}`);
      return null;
    }
  }

  /**
   * **把本帧的转场结果画进记录 `[4]` 指定的那个离屏槽** —— 引擎 `sub_4B06D0` 的等价物。
   *
   * 引擎的次序（raw 136174 / 134937 / 135824 + 136250-136259 / 134947-135510）：
   * `SetTarget([4])` → `Clear` → 从 36（旧）/ 37（新）取互补条带（类别 2）或整屏交叉淡化（类别 0）
   * 画进去。`[4]` **不是屏幕**：语料里它是脚本 `create-texture` 出来的 1280×720 槽，随后由引用该槽的
   * 绘制项呈现（`src/SC0000.txt:1337-1339`）⇒ emulator 的等价物就是"画进那个槽的画布"
   * （`TextureCache.composeIntoSlot`）。
   *
   * **类别**：0 = 交叉淡化（`0x223`）、1 = 分块淡入淡出（`0x24D`，**未实现**）、2 = 盲帘（`0x24F`）、
   * 3 = 插值模糊（`0x250`/`0x251`，累积近似，见 `scTransitionBlurPlan` 的偏差披露）。
   *
   * **仍未实现**：类别 1 `0x24D` —— 语料 **0 处**，且体里的可见效果与"分块/随机"参数来源未确证
   * （规格 §3.5 的 U2）⇒ 如实跳过，登记在缺口台账（`analysis/opcode-gaps.json`）+ 票据 `T-0084`。
   */
  #compositeTransitions(): void {
    const act = scActiveTransitions(this.scene);
    if (act.length === 0) return;
    const old = this.#transOld;
    if (!old) return;
    const cur = this.#captureStageCanvas();
    if (!cur) return;
    const sw = Math.max(1, this.app.screen.width);
    const sh = Math.max(1, this.app.screen.height);
    for (const { id, rec, rt } of act) {
      const cat = rec[0] ?? 0;
      const slot = rec[4] ?? -1;
      if (cat !== 0 && cat !== 2 && cat !== 3) continue;
      let blurLog: string | null = null;
      const ok = this.textures.composeIntoSlot(slot, (ctx, w, h) => {
        if (cat === 0) {
          // 类别 0 = 交叉淡化：36（旧）整屏不透明，再以 `alpha = t*255` 叠 37（新）。
          ctx.drawImage(old, 0, 0, old.width, old.height, 0, 0, w, h);
          ctx.globalAlpha = Math.min(1, Math.max(0, rt.t));
          ctx.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, w, h);
          ctx.globalAlpha = 1;
          return;
        }
        if (cat === 3) {
          // 类别 3 = 插值模糊（`0x250` SlideBlur / `0x251` ZoomBlur）。
          // ★参数逐条确证（raw 135837-135881）；**像素是累积近似** —— 见 `scTransitionBlurPlan` 的
          //   偏差披露（引擎走 D3DX effect 或逐像素 CPU 卷积，emulator 两者都没有）。
          //   源取**本帧屏幕合成**：引擎读的是层 36 的纹理（raw 135883；`Scene+42600` 就是层 36），
          //   而层 36 的填充路径未确证（规格 §7 的 U3/U4）⇒ 这条也写进票据。
          const plan = scTransitionBlurPlan(rec, rt, { w, h });
          if (!plan) return;
          const off = scTransitionBlurOffsets(plan);
          const half = (plan.samples - 1) / 2;
          const total = (plan.samples - 1) + TRANSITION_BLUR_CENTER_WEIGHT;
          ctx.clearRect(0, 0, w, h);
          for (let k = 0; k < plan.samples; k++) {
            const weight = k === half ? TRANSITION_BLUR_CENTER_WEIGHT : 1;
            ctx.save();
            if (off.kind === 'zoom') {
              // 绕中心的均匀缩放：采样 k 的比例 `1 + (k-half)*step` ⇒ 画的时候用它的**倒数**。
              const s = 1 + (k - half) * off.step;
              const inv = Math.abs(s) < 1e-6 ? 1 : 1 / s;
              ctx.translate(off.cx, off.cy);
              ctx.scale(inv, inv);
              ctx.translate(-off.cx, -off.cy);
            } else {
              // 沿 Angle 的平移：采样位移 `(k-half)*(dx,dy)` ⇒ 画在**负位移**处。
              ctx.translate(-(k - half) * off.dx, -(k - half) * off.dy);
            }
            ctx.globalAlpha = weight / total;
            ctx.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, w, h);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          blurLog =
            `${plan.zoom ? 'Zoomblur' : 'Slideblur'} Length=${plan.length} ` +
            (plan.zoom
              ? `Center=(${plan.centerUPx},${plan.centerVPx}) 归一化=(${plan.centerU.toFixed(3)},${plan.centerV.toFixed(3)})`
              : `Angle=${plan.angle}`) +
            ` 目标层=${w}x${h} 采样=${plan.samples}（近似）`;
          return;
        }
        // 类别 2 = 盲帘擦除：Clear 之后把 36/37 的互补条带 1:1 画进去。
        ctx.clearRect(0, 0, w, h);
        const rect = scTransitionTargetRect(this.scene, rec);
        if (!rect) return; // 查不到目标绘制项 ⇒ 引擎把该记录杀成死记录并直接返回（raw 134890-134893）
        const kx = w / sw;
        const ky = h / sh;
        for (const b of scTransitionBands(rec, rt, this.clockMs, rect)) {
          const src = b.src === 'old' ? old : cur;
          ctx.drawImage(src, 0, 0, src.width, src.height, b.x * kx, b.y * ky, b.w * kx, b.h * ky);
        }
      });
      if (ok) {
        this.#pushLog(
          `[transition] id=0x${id.toString(16)} cat=${cat} t=${rt.t.toFixed(3)} → 槽 ${slot}` +
            (cat === 0
              ? '（交叉淡化：旧帧 + 新帧×t）'
              : cat === 3
                ? `（${blurLog ?? '插值模糊'}）`
                : `（盲帘类型 ${rec[13]}）`),
        );
      }
    }
  }

  // ---- 动画求值 / 渲染驱动 ---- //
  /**
   * **本遍推进后池是否还挂着** —— `Scene+46516` 的等价物（引擎 `sub_49AA30` raw 117843-117844；`tickets/T-0024`）。
   * ★口径 = `scPoolPending`（mesh 窗 + draw item 5 窗，**排除 `+720` bit0 的元素**）：
   * 这一格不是"门自己扫几个窗"的猜测 —— 门 = 它 + `0x238` 计时器（`Engine.gatePending`）。
   * ★时钟用 `advanceModel(nowMs)` 注入的 `clockMs`（`tickets/T-0008` 的单一时间域）。
   * ★方法名与桥一致（`tickets/T-0013`）：帧驱动/会话只经接口调用。
   */
  poolPending(): boolean {
    return scPoolPending(this.scene, this.clockMs);
  }

  /**
   * 引擎式 present 条件："场景脏 || 仍有动画在播"（判据在共享层 `sceneNeedsRender`，见 `tickets/T-0008`）。
   *
   * ★2026-09：**去掉了"命中 0x400 等待门"那一项** —— 它读的是宿主自己的 `waitFlags` 镜像（只置不清
   * ⇒ 永久为真）。门分支下的"持续 present"由**帧驱动**负责（产品路径原本就在门分支里无条件 present）。
   */
  needsRender(): boolean {
    return sceneNeedsRender(this.scene, this.clockMs, this.sceneDirty);
  }

  /** 启动渲染：仅记录墙钟起点（**不是**启动 ticker；见 `startFrameLoop` 的说明）。 */
  startFrameLoop(): void {
    if (this.frameStarted) return;
    this.frameStarted = true;
    this.wallStart = performance.now();
  }

  /**
   * `FrameHost.advanceModel`（`tickets/T-0004` 的 B4）：把**本帧时钟**注入宿主。
   *
   * pixi 的"模型推进"= 把时钟刷新到本帧（窗的求值发生在 `present` 里，用 `clockMs` 算相位）。
   * ★修前这个时钟是 `performance.now() - wallStart`（**独立时间域**，与 `Engine.nowMs` 不同源，
   * 见 `tickets/T-0008` 的 D1）⇒ 现在一律由驱动经 `Engine.nowMs` 注入，只有没人注入时才退回去。
   */
  advanceModel(nowMs: number): void {
    this.clockMs = nowMs;
    this.#clockInjected = true;
    // ★推进窗（窗末 `work ← target`）——与 `HeadlessScene.advanceModel` 调的是**同一个** `scAdvance`
    //   ⇒ "模型推进"两个宿主只有一份实现（设计 D3）。修前推进藏在 `present` 里（`presenter.ts:56`），
    //   而 `present` 会被 `needsRender` 跳过（窗恰好结束的那一帧 `pending` 已为假）⇒ 那一帧的
    //   收尾就永远不会发生，两宿主的 digest 会分叉 —— 正是 G3 要抓的东西。
    scAdvance(this.scene, nowMs);
    // ★转场窗（`tickets/T-0084`）：与 headless 共用 `scene/transition.ts` 一份推进器
    //   （锁存起点 / 推进 t·off / 到点杀记录 / 一遍绘完清空整表 —— 引擎 `sub_4B06D0` +
    //   帧函数 raw 136840-136841）。放在 `scAdvance` 之后、本帧 `present` 之前：
    //   脚本本帧写的记录会被本帧这一次 tick 看到，不会"写了立刻被清掉"。
    const trans = scTransitionTick(this.scene, nowMs);
    // ★转场要"新旧两帧"：引擎的 36/37 = 两个屏幕层。这里在**本帧 present 之前**抓一帧当旧帧
    //   （此刻 drawRoot 还是上一帧合成出来的内容）；窗结束（表被清）就释放。
    if (scTransitionsPending(this.scene)) {
      if (!this.#transOld) this.#transOld = this.#captureStageCanvas();
    } else if (this.#transOld) {
      this.#transOld = null;
    }
    if (trans.cleared) this.#transOld = null;
    // ★Live2D 动作推进：与 headless 共用 `scL2dTick`（只在"这一帧真要画的节点"上推进；
    //   引擎里推进与出画是同一次调用，见能力条目 `live2d-node-draw-advance`，T-0054）。
    const drawn = scL2dTick(this.scene, nowMs);
    if (drawn.length > 0) this.#l2dDrawnKeys = drawn;
    // ★Live2D 纹理：在本帧**开头**发起载入，帧末的 `texturesIdle`（`session.#present` 的次序 =
    //   推进模型 → 屏障 → 合成）就能在同一帧里等到它们 ⇒ 与引擎 `0x345` 的同步装载同观感。
    this.#ensureL2dTextures();
  }

  /**
   * **把真实系统光标挪到「引擎虚拟坐标 `(x, y)`」处**（`NativeBridge.setSystemCursor`；引擎 `0x10A`）。
   *
   * 渲染进程只做**虚拟 → 客户区**这一跳（`pixi/inputAttach.ts` 的 `toVirtual` 的逆，用同一个
   * `canvas.getBoundingClientRect()` ⇒ 两向换算永远互为逆运算，不会各算一套）；客户区 → 屏幕、
   * 以及 DIP → 物理都由主进程做（`electron/nativeAddon.ts` 的注释里有完整三跳）。
   *
   * ★没有 `window.api.setSystemCursor`（旧 preload / 非 Electron 宿主）时**什么都不做** ——
   * 引擎侧坐标已经由 `InputManager.setCursor` 生效，脚本逻辑不受影响，少的是"玩家看见光标跳过去"。
   */
  setSystemCursor(x: number, y: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const cw = rect.width || VIEW_W;
    const ch = rect.height || VIEW_H;
    window.api?.setSystemCursor?.(
      Math.round(rect.left + (x / VIEW_W) * cw),
      Math.round(rect.top + (y / VIEW_H) * ch),
    );
  }

  /**
   * 把**所有活实例槽**上已绑定的纹理号发起载入（幂等）。
   *
   * 为什么按槽而不是"按本帧要画的批次"：批次的纹理号要先把几何求值一遍才知道，那等于每帧
   * 算两遍；而"槽里绑了哪几张图"是现成的（`L2dInstance.textures`），且一个槽的纹理最多 10 张。
   * 与引擎的口径一致：`0x345` 一执行，纹理就属于该槽（不管当前动作看不看得见它）。
   */
  #ensureL2dTextures(): void {
    const host = this.scene.l2dHost;
    if (!host) return;
    const ids: number[] = [];
    for (const inst of host.l2dSlots.values()) {
      if (!inst.model) continue;
      for (const [no, fileId] of inst.textures) if (no >= 0) ids.push(fileId);
    }
    if (ids.length > 0) this.#l2dTextures.ensure(ids);
  }

  /**
   * `FrameHost.digestState`：本宿主的场景模型 —— 与 `HeadlessScene` 是**同一份** `SceneState`
   * 语义（`scene/ops.ts`），只是画法不同 ⇒ `FrameDigest` 的 engine 段才有可比性。
   */
  digestState(): SceneState {
    return this.scene;
  }

  /** `FrameHost.digestHostCounters`：宿主义务履行计数（**不参与两宿主比较**）。 */
  digestHostCounters(): { barriers: number; audioIntents: number; fontMisses: number } {
    return { barriers: this.#barriers, audioIntents: this.#audioIntents, fontMisses: fontFailures().length };
  }

  /**
   * 合成一帧。
   * @param nowMs 本帧时钟（引擎 `nowMs`）；给了就用它（**单一时间域**，D1），否则用驱动注入的值，
   *   都没有才退回"墙钟 - 起点"（旧调用点/测试）
   * @param waitFlags 仅用于诊断日志（`[present … wait=0x…]`）；传 `Engine.waitFlags`
   */
  present(nowMs?: number, waitFlags = 0): void {
    // ★转场窗内**不许被留帧早退**：留帧是"屏上保留上一帧"的近似，而转场正是"这一帧要画东西"
    //   （引擎的 `Scene+46508` 在转场期间恒为脏，raw 136718-136719）⇒ 早退会让条带/淡入淡出只画一帧。
    const transPending = scTransitionsPending(this.scene);
    // 撤幕留帧：见 `#holdFrameAfterCurtainDrop`（不动舞台 ⇒ 屏上保留上一帧）
    if (this.#holdFrames > 0 && !transPending) {
      this.#holdFrames--;
      this.#pushLog(`[frame-hold] 跳过本次 present（剩 ${this.#holdFrames} 帧）`);
      return;
    }
    if (nowMs !== undefined) {
      this.clockMs = nowMs;
      this.#clockInjected = true;
    } else if (!this.#clockInjected) {
      this.clockMs = performance.now() - this.wallStart;
    }
    this.#clockInjected = false; // 已消费本帧注入的时钟
    // 消息窗文本：先按内容版本号重建纹理，再与 draw-item 按同一 layer 归并合成
    const textSprites = this.textLayer.sync(this.scene);
    // ★字格图标（▼「点击继续」）：引擎把精灵表的第 k 格**直接 blit 到屏幕**（`sub_45A940`），
    //   所以它画在最上层（层序给一个大值）。见 `MsgCellFrame`。
    const cellSprites = this.#cellSprites();
    this.presenter.present(this.scene, this.clockMs, waitFlags, [...textSprites, ...cellSprites]);
    // ★转场：把"旧帧 → 新帧"的合成结果画进记录 `[4]` 指定的那个**离屏槽**（引擎 `sub_4B06D0` 的
    //   `sub_4A50C0(_this, v384[4])` + `Clear` + 条带/淡入淡出，raw 136174 / 134937 / 135824）。
    //   放在 `presenter.present` 之后：此刻 stage 上就是本帧合成结果 = 引擎的"新"屏幕层。
    if (transPending) this.#compositeTransitions();
    // ★舞台已换成新纹理 ⇒ 现在才是销毁旧纹理的安全时刻（否则 ticker 会去画已销毁的纹理 →
    //   WebGL 批次损坏 → 整屏只剩背景色，且此后不再恢复；见 TextureCache.collectGarbage 的说明）
    const gc = this.textures.collectGarbage();
    if (gc > 0) this.#pushLog(`[texture] 延迟销毁旧纹理 ${gc} 张`);
    this.sceneDirty = false; // present 已消费本次"脏"标记
  }

  /** 绘制项 → 纹理（回归测试与诊断用；实现见 `TextureCache.resolve`）。 */
  resolveItemTexture(it: Item): { tex?: Texture; imgid?: number } {
    return this.textures.resolve(it);
  }

  /**
   * **字格图标（▼「点击继续」）的 Sprite**（引擎 `sub_45A940` raw 71296-71474 的等价物）。
   *
   * 源 = `0x73` 的 op4 槽（ADV 是 `SO000.AGF` 装进槽 12；序章是 `SO026.AGF`），
   * 源矩形 = 格原点 + `(k % cols, k / cols) × (cellW, cellH)`；目标 = `MsgCellFrame.x/y`（屏幕像素）。
   * 层序给 `CELL_LAYER`（很大）—— 引擎是"把图直接 blit 到屏幕面"，即最上层。
   */
  #cellSprites(): { win: number; layer: number; sprite: Sprite }[] {
    const out: { win: number; layer: number; sprite: Sprite }[] = [];
    for (const [win, frame] of this.scene.msgWins) {
      const c = frame.cell;
      if (!c) {
        const stale = this.#cellSpritesCache.get(win);
        if (stale) {
          // ★只销毁"这一格的视图"，**绝不销毁 source** —— 那是槽里共用的精灵表，
          //   销毁它会把整个 WebGL 纹理状态弄坏（实测：整屏黑 + addressModeU 报错）。
          stale.sprite.destroy({ texture: false, textureSource: false });
          stale.texture.destroy(false);
          this.#cellSpritesCache.delete(win);
        }
        continue;
      }
      const sheet = this.textures.slotTex.get(c.srcSurface);
      if (!sheet) continue; // 槽还没绑定/载入（下一帧再画，不静默画错图）
      const col = c.cols > 0 ? c.k % c.cols : 0;
      const row = c.cols > 0 ? Math.floor(c.k / c.cols) : 0;
      const rect = new Rectangle(c.originX + col * c.cellW, c.originY + row * c.cellH, c.cellW, c.cellH);
      // ★裁剪到贴图范围内（引擎 `ddCpySpriteSurfaceFast` raw 48997-49014 同样裁剪；裁没了就什么都不画）。
      //   实测：SN0000 序章的 `i073 8 … 38 38 8 64`（56×56、originY=56）是给 **NOVEL 那张 SO026**
      //   （448×112，两行）写的，而序章进场时槽 12 里是 SYSTEM4 绑的 **SO000**（350×35，单行 10 帧）
      //   ⇒ 源矩形 y=56..112 整块越界 ⇒ 引擎裁到 0 ⇒ **序章本来就没有 ▼**（普通 ADV 场景才有）。
      const sw = sheet.source.width;
      const sh = sheet.source.height;
      const x0 = Math.max(0, rect.x);
      const y0 = Math.max(0, rect.y);
      const x1 = Math.min(sw, rect.x + rect.width);
      const y1 = Math.min(sh, rect.y + rect.height);
      if (x1 - x0 <= 0 || y1 - y0 <= 0) {
        if (!this.#cellClippedWarned.has(win)) {
          this.#cellClippedWarned.add(win);
          this.#pushLog(
            `[cell] win=${win} 源矩形 (${rect.x},${rect.y},${c.cellW}x${c.cellH}) 超出槽 ${c.srcSurface} 贴图 ${sw}×${sh} ⇒ 不画（引擎同样裁空）`,
          );
        }
        continue;
      }
      const cached = this.#cellSpritesCache.get(win);
      if (cached && cached.k === c.k && cached.src === c.srcSurface && cached.sprite.texture.source === sheet.source) {
        cached.sprite.position.set(c.x, c.y);
        out.push({ win, layer: CELL_LAYER, sprite: cached.sprite });
        continue;
      }
      // 换格/换图：重建一张带 frame 的纹理视图（旧的一并销毁，避免每帧泄漏）
      const texture = new PixiTexture({ source: sheet.source, frame: rect });
      if (cached) {
        cached.sprite.texture = texture;
        cached.sprite.position.set(c.x, c.y);
        const prev = cached.texture;
        this.#cellSpritesCache.set(win, { sprite: cached.sprite, texture, k: c.k, src: c.srcSurface });
        prev.destroy(false); // 同上：只销毁 frame 视图，保留共用 source
        out.push({ win, layer: CELL_LAYER, sprite: cached.sprite });
        continue;
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0, 0);
      sprite.position.set(c.x, c.y);
      this.#cellSpritesCache.set(win, { sprite, texture, k: c.k, src: c.srcSurface });
      this.#pushLog(`[cell] win=${win} 槽=${c.srcSurface} k=${c.k} 源=(${rect.x},${rect.y},${c.cellW}x${c.cellH}) 目标=(${c.x},${c.y})`);
      out.push({ win, layer: CELL_LAYER, sprite });
    }
    return out;
  }

  /**
   * 诊断：导出某绘制项**求值后**的渲染状态（先推进动画窗，再取各窗结果）。
   * 供人工排查 5 窗语义（颜色/缩放/旋转/平移/flipbook + 源矩形）。
   */
  debugItemState(handle: number): {
    color: number;
    scale: Vec3;
    rotRad: number;
    trans: Vec3;
    src: { x: number; y: number; w: number; h: number };
    /** 动画位仍在（`flags & 2`）——即"还有窗没走完"。 */
    pending: boolean;
  } | null {
    const it = this.scene.drawItems.get(handle);
    if (!it) return null;
    const clock = this.clockMs;
    advanceWindows(it, clock); // 先推进窗（窗末 work ← target），再取各窗结果
    return {
      color: itemColor(it, clock),
      scale: itemScale(it, clock),
      rotRad: itemRotationRad(it, clock),
      trans: itemTranslation(it, clock),
      src: itemSrcRect(it, clock),
      pending: (it.flags & 2) !== 0,
    };
  }

  #assertItem(handle: number): void {
    const it = this.scene.drawItems.get(handle);
    if (it) assertFlags('drawitem', it.handle, it.flags);
  }

  #assertMesh(handle: number): void {
    const m = this.scene.meshes.get(handle);
    if (m) assertFlags('mesh', m.handle, m.flags);
  }

  #markDirty(): void {
    this.sceneDirty = true;
  }
}

/**
 * **把引擎的两个 D3D 混合组合注册进 Pixi 的 WebGL 混合表**（`tickets/T-0017`）。
 *
 * 为什么必须注册：Pixi 内置档里**没有**等价项，而且 `'none'` 是 `[0, 0]`（**画黑**，不是"覆盖"）——
 * 2026-09 实测：把引擎的 `(ONE, ZERO)` 映射成 `'none'` 会让序章整屏变黑（背景与侧栏一起消失）。
 * 自定义名走**普通路径**（不在 `BLEND_MODE_FILTERS` 里 ⇒ 不进高级 filter pass），
 * 由 `GlStateSystem.setBlendMode` 查 `blendModesMap` 应用；名字必须先注册，否则会**静默回落 `normal`**。
 *
 * 因子按 Pixi 的**预乘**约定取（与引擎的未预乘 D3D 组合等价）：
 *  - `d3d-opaque`      = `[ONE, ZERO]`          ⇔ 引擎 `SRCBLEND=ONE(2)` / `DESTBLEND=ZERO(1)`
 *    （选择子 2 与 mesh 画完留下的状态；`BLENDOP=ADD`）
 *  - `d3d-rev-subtract` = `[ONE, ONE, ONE, ONE, FUNC_REVERSE_SUBTRACT, FUNC_REVERSE_SUBTRACT]`
 *    ⇔ 引擎 `BLENDOP=REVSUBTRACT(3)` + `SRCALPHA(5)` / `ONE(2)` ⇒ `dst − color·α`
 *    （预乘后源 = `color·α` ⇒ 源因子 ONE）
 */
function installD3DBlendModes(app: Application): void {
  // ★类型：`app.renderer` 是 `Renderer | CanvasRenderer` 联合，只有 WebGL 后端有 `state`/`gl`
  //   ⇒ 用结构化断言取（拿不到就是非 WebGL 后端，直接返回）。
  const r = app.renderer as unknown as {
    gl?: { ONE: number; ZERO: number; FUNC_REVERSE_SUBTRACT: number };
    state?: { blendModesMap?: Record<string, number[]> };
  };
  const ONE = r.gl?.ONE ?? 1;
  const ZERO = r.gl?.ZERO ?? 0;
  const FUNC_REVERSE_SUBTRACT = r.gl?.FUNC_REVERSE_SUBTRACT ?? 0x800b;
  const map = r.state?.blendModesMap;
  if (!map) return; // 非 WebGL 后端（未来 WebGPU）⇒ 保持内置档，presenter 的名字会静默回落 normal
  map['d3d-opaque'] = [ONE, ZERO];
  map['d3d-rev-subtract'] = [ONE, ONE, ONE, ONE, FUNC_REVERSE_SUBTRACT, FUNC_REVERSE_SUBTRACT];
}
