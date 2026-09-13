/**
 * **Node（headless）侧的音频宿主** —— 让 `AudioEngine` 的全部规则（通道/延迟/语音仲裁/ADV 寄存/BGM 淡变）
 * 在 Node 里**真的跑起来**，只是不出声（无声音设备）。
 *
 * 为什么需要它（`tickets/T-0006`，B3 的一环）：修前 `HeadlessScene` 根本不实现 `audio` ⇒
 * 两份 chain / `report` 里所有音频意图都被闸门 A 记成"意图被丢弃"，于是 headless **看不到**
 * "延迟 SE 什么时候响、语音通道什么时候释放、ADV 寄存的语音什么时候冲刷、BGM 淡变走到哪"
 * —— 而这些正是"headless 与 Electron 表现不一致"的一大块。
 *
 * 与 `webAudioHost`（Electron）的差别**只有两处**，都记在这里：
 *  1. `play()` 不接声音设备，只**记账**（`plays`），并回一个可 stop/setGain/setPan/setLoop 的哑句柄；
 *  2. `decode()` 不做真正的解码（Node 没有 Web Audio），而是**从容器头读出精确时长**：
 *     - OGG：首页取采样率（identification packet 的 `vorbis` 头，`+12` 的 u32le），
 *       末页取 granule position（`OggS` 页头 `+6` 的 u64le）⇒ `duration = granule / rate`；
 *     - WAV：`fmt ` 的 byteRate 与 `data` 的 size ⇒ `duration = dataSize / byteRate`。
 *     ⇒ `durationSec` 与 Electron 的 `decodeAudioData` **同量级、同用途**（语音占线/SE 通道释放的判据），
 *     不需要真的解码 PCM。其它容器 ⇒ 返回 null（当作解码失败，与宿主取不到字节同一条路）。
 */
import { bgmFileName, type AudioClip, type AudioHost, type AudioPlayback, type AudioResource, type PlayOptions } from './audioEngine.js';

/** 取字节的来源（`NodeFileSource` 的子集）。`{id}` 走统一文件 id，`{name}` 走文件名。 */
export interface AudioByteSource {
  readById(id: number): Promise<{ name: string; data: Uint8Array } | null>;
  readByName(name: string): Promise<{ name: string; data: Uint8Array } | null>;
}

export interface NodeAudioHostOptions {
  source: AudioByteSource;
  /** 日志（默认丢弃）。chain/报告把它接到自己的 trace 上。 */
  log?: (msg: string) => void;
  /** 时长兜底（`audioDurationSec` 认不出容器时）：返回秒数；不给 ⇒ 该资源按"解码失败"处理。 */
  fallbackDurationSec?: (id: number, bytes: Uint8Array) => number | null;
}

/** 读 u32 小端。 */
function u32le(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** 读 u64 小端（granule position；超过 2^53 的极端值按 0 处理）。 */
function u64le(b: Uint8Array, o: number): number {
  const lo = u32le(b, o);
  const hi = u32le(b, o + 4);
  if (hi === 0xffffffff && lo === 0xffffffff) return -1; // Vorbis 的"无 granule"哨兵
  return hi * 0x100000000 + lo;
}

const ascii = (b: Uint8Array, o: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i] ?? 0);
  return s;
};

/**
 * 从容器头推**精确**时长（秒）。认不出返回 null。
 *
 * OGG 的 granule 是"到该页为止的采样数"（Vorbis）⇒ 末页 granule ÷ 采样率 = 总时长。
 * 末页查找从尾部往前扫最多 64KB（一页最大约 64KB）。
 */
export function audioDurationSec(bytes: Uint8Array): number | null {
  // ---- OGG（BGM/语音：`BGM031.OGG` / `FIA3203.OGG`）----
  if (bytes.length > 27 + 16 && ascii(bytes, 0, 4) === 'OggS') {
    const nsegs = bytes[26]!;
    const payload = 27 + nsegs;
    // identification packet：`\x01vorbis` + version(4) + channels(1) + rate(4)
    if (ascii(bytes, payload + 1, 6) === 'vorbis') {
      const rate = u32le(bytes, payload + 12);
      if (rate > 0) {
        const from = Math.max(0, bytes.length - 65536);
        for (let p = bytes.length - 27; p >= from; p--) {
          if (ascii(bytes, p, 4) === 'OggS') {
            const granule = u64le(bytes, p + 6);
            if (granule > 0) return granule / rate;
          }
        }
      }
    }
    return null;
  }
  // ---- WAV（SE：`SE004.WAV`）----
  if (bytes.length > 44 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    let p = 12;
    let byteRate = 0;
    let dataSize = -1;
    while (p + 8 <= bytes.length) {
      const id = ascii(bytes, p, 4);
      const size = u32le(bytes, p + 4);
      if (id === 'fmt ') byteRate = u32le(bytes, p + 8 + 8);
      else if (id === 'data') dataSize = size;
      if (byteRate > 0 && dataSize >= 0) break;
      p += 8 + size + (size & 1); // chunk 按偶数对齐
    }
    if (byteRate > 0 && dataSize >= 0) return dataSize / byteRate;
    return null;
  }
  return null;
}

