/**
 * **音频引擎（宿主无关）** —— 按引擎的「1 个设备 + 3 个模块」模型实现播放逻辑。
 *
 * 引擎侧结论（证据/raw 行号）见 `docs-new/03-engine/sound-system.md`；本文件只把它翻成代码：
 *
 * | 引擎 | 这里 |
 * |---|---|
 * | 设备 15 通道（0..9 = SE / 12..14 = 语音） | `se[10]` + `voice[3]`（语音逻辑通道 0..2 ↔ 设备 12..14） |
 * | `设备[327+ch]` 通道音量（0..10000 线性） | `seVolume` / `voiceVolume` / `bgmVolume`（由 `sound:Volume0..4` 驱动） |
 * | `设备[342]` 主音量 | `master` |
 * | `设备[375+ch]` **pan** ±10000（`sub_4B6940` → `SetPan`） | `channel.pan` → `playback.setPan` |
 * | `设备[390+ch]` 每通道音量因子（`-1` = 不缩放） | `voice.factor`（0..10000，缺省 10000） |
 * | SoundBuffer `+9296` 循环标志 | `play({loop})` |
 * | SoundBuffer `+2331` 定位（毫秒） | `play({offsetSec})` |
 * | SE 延迟播 `[262/272/282/292]` + 每帧 `sub_4B5230` | `seDelay` + `tick()` |
 * | 语音 3 路槽（`armed/delay/id/loop`）+ 每帧 `sub_4BBAB0` | `voiceQueue` + `tick()` |
 * | ADV 激活位期间寄存（`Engine[122505/122508+ch]`）+ 位清除时冲刷 | `voiceDefer` + `tick(nowMs, advActive)` |
 * | Music 淡变（`sub_489D10`/`sub_489E50`：按步长走到目标） | `bgmFadeTo` + `tick()` |
 *
 * ★两条刻意的近似（都在代码里写明，避免以后被当成 bug）：
 *  1. **BGM 与语音重叠**：引擎在 `set:KeepMusicVoice` + `sound:MusicFadeOnVoicePlaying` 打开时**暂停** BGM
 *     （`sub_489C00`），这里改为**压低**（duck）——意图相同（让人声听得清）但不会丢掉播放位置；
 *  2. 音量曲线：引擎把 0..10000 线性值经 `log` 映射成 DirectSound 的百分之一 dB，数学上等价于
 *     `振幅 = v/10000`（DS 的 dB=20log10），因此这里直接用**线性增益**（见 `docs/13-audio-plan.md` §3.4）。
 *
 * 宿主只提供四件事：取字节、解码、起播、停播（见 `AudioHost`）。真实宿主 = Web Audio
 * （`src/renderer/audio/webAudioHost.ts`），测试宿主 = `test/helpers/fakeAudioHost.ts`。
 */

/** SE 通道数（设备 0..9）。 */
export const SE_CHANNELS = 10;
/** 语音逻辑通道数（设备 12..14）。 */
export const VOICE_CHANNELS = 3;
/** 语音第一条通道对应的设备通道号（仅用于日志/诊断）。 */
export const VOICE_CHANNEL_BASE = 12;

/** 音量/pan 的量程（引擎 `±10000`）。 */
export const VOLUME_MAX = 10000;

/** 音量类别（引擎 `sound:Volume0..4` / `0xC6` 的 op1）。 */
export const VOLUME_MASTER = 0;
export const VOLUME_BGM = 1;
export const VOLUME_SE = 2;
export const VOLUME_VOICE = 3;
export const VOLUME_MOVIE = 4;

/** 音频总线（`0xBB` SE 开关 / `sound:Voice` / `0xBC` BGM 开关）。 */
export type AudioBus = 'se' | 'voice' | 'bgm';

/** 已解码的一段音频。`handle` 由宿主解释（Web Audio 下是 `AudioBuffer`）。 */
export interface AudioClip {
  readonly id: number;
  readonly durationSec: number;
  /** 原始压缩字节数（LRU 预算按它算，避免用解码后的大小）。 */
  readonly bytes: number;
  readonly handle?: unknown;
}

/**
 * **音频资源定位**（两种，来自引擎的两套口径 —— 2026-09 实测订正）：
 *  - `{ id }`：**统一文件 id**（`SYS4INI` 索引下标）。SE（`play-sound-effect`）与语音（`play-voice`）用它：
 *    实测 `play-sound-effect 2e` → id 46 = `SE004.WAV`、`play-voice 0x162` → id 354 = `FIA3203.OGG`；
 *  - `{ name }`：**文件名**。BGM（`play-bgm`/`0xB7`/`0xB9`/`0xBF`）用的是**曲号**而不是文件 id：
 *    引擎 `MusicBase` 有一张「曲号 → 文件 id」表（`+1304`，索引 = `曲号 − 2`；见 `sub_48DB80` raw 108738），
 *    这张表在本作等价于 `BGM%03d.OGG`（脚本侧数据 `MUINIT.txt` 的两张表逐条吻合：A = 文件 id、B = 曲号）。
 *    ★用统一 id 解释曲号会**静音错曲**：`play-bgm 1f`（曲号 31 = 标题曲）曾被解析成 id 31 = `BGM041.OGG`
 *      （回想界面的曲子）—— 这正是 2026-09 用户报的「标题 BGM 放错」。
 */
