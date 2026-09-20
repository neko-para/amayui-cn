/**
 * `NativeBridge` 的**无界面桩实现**：全部记录 + 返回默认，绝不触发真实渲染/音频/输入。
 *
 * 用途：
 *  - `src/run.ts`（命令行跑到 TITLE，安静模式）；
 *  - 各单元测试（只关心 VM 侧状态，不关心宿主副作用）。
 *
 * 真宿主实现见 `src/renderer/pixiBackend.ts`（Electron/WebGL）与
 * `src/renderer/headlessScene.ts`（Node 报告，共用 sceneModel 语义）。
 */
import type { DrawItemConfig, MeshCreateSpec, NativeBridge } from './native.js';
import type { MsgWinInput } from '../text/layout.js';

/** 把一条音频意图压成一行（headless 日志/测试断言用）。 */
export function formatAudioIntent(intent: import('../audio/audioEngine.js').AudioIntent): string {
  const kv = Object.entries(intent)
    .filter(([k]) => k !== 'kind')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return `${intent.kind}${kv ? ' ' + kv : ''}`;
}

/** 无界面桩实现：全部记录 + 返回默认，绝不触发真实渲染/音频/输入。 */
export class StubNative implements NativeBridge {
  constructor(private onLog: (msg: string) => void = (m) => console.log(m)) {}

