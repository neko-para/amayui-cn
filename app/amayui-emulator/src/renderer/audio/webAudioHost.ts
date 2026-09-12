/**
 * **Web Audio 宿主** —— `AudioHost` 的真实实现（Electron 渲染进程用）。
 *
 * 职责边界（与 `src/audio/audioEngine.ts` 的约定）：
 *  - 本文件只管「取字节 / 解码 / 起播 / 停播」四件事；
 *  - 通道、音量、pan、循环、延迟、语音仲裁、ADV 寄存全部在 `AudioEngine` 里（可单测）；
 *  - 因此本文件几乎不含逻辑，只有 Web Audio 的样板与两处兜底（见下）。
 *
 * ## 取字节的两条路
 *  1. `window.api.audio(id)`（IPC → 主进程 `NodeFileSource.readById` 取 ALF 成员）——SE/语音用；
 *  2. `amayui-audio://<id>`（主进程自定义协议 + **Range**）→ BGM 用 `<audio>` **流式**播放，
 *     不把 2–6MB 解成 30–50MB PCM（见 `docs/13-audio-plan.md` §3.2/§3.3）。
 *
 * ## 两处兜底（都是"宁可退化也不要静音"）
 *  1. **流式失败自动退化为解码**：`<audio>` 报错（协议没注册/取字节失败）时，`#StreamPlayback`
 *     会在后台 `load+decode` 同一个 id 并用 `AudioBufferSourceNode` 重播，音量/pan/循环设置照搬；
 *  2. **AudioContext 被自动播放策略挂起**：构造即尝试 `resume()`，并在首次 `keydown/pointerdown`
 *     上也 resume 一次（Electron 侧另有 `autoplay-policy=no-user-gesture-required` 开关，见 `electron/main.ts`）。
 */

import type { AudioClip, AudioHost, AudioPlayback, AudioResource, PlayOptions } from '../../audio/audioEngine.js';

/** Web Audio 下的 clip：`handle` 就是解码后的 `AudioBuffer`。 */
interface WebClip extends AudioClip {
  readonly handle: AudioBuffer;
}

/** 供宿主/诊断查询的运行时信息。 */
export interface WebAudioHostInfo {
  contextState: string;
  streamEnabled: boolean;
  /** 流式回退次数（`<audio>` 失败 → 解码重播）。 */
  streamFallbacks: number;
}

/** `AudioResource` → IPC 参数（数字 = 统一文件 id；字符串 = 文件名）。 */
function resToParam(res: AudioResource): number | string {
  return 'id' in res ? res.id : res.name;
}

/** `AudioResource` → 供 `decode` 记录用的数字 id（BGM 用曲号；诊断只用）。 */
function resKeyNum(res: AudioResource): number {
  if ('id' in res) return res.id;
  const m = /(\d+)/.exec(res.name);
  return m ? Number(m[1]) : 0;
}

/** `AudioResource` → 协议 URL：纯数字段 = id，否则 = 文件名（主进程按段判断）。 */
function resToUrl(base: string, res: AudioResource): string {
  return `${base}${'id' in res ? res.id : res.name}`;
}

export interface WebAudioHostOptions {
  /** 取字节（默认走 `window.api.audio`；取不到再试 `fetch(streamBase+…)`）。 */
  load?: (param: number | string) => Promise<Uint8Array | null>;
  /** 流式基址（默认取 `window.api.audioStreamBase`）；缺省 ⇒ 不启用流式。 */
  streamBase?: string;
  log?: (msg: string) => void;
  /** 注入 AudioContext 工厂（测试/自定义；默认 `new AudioContext()`）。 */
  createContext?: () => AudioContext;
}

export class WebAudioHost implements AudioHost {
  readonly #opts: WebAudioHostOptions;
  readonly #log: (msg: string) => void;
  #ctx: AudioContext | null = null;
  #streamBase: string;
  #streamFallbacks = 0;
  /** 流式协议可达性探测结果：`null` = 未探测。不可达时 `streamUrl()` 返回 undefined（BGM 直接走解码）。 */
  #streamOk: boolean | null = null;
  #probeStarted = false;
  /** 一次性事件绑定标记（首个手势时 resume）。 */
  #gestureHooked = false;

