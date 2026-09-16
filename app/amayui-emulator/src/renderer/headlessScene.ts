/**
 * **无渲染的宿主（HeadlessScene）**：用 `sceneModel.ts` 的共享语义实现 `NativeBridge`，
 * 但**不画任何东西** —— 只把模型留在内存里，并支持导出**确定性快照**。
 *
 * 三个用途（都是本轮"让隐性变显性"要解决的事）：
 *  1. **场景执行报告**：Node 里跑真实脚本，导出"这场景跑了哪些 op / 各多少次 / 最终模型长什么样"；
 *  2. **快照回归**：把快照存成人可读文本进仓库，任何语义改动都会显形（"变化必须被解释"）；
 *  3. **静默检测**：它**故意只实现自己真正建模的方法**，其余交给 `withNativeTap` 记成
 *     「意图被丢弃」事件 —— 于是"哪些能力缺了"变成一份可数的清单，而不是靠画面猜。
 *
 * 与 `PixiBackend` 的关系：两者共用 `sceneModel.ts` + `drawItem.ts` 的语义（唯一一份），
 * 只有副作用不同（画到 Pixi / 记进快照）。
 */
import {
  scAdvance,
  scPoolPending,
  scAnimationsPending,
  sceneNeedsRender,
  scClearDrawContainer,
  scConfigureDrawItem,
  scGetDrawItemPos,
  scGetDrawItemPivot,
  scGetDrawItemTexSlot,
  scCreateMesh,
  scDetachTexture,
  scDrawCgNumber,
  scSetDrawColor,
  scSetDrawColorAlpha,
  scCopyItem,
  scSwapItems,
  scSetDrawPivot,
  scDrawString,
  scCreateTextureReset,
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
  scMsgWinClear,
  scMsgWinClearAll,
  scSetRenderTarget,
  scSetSlotMode,
  scSetSceneBlend,
  scMsgWinSync,
  scSnapshot,
  snapshotToText,
  newSceneState,
  type SceneSnapshot,
  type SetterOutcome,
  type SceneState,
} from './sceneModel.js';
import type { DrawItemConfig, DrawStringStyle, MeshCreateSpec, NativeBridge } from '../vm/native.js';
import { AudioEngine, type AudioHost, type AudioIntent } from '../audio/audioEngine.js';
import type { MsgWinInput } from '../text/layout.js';
import type { InputManager } from '../vm/input.js';

export interface HeadlessOptions {
  /** 日志回调（默认丢弃；CLI 里可指向 stdout）。 */
  onLog?: (msg: string) => void;
  /**
   * 图像尺寸解析器（`0x208` getter 用）。不给时 `getTextureSize` 返回 0/0 —— 并**记一条缺口事件**，
   * 因为"恒返回 0×0"是 headless 的已知局限，不能让它静默变成"脚本收到的尺寸就是 0"。
   */
  imageSize?: (imgid: number) => { w: number; h: number } | null;
  /**
   * **音频宿主**（可选；`tickets/T-0006`/`T-0003`）。给了 ⇒ 本宿主实现 `audio`，里面跑**真 `AudioEngine`**
   * ⇒ 帧驱动每帧的 `tick` 会真的推进"SE 延迟到期 / 语音排队与占线 / ADV 寄存冲刷 / BGM 淡变"。
   * 不给 ⇒ **不实现** `audio`（与修前一致：闸门 A 把音频意图记成"意图被丢弃"）——
   * 这个默认值同时保住了 G2：`report.ts` 的输出必须逐字节不变。
   * 现成实现：`src/audio/nodeAudioHost.ts`（真字节 + 容器头推时长，不出声）。
   */
  audioHost?: AudioHost;
  /** 音频引擎的额外选项（缓存上限等）。仅在给了 `audioHost` 时有意义。 */
  audioOptions?: { cacheBytes?: number };
}

/** headless 特有的"能力缺口"事件（宿主已实现但语义不完整时使用）。 */
export interface HeadlessGap {
  what: string;
  count: number;
  sample: string;
}