export type AudioResource = { id: number } | { name: string };

/** 曲号 → BGM 文件名（引擎 `MusicBase` 表在本作的等价形式）。 */
export function bgmFileName(bgm: number): string {
  return `BGM${String(Math.max(0, Math.floor(bgm))).padStart(3, '0')}.OGG`;
}

/** 一次播放的可控制句柄（宿主实现）。 */
export interface AudioPlayback {
  stop(): void;
  setGain(gain: number): void;
  setPan(pan: number): void;
  setLoop(loop: boolean): void;
  /** 流式宿主（`<audio>`）用它报告播放位置；一次性缓冲宿主可不实现。 */
  positionSec?(): number;
}

export interface PlayOptions {
  loop: boolean;
  /** 线性增益（0..1），已含主音量与通道因子。 */
  gain: number;
  /** -1 全左 .. +1 全右。 */
  pan: number;
  /** 起播偏移（秒）；引擎的 `sub_4B5A30`（毫秒→字节）等价物。 */
  offsetSec?: number;
}

/** 音频宿主：引擎需要的全部外部能力（真实实现 = Web Audio；测试 = 假实现）。 */
export interface AudioHost {
  /** 取一段音频的原始字节（`AudioResource` 定位）。取不到返回 null。 */
  load(res: AudioResource): Promise<Uint8Array | null>;
  /** 解码（宿主负责缓存策略之外的一切）。失败返回 null。 */
  decode(id: number, bytes: Uint8Array): Promise<AudioClip | null>;
  /** 起播一段已解码音频。 */
  play(clip: AudioClip, opts: PlayOptions): AudioPlayback;
  /**
   * 一段音频的**流式 URL**（可选）。给了且 `playStream` 也在 ⇒ BGM 走流式
   * （真实宿主 = `amayui-audio://audio/<id 或 文件名>` 自定义协议 + `<audio>`，见执行计划 §3.3）；
   * 否则退回 `load`+`decode`+`play`。
   */
  streamUrl?(res: AudioResource): string | undefined;
  /** 流式播放；`res` 用于失败后退化到解码（宿主内部自己接续）。 */
  playStream?(url: string, res: AudioResource, opts: PlayOptions): AudioPlayback;
  /** 需要时恢复被浏览器挂起的 AudioContext（自动播放策略）。 */
  resume?(): void;
  log?(msg: string): void;
}

/** 一个 SE 通道。 */
interface SeChannel {
  /** 已装载的音效 id（引擎 `SE[1212+ch]`；0 = 未装载）。 */
  loadedId: number;
  clip: AudioClip | null;
  playback: AudioPlayback | null;
  loop: boolean;
  /** pan（±10000）。 */
  pan: number;
  /** 本次起播的时刻（ms；非循环音效的收尾判定用）。 */
  startedAtMs: number;
  /** 装载中/待播（`sePlay` 先于装载完成时挂起）。 */
  pending: { loop: boolean; offsetSec?: number } | null;
  /** 延迟播武装（引擎 `[262+ch]`/`[272+ch]`/`[282+ch]`/`[292+ch]`）。 */
  delay: { delayMs: number; loop: boolean; armedAtMs: number } | null;
}

/** 一条**音频意图**：VM 的音频 opcode 与宿主之间唯一的词汇表（`NativeBridge.audio` 的参数）。 */
export type AudioIntent =
  | { kind: 'se-load'; ch: number; id: number }
  | { kind: 'se-play'; ch: number; loop: boolean }
  | { kind: 'se-stop'; ch: number }
  | { kind: 'se-delay'; ch: number; loop: boolean; delayMs: number }
  | { kind: 'voice-play'; ch: number; id: number; loop: boolean }
  | { kind: 'voice-defer'; ch: number; id: number; loop: boolean }
  | { kind: 'voice-queue'; ch: number; id: number; aux: number; delayMs: number }
  | { kind: 'voice-reset'; ch: number }
  | { kind: 'voice-pan'; ch: number; pan: number }
  | { kind: 'voice-flag'; ch: number }
  | { kind: 'voice-factor-prepare'; ch: number; value: number }
  | { kind: 'voice-factor-apply'; ch: number; value: number }
  | { kind: 'bgm-play'; bgm: number; loop: boolean; res?: AudioResource }
  | { kind: 'bgm-stop' }
  | { kind: 'bgm-mode'; mode: number }
  | { kind: 'bgm-fade'; value: number; step: number }
  | { kind: 'enable'; target: AudioBus; on: boolean }
  | { kind: 'volume'; category: number; value: number }
  | { kind: 'policy'; keepMusicVoice: boolean; fadeOnVoice: boolean }
  | { kind: 'tick'; nowMs: number; advActive: boolean };

/** 一个语音通道（逻辑 0..2 ↔ 设备 12..14）。 */
interface VoiceChannel {
  clip: AudioClip | null;
  playback: AudioPlayback | null;
  startedAtMs: number;
  loop: boolean;
  /** pan（±10000）。 */
  pan: number;
  /** 音量因子（引擎 `[289+ch]`；0..10000，缺省 10000）。 */
  factor: number;
  /** 频道状态位（引擎 `[283+ch]`；仅记账，0x2F7 置 1、0x2F6 清 0）。 */
  flag: number;
  /** 0x2FF 预备但未生效的因子。 */
  preparedFactor: number | null;
  /** 排入的请求（引擎 `[265+ch]`/`[268+ch]`/`[271+ch]`/`[274+ch]`/`[277+ch]`）。 */
  request: { delayMs: number; armedAtMs: number; id: number; loop: boolean } | null;
  /** ADV 激活位期间的寄存（引擎 `Engine[122505+ch]`/`[122508+ch]`）。 */
  deferred: { id: number; loop: boolean } | null;
  /** 装载中：装载完成后自动起播。 */
  loading: { id: number; loop: boolean } | null;
}

