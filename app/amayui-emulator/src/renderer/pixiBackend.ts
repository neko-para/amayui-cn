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
import { assertFlags, type DrawStringStyle, type MeshCreateSpec, type NativeBridge } from '../vm/native.js';
import type { InputManager } from '../vm/input.js';
import { AudioEngine, type AudioDebugState, type AudioIntent } from '../audio/audioEngine.js';
import { WebAudioHost } from './audio/webAudioHost.js';
import { advanceWindows, calcDiffuse, itemColor, itemRotationRad, itemScale, itemSrcRect, itemTranslation, meshColor, type DrawItemConfig, type Item, type MeshObj, type Vec3 } from './drawItem.js';
import {
  newSceneState,
  scAnimationsDone,
  scClearDrawContainer,
  scMsgWinClear,
  scMsgWinClearAll,
  scMsgWinSync,
  scConfigureDrawItem,
  scGetDrawItemPos,
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
  scSetDrawPivot,
  scSetDrawPos,
  scSetDrawTranslation,
  scSetFlipbook,
  scSetRotationAnim,
  scSetScale,
  scSetScaleAnim,
  scSetTranslationAnim,
  scSetVertexColor,
  scSetVertexColorAlpha,
  // A4 族（2026-09）：图元/网格/纹理/渲染状态
  scResetPrimTransform,
  scSetPrimTransform4,
  scBlitSlotToSlot,
  scCommitGraphics,
  scClearTransitions,
  scSetDrawModeBlock,
  scSetDrawEntryParam,
  scSetSlotParams,
  scSetMeshEntryAttr,
  scRelease3DSlot,
  scSet3DColor,
  scFillPanelRect,
  type SceneState,
} from './sceneModel.js';
import { setupPixiStage } from './pixi/appSetup.js';
import { attachMouseInput } from './pixi/inputAttach.js';
import { ScenePresenter } from './pixi/presenter.js';
import { TextLayer } from './pixi/textLayer.js';
import type { MsgWinInput } from '../text/layout.js';
import { TextureCache } from './pixi/textureCache.js';
import { VIEW_H, VIEW_W } from './viewport.js';
import type { RenderStatus } from './renderStatus.js';

/**
 * 留帧上限（帧数）。★2026-09 用户实测"配置界面在进 SN0000 前仍闪一下"后加强：
 * 8 → 60 帧（≈1 秒），并**改掉"清容器即解除"**（见 `clearDrawContainer`）——
 * 引擎的 backbuffer 从不清屏，屏上留的就是上一帧，只有**真的画了新东西**才该换帧。
 */