/** 「缺失即建项」统计（引擎 `sub_4AAA50`/`sub_4AAB80` 路径被走到的次数）。 */
export interface EnsureStats {
  /** setter 为不存在的项建了默认项（flags=0 ⇒ 尚不可绘制），且该 setter 无门控、字段已写入。 */
  createdApplied: number;
  /** 同上，但该 setter 有 `flags & 1` 门控 ⇒ 只建项、字段未生效（0x202/0x21E/0x21F/0x220/0x239）。 */
  createdGated: number;
}

export class HeadlessScene implements NativeBridge {
  readonly scene: SceneState = newSceneState();
  input?: InputManager;

  /** 槽 → imgid（`0x1F9` set-texture 建立的绑定；`0x1FA` 释放）。 */
  readonly slotImgid = new Map<number, number>();
  /** 引擎里"程序化纹理"标记（`0x1F8` 建过、非文件图像）⇒ 尺寸未知。 */
  readonly proceduralSlots = new Set<number>();
  /** 程序化槽的**表面尺寸**（`0x1F8` 的 op2/op3）—— 引擎 `CTexture+1040/+1044`。 */
  readonly slotSize = new Map<number, { w: number; h: number }>();

  /** 渲染/模型时钟（ms）。★由 `advanceModel(nowMs)`/`advance(clock)` 推入；门判据用同一份（`tickets/T-0008`）。 */
  clockMs = 0;
  frameTicks = 0;
  /** 被丢弃的副作用（本类不建模的那些）—— 由调用方通过 DropRecorder 读；这里只留最直观的计数。 */
  readonly unmodeled: HeadlessGap[] = [];
  /** 「缺失即建项」统计（引擎 `sub_4AAA50` 路径）。 */
  readonly ensure: EnsureStats = { createdApplied: 0, createdGated: 0 };
  readonly logs: string[] = [];

  /**
   * **音频意图**（`NativeBridge.audio`）：与 Electron 侧同一个 `AudioEngine.handle`。
   *
   * ★**条件能力**：只有构造时给了 `audioHost` 才**存在**（本方法在构造器里按需赋值，原型上没有它）。
   * 这样"没给宿主"与"宿主没实现"在闸门 A 眼里是同一件事 —— 音频意图会被记成「意图被丢弃」，
   * 而不是变成一个**静默的空实现**（后者会让缺口彻底不可见，正是 `tickets/T-0013` 要防的事）。
   */
  audio?: (intent: AudioIntent) => void;

  readonly audioEngine: AudioEngine | null;

  /** 本宿主收到的音频意图条数（进 `FrameDigest.host` 段；不参与两宿主比较）。 */
  audioIntentCount = 0;
  /** 本帧 `0x208`（纹理尺寸）的答案记录（`--record` 用；见 `drainTextureSizeLog`）。 */
  texSizeLog: { slot: number; w: number; h: number }[] = [];
  /** 回放时"录下来的 `0x208` 答案"队列（见 `setTextureSizeAnswers`）。 */
  #texSizeQueue: { slot: number; w: number; h: number }[] | null = null;

  constructor(private readonly opt: HeadlessOptions = {}) {
    if (opt.audioHost) {
      // ★帧泵由**驱动**每帧调（`tickets/T-0003` 的 D5）：`runFrameLoop` → `host.audio({kind:'tick',…})`
      //   → `HeadlessScene.audio` → `AudioEngine.handle`，与 Electron 的 `session.#present()` 同一条链。
      const eng = new AudioEngine(opt.audioHost, { ...(opt.audioOptions ?? {}), log: (m) => this.log(m) });
      this.audioEngine = eng;
      this.audio = (intent) => {
        this.audioIntentCount++;
        eng.handle(intent);
      };
    } else {
      this.audioEngine = null;
    }
  }

  /** `FrameHost.digestState`：本宿主的场景模型（`frame/digest.ts` 的纯函数构建器吃它）。 */
  digestState(): SceneState {
    return this.scene;
  }