  constructor(opts: WebAudioHostOptions = {}) {
    this.#opts = opts;
    this.#log = opts.log ?? ((): void => {});
    this.#streamBase = opts.streamBase ?? (typeof window !== 'undefined' ? (window.api?.audioStreamBase ?? '') : '');
    if (this.#streamBase) this.#probeStream();
  }

  /**
   * **自检**：流式协议是否真的可用（CSP / CORS / scheme 注册任一环节不对，`<audio>` 只会给一句
   * "no supported source was found"，且**请求根本到不了主进程**，极难定位）。
   *
   * 探测用 `fetch`（同一套 scheme 权限），结果决定 BGM 走流式还是直接解码；
   * 失败时留一条带原因/状态码的日志 —— 这一条是 2026-09 定位 CSP 问题时加的。
   */
  #probeStream(): void {
    if (this.#probeStarted) return;
    this.#probeStarted = true;
    // 用 id 0（SYSTEM4.BIN，一定存在）探可达性；只取 2 字节
    void fetch(`${this.#streamBase}0`, { headers: { Range: 'bytes=0-1' } })
      .then((r) => {
        this.#streamOk = r.ok || r.status === 206;
        this.#log(`[audio] 流式协议探测：status=${r.status} ⇒ ${this.#streamOk ? '走流式' : '退回解码'}`);
      })
      .catch((err: Error) => {
        this.#streamOk = false;
        this.#log(`[audio] 流式协议探测失败（${err.message}）⇒ BGM 退回解码播放`);
      });
  }

  info(): WebAudioHostInfo {
    return {
      contextState: this.#ctx?.state ?? 'none',
      streamEnabled: this.#streamBase.length > 0,
      streamFallbacks: this.#streamFallbacks,
    };
  }

  /** 懒创建 AudioContext（首次真正要出声时才建，避免"打开就创建"的启动副作用）。 */
  #ensureCtx(): AudioContext {
    if (this.#ctx) return this.#ctx;
    const ctx = this.#opts.createContext ? this.#opts.createContext() : new AudioContext();
    this.#ctx = ctx;
    if (!this.#gestureHooked && typeof window !== 'undefined') {
      this.#gestureHooked = true;
      const resume = (): void => void ctx.resume().catch(() => undefined);
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    }
    void ctx.resume().catch(() => undefined);
    this.#log(`[audio] AudioContext 建立（state=${ctx.state}, ${ctx.sampleRate}Hz, 流式=${this.#streamBase ? 'on' : 'off'}）`);
    return ctx;
  }

  resume(): void {
    void this.#ensureCtx().resume().catch(() => undefined);
  }

  // ==================== 取字节 / 解码 ====================

  async load(res: AudioResource): Promise<Uint8Array | null> {
    if (this.#opts.load) return await this.#opts.load(resToParam(res));
    const param = resToParam(res);
    try {
      const viaIpc = await window.api?.audio?.(param);
      if (viaIpc && viaIpc.length > 0) return viaIpc instanceof Uint8Array ? viaIpc : new Uint8Array(viaIpc);
    } catch (err) {
      this.#log(`[audio] IPC 取字节失败 ${JSON.stringify(param)}: ${(err as Error).message}`);
    }
    if (this.#streamBase) {
      try {
        const r = await fetch(resToUrl(this.#streamBase, res));
        if (r.ok) return new Uint8Array(await r.arrayBuffer());
      } catch (err) {
        this.#log(`[audio] 协议取字节失败 ${JSON.stringify(param)}: ${(err as Error).message}`);
      }
    }
    return null;
  }

  async decode(id: number, bytes: Uint8Array): Promise<AudioClip | null> {
    const ctx = this.#ensureCtx();
    // decodeAudioData 会**转移**传入的 ArrayBuffer ⇒ 传一份独立拷贝，别把调用方的字节吃掉
    const copy = bytes.slice();
    try {
      const buf = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
      const clip: WebClip = { id, durationSec: buf.duration, bytes: bytes.length, handle: buf };
      return clip;
    } catch (err) {
      this.#log(`[audio] 解码失败 id=${id}（${bytes.length}B）: ${(err as Error).message}`);
      return null;
    }
  }

  // ==================== 播放 ====================

  play(clip: AudioClip, opts: PlayOptions): AudioPlayback {
    const ctx = this.#ensureCtx();
    const web = clip as WebClip;
    const src = ctx.createBufferSource();
    src.buffer = web.handle;
    src.loop = opts.loop;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan;
    src.connect(panner).connect(gain).connect(ctx.destination);
    const startedAt = ctx.currentTime;
    src.start(0, Math.max(0, opts.offsetSec ?? 0));
    return new BufferPlayback(src, gain, panner, ctx, startedAt, web.durationSec);
  }

  streamUrl(res: AudioResource): string | undefined {
    if (!this.#streamBase) return undefined;
    if (this.#streamOk === false) return undefined; // 探测失败 ⇒ 不假装能流式
    return resToUrl(this.#streamBase, res);
  }

  playStream(url: string, res: AudioResource, opts: PlayOptions): AudioPlayback {
    const el = new Audio();
    el.loop = opts.loop;
    el.preload = 'auto';
    el.volume = clamp01(opts.gain);
    // ★**不经 Web Audio 图**（2026-09 实测教训）：页面是 `file://`，而 `amayui-audio://` 是另一个源，
    //   Chromium 会把这种元素判为 **tainted**，`createMediaElementSource` 的输出**恒为静音**
    //   ⇒ 表现是"日志里流式起播了，但一点声音都没有"。BGM 只需要一个标量增益，直接用 `el.volume`
    //   （顺带不依赖 CORS，也不再需要 AudioContext）。
    el.src = url;
    const pb = new StreamPlayback(el, url, this.#log);
    el.addEventListener('loadedmetadata', () => {
      this.#log(`[audio] <audio> 元数据 ${url} 时长=${Math.round(el.duration)}s`);
    }, { once: true });
    for (const ev of ['stalled', 'suspend', 'waiting', 'abort'] as const) {
      el.addEventListener(ev, () => this.#log(`[audio] <audio> 事件 ${ev} ${url}`), { once: true });
    }
    // 兜底：流式取不到字节（协议缺失/切片失败）⇒ 后台换成解码重播
    el.addEventListener('error', () => {
      this.#streamFallbacks++;
      this.#log(`[audio] 流式失败（${url}）⇒ 退化为解码播放 ${JSON.stringify(resToParam(res))}`);
      void this.#fallbackToDecode(pb, res, opts);
    }, { once: true });
    void el
      .play()
      .then(() => {
        this.#log(`[audio] 流式起播确认 ${url}（readyState=${el.readyState} 时长=${Math.round(el.duration)}s 音量=${el.volume.toFixed(2)}）`);
      })
      .catch((err: Error) => this.#log(`[audio] <audio>.play() 被拒：${err.message}（${url}）`));
    return pb;
  }

  /** 流式失败后的退化路径：取字节 → 解码 → 用缓冲播放，并接管原句柄的控制。 */
  async #fallbackToDecode(pb: StreamPlayback, res: AudioResource, opts: PlayOptions): Promise<void> {
    const bytes = await this.load(res);
    if (!bytes) {
      this.#log(`[audio] 退化失败：${JSON.stringify(resToParam(res))} 取不到字节`);
      return;
    }
    const clip = await this.decode(resKeyNum(res), bytes);
    if (!clip) return;
    pb.adopt(this.play(clip, { ...opts, ...pb.currentOptions() }));
  }

  // ==================== 关闭 ====================

  dispose(): void {
    void this.#ctx?.close().catch(() => undefined);
    this.#ctx = null;
  }
}

/** `AudioBufferSourceNode` 播放句柄。 */
class BufferPlayback implements AudioPlayback {
  #stopped = false;
  constructor(
    private readonly src: AudioBufferSourceNode,
    private readonly gain: GainNode,
    private readonly panner: StereoPannerNode,
    private readonly ctx: AudioContext,
    private readonly startedAt: number,
    private readonly durationSec: number,
  ) {}

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    try {
      this.src.stop();
    } catch {
      /* 已经停了 */
    }
    this.src.disconnect();
  }

  setGain(gain: number): void {
    if (!this.#stopped) this.gain.gain.value = gain;
  }

  setPan(pan: number): void {
    if (!this.#stopped) this.panner.pan.value = pan;
  }

  setLoop(loop: boolean): void {
    this.src.loop = loop;
  }

  positionSec(): number {
    if (this.durationSec <= 0) return 0;
    return (this.ctx.currentTime - this.startedAt) % this.durationSec;
  }
}

/** `<audio>`（流式）播放句柄；`adopt()` 用于退化后接管解码播放。 */
class StreamPlayback implements AudioPlayback {
  #inner: AudioPlayback | null = null;
  #stopped = false;
  constructor(
    private readonly el: HTMLAudioElement,
    private readonly url: string,
    private readonly log: (m: string) => void,
  ) {}

  /** 当前设置（退化时照搬给解码播放）。 */
  currentOptions(): Pick<PlayOptions, 'loop' | 'gain' | 'pan'> {
    return { loop: this.el.loop, gain: this.el.volume, pan: 0 };
  }

  /** 退化：换用另一个 playback，并把已有设置搬过去。 */
  adopt(next: AudioPlayback): void {
    if (this.#stopped) {
      next.stop();
      return;
    }
    this.#inner = next;
    this.#stopElement();
    this.log(`[audio] 已接管解码播放 ${this.url}`);
  }

  #stopElement(): void {
    try {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    this.#stopped = true;
    this.#stopElement();
    this.#inner?.stop();
  }

  /** 音量走**元素自身**（不经 Web Audio 图，见 `playStream` 的说明）。 */
  setGain(gain: number): void {
    this.el.volume = clamp01(gain);
    this.#inner?.setGain(gain);
  }

  setPan(pan: number): void {
    // `<audio>` 元素没有 pan；BGM 恒为 0（引擎的 pan 只作用在 SE/语音通道上）
    if (pan !== 0) this.log(`[audio] 流式播放不支持 pan=${pan}（BGM 恒为 0）`);
    this.#inner?.setPan(pan);
  }

  setLoop(loop: boolean): void {
    this.el.loop = loop;
    this.#inner?.setLoop(loop);
  }

  positionSec(): number {
    return this.#inner?.positionSec?.() ?? this.el.currentTime ?? 0;
  }
}

/** 钳制到 0..1（`HTMLMediaElement.volume` 的值域）。 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
