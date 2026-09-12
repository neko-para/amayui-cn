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
  destroyL2DSlot(slot: number): void {
    this.log(`[native:stub] destroyL2DSlot slot=${slot}`);
  }
  l2dSlotSet(slot: number, sel: number, value: number): void {
    this.log(`[native:stub] l2dSlotSet slot=${slot} sel=${sel} v=${value}`);
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
  setVertexColor(handle: number, state0: number): void {
    this.log(`[native:stub] setVertexColor h=0x${handle.toString(16)} state0=0x${state0.toString(16)}`);
  }
  setVertexColorAlpha(handle: number, delay: number, count: number, state1: number): void {
    this.log(`[native:stub] setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${state1.toString(16)}`);
  }
  setDrawColorAlpha(handle: number, from: number): void {
    this.log(`[native:stub] setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)}`);
  }
  detachTexture(handle: number, count: number): void {
    this.log(`[native:stub] detachTexture h=0x${handle.toString(16)} count=${count}`);
  }
  setDrawColor(handle: number, delay: number, count: number, to: number): void {
    this.log(`[native:stub] setDrawColor h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${to.toString(16)}`);
  }
  setWaitFlag(mask: number): void {
    this.log(`[native:stub] setWaitFlag 0x${mask.toString(16)}`);
  }
  releaseTexture(layer: number): void {
    this.log(`[native:stub] releaseTexture layer=${layer}`);
  }
  playMovie(id: number): void {
    this.log(`[native:stub] playMovie id=0x${id.toString(16)}`);
  }
  setDrawPivot(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawPivot h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  setDrawPos(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawPos h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  setScaleAnim(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setScaleAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} s=(${sx},${sy},${sz})`);
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
  setTextureTransform(handle: number, value: number): void {
    this.log(`[native:stub] setTextureTransform h=0x${handle.toString(16)} v=${value}`);
  }
  gfxSubsystem(a2: number, a3: number, a4: number): void {
    this.log(`[native:stub] gfxSubsystem op1=${a2} op2=${a3} op3=${a4}`);
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
}