  /** `FrameHost.digestHostCounters`：headless 无纹理（屏障恒 0）、无光栅化（缺字恒 0）。 */
  digestHostCounters(): { barriers: number; audioIntents: number; fontMisses: number } {
    return { barriers: 0, audioIntents: this.audioIntentCount, fontMisses: 0 };
  }

  private note(what: string, sample: string): void {
    const g = this.unmodeled.find((x) => x.what === what);
    if (g) g.count++;
    else this.unmodeled.push({ what, count: 1, sample });
  }

  /** 统一处理 setter 结局（三种：已写 / 建项后已写 / 建项但被门控）。 */
  private outcome(o: SetterOutcome, what: string, sample: string): void {
    if (o === 'created-applied') this.ensure.createdApplied++;
    else if (o === 'created-gated') this.ensure.createdGated++;
    if (o === 'created-gated') this.note(`${what}（项不存在 ⇒ 建空项，但被 flags&1 门控 ⇒ 未生效）`, sample);
  }

  log(msg: string): void {
    this.logs.push(msg);
    this.opt.onLog?.(msg);
  }

  // ---- 被真正建模的部分（走共享语义） ----

  configureDrawItem(cfg: DrawItemConfig): void {
    scConfigureDrawItem(this.scene, cfg);
  }

  drawTexture(args: number[]): void {
    const [tex = 0, layer = 0, x = 0, y = 0, w = 0, h = 0, p = 0, q = 0] = args;
    this.configureDrawItem({ handle: tex, layer, srcX: x, srcY: y, srcW: w, srcH: h, dstX: p, dstY: q, tex });
  }

  setTexture(args: number[]): void {
    const [imgid = 0, slot = 0] = args;
    this.bindTexture(imgid, slot);
  }

  bindTexture(imgid: number, slot: number): void {
    this.slotImgid.set(slot, imgid);
    this.proceduralSlots.delete(slot); // 绑定了文件图像 ⇒ 不再是程序化纹理
  }

  releaseTexture(slot: number): void {
    this.slotImgid.delete(slot);
    this.proceduralSlots.delete(slot);
  }

  /** `0x20D` 设置渲染目标（`tickets/T-0017`：混合选择子值 2 的门控依据）。 */
  setRenderTarget(slot: number): void {
    scSetRenderTarget(this.scene, slot);
  }

  /** `0x33F` op1 场景默认混合（`Scene+1260`）。 */
  setSceneBlend(blend: number): void {
    scSetSceneBlend(this.scene, blend);
  }

  createTexture(slot: number, _w: number, _h: number, _mode: number): void {
    // 引擎：释放旧纹理对象并**新建**一张程序化纹理 ⇒ 该槽不再指向已绑定的文件图像，
    // 且槽上的直绘文本随新表面一起消失（`0x204` 是往"已有表面"上叠字）。
    this.proceduralSlots.add(slot);
    scSetSlotMode(this.scene, slot, _mode); // ★纹理创建模式（`CTexture+1048`）：混合门控只认 mode 1
    scCreateTextureReset(this.scene, slot);
    if (_w > 0 && _h > 0) this.slotSize.set(slot, { w: _w, h: _h }); // 新建表面尺寸（0x208 getter 用）
    this.note('createTexture(程序化纹理内容由 draw-string 直绘，未生成位图)', `slot=${slot} ${_w}x${_h}`);
  }

  /** `0x204` draw-string：把整串文本记进该槽（无光栅化 —— headless 不做像素）。 */
  drawString(slot: number, x: number, y: number, text: string, style: DrawStringStyle): void {
    scDrawString(this.scene, slot, x, y, text, style.fill);
  }

  /**
   * `0x1AE` 写 `.STH` 缩略图：headless **没有画布** ⇒ 返回 null（调用方退化成"空块"）。
   * ★取舍是显式的：headless 只做状态/布局，像素级产物（缩略图）由 PixiBackend 负责。
   */
  getSlotPixels(_slot: number): { w: number; h: number; rgba: Uint8Array } | null {
    return null;
  }

