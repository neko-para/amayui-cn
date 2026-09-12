/**
 * **音频宿主的假实现**（测试用）：不碰 Web Audio，只记录"引擎让它做什么"。
 *
 * 为什么要有它：`AudioEngine`（`src/audio/audioEngine.ts`）的全部规则——通道、音量、pan、循环、
 * 延迟、语音仲裁、ADV 寄存器、LRU——都应当能在 Node 里断言，因此把"解码/起播"这两件宿主专属的事
 * 挡在接口后面（`AudioHost`）。真实实现见 `src/renderer/audio/webAudioHost.ts`。
 */
import type { AudioClip, AudioHost, AudioPlayback, AudioResource, PlayOptions } from '../src/audio/audioEngine.js';

/** `AudioResource` → 记录用的键（`id:46` / `name:BGM031.OGG`）。 */
export function resLabel(res: AudioResource): string {
  return 'id' in res ? `id:${res.id}` : `name:${res.name}`;
}

/** 一次 `play()` 的记录（含后续 `setGain/setPan/setLoop/stop` 的历史）。 */
export interface FakePlay {
  /** 播放的 clip id。 */
  id: number;
  /** 起播参数。 */
  opts: PlayOptions;
  stopped: boolean;
  /** 当前值与历史（断言"音量/pan 真的被改过"用）。 */
  gain: number;
  pan: number;
  loop: boolean;
  gainHistory: number[];
  panHistory: number[];
}

export interface FakeAudioHostOptions {
  /** 每个 id 的字节数（`load` 返回这么长的占位字节）。缺省 1024。 */
  sizeOf?: (id: number) => number;
  /** 每个 id 的时长（秒）。缺省 1s。 */
  durationOf?: (id: number) => number;
  /** 提供 `streamUrl`/`playStream`（模拟 Electron 的 `amayui-audio://` 协议可用）。 */
  streaming?: boolean;
  /** `load` 返回 null 的键（`id:46` / `name:BGM031.OGG`）。模拟取字节失败。 */
  missing?: Set<string>;
  /** `decode` 返回 null 的 id 集合（模拟解码失败）。 */
  undecodable?: Set<number>;
  /** 记录日志（默认丢弃）。 */
  onLog?: (msg: string) => void;
}

/** 假宿主：全部操作可断言。 */
export class FakeAudioHost implements AudioHost {
  /** `load()` 的调用顺序（`id:46` / `name:BGM031.OGG`）。 */
  readonly loads: string[] = [];
  /** `decode(id)` 的调用顺序。 */
  readonly decodes: number[] = [];
  /** 全部 `play()` 记录（顺序 = 起播顺序）。 */
  readonly plays: FakePlay[] = [];
  /** `playStream(url)` 记录。 */
  readonly streams: Array<{ url: string; res: string; opts: PlayOptions; stopped: boolean }> = [];
  readonly logs: string[] = [];

  #sizeOf: (id: number) => number;
  #durationOf: (id: number) => number;
  #streaming: boolean;
  #missing: Set<string>;
  #undecodable: Set<number>;
  #onLog: ((msg: string) => void) | null;

  constructor(opts: FakeAudioHostOptions = {}) {
    this.#sizeOf = opts.sizeOf ?? ((): number => 1024);
    this.#durationOf = opts.durationOf ?? ((): number => 1);
    this.#streaming = opts.streaming ?? false;
    this.#missing = opts.missing ?? new Set();
    this.#undecodable = opts.undecodable ?? new Set();
    this.#onLog = opts.onLog ?? null;
  }

  /** 已解码 clip 的 id（按解码顺序）。 */
  get decodedIds(): number[] {
    return [...this.decodes];
  }

  /** 当前正在播的记录（未 stop）。 */
  get active(): FakePlay[] {
    return this.plays.filter((p) => !p.stopped);
  }

  log(msg: string): void {
    this.logs.push(msg);
    this.#onLog?.(msg);
  }

  async load(res: AudioResource): Promise<Uint8Array | null> {
    const label = resLabel(res);
    this.loads.push(label);
    if (this.#missing.has(label)) return null;
    const num = 'id' in res ? res.id : Number(/(\d+)/.exec(res.name)?.[1] ?? 0);
    return new Uint8Array(this.#sizeOf(num));
  }

  async decode(id: number, bytes: Uint8Array): Promise<AudioClip | null> {
    this.decodes.push(id);
    if (this.#undecodable.has(id)) return null;
    return { id, durationSec: this.#durationOf(id), bytes: bytes.length, handle: id };
  }

  play(clip: AudioClip, opts: PlayOptions): AudioPlayback {
    const rec: FakePlay = {
      id: clip.id,
      opts: { ...opts },
      stopped: false,
      gain: opts.gain,
      pan: opts.pan,
      loop: opts.loop,
      gainHistory: [opts.gain],
      panHistory: [opts.pan],
    };
    this.plays.push(rec);
    return {
      stop: (): void => {
        rec.stopped = true;
      },
      setGain: (g: number): void => {
        rec.gain = g;
        rec.gainHistory.push(g);
      },
      setPan: (p: number): void => {
        rec.pan = p;
        rec.panHistory.push(p);
      },
      setLoop: (l: boolean): void => {
        rec.loop = l;
      },
      positionSec: (): number => 0,
    };
  }

  streamUrl(res: AudioResource): string | undefined {
    // 与真实宿主同形：`amayui-audio://audio/<id 或 文件名>`
    return this.#streaming ? `amayui-audio://audio/${'id' in res ? res.id : res.name}` : undefined;
  }

  playStream(url: string, res: AudioResource, opts: PlayOptions): AudioPlayback {
    const rec = { url, res: resLabel(res), opts: { ...opts }, stopped: false };
    this.streams.push(rec);
    return {
      stop: (): void => {
        rec.stopped = true;
      },
      setGain: (g: number): void => {
        rec.opts = { ...rec.opts, gain: g };
      },
      setPan: (p: number): void => {
        rec.opts = { ...rec.opts, pan: p };
      },
      setLoop: (l: boolean): void => {
        rec.opts = { ...rec.opts, loop: l };
      },
      positionSec: (): number => 0,
    };
  }

  resume(): void {
    /* 假宿主不需要 */
  }
}