  log(msg: string): void {
    this.onLog(msg);
  }
  /**
   * 音频意图（headless/测试）：只记一行，不产生声音。
   * 意图词汇表见 `src/audio/audioEngine.ts`；真实现见 `src/renderer/pixiBackend.ts` 的 `audio()`。
   */
  audio(intent: import('../audio/audioEngine.js').AudioIntent): void {
    this.log(`[native:stub] audio ${formatAudioIntent(intent)}`);
  }
  playSound(id: number, volume: number): void {
    this.log(`[native:stub] play-sound-effect id=0x${id.toString(16)} vol=${volume}`);
  }
  playBgm(id: number): void {
    this.log(`[native:stub] play-bgm id=0x${id.toString(16)}`);
  }
  playVoice(id: number): void {
    this.log(`[native:stub] play-voice id=0x${id.toString(16)}`);
  }
  drawTexture(args: number[]): void {
    // 默认实现：把 draw-texture 的 8 操作数解释为绘制项配置（与 op_draw_texture 同一语义）
    const [slot = 0, layer = 0, x = 0, y = 0, w = 0, h = 0, p = 0, q = 0] = args;
    this.log(`[native:stub] draw-texture slot=${slot} layer=${layer} src=(${x},${y},${w}x${h}) dst=(${p},${q})`);
  }
  setTexture(args: number[]): void {
    const [imgid = 0, slot = 0] = args;
    this.log(`[native:stub] set-texture imgid=0x${imgid.toString(16)} slot=${slot}`);
  }
  createTexture(slot: number, w: number, h: number, mode: number): void {
    this.log(`[native:stub] createTexture slot=${slot} ${w}x${h} mode=${mode}`);
  }
  setRenderTarget(slot: number): void {
    this.log(`[native:stub] setRenderTarget slot=${slot}`);
  }
  setSceneBlend(blend: number): void {
    this.log(`[native:stub] setSceneBlend ${blend}`);
  }
  setScale(handle: number, sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setScale h=0x${handle.toString(16)} (${sx},${sy},${sz})`);
  }
  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawTranslation h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  getTextureSize(slot: number): { w: number; h: number } {
    this.log(`[native:stub] getTextureSize slot=${slot}`);
    return { w: 0, h: 0 };
  }
  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    this.log(`[native:stub] drawCgNumber id=0x${id.toString(16)} rec=[${rec.join(',')}] value=${value} (${x},${y}) digits=${digits} flags=${flags}`);
  }
  setLight(idx: number, on: boolean): void {
    this.log(`[native:stub] setLight idx=${idx} on=${on}`);
  }
  releaseMovieSlots(): void {
    this.log('[native:stub] releaseMovieSlots (42..999)');
  }
  clearMeshSlots(): void {
    this.log('[native:stub] clearMeshSlots');
  }
  clearSlotRecords(): void {
    this.log('[native:stub] clearSlotRecords (1000x2 记录表)');
  }
  setRenderState(state: number, value: number): void {
    this.log(`[native:stub] setRenderState #${state} = ${value}`);
  }
  setFont(args: number[]): void {
    this.log(`[native:stub] set-font [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setString(s: string): void {
    this.log(`[native:stub] set-string "${s}"`);
  }
  stringResourceId(s: string): number {
    this.log(`[native:stub] string-resource-id "${s}"`);
    return -1;
  }
  getInputType(): number {
    return 0;
  }
  sleep(ms: number): void {
    this.log(`[native:stub] sleep ${ms}`);
  }
  unhandled(opcode: number, name: string): void {
    this.log(`[native:stub] unhandled subsystem opcode 0x${opcode.toString(16)} (${name})`);
  }

  // Plan A：桩版本记录 + 校验（严格）
  configureDrawItem(cfg: import('./native.js').DrawItemConfig): void {
    this.log(`[native:stub] configureDrawItem h=0x${cfg.handle.toString(16)} layer=${cfg.layer}`);
  }
  bindTexture(imgid: number, slot: number): void {
    this.log(`[native:stub] bindTexture imgid=0x${imgid.toString(16)} slot=${slot}`);
  }
  createMesh(spec: import('./native.js').MeshCreateSpec): void {
    this.log(`[native:stub] createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount}`);
  }
  setVertexColor(handle: number, index: number, alpha: number, rgb: number): void {
    this.log(`[native:stub] setVertexColor h=0x${handle.toString(16)} idx=${index} a=${alpha} rgb=0x${(rgb >>> 0).toString(16)}`);
  }
  setVertexColorAlpha(handle: number, delay: number, count: number, alpha: number, rgb: number): void {
    this.log(
      `[native:stub] setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} a=${alpha} rgb=0x${(rgb >>> 0).toString(16)}`,
    );
  }
  setDrawColorAlpha(handle: number, from: number, blend: number): void {
    this.log(`[native:stub] setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)} blend=${blend}`);
  }
  detachTexture(handle: number, count: number): void {
    this.log(`[native:stub] detachTexture h=0x${handle.toString(16)} count=${count}`);
  }
  setDrawColor(handle: number, delay: number, count: number, to: number): void {
    this.log(`[native:stub] setDrawColor h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${to.toString(16)}`);
  }

  /** `0x21D` CopyScene：headless 桩没有场景模型 ⇒ 只记一行、返回 true（不当作"源不存在"）。 */
  copyScene(srcHandle: number, dstHandle: number): boolean {
    this.log(`[native:stub] copyScene 0x${srcHandle.toString(16)} → 0x${dstHandle.toString(16)}`);
    return false;
  }

  setWaitFlag(mask: number): void {
    this.log(`[native:stub] setWaitFlag 0x${mask.toString(16)}`);
  }
  releaseTexture(layer: number): void {
    this.log(`[native:stub] releaseTexture layer=${layer}`);
  }
  playMovie(id: number, slot: number, mode: number): void {
    this.log(`[native:stub] playMovie id=0x${id.toString(16)} slot=${slot} mode=${mode}`);
  }
  /** `0x20B` FillTexture：桩无纹理槽表面 ⇒ 只留痕（引擎此时会打 FillTexture 错误串）。 */
  fillSlotRect(slot: number, x: number, y: number, w: number, h: number, argb: number, alpha: number): void {
    this.log(`[native:stub] fillSlotRect slot=${slot} (${x},${y},${w}x${h}) argb=0x${(argb >>> 0).toString(16)} alpha=${alpha}`);
  }
  setDrawPivot(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawPivot h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  /**
   * `0x215` 绘制项 → 纹理槽号（getter）。桩宿主没有场景模型 ⇒ 按引擎的"项不存在"语义返回 −1，
   * 与真实宿主（HeadlessScene/PixiBackend 走同一份 `scene/ops.ts`）保持同一契约。
   */
  getDrawItemTexSlot(handle: number): number {
    this.log(`[native:stub] getDrawItemTexSlot h=0x${handle.toString(16)} → -1（桩无场景）`);
    return -1;
  }
  /** `0x218` 绘制项 pivot（getter）。桩返回全 0（= 引擎"项不存在"分支）。 */
  getDrawItemPivot(handle: number): { x: number; y: number; z: number } {
    this.log(`[native:stub] getDrawItemPivot h=0x${handle.toString(16)} → (0,0,0)（桩无场景）`);
    return { x: 0, y: 0, z: 0 };
  }
  /** `0x21A` 绘制项描画位置（getter）。桩返回全 0（= 引擎"项不存在"分支）。 */
  getDrawItemPos(handle: number): { x: number; y: number; z: number } {
    this.log(`[native:stub] getDrawItemPos h=0x${handle.toString(16)} → (0,0,0)（桩无场景）`);
    return { x: 0, y: 0, z: 0 };
  }
  /** `0x228` 绘制项当前平移（getter）。桩返回 `undefined`（= 引擎 `sub_4AA060` 查表失败 ⇒ op1=1）。 */
  getDrawItemTranslation(handle: number): { x: number; y: number; z: number } | undefined {
    this.log(`[native:stub] getDrawItemTranslation h=0x${handle.toString(16)} → undefined（桩无场景）`);
    return undefined;
  }
  setDrawPos(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawPos h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  setScaleAnim(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setScaleAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} s=(${sx},${sy},${sz})`);
  }
  /**
   * `0x22A`/`0x22C`/`0x22D`/`0x22F`：**Scene 级世界矩阵**四条（只作用于层号 ∈ [20,30) 的项）。
   * ★桩没有场景模型 ⇒ 按契约只留痕（真语义在共享层 `scene/ops.ts` 的 `scSetScene*`）。
   */
  setSceneScale(sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setSceneScale (${sx},${sy},${sz})`);
  }
  setSceneTranslation(x: number, y: number, z: number): void {
    this.log(`[native:stub] setSceneTranslation (${x},${y},${z})`);
  }
  setSceneAxisScale(a: number, b: number, sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setSceneAxisScale a=${a} b=${b} s=(${sx},${sy},${sz})`);
  }
  setSceneAxisTranslation(a: number, b: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setSceneAxisTranslation a=${a} b=${b} t=(${x},${y},${z})`);
  }
  setRotationAnim(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void {
    this.log(`[native:stub] setRotationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} axis=(${ax},${ay},${az}) θ=${deg}`);
  }
  setTranslationAnim(handle: number, delay: number, dur: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setTranslationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} t=(${x},${y},${z})`);
  }
  setFlipbook(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void {
    this.log(`[native:stub] setFlipbook h=0x${handle.toString(16)} d=${delay} dur=${dur} frames=${frames} cols=${cols} flags=${flags}`);
  }
  /**
   * B 层（bit2）周期/循环动画（`0x230`–`0x235`）：桩宿主只留痕。
   * ★桩**不是**"少一个能力"：真语义在共享层 `scene/ops.ts`，桩没有场景模型 ⇒ 这里按契约返回 undefined。
   */
  setDrawItemLoop(req: import('./native.js').DrawItemLoopRequest): void {
    this.log(`[native:stub] setDrawItemLoop ${req.op} h=0x${req.handle.toString(16)}`);
  }
  /** `0x244` 批量清 A 层窗起点：桩无场景 ⇒ 返回 0（= 没有命中的绘制项）。 */
  clearDrawItemAnimStarts(mask: number): number {
    this.log(`[native:stub] clearDrawItemAnimStarts mask=${mask} → 0（桩无场景）`);
    return 0;
  }
  gfxSubsystem(a2: number, a3: number, a4: number): void {
    this.log(`[native:stub] gfxSubsystem op1=${a2} op2=${a3} op3=${a4}`);
  }
  /** 释放「留帧」：桩无画布 ⇒ 只留痕（引擎侧 = 装载点复位显示态 ⇒ 不留旧像素）。 */
  releaseFrameHold(): void {
    this.log('[native:stub] releaseFrameHold（读档点：不留旧像素）');
  }

  /** VM 每条指令派发前下发"正在执行哪一帧"（桩无模型 ⇒ 静默；记日志会每指令一行）。 */
  setCurrentFrame(_frame: number): void {}

  /** 丢掉"某一帧画的"绘制项（桩无画布 ⇒ 只留痕；见 `native.dropFrameItems` 的依据说明）。 */
  dropFrameItems(frame: number): number {
    this.log(`[native:stub] dropFrameItems frame=${frame}（读档点：丢掉被放弃调用方那一层 UI）`);
    return 0;
  }

  clearDrawContainer(): void {
    this.log('[native:stub] clearDrawContainer');
  }
  msgWinSync(win: number, input: MsgWinInput): void {
    // 桩不渲染，但把「收到文本」记下来 —— 否则"脚本显示了消息"这件事在无界面运行里完全不可见。
    const text = input.segments.map((x) => x.text).join('');
    this.log(`[native:stub] msgWinSync win=${win} segs=${input.segments.length} text="${text.slice(0, 40)}"`);
  }
  msgWinClear(win: number): void {
    this.log(`[native:stub] msgWinClear win=${win}`);
  }
  msgWinClearAll(): void {
    this.log('[native:stub] msgWinClearAll');
  }
  frameTick(): void {
    /* 每帧调用，stub 不记日志（避免刷屏） */
  }

  /**
   * **真实系统光标**（引擎 `0x10A` 的宿主侧）：stub 宿主没有光标 ⇒ 显式 no-op
   * （`tickets/T-0053` / `T-0058`）。★不实现会被闸门 A 记成宿主缺口，而 `i10a` 全库 1678 处 ⇒ 纯噪声。
   */
  setSystemCursor(_x: number, _y: number): void {
    /* 无光标可动 */
  }
}