  /**
   * `0x1AF` 读 `.STH` 缩略图：headless 只记尺寸（供 E3 断言"缩略图确实被解出并写进了该槽"），不存像素。
   */
  setSlotPixels(slot: number, w: number, h: number, _rgba: Uint8Array): void {
    this.slotSize.set(slot, { w, h });
    this.proceduralSlots.add(slot);
    this.note('setSlotPixels(.STH 缩略图 → 纹理槽，headless 只记尺寸)', `slot=${slot} ${w}x${h}`);
  }

  getTextureSize(slot: number): { w: number; h: number } {
    const imgid = this.slotImgid.get(slot);
    if (imgid === undefined || this.proceduralSlots.has(slot)) {
      // 槽为空 == 引擎口径 0/0；程序化槽（`0x1F8` 建的）尺寸由 create-texture 给出
      const s = this.slotSize.get(slot);
      if (s) return this.#logTexSize(slot, s);
      if (imgid === undefined) return this.#logTexSize(slot, { w: 0, h: 0 });
      this.note('getTextureSize(程序化纹理尺寸未知)', `slot=${slot}`);
      return this.#logTexSize(slot, { w: 0, h: 0 });
    }
    const sz = this.opt.imageSize?.(imgid) ?? null;
    if (!sz) {
      this.note('getTextureSize(headless 未解析图像尺寸)', `slot=${slot} imgid=0x${imgid.toString(16)}`);
      return this.#logTexSize(slot, { w: 0, h: 0 });
    }
    return this.#logTexSize(slot, sz);
  }