export interface AudioDebugState {
  se: Array<{ ch: number; loadedId: number; playing: boolean; loop: boolean; pan: number; gain: number; delayMs: number | null }>;
  voice: Array<{ ch: number; playing: boolean; id: number; loop: boolean; pan: number; factor: number; prepared: number | null; queued: number | null; deferred: number | null }>;
  /** BGM：`bgm` = 曲号（不是统一文件 id），`name` = 由曲号推出的文件名。 */
  bgm: { bgm: number; name: string; playing: boolean; loop: boolean; enabled: boolean; mode: number; gain: number; fading: boolean } | null;
  volumes: { master: number; bgm: number; se: number; voice: number; movie: number };
  enabled: { se: boolean; voice: boolean; bgm: boolean };
  cache: { clips: number; bytes: number; hits: number; misses: number };
}

export interface AudioEngineOptions {
  /** 解码缓存预算（字节；按压缩字节计）。默认 96MB（见执行计划 §3.2）。 */
  cacheBytes?: number;
  /** 语音与 BGM 重叠时的压低系数（默认 0.35）。 */
  duckGain?: number;
  log?: (msg: string) => void;
}

const DEFAULT_CACHE_BYTES = 96 * 1024 * 1024;
const DEFAULT_DUCK_GAIN = 0.35;
/** 淡变总步数（引擎 `sub_489E50` 里进度到 100 即收尾）。 */
const FADE_STEPS = 100;

export class AudioEngine {
  readonly #host: AudioHost;
  readonly #log: (msg: string) => void;
  readonly #cacheBytes: number;
  readonly #duckGain: number;

  #se: SeChannel[] = [];
  #voice: VoiceChannel[] = [];