/** 一次 `play()` 的记账（供断言/证据）。 */
export interface NodePlay {
  id: number;
  opts: PlayOptions;
  stopped: boolean;
  gain: number;
  pan: number;
  loop: boolean;
}

/**
 * headless 音频宿主：**出声的地方哑掉，做决定的地方全真**。
 * `plays` / `loads` / `decodes` 就是"引擎让宿主干了什么"的可断言记录。
 */
export class NodeAudioHost implements AudioHost {
  /** 每次 `load` 的资源标签（`id:46` / `name:BGM031.OGG`）。 */
  readonly loads: string[] = [];
  readonly decodes: { id: number; bytes: number; durationSec: number }[] = [];
  readonly plays: NodePlay[] = [];
  readonly logs: string[] = [];

  readonly #source: AudioByteSource;
  readonly #log: (msg: string) => void;
  readonly #fallback: ((id: number, bytes: Uint8Array) => number | null) | null;

  constructor(opts: NodeAudioHostOptions) {
    this.#source = opts.source;
    this.#log = opts.log ?? ((): void => {});
    this.#fallback = opts.fallbackDurationSec ?? null;
  }

  #note(msg: string): void {
    this.logs.push(msg);
    this.#log(msg);
  }

  async load(res: AudioResource): Promise<Uint8Array | null> {
    if ('id' in res) {
      this.loads.push(`id:${res.id}`);
      const hit = await this.#source.readById(res.id);
      if (!hit) {
        this.#note(`[audio] 取字节失败：id:${res.id}`);
        return null;
      }
      return hit.data;
    }
    // BGM 传的是**曲号**（引擎 `MusicBase` 表）；宿主按 `BGM%03d.OGG` 解析
    // （与 Electron 侧 `resToParam`/主进程同口径，见 `sound-system.md` §5）。
    const name = res.name.includes('.') ? res.name : bgmFileName(Number(res.name) || 0);
    this.loads.push(`name:${name}`);
    const hit = await this.#source.readByName(name);
    if (!hit) {
      this.#note(`[audio] 取字节失败：name:${name}`);
      return null;
    }
    return hit.data;
  }

  async decode(id: number, bytes: Uint8Array): Promise<AudioClip | null> {
    const dur = audioDurationSec(bytes) ?? this.#fallback?.(id, bytes) ?? null;
    if (dur === null) {
      this.#note(`[audio] 无法从容器头推时长（id=${id}，${bytes.length}B）⇒ 按解码失败处理`);
      return null;
    }
    this.decodes.push({ id, bytes: bytes.length, durationSec: dur });
    return { id, durationSec: dur, bytes: bytes.length, handle: id };
  }

  play(clip: AudioClip, opts: PlayOptions): AudioPlayback {
    const rec: NodePlay = { id: clip.id, opts: { ...opts }, stopped: false, gain: opts.gain, pan: opts.pan, loop: opts.loop };
    this.plays.push(rec);
    this.#note(`[audio] headless 起播 id=${clip.id} ${clip.durationSec.toFixed(2)}s gain=${opts.gain.toFixed(2)} loop=${opts.loop}`);
    return {
      stop: (): void => {
        rec.stopped = true;
      },
      setGain: (g: number): void => {
        rec.gain = g;
      },
      setPan: (p: number): void => {
        rec.pan = p;
      },
      setLoop: (l: boolean): void => {
        rec.loop = l;
      },
      positionSec: (): number => 0,
    };
  }

  /** 无流式：强制走 `load + decode + play`（= 引擎"一次性解码后播放"的路径，决定更好比）。 */
  streamUrl(): undefined {
    return undefined;
  }

  resume(): void {
    /* 无声音设备 */
  }
}