  /** 记一次 `0x208` 的答案（`--record` 录进轨迹；回放时由 `replayTextureSizes` 喂回来）。 */
  #logTexSize(slot: number, sz: { w: number; h: number }): { w: number; h: number } {
    this.texSizeLog.push({ slot, w: sz.w, h: sz.h });
    return sz;
  }

  /** 取走本帧的 `0x208` 答案记录（取走即清空）。 */
  drainTextureSizeLog(): { slot: number; w: number; h: number }[] {
    const out = this.texSizeLog;
    this.texSizeLog = [];
    return out;
  }

  /**
   * **接上"录下来的 `0x208` 答案"**（`tickets/T-0005` 的 G3 回放）。
   *
   * 为什么回放要把纹理尺寸当**输入数据**（而不是自己解析 AGF）：这个答案在录制侧
   * **依赖宿主的加载状态**（`pixiBackend.getTextureSize` 走 IPC 异步 ⇒ 图还没到就是 0×0），
   * 而脚本拿它算源矩形/描画位置 ⇒ 它直接改变场景状态。headless 没有纹理加载过程，
   * "自己解析出真实尺寸"只是**近似**那个异步答案（恰好加载完成时才相等）。
   * 于是：录制侧把它录下来，回放侧按帧、按调用顺序喂回去（位置队列见 `frame/trace.ts` 的 `runReplay`）。
   *
   * 缺口登记：让 headless **自带** AGF 尺寸解析（不靠录制）是独立事项，见 `tickets/T-0005/notes.md`。
   */
  setTextureSizeAnswers(queue: { slot: number; w: number; h: number }[]): void {
    this.#texSizeQueue = [...queue];
    this.opt.imageSize = (imgid) => this.#takeTexSize(imgid);
  }

  /** 从队列里取"本帧这次调用"的答案（按 slot 匹配优先；匹配不到就交出 0×0 并记一条缺口）。 */
  #takeTexSize(_imgid: number): { w: number; h: number } | null {
    const q = this.#texSizeQueue;
    if (!q || q.length === 0) return null;
    const slot = [...this.slotImgid.entries()].find(([, id]) => id === _imgid)?.[0];
    let idx = -1;
    if (slot !== undefined) idx = q.findIndex((e) => e.slot === slot);
    if (idx < 0) idx = 0; // 顺序兜底（slot 表可能已被 release/重建）
    const hit = q.splice(idx, 1)[0];
    return hit ? { w: hit.w, h: hit.h } : null;
  }

  createMesh(spec: MeshCreateSpec): void {
    scCreateMesh(this.scene, spec);
  }

  detachTexture(handle: number, count: number): void {
    scDetachTexture(this.scene, handle, count);
  }

  clearDrawContainer(): void {
    scClearDrawContainer(this.scene);
  }

  setDrawPos(handle: number, x: number, y: number, z: number): void {
    scSetDrawPos(this.scene, handle, x, y, z);
  }

  setDrawPivot(handle: number, x: number, y: number, z: number): void {
    scSetDrawPivot(this.scene, handle, x, y, z);
  }

  /**
   * `0x215`（sub_4ADC20）：绘制项 → 纹理槽号。**项不存在或 `flags & 1 == 0` ⇒ −1**（引擎原样）。
   * 与 `0x1FB` 把 op2 写进 `DrawItem+4` 一一对应。
   */
  getDrawItemTexSlot(handle: number): number {
    return scGetDrawItemTexSlot(this.scene, handle);
  }

  /** `0x218`（sub_4ADCF0）：绘制项 pivot 三元组；项不存在 ⇒ 全 0（引擎原样）。 */
  getDrawItemPivot(handle: number): { x: number; y: number; z: number } {
    return scGetDrawItemPivot(this.scene, handle);
  }

  /** `0x21A`（sub_4ADC80）：绘制项描画位置三元组；项不存在 ⇒ 全 0（引擎原样）。 */
  getDrawItemPos(handle: number): { x: number; y: number; z: number } {
    return scGetDrawItemPos(this.scene, handle);
  }

  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    scSetDrawTranslation(this.scene, handle, x, y, z);
  }

  /** `0x1FD` 立即缩放（走共享语义 ⇒ 报告与画面不会漂移）。 */
  setScale(handle: number, sx: number, sy: number, sz: number): void {
    scSetScale(this.scene, handle, sx, sy, sz);
  }

  // ---- A4 族（2026-09）：全部走共享场景语义（`scene/ops.ts` 的 `scXxx`）----

  /** `0x1FC` 复位图元变换。 */
  resetPrimTransform(handle: number): void {
    scResetPrimTransform(this.scene, handle);
  }

  /** `0x1FE` 图元变换 4 浮点（**原样**，不除 100）。 */
  setPrimTransform4(handle: number, a: number, b: number, c: number, d: number): void {
    scSetPrimTransform4(this.scene, handle, a, b, c, d);
  }

  /**
   * 槽→槽转送（`0x207` / `0x32`）：headless **没有画布** ⇒ 只把这次下发记进模型
   * （`scene.render4.blits`），返回 false（= 没转像素）。像素级产物由 `PixiBackend` 负责。
   */
  blitSlotToSlot(srcSlot: number, dstSlot: number, srcRect: number[], dstRect: number[]): boolean {
    scBlitSlotToSlot(this.scene, srcSlot, dstSlot, srcRect, dstRect);
    return false;
  }

  /** `0x20E` 图形提交（状态包裹 + 设备 Clear）。 */
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

  /**
   * `0x256` **按 id 区间立即平移**（`sub_4ACD10`）：`slot` + `count` 定义区间 `[slot, slot+count)`，
   * 对区间内**已存在**的绘制项写 work+target 平移。★收起侧边栏就靠它（`tickets/T-0028`）。
   */
  setSlotParams(slot: number, count: number, x: number, y: number, z: number): void {
    this.outcome(
      scSetSlotParams(this.scene, slot, count, x, y, z),
      'setSlotParams',
      `slot=0x${slot.toString(16)} count=0x${count.toString(16)} t=(${x},${y},${z})`,
    );
  }

  /** `0x321` MeshEntry 属性。 */
  setMeshEntryAttr(mesh: number, index: number, value: number): void {
    scSetMeshEntryAttr(this.scene, mesh, index, value);
  }

  /** `0x32A` 释放 3D 模型槽。 */
  release3DSlot(slot: number): void {
    scRelease3DSlot(this.scene, slot);
  }

  /** `0x32D` 3D 颜色（四分量 0..1）。 */
  set3DColor(r: number, g: number, b: number, a: number): void {
    scSet3DColor(this.scene, r, g, b, a);
  }

  setDrawColor(handle: number, delay: number, dur: number, to: number): void {
    this.outcome(scSetDrawColor(this.scene, handle, delay, dur, to), 'setDrawColor', `handle=0x${handle.toString(16)}`);
  }

  /** `0x214`：交换两条绘图项记录（键不动；只碰绘图项表）。引擎无错误串 ⇒ 不当作失败。 */
  swapItems(a: number, b: number): boolean {
    const swapped = scSwapItems(this.scene, a, b);
    this.log(`[scene] swapItems 0x${a.toString(16)} ↔ 0x${b.toString(16)}${swapped ? '' : '（两侧都不存在 ⇒ 只置脏位）'}`);
    return swapped;
  }

  /** `0x21D` CopyScene：源项（+网格）整份复制到目标 handle。源不存在 ⇒ false（引擎打错误串）。 */
  copyScene(srcHandle: number, dstHandle: number): boolean {
    const r = scCopyItem(this.scene, srcHandle, dstHandle);
    this.log(
      `[scene] CopyScene 0x${srcHandle.toString(16)} → 0x${dstHandle.toString(16)}` +
        (r.copied ? `（drawItem=${r.drawItem} mesh=${r.mesh}）` : '【源不存在】'),
    );
    return r.copied;
  }

  setDrawColorAlpha(handle: number, from: number, blend = 0): void {
    this.outcome(
      scSetDrawColorAlpha(this.scene, handle, from, blend),
      'setDrawColorAlpha',
      `handle=0x${handle.toString(16)}`,
    );
  }

  setScaleAnim(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void {
    this.outcome(
      scSetScaleAnim(this.scene, handle, delay, dur, sx, sy, sz),
      'setScaleAnim',
      `handle=0x${handle.toString(16)}`,
    );
  }

  setRotationAnim(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void {
    this.outcome(
      scSetRotationAnim(this.scene, handle, delay, dur, ax, ay, az, deg),
      'setRotationAnim',
      `handle=0x${handle.toString(16)}`,
    );
  }

  setTranslationAnim(handle: number, delay: number, dur: number, x: number, y: number, z: number): void {
    this.outcome(
      scSetTranslationAnim(this.scene, handle, delay, dur, x, y, z),
      'setTranslationAnim',
      `handle=0x${handle.toString(16)}`,
    );
  }

  setFlipbook(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void {
    this.outcome(
      scSetFlipbook(this.scene, handle, delay, dur, frames, cols, flags),
      'setFlipbook',
      `handle=0x${handle.toString(16)}`,
    );
  }

  setVertexColor(handle: number, index: number, alpha: number, rgb: number): void {
    this.outcome(
      scSetVertexColor(this.scene, handle, index, alpha, rgb),
      'setVertexColor',
      `handle=0x${handle.toString(16)} idx=${index} a=${alpha} rgb=0x${(rgb >>> 0).toString(16)}`,
    );
  }

  setVertexColorAlpha(handle: number, delay: number, dur: number, alpha: number, rgb: number): void {
    this.outcome(
      scSetVertexColorAlpha(this.scene, handle, delay, dur, alpha, rgb),
      'setVertexColorAlpha',
      `handle=0x${handle.toString(16)} d=${delay} c=${dur} a=${alpha} rgb=0x${(rgb >>> 0).toString(16)}`,
    );
  }

  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    scDrawCgNumber(this.scene, id, rec, value, x, y, digits, flags);
  }

  /**
   * `0x21C set-wait-flag`：headless **不保存这份镜像**（`tickets/T-0008`）。
   * 修前这里写 `this.waitFlags`，而全文件**没有任何读者**（死状态）；门状态的唯一真源是 `Engine.waitFlags`。
   */
  setWaitFlag(_mask: number): void {
    /* 无副作用：门状态由 Engine.waitFlags 管，宿主不需要镜像 */
  }

  // ---- 消息窗文本（引擎「每窗一张离屏表面」的等价物）----
  // headless 不做光栅化：排版结果直接进模型 ⇒ 报告/快照里能看见文字（这正是本轮要的可观测性）。

  msgWinSync(win: number, input: MsgWinInput): void {
    scMsgWinSync(this.scene, win, input);
  }

  msgWinClear(win: number): void {
    scMsgWinClear(this.scene, win);
  }

  msgWinClearAll(): void {
    scMsgWinClearAll(this.scene);
  }

  /** `0x20C`/`0x23C`：推进时钟并驱动所有动画窗（= `present()` 的"模型部分"）。 */
  frameTick(): void {
    this.frameTicks++;
  }

  // ---- 快照 / 推进 ----

  /** 推进到指定时钟（驱动 5 个窗），返回是否还有动画在跑。 */
  advance(clock: number): boolean {
    this.clockMs = clock;
    scAdvance(this.scene, clock);
    return scAnimationsPending(this.scene, clock);
  }

  // ---- 帧宿主能力（`FrameHost`；见 src/frame/host.ts）----
  //   headless 没有渲染，所以"合成一帧"在这里就是"推进模型"；两个方法都必须存在，
  //   否则共享帧驱动（src/frame/loop.ts）里 `0x400` 门永远等不到放行、模型永远不前进。

  /** `FrameHost.advanceModel`：把模型推进到本帧时钟（headless 没有渲染，这就是"合成"的全部内容）。 */
  advanceModel(nowMs: number): void {
    this.advance(nowMs);
  }

  /**
   * `FrameHost.poolPending`：**本遍推进后池是否还挂着**（`Scene+46516` 的等价物；`tickets/T-0024`）。
   * ★口径 = `scPoolPending`（mesh 窗 + draw item 5 窗，**排除 `+720` bit0 的元素**）——
   * 不是"门自己扫哪几个窗"的猜测：门 = 这条 + `Engine.gatePending` 的 `0x238` 计时器。
   * 时钟用 `advanceModel(nowMs)` 注入的 `clockMs`（"这一遍"的时间）。
   */
  poolPending(): boolean {
    return scPoolPending(this.scene, this.clockMs);
  }

  /**
   * `NativeBridge.needsRender`：**这一帧该不该"合成"**。
   *
   * headless 没有像素，它的"合成"= 出快照/被观察 ⇒ 判据与 pixi **同一个函数**（`sceneNeedsRender`），
   * 差别只在"脏"的来源：pixi 用宿主自己的 `sceneDirty`（+每次 present 清），headless 用**共享模型**的
   * `scene.dirty`（每个变更型 `sc*` 置位），并在 `snapshot()` 时清零 —— "取快照 = 消费当前状态"。
   *
   * ★它**不**参与"要不要推进模型"的决定：`advanceModel` 是模型推进（窗末收尾也发生在那里），
   * 跳过它会让动画永远收不了尾。驱动里 `advanceModel` 与 `present` 是两件事（`T-0003` 的 D5）。
   */
  needsRender(): boolean {
    return sceneNeedsRender(this.scene, this.clockMs, this.scene.dirty);
  }

  /**
   * 导出确定性快照。**同时清脏位**：快照就是 headless 的"合成一帧"，
   * 之后若模型没再变、也没有窗在跑，`needsRender()` 就应当回到 false。
   */
  snapshot(): SceneSnapshot {
    const s = scSnapshot(this.scene, this.clockMs);
    this.scene.dirty = false;
    return s;
  }

  snapshotText(): string {
    return snapshotToText(this.snapshot());
  }

  /** 纹理槽绑定表（槽 → imgid → 是否程序化），供报告的"槽解析"一节。 */
  slotTable(): { slot: number; imgid: number; procedural: boolean }[] {
    return [...this.slotImgid]
      .map(([slot, imgid]) => ({ slot, imgid, procedural: this.proceduralSlots.has(slot) }))
      .sort((a, b) => a.slot - b.slot);
  }
}
