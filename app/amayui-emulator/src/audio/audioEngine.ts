/**
 * **音频引擎（宿主无关）** —— 按引擎的「1 个设备 + 3 个模块」模型实现播放逻辑。
 *
 * 引擎侧结论（证据/raw 行号）见 `docs-new/03-engine/sound-system.md`；本文件只把它翻成代码：
 *
 * | 引擎 | 这里 |
 * |---|---|
 * | 设备 15 通道（0..9 = SE / 10..11 备用 / 12..14 = 语音） | `se[15]` + `voice[3]`（语音逻辑通道 0..2 ↔ 设备 12..14） |
 * | `设备[327+ch]` 通道音量（0..10000 线性） | `seVolume` / `voiceVolume` / `bgmVolume`（由 `sound:Volume0..4` 驱动） |
 * | `设备[342]` 主音量 | `master` |
 * | `设备[375+ch]` **pan** ±10000（`sub_4B6940` → `SetPan`） | `channel.pan` → `playback.setPan` |
 * | `设备[390+ch]` 每通道音量因子（`-1` = 不缩放） | `voice.factor`（0..10000，缺省 10000） |
 * | SoundBuffer `+9296` 循环标志 | `play({loop})` |
 * | SoundBuffer `+2331` 定位（毫秒） | `play({offsetSec})` |
 * | SE 延迟播 `[262/272/282/292]` + 每帧 `sub_4B5230` | `seDelay` + `tick()` |
 * | 语音 3 路槽（`armed/delay/id/loop`）+ 每帧 `sub_4BBAB0` | `voiceQueue` + `tick()` |
 * | ADV 激活位期间寄存（`Engine[122505/122508+ch]`）+ 位清除时冲刷 | `voiceDefer` + `tick(nowMs, advActive)` |
 * | Music 淡变（`sub_489D10`/`sub_489E50`：每次 CALL +100，受 `sub_453A60` 节流） | `bgmFadeTo` + `tick()` |
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

/**
 * SE 通道表的长度 = **设备通道表长度 15**（引擎 `Device[405+ch]` = 15 格 SoundBuffer 指针，ch = 0..14）。
 *
 * ★2026-09 订正（审计 P2，票 `T-0152` 的 `0xb4`/`0xb5`）：这里**不是 10**。证据：
 *  - `sub_4B6020`（`0xB5`/`0xBA` 的落点）raw **138599** 的值域门是 `if ( a2 > 0xE )` ⇒ 0..14 全合法；
 *  - `sub_4B4F60`（`0xB4` 的装载落点）raw **137654** 写 `*(_DWORD *)(_this + 4 * ch + 1212)`（**无值域门**）；
 *  - `sub_4B69B0`（Sound 析构）raw 139101-139108 逐个删 **15** 个 critical section；
 *  - `sub_4B60C0`（释放）raw 138630 的值域门是 `if ( a2 >= 15 )`。
 *
 * ★但 15 格里**只有 0..9 与 12..14 会被真的绑缓冲**：`sub_4B5CF0`（raw 138415+，DirectSoundCreate
 * 之后）只建 2 个缓冲（主缓冲 `_this[259]` + 流缓冲 `_this[260]`），`_this[a2+405]` 那 15 格是
 * 按需（`0xB4` 装载 → `sub_4B6570` 绑 / `0xB6` 释放）建的；语音经 `Engine+21032` 那层走
 * `sub_4BB840` → `sub_4B6020(设备, ch+12, …)` ⇒ **12/13/14 归语音**，10/11 是**备用直通**格。
 * ⇒ 越界判据是**两段**：`ch > 14` 报 `dsPlaySound(%d)`（raw 138599-138604）、`ch` 合法但**该通道
 * 没有缓冲**报 `dsPlay(%d)`（raw 138605-138612）。**两段都已建模**（第二段见 `sePlay` 的说明）。
 */
export const SE_CHANNELS = 15;
/** 语音逻辑通道数（设备 12..14）。 */
export const VOICE_CHANNELS = 3;
/** 语音第一条通道对应的设备通道号（仅用于日志/诊断）。 */
export const VOICE_CHANNEL_BASE = 12;
/**
 * `sub_408D90`（`0xBB` / `0x1BA op1=2` 的 SE 总开关）关 SE 时逐个释放的**音效通道数**。
 *
 * ★为什么单列而不是用 `SE_CHANNELS`：引擎那一段的循环上界是 **10**（raw 13561-13568 逐个
 * `sub_4B60C0(SE, i)`），**不碰** 10..14 那几格（12..14 属语音）⇒ 关 SE 不得把语音通道一起停掉。
 */
