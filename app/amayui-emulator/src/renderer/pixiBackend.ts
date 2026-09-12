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
import { advanceWindows, itemColor, itemRotationRad, itemScale, itemSrcRect, itemTranslation, type DrawItemConfig, type Item, type MeshObj, type Vec3 } from './drawItem.js';
import {
  newSceneState,
  scAnimationsDone,
  scClearDrawContainer,
  scMsgWinClear,
  scMsgWinClearAll,
  scMsgWinSync,
  scConfigureDrawItem,
  scCreateMesh,
  scDetachTexture,
  scDrawCgNumber,
  scDrawString,
  scCreateTextureReset,
  scSetDrawColor,
  scSetDrawColorAlpha,
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

  createMesh(spec: MeshCreateSpec): void {
    this.#markDirty();
    const m = scCreateMesh(this.scene, spec.handle, spec.layer);
    assertFlags('mesh', m.handle, m.flags);
    this.#pushLog(`createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount}`);
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

  /** `0x208`：纹理尺寸 getter（写回脚本操作数由 opcode 侧负责）。 */
  getTextureSize(slot: number): { w: number; h: number } {
    return this.textures.size(slot);
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

  /** `0x322`（`sub_4AE2C0`）：mesh 顶点色 state0。★缺失即建项、无门控。 */
  setVertexColor(handle: number, state0: number): void {
    this.#markDirty();
    const o = scSetVertexColor(this.scene, handle, state0);
    this.#assertMesh(handle);
    this.#pushLog(`setVertexColor h=0x${handle.toString(16)} state0=0x${state0.toString(16)}${o === 'applied' ? '' : ' [建空项]'}`);
  }

  /** `0x323`（`sub_4AE330`）：mesh 顶点色动画窗。★缺失即建项、无门控。 */
  setVertexColorAlpha(handle: number, delay: number, count: number, state1: number): void {
    this.#markDirty();
    const o = scSetVertexColorAlpha(this.scene, handle, delay, count, state1);
    this.#assertMesh(handle);
    this.#pushLog(`setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${state1.toString(16)}${o === 'applied' ? '' : ' [建空项]'}`);
  }

  setDrawColorAlpha(handle: number, from: number): void {
    this.#markDirty();
    const o = scSetDrawColorAlpha(this.scene, handle, from);
    this.#assertItem(handle);
    this.#pushLog(`setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)}${o === 'applied' ? '' : ' [建空项]'}`);
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
    const r = scDetachTexture(this.scene, handle, count);
    if (count <= 1) {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} REMOVE (drawItems=${r.drawItems}, meshes=${r.meshes})`);
    } else {
      this.#pushLog(`detachTexture h=0x${handle.toString(16)} count=${count} RANGE-REMOVE [0x${handle.toString(16)},0x${(handle + count).toString(16)}) (drawItems=${r.drawItems}, meshes=${r.meshes})`);
    }
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