const HOLD_MAX_FRAMES = 60;

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
   * **场景模型**（与 `HeadlessScene` 共用 `sceneModel.ts` 的同一份语义）：
   * 建/删项、5 个窗、"缺失即建项"、bit0 门控都在那边实现，本类只负责画到 Pixi。
   * 这样"报告说对、画面不对"这类最难查的漂移就不可能发生。
   */
  private scene: SceneState = newSceneState();

  private waitFlags = 0; // effect_flags 中的等待位（0x400 等）——由 setWaitFlag 置
  private clockMs = 0; // 渲染帧时钟（ms，等价 this[46500]）
  private wallStart = 0; // 帧循环起点（performance.now），时钟 = now - wallStart（墙钟，保证推进）
  private frameStarted = false;
  /** 场景"脏"= 本次有配置类 op 改动过场景（引擎：present 须由脏标记 + 0x400 门控驱动）。 */
  private sceneDirty = false;
  /** 撤幕留帧的剩余帧数（见 `#holdFrameAfterCurtainDrop`）。 */
  #holdFrames = 0;

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
    b.presenter = new ScenePresenter(b.drawRoot, b.textures, b.unit, (m) => b.#pushLog(m));
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
    if (this.textures.pendingCount === 0) return;
    await this.textures.waitIdle();
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
    this.#releaseFrameHoldIfVisible(`createMesh 0x${spec.handle.toString(16)}`, this.#meshVisibleColor(m));
    assertFlags('mesh', m.handle, m.flags);
    const v = m.verts[0];
    this.#pushLog(
      `createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount} layer=${spec.layer}` +
        (v ? ` rect=(${v.x},${v.y})..(${m.verts[3]?.x ?? v.x},${m.verts[3]?.y ?? v.y}) base0=0x${(spec.baseColors[0] ?? 0).toString(16)}` : ' 无几何'),
    );
  }

  /** `0x1F8` create-texture：见 `TextureCache.create`（槽旧纹理失效后重取 / 新建空白表面）。 */
  createTexture(slot: number, w: number, h: number, mode: number): void {
    this.#markDirty();
    this.textures.create(slot, w, h, mode);
    scCreateTextureReset(this.scene, slot);
  }

  /** `0x204` draw-string：把整串文本直绘进该槽的表面（见 `TextureCache.drawString`）。 */
  drawString(slot: number, x: number, y: number, text: string, style: DrawStringStyle): void {
    this.#markDirty();
    scDrawString(this.scene, slot, x, y, text, style.fill); // 共享模型：报告/测试也能看到这串字
    this.textures.drawString(slot, x, y, text, style);
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

  /** `0x207` 槽→槽 StretchRect。 */
  blitSlotToSlot(srcSlot: number, dstSlot: number, srcRect: number[], dstRect: number[]): void {
    this.#markDirty();
    scBlitSlotToSlot(this.scene, srcSlot, dstSlot, srcRect, dstRect);
    this.#pushLog(`blitSlotToSlot ${srcSlot}→${dstSlot} src=[${srcRect}] dst=[${dstRect}]`);
  }

  /** `0x20E` 图形提交（清 target+z；Pixi 每帧自绘 ⇒ 只记数）。 */
  commitGraphics(): void {
    scCommitGraphics(this.scene);
  }

  /** `0x224` 清转场表。 */
  clearTransitions(): void {
    scClearTransitions(this.scene);
  }

  /** `0x229` 绘制模式 5 元组。 */
  setDrawModeBlock(a: number, b: number, x: number, y: number, z: number): void {
    scSetDrawModeBlock(this.scene, a, b, x, y, z);
  }

  /** `0x242` DrawItem `+720`。 */
  setDrawEntryParam(entry: number, value: number): void {
    scSetDrawEntryParam(this.scene, entry, value);
  }

  /** `0x256` 按 id 的绘制项参数。 */
  setSlotParams(slot: number, a: number, x: number, y: number, z: number): void {
    this.#markDirty();
    scSetSlotParams(this.scene, slot, a, x, y, z);
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

  /** `0x97` 面板填矩形（A5）。 */
  fillPanelRect(x0: number, y0: number, x1: number, y1: number, mode: number): void {
    scFillPanelRect(this.scene, [x0, y0, x1, y1], mode);
  }

  /** `0x208`：纹理尺寸 getter（写回脚本操作数由 opcode 侧负责）。 */
  getTextureSize(slot: number): { w: number; h: number } {
    return this.textures.size(slot);
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
   * `0x322`（`sub_426C20`）：mesh 顶点色 state0 + entry[9]。★缺失即建项、无门控，但**不置 bit0**
   * （没有几何 ⇒ 不画）。`alpha/rgb` 为负 = 取当前 state0 的对应通道（引擎 raw 33865-33884）。
   */
  setVertexColor(handle: number, index: number, alpha: number, rgb: number): void {
    this.#markDirty();
    const o = scSetVertexColor(this.scene, handle, index, alpha, rgb);
    // ★幕的**颜色**落地这一刻才是"新内容真的可见"⇒ 解除留帧（见 `createMesh` 处说明）
    const mAfter = this.scene.meshes.get(handle);
    if (mAfter) this.#releaseFrameHoldIfVisible(`setVertexColor 0x${handle.toString(16)}`, this.#meshVisibleColor(mAfter));
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
    if (count <= 1) {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} REMOVE (drawItems=${r.drawItems}, meshes=${r.meshes})`);
    } else {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} RANGE-REMOVE [0x${handle.toString(16)},0x${(handle + count).toString(16)}) (drawItems=${r.drawItems}, meshes=${r.meshes})`);
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
   * **只在"新内容已经可见"时解除留帧**（颜色 alpha>0）。
   *
   * 为什么不能"建了项就解除"：引擎建项与设色是**两条指令**（如 `0x320 create-mesh` 后紧跟
   * `0x322 set-vertex-color`），中间那一帧的项还是全透明 ⇒ 解除留帧就会把**旧画面/空画面**呈现出来
   * （用户实测：进 SN0000 时背景闪一下）。上限 `HOLD_MAX_FRAMES` 兜住"新内容长期不可见"的极端情形。
   */
  #releaseFrameHoldIfVisible(what: string, color: number): void {
    if (this.#holdFrames <= 0) return;
    if (((color >>> 24) & 0xff) === 0) {
      this.#pushLog(`[frame-hold] ${what} 颜色仍透明 → 继续留帧（剩 ${this.#holdFrames} 帧）`);
      return;
    }
    this.#pushLog(`[frame-hold] ${what} → 新内容可见，解除留帧（剩 ${this.#holdFrames} 帧）`);
    this.#holdFrames = 0;
  }

  /**
   * 幕此刻**实际可见的颜色**（= presenter 那一帧画出来的颜色）：`state0→state1` 按动画窗插值
   * （`calcDiffuse`）后取各顶点均值（`meshColor`）。留帧解除的判据必须与渲染同源，
   * 否则会出现"判据说可见、画面其实还是透明"的裂缝。
   */
  #meshVisibleColor(m: MeshObj): number {
    return meshColor(m, calcDiffuse(m, this.clockMs));
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

  setWaitFlag(mask: number): void {
    this.waitFlags |= mask;
    this.#markDirty();
    this.#pushLog(`setWaitFlag 0x${mask.toString(16)} (~0x${(this.waitFlags & mask).toString(16)})`);
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

  playMovie(id: number): void {
    this.#markDirty();
    this.#pushLog(`playMovie id=0x${id.toString(16)}`);
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

  /** `0x20C`（sub_41A1A0 → `sub_4B4040(_this+80708)`）：帧刷新。渲染循环自行 present，这里只标脏。 */
  frameTick(): void {
    this.#markDirty();
  }

  // ---- 动画求值 / 渲染驱动 ---- //

  /** 场景是否还有动画在跑（供 0x400 门控放行判断）。 */
  sceneAnimationsDone(): boolean {
    return scAnimationsDone(this.scene, this.clockMs);
  }

  /** 引擎式 present 条件："场景脏 || 仍有动画在播 || 命中 0x400 等待门"。 */
  needsRender(): boolean {
    return this.sceneDirty || !this.sceneAnimationsDone() || (this.waitFlags & 0x400) !== 0;
  }

  /** 启动渲染：仅记录墙钟起点。present 由 renderer 循环在每批指令之后调用（不在 ticker 里并发跑）。 */
  startFrameLoop(): void {
    if (this.frameStarted) return;
    this.frameStarted = true;
    this.wallStart = performance.now();
  }

  /** 合成一帧（时钟 = 墙钟，单调推进）。 */
  present(): void {
    // 撤幕留帧：见 `#holdFrameAfterCurtainDrop`（不动舞台 ⇒ 屏上保留上一帧）
    if (this.#holdFrames > 0) {
      this.#holdFrames--;
      this.#pushLog(`[frame-hold] 跳过本次 present（剩 ${this.#holdFrames} 帧）`);
      return;
    }
    this.clockMs = performance.now() - this.wallStart;
    // 消息窗文本：先按内容版本号重建纹理，再与 draw-item 按同一 layer 归并合成
    const textSprites = this.textLayer.sync(this.scene);
    this.presenter.present(this.scene, this.clockMs, this.waitFlags, textSprites);
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