export const SE_ENABLE_RELEASE_CHANNELS = 10;

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
  /**
   * **暂停/继续**（可选；`0xC1` 的 BGM 暂停切换用它）。
   *
   * 引擎侧：`0xC1`（`sub_419770` raw 24831-24842）翻转 `Music[260]` 并把新值经当前音源对象的
   * vtable+12（`MusicBase` 抽象槽 3 = `SetPause`）下发 —— CD 走 MCI 的 PAUSE/RESUME、PCM 走
   * `sub_4B60C0`/`sub_4B6190`（都是**保留播放位置**的暂停）。
   * 不实现的宿主（如一次性缓冲播放）由 `AudioEngine.bgmPause` 兜底：记下 `positionSec()` 后停播，
   * 恢复时用 `play({offsetSec})` 从原位续播。
   */
  setPaused?(paused: boolean): void;
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
  /** 延迟播记录。`armedAtMs` = **null 表示还没起步**（★不能用 0：headless 的虚拟时钟第一帧就是 0）。 */
  delay: { delayMs: number; loop: boolean; armedAtMs: number | null } | null;
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
  | { kind: 'bgm-pause'; paused: boolean }
  | { kind: 'bgm-mode'; mode: number }
  /**
   * BGM 淡变。`step` = **每次 CALL 的进度增量**（引擎 `sub_489D10(Music, op1, v9)` 的 v9），
   * `throttleMs` = **两次 CALL 的最小间隔毫秒**（`sub_453A60(_this+107503, op2<1000?op2/10:op2/1000)`）。
   * 不在场 = 0 = 每帧一次（清 bit0x200 那条内部路径用的旧口径）。见 `bgmFadeTo`。
   */
  | { kind: 'bgm-fade'; value: number; step: number; throttleMs?: number }
  /**
   * **换曲时的音量衔接**（引擎 `0xC2` raw 29826-29830 → `sub_418580`；键 `set:TransferMusicVolume`）：
   * `mode = 1` ⇒ 按淡变进度把当前音量运行态插值到新目标（`Music[264] ← (Music[262]*(100-p)+p*Music[265])/100`）；
   * `mode = 2` ⇒ 直接跳到目标（`Music[264] = Music[265]`）；其余值 ⇒ 什么都不做。
   */
  | { kind: 'bgm-transfer-volume'; mode: number }
  /**
   * **影片音轨跟随声音开关**（引擎 `sub_406DF0` 的播放器循环，raw 12095-12103；由 `0xBB`/`0xBC`/
   * `0x1BA` 四条分支的收尾触发）。
   *
   * `category` = 1 音乐 / 2 SE / 3 语音 / 4 影片；`on` = **归一成 0/1**（raw 12052 `v4 = a3 != 0`）。
   * 影片播放器对象表在重写侧未建模 ⇒ 宿主未接时由闸门 A 留痕（见 `handlers/audio.ts` 的
   * `applyDependentMovie`，票 `T-0152` 的 P2 `0x1ba missing-consumer`）。
   */
  | { kind: 'movie-dependent-audio'; category: number; on: number }
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
  /** 语音排入记录。`armedAtMs` 同 SE：**null = 还没起步**。 */
  request: { delayMs: number; armedAtMs: number | null; id: number; loop: boolean } | null;
  /** ADV 激活位期间的寄存（引擎 `Engine[122505+ch]`/`[122508+ch]`）。 */
  deferred: { id: number; loop: boolean } | null;
  /** 装载中：装载完成后自动起播。 */
  loading: { id: number; loop: boolean } | null;
}

