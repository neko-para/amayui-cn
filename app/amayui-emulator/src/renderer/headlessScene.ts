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
  scAnimationsDone,
  scClearDrawContainer,
  scConfigureDrawItem,
  scCreateMesh,
  scDetachTexture,
  scDrawCgNumber,
  scSetDrawColor,
  scSetDrawColorAlpha,
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
  scMsgWinClear,
  scMsgWinClearAll,
  scMsgWinSync,
  scSnapshot,
  snapshotToText,
  newSceneState,
  type SceneSnapshot,
  type SetterOutcome,
  type SceneState,
} from './sceneModel.js';
import type { DrawItemConfig, DrawStringStyle, MeshCreateSpec, NativeBridge } from '../vm/native.js';
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

  /** 舞台/待定标志（供 0x400 卫门与报告观察）。 */
  waitFlags = 0;
  clockMs = 0;
  frameTicks = 0;
  /** 被丢弃的副作用（本类不建模的那些）—— 由调用方通过 DropRecorder 读；这里只留最直观的计数。 */
  readonly unmodeled: HeadlessGap[] = [];
  /** 「缺失即建项」统计（引擎 `sub_4AAA50` 路径）。 */
  readonly ensure: EnsureStats = { createdApplied: 0, createdGated: 0 };
  readonly logs: string[] = [];

  constructor(private readonly opt: HeadlessOptions = {}) {}

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

  createTexture(slot: number, _w: number, _h: number, _mode: number): void {
    // 引擎：释放旧纹理对象并**新建**一张程序化纹理 ⇒ 该槽不再指向已绑定的文件图像，
    // 且槽上的直绘文本随新表面一起消失（`0x204` 是往"已有表面"上叠字）。
    this.proceduralSlots.add(slot);
    scCreateTextureReset(this.scene, slot);
    if (_w > 0 && _h > 0) this.slotSize.set(slot, { w: _w, h: _h }); // 新建表面尺寸（0x208 getter 用）
    this.note('createTexture(程序化纹理内容由 draw-string 直绘，未生成位图)', `slot=${slot} ${_w}x${_h}`);
  }

  /** `0x204` draw-string：把整串文本记进该槽（无光栅化 —— headless 不做像素）。 */
  drawString(slot: number, x: number, y: number, text: string, _style: DrawStringStyle): void {
    scDrawString(this.scene, slot, x, y, text);
  }

  getTextureSize(slot: number): { w: number; h: number } {
    const imgid = this.slotImgid.get(slot);
    if (imgid === undefined || this.proceduralSlots.has(slot)) {
      // 槽为空 == 引擎口径 0/0；程序化槽（`0x1F8` 建的）尺寸由 create-texture 给出
      const s = this.slotSize.get(slot);
      if (s) return s;
      if (imgid === undefined) return { w: 0, h: 0 };
      this.note('getTextureSize(程序化纹理尺寸未知)', `slot=${slot}`);
      return { w: 0, h: 0 };
    }
    const sz = this.opt.imageSize?.(imgid) ?? null;
    if (!sz) {
      this.note('getTextureSize(headless 未解析图像尺寸)', `slot=${slot} imgid=0x${imgid.toString(16)}`);
      return { w: 0, h: 0 };
    }
    return sz;
  }

  createMesh(spec: MeshCreateSpec): void {
    scCreateMesh(this.scene, spec.handle, spec.layer);
    if (spec.verts.length > 0) this.note('createMesh(顶点几何未建模，仅颜色窗)', `handle=0x${spec.handle.toString(16)} v=${spec.vcount}`);
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

  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    scSetDrawTranslation(this.scene, handle, x, y, z);
  }

  /** `0x1FD` 立即缩放（走共享语义 ⇒ 报告与画面不会漂移）。 */
  setScale(handle: number, sx: number, sy: number, sz: number): void {
    scSetScale(this.scene, handle, sx, sy, sz);
  }

  setDrawColor(handle: number, delay: number, dur: number, to: number): void {
    this.outcome(scSetDrawColor(this.scene, handle, delay, dur, to), 'setDrawColor', `handle=0x${handle.toString(16)}`);
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

  setVertexColor(handle: number, state0: number): void {
    this.outcome(scSetVertexColor(this.scene, handle, state0), 'setVertexColor', `handle=0x${handle.toString(16)}`);
  }

  setVertexColorAlpha(handle: number, delay: number, dur: number, state1: number): void {
    this.outcome(
      scSetVertexColorAlpha(this.scene, handle, delay, dur, state1),
      'setVertexColorAlpha',
      `handle=0x${handle.toString(16)}`,
    );
  }

  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    scDrawCgNumber(this.scene, id, rec, value, x, y, digits, flags);
  }

  setWaitFlag(mask: number): void {
    this.waitFlags |= mask;
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
    return !scAnimationsDone(this.scene, clock);
  }

  snapshot(): SceneSnapshot {
    return scSnapshot(this.scene, this.clockMs);
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