  #bgm: {
    /** **曲号**（不是统一文件 id；见 `bgmPlay` 的说明）。 */
    bgm: number;
    clip: AudioClip | null;
    playback: AudioPlayback | null;
    loop: boolean;
    mode: number;
    /** 淡变：从 `from` 走到 `to`（都是 0..1 的增益比例），进度 0..100。 */
    fade: { from: number; to: number; progress: number; step: number } | null;
  } = { bgm: 0, clip: null, playback: null, loop: true, mode: 1, fade: null };

  #volumes = { master: VOLUME_MAX, bgm: VOLUME_MAX, se: VOLUME_MAX, voice: VOLUME_MAX, movie: VOLUME_MAX };
  #enabled = { se: true, voice: true, bgm: true };
  #policy = { keepMusicVoice: false, fadeOnVoice: false };

  /** 解码缓存（LRU：`#cacheOrder` 头部最新）。 */
  #cache = new Map<string, AudioClip>();
  #cacheOrder: string[] = [];
  #cacheBytesUsed = 0;
  #cacheHits = 0;
  #cacheMisses = 0;
  /** 在飞的装载（`idle()` 等它们）。 */
  #inflight = new Set<Promise<unknown>>();

  constructor(host: AudioHost, opts: AudioEngineOptions = {}) {
    this.#host = host;
    this.#log = opts.log ?? host.log ?? ((): void => {});
    this.#cacheBytes = opts.cacheBytes ?? DEFAULT_CACHE_BYTES;
    this.#duckGain = opts.duckGain ?? DEFAULT_DUCK_GAIN;
    for (let ch = 0; ch < SE_CHANNELS; ch++) {
      this.#se.push({ loadedId: 0, clip: null, playback: null, loop: false, pan: 0, startedAtMs: 0, pending: null, delay: null });
    }
    for (let ch = 0; ch < VOICE_CHANNELS; ch++) {
      this.#voice.push({
        clip: null, playback: null, startedAtMs: 0, loop: false, pan: 0,
        factor: VOLUME_MAX, flag: 0, preparedFactor: null, request: null, deferred: null, loading: null,
      });
    }
  }

  // ==================== 单一入口（NativeBridge 只调它） ====================

  /** 把一条**音频意图**派发到引擎（`NativeBridge.audio` 的唯一实现，便于宿主/测试统一记录）。 */
  handle(intent: AudioIntent): void {
    switch (intent.kind) {
      case 'se-load': this.seLoad(intent.id, intent.ch); break;
      case 'se-play': this.sePlay(intent.ch, intent.loop); break;
      case 'se-stop': this.seStop(intent.ch); break;
      case 'se-delay': this.sePlayDelayed(intent.ch, intent.loop, intent.delayMs); break;
      case 'voice-play': this.voicePlay(intent.ch, intent.id, intent.loop); break;
      case 'voice-defer': this.voiceDefer(intent.ch, intent.id, intent.loop); break;
      case 'voice-queue': this.voiceQueue(intent.ch, intent.id, intent.aux, intent.delayMs); break;
      case 'voice-reset': this.voiceReset(intent.ch); break;
      case 'voice-pan': this.voicePan(intent.ch, intent.pan); break;
      case 'voice-flag': this.voiceFlag(intent.ch); break;
      case 'voice-factor-prepare': this.voiceFactorPrepare(intent.ch, intent.value); break;
      case 'voice-factor-apply': this.voiceFactorApply(intent.ch, intent.value); break;
      case 'bgm-play': this.bgmPlay(intent.bgm, intent.loop, intent.res); break;
      case 'bgm-stop': this.bgmStop(); break;
      case 'bgm-mode': this.bgmMode(intent.mode); break;
      case 'bgm-fade': this.bgmFadeTo(intent.value, intent.step); break;
      case 'enable': this.setEnabled(intent.target, intent.on); break;
      case 'volume': this.setVolume(intent.category, intent.value); break;
      case 'policy': this.setPolicy(intent.keepMusicVoice, intent.fadeOnVoice); break;
      case 'tick': this.tick(intent.nowMs, intent.advActive); break;
    }
  }

  // ==================== SE（0xB4/0xB5/0xBA/0xB6/0x2BF） ====================

  /** `0xB4` play-sound-effect：把音效 id 装载到 SE 通道（装载完成不自动起播，要再发 `0xB5`/`0xBA`）。 */
  seLoad(id: number, ch: number): void {
    const c = this.#seChannel(ch, 'se-load');
    if (!c) return;
    c.loadedId = id;
    if (!this.#enabled.se) return; // 关掉 SE 时不装载（引擎 SE 模块 `[261]` 关时 sub_4B5020 直接返回）
    void this.#track(this.#ensureClip({ id }, id)).then((clip) => {
      if (!clip || c.loadedId !== id) return;
      c.clip = clip;
      if (c.pending) {
        const p = c.pending;
        c.pending = null;
        this.#startSe(ch, p.loop, p.offsetSec);
      }
    });
  }

  /** `0xB5`（loop=false）/ `0xBA`（loop=true）：SE 通道起播。装载未完成则挂起，装载完自动起播。 */
  sePlay(ch: number, loop: boolean): void {
    const c = this.#seChannel(ch, 'se-play');
    if (!c) return;
    if (!this.#enabled.se) return;
    c.delay = null;
    if (!c.clip) {
      c.pending = { loop };
      return;
    }
    this.#startSe(ch, loop);
  }

  /** `0xB6`：SE 通道停止/释放（引擎 `sub_4B5050` → `sub_4B6390`）。 */
  seStop(ch: number): void {
    const c = this.#seChannel(ch, 'se-stop');
    if (!c) return;
    c.delay = null;
    c.pending = null;
    this.#stopSe(ch);
  }

  /** `0x2BF`：延迟播 SE（引擎 `sub_4B5170` 武装 → 每帧 `sub_4B5230` 到期起播）。 */
  sePlayDelayed(ch: number, loop: boolean, delayMs: number): void {
    const c = this.#seChannel(ch, 'se-delay');
    if (!c) return;
    if (!this.#enabled.se) return;
    c.delay = { delayMs: Math.max(0, delayMs), loop, armedAtMs: 0 };
  }

  // ==================== 语音（0xC4/0x1BD/0x2F4/0x2C0/0x2F5/0x2F6/0x2F7/0x2F8/0x2FF/0x302） ====================

  /** 立即起播语音（`0xC4`/`0x1BD`/`0x2F4` 的非 ADV 路径、ADV 冲刷、每帧队列泵）。 */
  voicePlay(ch: number, id: number, loop: boolean): void {
    const v = this.#voiceChannel(ch, 'voice-play');
    if (!v) return;
    if (!this.#enabled.voice) return;
    v.request = null;
    v.deferred = null;
    if (v.clip && v.loading === null && this.#voiceClipId(v) === id) {
      this.#startVoice(ch, id, loop);
      return;
    }
    v.loading = { id, loop };
    void this.#track(this.#ensureClip({ id }, id)).then((clip) => {
      const cur = v.loading;
      if (!clip || !cur || cur.id !== id) return;
      v.loading = null;
      v.clip = clip;
      if (this.#enabled.voice) this.#startVoice(ch, id, cur.loop);
    });
  }

  /**
   * ADV 激活位（`effect_flags & 0x8000000`）期间的**寄存**（引擎写 `Engine[122505+ch]`/`[122508+ch]`，
   * 位清除时统一冲刷 —— 冲刷发生在本引擎的 `tick(nowMs, advActive=false)` 里）。
   */
  voiceDefer(ch: number, id: number, loop: boolean): void {
    const v = this.#voiceChannel(ch, 'voice-defer');
    if (!v) return;
    v.deferred = { id, loop };
  }

  /** `0x2C0`/`0x2F5`：把语音排入通道（带延迟；引擎 `sub_4BBA40` → 每帧 `sub_4BBAB0`）。 */
  voiceQueue(ch: number, id: number, _aux: number, delayMs: number): void {
    const v = this.#voiceChannel(ch, 'voice-queue');
    if (!v) return;
    v.request = { delayMs: Math.max(0, delayMs), armedAtMs: 0, id, loop: false };
  }

  /** `0x2F6`：复位语音通道（停播 + 清状态 + **丢弃寄存**；引擎还会刷新 `Engine[122501]`）。 */
  voiceReset(ch: number): void {
    const v = this.#voiceChannel(ch, 'voice-reset');
    if (!v) return;
    this.#stopVoice(ch);
    v.request = null;
    v.deferred = null;
    v.loading = null;
    v.flag = 0;
    v.preparedFactor = null;
  }

  /** `0x2F8`：设语音通道 **pan**（±10000，0 = 中央）。 */
  voicePan(ch: number, pan: number): void {
    const v = this.#voiceChannel(ch, 'voice-pan');
    if (!v) return;
    v.pan = clampPan(pan);
    v.playback?.setPan(gainPan(v.pan));
  }

  /** `0x2F7`：置通道状态位（引擎 `Engine[21315+ch] = 1`）。 */
  voiceFlag(ch: number): void {
    const v = this.#voiceChannel(ch, 'voice-flag');
    if (v) v.flag = 1;
  }

  /** `0x2FF`：音量因子**预备**（引擎 `Engine[21318+ch]=1`、`[21321+ch]=op2`；尚未生效）。 */
  voiceFactorPrepare(ch: number, value: number): void {
    const v = this.#voiceChannel(ch, 'voice-factor-prepare');
    if (v) v.preparedFactor = clampVolume(value);
  }

  /** `0x302`：音量因子**生效**并应用（引擎 `Engine[21318+ch]=0x10000` → `sub_4BBC30`）。 */
  voiceFactorApply(ch: number, value: number): void {
    const v = this.#voiceChannel(ch, 'voice-factor-apply');
    if (!v) return;
    v.factor = clampVolume(value);
    v.preparedFactor = null;
    v.playback?.setGain(this.#voiceGain(v));
  }

  // ==================== BGM（0xBF/0xB7/0xB9/0xBB/0xBC/0xC2） ====================

  /**
   * `0xBF`/`0xB7`/`0xB9`：播 BGM。
   *
   * ★`bgm` 是**曲号**（不是统一文件 id）：引擎 `MusicBase`/PCM 用一张「曲号 → 文件 id」表
   * （`+1304`，索引 = 曲号 − 2；`sub_48DB80` raw 108738），该表由宿主从 `SYS4INI` 尾部装载
   * （`parseMusicTables`）、并由 `0x1D6`/`0x1D8` 在运行期追加 —— VM 侧已解析好时经 `res` 传进来。
   * `res` 缺省时退回"按文件名 `BGM%03d.OGG` 取，再不行按统一 id 试一次"（见 `#loadBgmClip`）。
   * 同曲号同循环且已在播 ⇒ 不重启（引擎同 id 同 loop 直接返回）。
   */
  bgmPlay(bgm: number, loop: boolean, res?: AudioResource): void {
    if (!this.#enabled.bgm || this.#bgm.mode === 0) {
      this.#bgm.bgm = bgm;
      return;
    }
    if (this.#bgm.bgm === bgm && this.#bgm.playback && this.#bgm.loop === loop) return;
    this.#stopBgm();
    this.#bgm.bgm = bgm;
    this.#bgm.loop = loop;
    this.#bgm.fade = null;
    const key: AudioResource = res ?? { name: bgmFileName(bgm) };
    const opts = { loop, gain: this.#bgmGain(), pan: 0 };
    const url = this.#host.streamUrl?.(key);
    if (url && this.#host.playStream) {
      this.#bgm.clip = null;
      this.#bgm.playback = this.#host.playStream(url, key, opts);
      this.#log(`[audio] bgm#${bgm}(${resLabel(key)}) 流式起播 loop=${loop}`);
      return;
    }
    void this.#track(this.#loadBgmClip(key, bgm)).then((clip) => {
      if (!clip || this.#bgm.bgm !== bgm) return;
      this.#bgm.clip = clip;
      this.#bgm.playback = this.#host.play(clip, { ...opts, gain: this.#bgmGain() });
      this.#log(`[audio] bgm#${bgm} 起播 loop=${loop} ${clip.durationSec.toFixed(1)}s`);
    });
  }

  /**
   * BGM 装载：给了 `res`（VM 按引擎表解析出来的统一 id）就用它；否则按 `BGM%03d.OGG` 取名，
   * 再不行退回"按统一 id"。每一步失败都留一行日志（不静默）。
   */
  async #loadBgmClip(res: AudioResource, bgm: number): Promise<AudioClip | null> {
    const first = await this.#ensureClip(res, bgm);
    if (first) return first;
    if ('name' in res) {
      this.#log(`[audio] bgm#${bgm}：按文件名取不到 ⇒ 退回按统一 id=${bgm} 试一次（老行为兜底）`);
      return await this.#ensureClip({ id: bgm }, bgm);
    }
    return null;
  }

  /** `0xBC`：BGM 开关/模式（op1-1：0 = 关，1/2 = 开）。引擎还会把 `sound:Music` ±3 写回。 */
  bgmMode(mode: number): void {
    this.#bgm.mode = mode;
    this.#enabled.bgm = mode !== 0;
    if (mode === 0) this.#stopBgm();
  }

  /**
   * `0xB8`：**停 BGM**（引擎 `sub_419720` → `sub_489B50`）。
   * 与 `bgmMode(0)` 的区别：不动 `sound:Music` 开关、不改模式，只停当前这首
   * （BGM 鉴赏进界面/换曲试听时用）。
   */
  bgmStop(): void {
    this.#stopBgm();
  }

  /** `0xC2`：把 BGM 淡变到 `value`（0..10000），每帧推进 `step`（引擎 `sub_489D10`/`sub_489E50`）。 */
  bgmFadeTo(value: number, step: number): void {
    const to = clampVolume(value) / VOLUME_MAX;
    this.#bgm.fade = { from: this.#bgmGain(), to, progress: 0, step: Math.max(1, Math.abs(step)) };
  }

  // ==================== 开关 / 音量 / 策略 ====================

  /** `0xBB`（SE）/ `0xBC`（BGM）/ `sound:Voice`：总线开关（关时引擎会把该总线的通道全停掉）。 */
  setEnabled(target: AudioBus, on: boolean): void {
    this.#enabled[target] = on;
    if (on) return;
    if (target === 'se') for (let ch = 0; ch < this.#se.length; ch++) this.#stopSe(ch);
    else if (target === 'voice') for (let ch = 0; ch < this.#voice.length; ch++) this.#stopVoice(ch);
    else this.#stopBgm();
    this.#log(`[audio] ${target} 总线关闭 ⇒ 该总线通道已停`);
  }

  /** `0xC6`：设音量（0 = 主 / 1 = BGM / 2 = SE / 3 = 语音 / 4 = 影片）。 */
  setVolume(category: number, value: number): void {
    const v = clampVolume(value);
    switch (category) {
      case VOLUME_MASTER:
        this.#volumes.master = v;
        this.#applyAllGains();
        break;
      case VOLUME_BGM:
        this.#volumes.bgm = v;
        this.#bgm.playback?.setGain(this.#bgmGain());
        break;
      case VOLUME_SE:
        this.#volumes.se = v;
        for (let ch = 0; ch < this.#se.length; ch++) {
          const c = this.#se[ch]!;
          if (c.playback) c.playback.setGain(this.#seGain(ch));
        }
        break;
      case VOLUME_VOICE:
        this.#volumes.voice = v;
        for (let ch = 0; ch < this.#voice.length; ch++) {
          const vc = this.#voice[ch]!;
          if (vc.playback) vc.playback.setGain(this.#voiceGain(vc));
        }
        break;
      case VOLUME_MOVIE:
        this.#volumes.movie = v; // 影片音轨不在本工程范围（引擎走另一路播放器）
        break;
      default:
        this.#log(`[audio] setVolume 类别越界：${category}（引擎报错分支，不写）`);
        return;
    }
    this.#log(`[audio] volume[${category}] = ${v}`);
  }

  /** `0xBF` 读到的两个配置：`set:KeepMusicVoice` 与 `sound:MusicFadeOnVoicePlaying`。 */
  setPolicy(keepMusicVoice: boolean, fadeOnVoice: boolean): void {
    this.#policy = { keepMusicVoice, fadeOnVoice };
    this.#applyAllGains();
  }

  // ==================== 帧泵 ====================

  /**
   * 每帧推进（渲染帧循环调用一次）：
   *  1. ADV 激活位**已清除**时冲刷寄存的语音（引擎 raw 20146/24966 的冲刷点）；
   *  2. SE 延迟播到期（引擎 `sub_4B5230`，raw 20645）；
   *  3. 语音槽排入的请求到期（引擎 `sub_4BBAB0`，raw 20646）；
   *  4. BGM 淡变推进 + 语音重叠时压低 BGM。
   */
  tick(nowMs: number, advActive: boolean): void {
    this.#lastTickMs = nowMs;
    // 1) ADV 位清除 ⇒ 冲刷寄存（引擎逐 ch 调 sub_4BB840）
    for (let ch = 0; ch < this.#voice.length; ch++) {
      const v = this.#voice[ch]!;
      if (v.deferred && !advActive) {
        const d = v.deferred;
        v.deferred = null;
        this.voicePlay(ch, d.id, d.loop);
      }
    }
    // 2) SE 延迟播
    for (let ch = 0; ch < this.#se.length; ch++) {
      const c = this.#se[ch]!;
      if (!c.delay) continue;
      const d = c.delay;
      if (d.armedAtMs === 0) d.armedAtMs = nowMs;
      if (nowMs - d.armedAtMs >= d.delayMs) {
        c.delay = null;
        if (!c.clip) c.pending = { loop: d.loop };
        else this.#startSe(ch, d.loop);
      }
    }
    // 3) 语音排入
    for (let ch = 0; ch < this.#voice.length; ch++) {
      const v = this.#voice[ch]!;
      if (!v.request || this.#voiceBusy(v)) continue;
      const r = v.request;
      if (r.armedAtMs === 0) r.armedAtMs = nowMs;
      if (nowMs - r.armedAtMs >= r.delayMs) this.voicePlay(ch, r.id, r.loop);
    }
    // 4) BGM 淡变 + 压低
    const bgm = this.#bgm;
    if (bgm.fade) {
      const f = bgm.fade;
      f.progress = Math.min(FADE_STEPS, f.progress + f.step);
      const t = f.progress / FADE_STEPS;
      const gain = f.from + (f.to - f.from) * t;
      bgm.playback?.setGain(this.#clampGain(gain * this.#duckFactor()));
      if (f.progress >= FADE_STEPS) {
        bgm.fade = null;
        if (f.to === 0) this.#stopBgm(); // 淡到 0 = 停（引擎在进度满且目标为 0 时 stop）
      }
    } else if (bgm.playback) {
      bgm.playback.setGain(this.#bgmGain());
    }
    // 播完的语音通道腾出来（loop=false 且时长已过 ⇒ 引擎按通道老化收尾）
    for (let ch = 0; ch < this.#voice.length; ch++) {
      const v = this.#voice[ch]!;
      if (v.playback && !v.loop && !this.#voiceBusy(v)) this.#stopVoice(ch);
    }
    for (let ch = 0; ch < this.#se.length; ch++) {
      const c = this.#se[ch]!;
      if (c.playback && !c.loop && c.clip && nowMs - c.startedAtMs >= c.clip.durationSec * 1000) {
        this.#stopSe(ch);
      }
    }
  }

  /** 等所有在飞的装载完成（测试/关窗收尾用）。 */
  async idle(): Promise<void> {
    while (this.#inflight.size > 0) await Promise.all([...this.#inflight]);
  }

  /** 诊断快照（测试断言 + 控制面板）。 */
  debug(): AudioDebugState {
    return {
      se: this.#se.map((c, ch) => ({
        ch, loadedId: c.loadedId, playing: c.playback !== null, loop: c.loop, pan: c.pan,
        gain: this.#seGain(ch), delayMs: c.delay ? c.delay.delayMs : null,
      })),
      voice: this.#voice.map((v, ch) => ({
        ch, playing: v.playback !== null, id: v.clip?.id ?? 0, loop: v.loop, pan: v.pan, factor: v.factor,
        prepared: v.preparedFactor, queued: v.request?.id ?? null, deferred: v.deferred?.id ?? null,
      })),
      bgm: this.#bgm.playback || this.#bgm.bgm
        ? {
            bgm: this.#bgm.bgm, name: bgmFileName(this.#bgm.bgm), playing: this.#bgm.playback !== null,
            loop: this.#bgm.loop, enabled: this.#enabled.bgm, mode: this.#bgm.mode,
            gain: this.#bgmGain(), fading: this.#bgm.fade !== null,
          }
        : null,
      volumes: { ...this.#volumes },
      enabled: { ...this.#enabled },
      cache: { clips: this.#cache.size, bytes: this.#cacheBytesUsed, hits: this.#cacheHits, misses: this.#cacheMisses },
    };
  }

  /** 释放全部播放与缓存（关窗/重启）。 */
  dispose(): void {
    for (let ch = 0; ch < this.#se.length; ch++) this.#stopSe(ch);
    for (let ch = 0; ch < this.#voice.length; ch++) this.#stopVoice(ch);
    this.#stopBgm();
    this.#cache.clear();
    this.#cacheOrder = [];
    this.#cacheBytesUsed = 0;
  }

  // ==================== 内部：装载 / 缓存 ====================

  /** 取（或解码）一个资源的 clip：命中缓存直接返回；否则 load + decode 并计入 LRU。 */
  async #ensureClip(res: AudioResource, numId: number): Promise<AudioClip | null> {
    const key = resKey(res);
    const hit = this.#cache.get(key);
    if (hit) {
      this.#cacheHits++;
      this.#touch(key);
      return hit;
    }
    this.#cacheMisses++;
    const bytes = await this.#host.load(res);
    if (!bytes || bytes.length === 0) {
      this.#log(`[audio] 取字节失败：${key}`);
      return null;
    }
    const clip = await this.#host.decode(numId, bytes);
    if (!clip) {
      this.#log(`[audio] 解码失败：${key}（${bytes.length}B）`);
      return null;
    }
    const stored: AudioClip = clip.bytes > 0 ? { ...clip, id: numId } : { ...clip, id: numId, bytes: bytes.length };
    this.#cache.set(key, stored);
    this.#cacheOrder.unshift(key);
    this.#cacheBytesUsed += stored.bytes;
    this.#evict();
    return stored;
  }

  #touch(key: string): void {
    const i = this.#cacheOrder.indexOf(key);
    if (i > 0) {
      this.#cacheOrder.splice(i, 1);
      this.#cacheOrder.unshift(key);
    }
  }

  #evict(): void {
    while (this.#cacheBytesUsed > this.#cacheBytes && this.#cacheOrder.length > 1) {
      const victim = this.#cacheOrder.pop()!;
      const clip = this.#cache.get(victim);
      if (!clip) continue;
      this.#cache.delete(victim);
      this.#cacheBytesUsed -= clip.bytes;
    }
  }

  /** 记录在飞 promise（`idle()` 用），并吞掉异常（避免 unhandled rejection）。 */
  #track<T>(p: Promise<T>): Promise<T | null> {
    const guarded = p.catch((err: unknown) => {
      this.#log(`[audio] 装载异常：${(err as Error).message}`);
      return null;
    });
    this.#inflight.add(guarded);
    void guarded.finally(() => this.#inflight.delete(guarded));
    return guarded;
  }

  // ==================== 内部：起播/停播/增益 ====================

  #seChannel(ch: number, what: string): SeChannel | null {
    if (ch >= 0 && ch < this.#se.length) return this.#se[ch]!;
    this.#log(`[audio] ${what}：SE 通道越界 ${ch}（引擎报 dsPlaySound/dsSetPan 分支）`);
    return null;
  }

  #voiceChannel(ch: number, what: string): VoiceChannel | null {
    if (ch >= 0 && ch < this.#voice.length) return this.#voice[ch]!;
    this.#log(`[audio] ${what}：语音通道越界 ${ch}（引擎报 dsPlaySound 分支）`);
    return null;
  }

  #startSe(ch: number, loop: boolean, offsetSec?: number): void {
    const c = this.#se[ch]!;
    if (!c.clip) return;
    c.playback?.stop();
    c.loop = loop;
    c.playback = this.#host.play(c.clip, {
      loop, gain: this.#seGain(ch), pan: gainPan(c.pan), offsetSec,
    });
    c.startedAtMs = this.#lastTickMs;
    this.#log(`[audio] SE ch${ch} 起播 id=${c.clip.id} loop=${loop}`);
  }

  #stopSe(ch: number): void {
    const c = this.#se[ch]!;
    c.playback?.stop();
    c.playback = null;
  }

  #voiceClipId(v: VoiceChannel): number {
    return v.clip?.id ?? 0;
  }

  #startVoice(ch: number, id: number, loop: boolean): void {
    const v = this.#voice[ch]!;
    if (!v.clip) return;
    v.playback?.stop();
    v.loop = loop;
    v.startedAtMs = this.#lastTickMs;
    v.playback = this.#host.play(v.clip, { loop, gain: this.#voiceGain(v), pan: gainPan(v.pan) });
    this.#log(`[audio] 语音 ch${ch}(设备 ${VOICE_CHANNEL_BASE + ch}) 起播 id=${id} loop=${loop}`);
    // 语音与 BGM 重叠 ⇒ 压低 BGM（见文件头"刻意的近似"）
    this.#bgm.playback?.setGain(this.#bgmGain());
  }

  #stopVoice(ch: number): void {
    const v = this.#voice[ch]!;
    v.playback?.stop();
    v.playback = null;
    v.clip = null;
    this.#bgm.playback?.setGain(this.#bgmGain());
  }

  #stopBgm(): void {
    this.#bgm.playback?.stop();
    this.#bgm.playback = null;
    this.#bgm.clip = null;
    this.#bgm.fade = null;
  }

  /** 语音通道是否"在响"（引擎 `sub_404CB0` 的占线判定；这里用播放句柄 + 时长）。 */
  #voiceBusy(v: VoiceChannel): boolean {
    if (!v.playback) return false;
    if (v.loop) return true;
    const dur = (v.clip?.durationSec ?? 0) * 1000;
    return dur > 0 && this.#lastTickMs - v.startedAtMs < dur;
  }

  #anyVoicePlaying(): boolean {
    return this.#voice.some((v) => this.#voiceBusy(v));
  }

  /** SE 通道增益 = `sound:Volume2 × 主音量`（引擎 `设备[327+ch] × 设备[342]`，通道各自无因子）。 */
  #seGain(_ch: number): number {
    return this.#clampGain((this.#volumes.se / VOLUME_MAX) * (this.#volumes.master / VOLUME_MAX));
  }

  #voiceGain(v: VoiceChannel): number {
    return this.#clampGain(
      (this.#volumes.voice / VOLUME_MAX) * (v.factor / VOLUME_MAX) * (this.#volumes.master / VOLUME_MAX),
    );
  }

  #bgmGain(): number {
    return this.#clampGain((this.#volumes.bgm / VOLUME_MAX) * (this.#volumes.master / VOLUME_MAX) * this.#duckFactor());
  }

  /** 语音在响且策略允许时压低 BGM（近似，见文件头）。 */
  #duckFactor(): number {
    if (!this.#policy.keepMusicVoice || !this.#policy.fadeOnVoice) return 1;
    return this.#anyVoicePlaying() ? this.#duckGain : 1;
  }

  #applyAllGains(): void {
    for (let ch = 0; ch < this.#se.length; ch++) {
      const c = this.#se[ch]!;
      c.playback?.setGain(this.#seGain(ch));
    }
    for (const v of this.#voice) v.playback?.setGain(this.#voiceGain(v));
    this.#bgm.playback?.setGain(this.#bgmGain());
  }

  #clampGain(g: number): number {
    return g < 0 ? 0 : g > 1 ? 1 : g;
  }

  /** 最近一次 tick 的时刻（毫秒）——语音占线/SE 收尾判定用；未 tick 过时取 0。 */
  #lastTickMs = 0;
}

/** 缓存键（id 与 name 两种定位不能混）。 */
function resKey(res: AudioResource): string {
  return 'id' in res ? `id:${res.id}` : `name:${res.name}`;
}

/** 资源定位 → 人读标签（日志/诊断）。 */
export function resLabel(res: AudioResource): string {
  return 'id' in res ? `id=${res.id}` : res.name;
}

/** 音量钳制（0..10000；引擎 `sub_4B68E0`/`sub_4B6210` 的输入域）。 */export function clampVolume(v: number): number {
  return v < 0 ? 0 : v > VOLUME_MAX ? VOLUME_MAX : Math.round(v);
}

/** pan 钳制（±10000，0 = 中央；引擎 `sub_4B6940` 的**对称**钳制）。 */
export function clampPan(v: number): number {
  return v < -VOLUME_MAX ? -VOLUME_MAX : v > VOLUME_MAX ? VOLUME_MAX : Math.round(v);
}

/** pan（±10000）→ Web Audio 的 -1..+1。 */
export function gainPan(pan: number): number {
  return clampPan(pan) / VOLUME_MAX;
}