export interface AudioDebugState {
  se: Array<{ ch: number; loadedId: number; playing: boolean; loop: boolean; pan: number; gain: number; delayMs: number | null }>;
  voice: Array<{ ch: number; playing: boolean; id: number; loop: boolean; pan: number; factor: number; prepared: number | null; queued: number | null; deferred: number | null }>;
  /** BGM：`bgm` = 曲号（不是统一文件 id），`name` = 由曲号推出的文件名。 */
  bgm: { bgm: number; name: string; playing: boolean; loop: boolean; enabled: boolean; mode: number; gain: number; fading: boolean; paused: boolean } | null;
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
    /** `0xC1` 的暂停位（引擎 `Music[260]`；起播/停播都会清）。 */
    paused: boolean;
    /** 宿主不支持 `setPaused` 时记下的暂停位置（秒），恢复时作 `offsetSec`。 */
    pausePos: number;
    /**
     * 淡变：从 `from` 走到 `to`（都是 0..1 的增益比例），进度 0..100。
     * `step` = 每次 CALL 的进度增量（引擎 `sub_489E50` 恒 +100 之外，`0xC2` 还给了 `op2<1000?10:1`）；
     * `throttleMs`/`nextAtMs` = 两次 CALL 的最小间隔（引擎 `sub_453A60(_this+107503, v4)` 的等价物）。
     */
    fade: { from: number; to: number; progress: number; step: number; throttleMs: number; nextAtMs: number } | null;
  } = { bgm: 0, clip: null, playback: null, loop: true, mode: 1, paused: false, pausePos: 0, fade: null };

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
    // ★必须**绑住宿主**：`host.log` 是宿主上的方法（`FakeAudioHost.log` 走 `this.logs`），
    //   `opts.log ?? host.log` 直接取方法引用会让调用点丢掉 `this`（实测 `this.logs` 为
    //   undefined ⇒ 异步装载完成的日志把 TypeError 抛到 unhandledRejection 上）。见 T-0152。
    this.#log = opts.log ?? (host.log ? (m: string): void => host.log!(m) : (): void => {});
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
      case 'bgm-pause': this.bgmPause(intent.paused); break;
      case 'bgm-mode': this.bgmMode(intent.mode); break;
      case 'bgm-fade': this.bgmFadeTo(intent.value, intent.step, intent.throttleMs); break;
      case 'bgm-transfer-volume': this.bgmTransferVolume(intent.mode); break;
      // 影片音轨跟随（`sub_406DF0`）：影片播放器对象表未建模 ⇒ 只记一行（有据登记，见意图注释）。
      case 'movie-dependent-audio':
        this.#log(
          `[audio] 影片音轨跟随：类别 ${intent.category} ⇒ ${intent.on}（引擎 sub_406DF0 raw 12095-12103；` +
            '播放器对象表未建模，重开条件 = 影片对象表进 emulator）',
        );
        break;
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
    // ★换装不同 id 时**立刻作废旧绑定**（2026-09 修：用户报「点『ゲーム開始』音效错」的根因）。
    //   引擎的 `0xB4` 是**同步**装载：`sub_4B4F60`（raw 137630-137658）→ `sub_4B6570` 先释放该通道
    //   的旧缓冲（raw 138906-138908）再绑新缓冲（raw 138925）⇒ `0xB5` 执行时通道上**必定**已是新音效
    //   （通道无缓冲则 `sub_4B6020` 报 `dsPlay(%d)` 并返回 0，raw 138605-138612）。
    //   而这里是异步装载（IPC 取字节 + decodeAudioData，毫秒级），紧随的 `0xB5` 是同步的 —— 若不作废，
    //   `sePlay` 会看到**上一个**音效的 `c.clip` 而立刻播它（`GAMESTART.txt:1307-1308` 于是播出通道 1
    //   上残留的 SE002(id 50)，而脚本要的是 SE009(id 20963)）。作废后 `sePlay` 走 `pending` 分支，
    //   装载完成由上面的 `.then` 起播**新**音效 ⇒ 延迟但正确（对照 `voicePlay` 早就有的 `loading` 保护）。
    //   同 id 重复装载仍命中缓存、立即起播，不引入额外延迟。
    if (c.clip && c.clip.id !== id) c.clip = null;
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

  /**
   * `0xB5`（loop=false）/ `0xBA`（loop=true）：SE 通道起播。装载未完成则挂起，装载完自动起播。
   *
   * ★**值域 = 0..14**（审计 P2，票 `T-0152` 的 `0xb5`）：引擎 `sub_4B6020` 的门是 `if ( a2 > 0xE )`
   * （raw 138599）⇒ 10..14 也在值域内（12..14 是语音的设备通道，见 `SE_CHANNELS` 的说明）。
   *
   * ★**第二段（2026-09-25 落实，T-0179）**：同一函数 raw 138605-138612 —— 值域内但**该通道没有缓冲**
   * 时引擎报另一条错误串 `dsPlay(%d)` 并 `return 0`（**不起播**）；引擎的 `0xB4`（`sub_4B4F60`）
   * **只建缓冲绑通道**，所以"先 `0xB5`、后 `0xB4`"在真机上是**没有声音**的。
   *
   * 关键：`loadedId` 是**同步**写的（见 `seLoad`），它足以把两种「没有 clip」分开 —— 旧注释说
   * "在本实现里无法区分"是错的：
   *  - `loadedId === 0`：**从未装载** = 引擎那个"通道没有缓冲"格 ⇒ 拒绝起播 + 记 `dsPlay(ch)`；
   *  - `loadedId !== 0`：**装载已在途**（引擎里不存在这个时刻：它同步装载）⇒ 挂起，装载完自动起播
   *    （本实现刻意的异步近似）。
   * 判据的另一半（`ch > 0xE`）留在 `#seChannel`（raw 138599 的 `a2 > 0xE` ⇒ `dsPlaySound`）。
   */
  sePlay(ch: number, loop: boolean): void {
    const c = this.#seChannel(ch, 'se-play');
    if (!c) return;
    if (!this.#enabled.se) return;
    c.delay = null;
    if (!c.clip) {
      // ★`loadedId === 0` ⇒ 从未装载（引擎 `sub_4B6020` raw 138605-138612 的 `dsPlay(%d)` 格）：
      //   报错串 + `return 0`，且**后续装载不补播**（引擎 0xB4 只装载）。守卫
      //   `test/audio-engine.test.ts` 的「通道从未装载 ⇒ 拒绝起播」。
      if (c.loadedId === 0) {
        this.#log(
          `[audio] SE ch${ch} 起播被拒：该通道没有缓冲（引擎 sub_4B6020 raw 138605-138612 报 dsPlay(${ch}) 并 return 0）`,
        );
        return;
      }
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
    c.delay = { delayMs: Math.max(0, delayMs), loop, armedAtMs: null };
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

  /**
   * `0x2C0`/`0x2F5`：把语音排入通道（带延迟；引擎 `sub_4BBA40` → 每帧 `sub_4BBAB0`）。
   *
   * ★**循环位取 `op2`（"附带值"）的 bit0** —— 这是本次审计 P1（`0x2c0`/`0x2f5`，票 `T-0152`）的落点，
   * 修前这里硬编码 `loop: false`。引擎依据：
   * ```c
   * // 排队写入端 sub_4BBA40（raw 142562-142571）：_this[ch+277] = op2   ← "附带值"存进 ch+277 槽
   * // 到期起播端 sub_4BBAB0（raw 142661-142667）：
   * //   v3 = _this + 265;  sub_4BB840(_this, ch, v3[9] = id, (unsigned)v3[12] & 1, 设备 pan 槽)
   * //   v3[12] = _this[277+ch] ⇒ 第 4 实参 = **op2 & 1** → sub_4B6020(设备, ch+12, 该位) → sub_4B73E0(buffer, 该位)
   * ```
   * 同族旁证：SE 的排队指令 `0x2BF`（`sub_4B5170`）把 op2 直接叫**循环标志**存 `SE[292+ch]`，
   * 起播时同样照它播一次/循环 ⇒ 这一族的第 2 操作数就是循环位。
   *
   * ★**同一次复核推翻了审计里"op2 是 pan"的说法**（`0x2c0`/`0x2f5` 的两条 missing-operand-io P1）：
   * `sub_4BBAB0` 的第 5 实参地址 = `(char*)v3 + 设备基址 + (488 − Voice 基址)` = **设备对象 + 1548 + 4·ch**
   * = `设备[387+ch]`，即**该语音通道当前的 pan 槽**（由 `0x2F8` 经 `sub_4B6940(设备, 12+ch, pan)` 写；
   * 语音通道号是 12..14 ⇒ 375+12+ch = 387+ch）—— 它是"把通道当前 pan 再下发一次"，
   * 与排队时写下的 op2 无关（op2 只被取 bit0 当循环位）。⇒ **不实现 op2→pan**，避免造出假语义。
   */
  voiceQueue(ch: number, id: number, aux: number, delayMs: number): void {
    const v = this.#voiceChannel(ch, 'voice-queue');
    if (!v) return;
    // op2 的 bit0 = 循环位（见方法注释的 raw 依据）；op2 的其它位在本作语料里恒为 1（30 处 op2 = 3）。
    v.request = { delayMs: Math.max(0, delayMs), armedAtMs: null, id, loop: (aux & 1) !== 0 };
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

  /**
   * `0x2F8`：设设备通道 **pan**（±10000，0 = 中央）。
   *
   * ★实参是**设备通道号**（引擎 `sub_4268D0` raw 33714 的 `v4` = `0x2F8` 的**第 2 操作数**，
   * 经 `sub_4B6940(设备, v2 + 12, v4)` 落 `设备[通道 + 375]`）：**12/13/14 ↔ 语音 `#voice[0..2]`**、
   * **0..11 ↔ `#se`**（`0x2F8` 对它们是一条**值域内**的引擎指令 —— `sub_4B6940` 的门只是 `a2 < 15`，
   * raw 139068；设备 10/11 在本工程里是**没有缓冲的备用格** ⇒ 只存值、无声可设）。
   * 值域外（< 0 或 ≥ 15）与设备层同口径：报一条错、什么都不做（raw 139085-139087）。
   */
  voicePan(ch: number, pan: number): void {
    const v = clampPan(pan);
    const target = this.#devicePanTarget(ch, 'voice-pan');
    if (!target) return;
    if (target.kind === 'se') {
      target.channel.pan = v;
      return;
    }
    target.channel.pan = v;
    target.channel.playback?.setPan(gainPan(v));
  }

  /** `0x2F7`：置通道状态位（引擎 `Engine[21315+ch] = 1`）。 */
  voiceFlag(ch: number): void {
    const v = this.#voiceChannel(ch, 'voice-flag');
    if (v) v.flag = 1;
  }

  /**
   * `0x2FF`：音量因子**预备**（引擎 `Engine[21318+ch]=1`、`[21321+ch]=op2`；尚未生效）。
   *
   * ★**原值直写、不钳位**（审计 P3 `0x2ff approximation`，票 `T-0152`）：同一槽在 `0x302` 里会被写成
   * `0x10000`（65536，raw 33768-33769）——**远超 10000** ⇒ 那一格不是 0..10000 域。钳位只应发生在
   * "把因子换算成增益"那一步（`#voiceGain` 里的 `v.factor / VOLUME_MAX`，而 `v.factor` 自带
   * `clampVolume`，因为它是**下发用的**值，与引擎 `设备[402+ch]` 的取值口径一致）。
   */
  voiceFactorPrepare(ch: number, value: number): void {
    const v = this.#voiceChannel(ch, 'voice-factor-prepare');
    if (v) v.preparedFactor = value;
  }

  /** `0x302`：音量因子**生效**并应用（引擎 `Engine[21318+ch]=0x10000` → `sub_4BBC30`）。 */
  voiceFactorApply(ch: number, value: number): void {
    const v = this.#voiceChannel(ch, 'voice-factor-apply');
    if (!v) return;
    v.factor = clampVolume(value);
    // ★**不清 preparedFactor**（审计 P3 `0x302 host-invented`，票 `T-0152`）：引擎 `sub_426A30`
    //   （raw 33767-33777）只写 `[21318+ch] = 0x10000` 与 `[21321+ch] = op2` 再 `sub_4BBC30` 下发，
    //   没有"把预备值清掉"这一步；`[21321+ch]` 在 `sub_4BBC30` 之后仍在（后续还能被读/被覆盖）。
    //   ⇒ 宿主侧的对应量 `preparedFactor` 保留原值（它只进诊断快照；真正发声用 `v.factor`）。
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

  /**
   * `0xC1`：**BGM 暂停/继续**（引擎 `sub_419770` → 当前音源对象 vtable+12 = `SetPause`）。
   *
   * 为什么不是"只记状态"：引擎那一步真的作用在音源对象上（CD 的 MCI PAUSE/RESUME、PCM 的
   * `sub_4B60C0`/`sub_4B6190`），且**保留播放位置** ⇒ 这里也必须真的暂停/继续，否则
   * `MMODE.txt:440` 的试听暂停按钮就是"点了没反应"。
   *
   * 两条路：
   *  1. 宿主实现了 `setPaused`（流式 `<audio>` 宿主 —— BGM 的常态路径）⇒ 直接转发；
   *  2. 没实现（一次性缓冲播放：`BufferPlayback`）⇒ 记 `positionSec()` 后停播，恢复时用
   *     `play({offsetSec})` 从原位续播（引擎 `sub_4B5A30` 的"毫秒 → 偏移"等价物）。
   *
   * ★没在播时只记状态（引擎对 NoMusic 槽/未起播对象的调用本来就是空桩 `sub_4350E0`）。
   */
  bgmPause(paused: boolean): void {
    const wasPaused = this.#bgm.paused;
    this.#bgm.paused = paused;
    const pb = this.#bgm.playback;
    if (pb) {
      if (pb.setPaused) {
        pb.setPaused(paused);
        this.#log(`[audio] BGM ${paused ? '暂停' : '继续'}（宿主 setPaused）`);
        return;
      }
      if (!paused) return; // 有句柄且要"继续" ⇒ 本来就在放
      this.#bgm.pausePos = pb.positionSec?.() ?? 0;
      pb.stop();
      this.#bgm.playback = null;
      this.#log(`[audio] BGM 暂停 @${this.#bgm.pausePos.toFixed(2)}s（宿主无 setPaused ⇒ 停播 + 记位置）`);
      return;
    }
    // 没有句柄：要么本来就没在播（只记状态），要么上一次是用兜底路径暂停的（现在要续播）。
    if (!paused && wasPaused) {
      const clip = this.#bgm.clip;
      if (!clip) {
        this.#log('[audio] BGM 继续失败：宿主无 setPaused 且没有可续播的缓冲（流式句柄应实现 setPaused）');
        return;
      }
      this.#bgm.playback = this.#host.play(clip, {
        loop: this.#bgm.loop, gain: this.#bgmGain(), pan: 0, offsetSec: this.#bgm.pausePos,
      });
      this.#log(`[audio] BGM 从 ${this.#bgm.pausePos.toFixed(2)}s 续播（宿主无 setPaused）`);
      return;
    }
    this.#log(`[audio] BGM 暂停态 = ${paused}（当前没有在播的曲子 ⇒ 只记状态）`);
  }

  /**
   * `0xC2`：把 BGM 淡变到 `value`（0..10000），每次 CALL 推进 `step`，两次 CALL 至少隔 `throttleMs` 毫秒
   * （引擎 `sub_489D10`/`sub_489E50` + `sub_453A60`）。
   *
   * ★**节流的那一半**（审计 P2 `0xc2 approximation`，票 `T-0152`）：引擎 `0xC2`（`sub_420E00`
   * raw 29831-29839）把 op2 **原值**按 `op2 < 1000 ? op2/10 : op2/1000` 折算成**节流毫秒**交给
   * `sub_453A60`，而每次 CALL 的进度增量恒由 `sub_489E50(Music, 100)` 给（raw 106328
   * `Music[262] += 100`）或由 `sub_489D10` 的第 3 实参 `op2<1000 ? 10 : 1` 给
   * （raw 29837）⇒ **op2 不是每帧步长**。修前把它当每帧步长 ⇒ `op2 = 500` 淡变快 2 倍、
   * `op2 = 1200` 慢约 1.2 倍（语料 943 处 `i0c2` 里 `< 1000` 的约 121 处）。
   */
  bgmFadeTo(value: number, step: number, throttleMs = 0): void {
    const to = clampVolume(value) / VOLUME_MAX;
    this.#bgm.fade = {
      from: this.#bgmGain(),
      to,
      progress: 0,
      step: Math.max(1, Math.abs(step)),
      throttleMs: Math.max(0, throttleMs),
      nextAtMs: this.#lastTickMs,
    };
  }

  /**
   * `0xC2` 的 `set:TransferMusicVolume` 分支（引擎 `sub_418580`，由 raw 29828-29829 调用）。
   *
   * 引擎体的三支（raw 24041-24053）：
   * ```c
   * if ( a2 == 1 ) { result = _this[262]; if ( result < 100 )
   *     { result = (_this[264] * (100 - result) + result * _this[265]) / 100; _this[264] = result; } }
   * else if ( a2 == 2 ) _this[264] = _this[265];
   * ```
   * 本工程把 `Music[264]`（当前音量运行态）的等价物放在宿主：`#bgm.fade` 的 `from`→`to` 插值就是
   * 那条式子（`progress` = `Music[262]`、`to` = `Music[265]`）⇒
   *  - `mode == 2`：**直接跳到目标** ⇒ 把当前淡变的起点重设为终点（下一帧就到目标，不再插值）；
   *  - `mode == 1`：保留当前插值（引擎那一步写回的 `Music[264]` 与"按 progress 插值"同值 ⇒ 无额外动作）；
   *  - 其余：什么都不做（引擎那两支都不成立）。
   */
  bgmTransferVolume(mode: number): void {
    if (mode === 2 && this.#bgm.fade) {
      this.#bgm.fade.from = this.#bgm.fade.to;
      this.#log('[audio] set:TransferMusicVolume = 2 ⇒ 淡变直接跳到目标（引擎 sub_418580 的 a2==2 支）');
      return;
    }
    this.#log(`[audio] set:TransferMusicVolume = ${mode}（引擎 sub_418580：1 = 按进度插值 / 2 = 跳到目标 / 其余无动作）`);
  }

  // ==================== 开关 / 音量 / 策略 ====================

  /** `0xBB`（SE）/ `0xBC`（BGM）/ `sound:Voice`：总线开关（关时引擎会把该总线的通道全停掉）。 */
  setEnabled(target: AudioBus, on: boolean): void {
    this.#enabled[target] = on;
    if (on) return;
    // ★关 SE 只停 0..9（引擎 `sub_408D90` 的循环上界 = 10，raw 13561-13568）——
    //   12..14 属语音、10/11 是备用直通格，都不归 SE 开关管（见 SE_ENABLE_RELEASE_CHANNELS）。
    if (target === 'se') for (let ch = 0; ch < SE_ENABLE_RELEASE_CHANNELS; ch++) this.#stopSe(ch);
    else if (target === 'voice') for (let ch = 0; ch < this.#voice.length; ch++) this.#stopVoice(ch);
    else this.#stopBgm();
    this.#log(`[audio] ${target} 总线关闭 ⇒ 该总线通道已停`);
  }

  /** `0xC6`：设音量（0 = 主 / 1 = BGM / 2 = SE / 3 = 语音 / 4 = 影片）。 */
  setVolume(category: number, value: number): void {
    // ★**原值直存**（审计 P3 `0xc6 approximation`，票 `T-0152`）：引擎 `sub_4071D0`/`sub_489B80`/`sub_4B68A0`
    //   对脚本给的音量是**原值直用**（`sound:Volume0..4` 与设备格存的都是原始值）；
    //   钳位只发生在"把 0..10000 换算成增益"那一步（各 `#*Gain()` 里）。
    //   语料 5 处全是 0..10000 的合法值 ⇒ 越界时才会与修前分叉（修前配置里会被钳成 0/10000）。
    const v = Number.isFinite(value) ? value : 0;
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
      if (d.armedAtMs === null) d.armedAtMs = nowMs; // ★null 才是"未起步"（0 会被第一帧吃掉）
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
      if (r.armedAtMs === null) r.armedAtMs = nowMs; // ★同上
      if (nowMs - r.armedAtMs >= r.delayMs) this.voicePlay(ch, r.id, r.loop);
    }
    // 4) BGM 淡变 + 压低
    const bgm = this.#bgm;
    if (bgm.fade) {
      const f = bgm.fade;
      // ★节流：引擎是「节流毫秒到期才 CALL 一次」（raw 29836 + 106328）——
      //   `throttleMs === 0` 时每帧都到期（= 清 bit0x200 那条内部路径的旧口径）。见 `bgmFadeTo`。
      if (nowMs >= f.nextAtMs) {
        f.nextAtMs = nowMs + f.throttleMs;
        f.progress = Math.min(FADE_STEPS, f.progress + f.step);
        const t = f.progress / FADE_STEPS;
        const gain = f.from + (f.to - f.from) * t;
        bgm.playback?.setGain(this.#clampGain(gain * this.#duckFactor()));
        if (f.progress >= FADE_STEPS) {
          bgm.fade = null;
          if (f.to === 0) this.#stopBgm(); // 淡到 0 = 停（引擎在进度满且目标为 0 时 stop）
        }
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
            gain: this.#bgmGain(), fading: this.#bgm.fade !== null, paused: this.#bgm.paused,
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
    this.#log(`[audio] ${what}：SE 通道越界 ${ch}（引擎 sub_4B6020 raw 138599 的 a2 > 0xE ⇒ 报 dsPlaySound）`);
    return null;
  }

  /**
   * `0x2F8` 的**设备通道号** → 宿主通道对象（设备 0..14 全覆盖，与引擎 `sub_4B6940` 的值域门同口径）。
   *
   * 两张宿主表的编号口径**不同**（本工程内部约定，不是引擎的）：
   *  - `#se[i]` = 设备通道 `i`（`SE_CHANNELS` = 15 ⇒ 设备 0..14 一一对应）；
   *  - `#voice[i]` = 设备通道 `12 + i`（`VOICE_CHANNEL_BASE`；只 3 格 = 设备 12..14）。
   * ⇒ 设备 12..14 → 语音、0..11 → SE、其余 → 报一条错（引擎 raw 139085-139087 的错串分支）。
   */
  #devicePanTarget(ch: number, what: string): { kind: 'se'; channel: SeChannel } | { kind: 'voice'; channel: VoiceChannel } | null {
    if (ch < 0 || ch >= SE_CHANNELS) {
      this.#log(`[audio] ${what}：设备通道越界 ${ch}（引擎 sub_4B6940 raw 139068 的 a2 < 15 ⇒ 报错分支）`);
      return null;
    }
    if (ch >= VOICE_CHANNEL_BASE) {
      const channel = this.#voice[ch - VOICE_CHANNEL_BASE];
      if (channel) return { kind: 'voice', channel };
      this.#log(`[audio] ${what}：设备通道 ${ch} 没有对应的语音通道对象（本实现只建模 3 格）`);
      return null;
    }
    const channel = this.#se[ch];
    if (channel) return { kind: 'se', channel };
    return null;
  }

  /**
   * 语音逻辑通道（0..2 ↔ 设备 12..14）。
   *
   * ★**越界处置 = 有据豁免，不是缺口**（审计 P3 `0x2f6 missing-consumer` / `0x2f8 missing-branch`，
   * 票 `T-0152`）：引擎那一侧 `Engine[ch + 21315]` 是**无门直接下标**
   * （raw 33676-33704；值域门只在下游设备层 `a2 >= 15`）⇒ ch = 3..14 时引擎会
   * **写坏相邻字段**（`[21315+3]` 已是别的槽）。本工程用独立的 `#voice[3]` 建模语音、**不复制这种
   * 越界写坏** ⇒ 越界只记日志、不动作。语料实测 `0x2F6` 的 op1 只有 0..2（86651 处）、
   * `0x2F8` 的通道位（第 2 操作数）只有 `0`（14642 处）⇒ 现实不可见。
   *
   * ★**`0x2F8` 是例外**：它走的是**设备通道号**（引擎 `sub_4B6940(设备, 12 + 语音通道, value)`），
   * 合法域 0..14（raw 139068）—— 12/13/14 折回本方法的 0..2、0..11 归 `#se`（见 `voicePan`）。
   */
  #voiceChannel(ch: number, what: string): VoiceChannel | null {
    if (ch >= 0 && ch < this.#voice.length) return this.#voice[ch]!;
    this.#log(`[audio] ${what}：语音通道越界 ${ch}（引擎按 ch 直接下标、设备层才判 < 15；本实现只建模 0..2）`);
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
    // ★注意：`0xB8`（停 BGM）**不动** `#bgm.mode`/`#enabled.bgm` —— 引擎 `sub_419720`（raw 24817-24829）
    //   只做「帧状态槽 = 1 + 清 bit0x200 + sub_489B50」，**不碰**任何 BGM 模式/开关字段
    //   （审计 P2 `0xb8 missing-behavior`，票 `T-0152`）⇒ 停完之后 `#bgm.mode` 必须原样保留，
    //   否则 `bgmPlay` 的 `mode === 0` 早退会让"停 → 重播"习语整段静音。
    // 引擎 `sub_489B50`（停）第二行就把暂停位清 0（raw 106186）⇒ 停播一律回到"非暂停"。
    this.#bgm.paused = false;
    this.#bgm.pausePos = 0;
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

  /**
   * 音量换算的**唯一钳位点**（`#volumes.*` 里存的是脚本给的**原值**，见 `setVolume` 的说明）：
   * 引擎 `sub_4B68E0`/`sub_4B6210` 把 0..10000 映射成 DirectSound 的百分之一 dB，越界值在那里被物理域限住。
   */
  #vol(v: number): number {
    return clampVolume(v);
  }

  /** SE 通道增益 = `sound:Volume2 × 主音量`（引擎 `设备[327+ch] × 设备[342]`，通道各自无因子）。 */
  #seGain(_ch: number): number {
    return this.#clampGain((this.#vol(this.#volumes.se) / VOLUME_MAX) * (this.#vol(this.#volumes.master) / VOLUME_MAX));
  }

  #voiceGain(v: VoiceChannel): number {
    return this.#clampGain(
      (this.#vol(this.#volumes.voice) / VOLUME_MAX) *
        (this.#vol(this.#volumes.master) / VOLUME_MAX) *
        (clampVolume(v.factor) / VOLUME_MAX),
    );
  }

  #bgmGain(): number {
    return this.#clampGain(
      (this.#vol(this.#volumes.bgm) / VOLUME_MAX) * (this.#vol(this.#volumes.master) / VOLUME_MAX) * this.#duckFactor(),
    );
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
