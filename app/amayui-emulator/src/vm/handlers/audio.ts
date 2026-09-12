/**
 * **音频指令族**（`0xB4`..`0xC7`、`0x1BD`、`0x2BF`/`0x2C0`、`0x2F4`..`0x302`）—— 逐条读体的结论见
 * `docs-new/03-engine/sound-system.md`，实现方案见 `app/amayui-emulator/docs/13-audio-plan.md`。
 *
 * ## 这一族为什么值得真实现（而不是当 no-op）
 * 引擎里它们**只作用于声音侧**：不回写操作数、不改 `ip/cur`、也不写任何脚本读得到的字段 ——
 * 所以它们被跳过时**不会**让任何脚本分支走错（这正是此前全程 no-op 也没出过逻辑 bug 的原因）。
 * 代价是「界面上的反馈音 / 标题 BGM / CV 页试听 / ADV 语音」全都静音，而且**未注册时命中即硬报错**
 * （0xB6/0xBA/0x2FF… 此前不在任何表里）——SAVE/CONFIG 这类界面脚本必然踩到。
 *
 * ## 与引擎的对应（表见 sound-system.md §7）
 * | opcode | 语义 | 意图 |
 * |---|---|---|
 * | `0xB4` play-sound-effect | SE 装载（**不起播**） | `se-load` |
 * | `0xB5` / `0xBA` | SE 起播（播一次 / 循环） | `se-play` |
 * | `0xB6` | SE 停止/释放 | `se-stop` |
 * | `0x2BF` | 延迟播 SE（循环标志 + 毫秒） | `se-delay` |
 * | `0xB7` / `0xB9` / `0xBF` | BGM 当前槽播（循环 / 不循环）/ play-bgm | `bgm-play` |
 * | `0xBB` / `0xBC` | SE 总开关 / BGM 模式开关 | `enable` / `bgm-mode` |
 * | `0xC2` | BGM 淡变 | `bgm-fade` |
 * | `0xC4` / `0x1BD` | 播语音（通道 0，循环位 0 / 1） | `voice-play`（ADV 位在时 `voice-defer`） |
 * | `0x2F4` | 播语音（id, 附带, 通道） | 同上（通道 = op3） |
 * | `0x2C0` / `0x2F5` | 语音排队（带延迟、指定通道） | `voice-queue` |
 * | `0x2F6` | 复位语音通道 | `voice-reset` |
 * | `0x2F7` / `0x2FF` / `0x302` | 状态位 / 音量因子预备 / 音量因子生效 | `voice-flag` / `voice-factor-prepare` / `voice-factor-apply` |
 * | `0x2F8` | **设语音通道 pan**（±10000） | `voice-pan` |
 * | `0xC6` | 设音量（0..4 类别，并写 `sound:VolumeN`） | `volume` |
 * | `0xC5` / `0xC7` | 读音量 / 读开关 | 已在 `config-read.ts`（真实现） |
 *
 * ## 两个刻意的取舍
 *  1. **不 `await`**：handler 只发意图，装载/解码在宿主侧异步完成（引擎是同步读文件+解码，会**阻塞**；
 *     我们不想让一帧 6MB 的 BGM 读取卡住 VM）。行为差异只是"晚一帧出声"。
 *  2. **ADV 寄存**：`effect_flags & 0x8000000` 置位时不立即起播，改发 `voice-defer`；宿主在
 *     `tick(nowMs, advActive=false)`（= ADV 位清除后的第一帧）冲刷 —— 对应引擎 raw 20146/24966 的冲刷点。
 */
import type { StepCtx } from '../step.js';
import { readIntOperand } from '../operand.js';
import { ADV_ACTIVE } from '../engine.js';
import type { AudioIntent, AudioBus } from '../../audio/audioEngine.js';
import { VOLUME_MAX } from '../../audio/audioEngine.js';
import { setConfigValue } from './msgwin.js';
import { resolveBgmResource } from './music-table.js';
import type { OpTable } from './shared.js';

/** 发一条音频意图给宿主（宿主没实现 `audio` ⇒ 静默丢弃，由闸门 A 留痕）。 */
function emit(c: StepCtx, intent: AudioIntent): void {
  c.native.audio?.(intent);
}

/** ADV 激活位是否置位（`0x8000000`；引擎 raw 20144 的同一判据）。 */
function advActive(c: StepCtx): boolean {
  return (c.e.effectFlags & ADV_ACTIVE) !== 0;
}

/** 语音"起播或寄存"：ADV 激活位在时寄存，否则立即起播（引擎 `0xC4`/`0x1BD`/`0x2F4` 的三处同构分支）。 */
function voicePlayOrDefer(c: StepCtx, ch: number, id: number, loop: boolean): void {
  if (advActive(c)) emit(c, { kind: 'voice-defer', ch, id, loop });
  else emit(c, { kind: 'voice-play', ch, id, loop });
}

/** `0xB4` play-sound-effect：op1 = 音效 id、op2 = SE 通道号（0..9）。★只装载，起播要另发 0xB5/0xBA。 */
const op_se_load: OpHandlerLike = (c) => {
  emit(c, { kind: 'se-load', id: readIntOperand(c.e, c.frame, c.instr, 1), ch: readIntOperand(c.e, c.frame, c.instr, 2) });
};

/** `0xB5` / `0xBA`：SE 通道起播（循环标志 = 0xB5 为 0、0xBA 为 1；引擎 SoundBuffer `+9296`）。 */
const op_se_play: OpHandlerLike = (c) => {
  emit(c, { kind: 'se-play', ch: readIntOperand(c.e, c.frame, c.instr, 1), loop: c.instr.opcode === 0xba });
};

/** `0xB6`：SE 通道停止/释放（引擎 `sub_4B5050` → `sub_4B6390` + 清 `SE[303+ch]`/`[262+ch]`）。 */
const op_se_stop: OpHandlerLike = (c) => {
  emit(c, { kind: 'se-stop', ch: readIntOperand(c.e, c.frame, c.instr, 1) });
};

/** `0x2BF`：延迟播 SE —— op1 = 通道、op2 = 循环标志、op3 = 延迟毫秒（引擎武装 + 每帧 `sub_4B5230`）。 */
const op_se_delay: OpHandlerLike = (c) => {
  emit(c, {
    kind: 'se-delay',
    ch: readIntOperand(c.e, c.frame, c.instr, 1),
    loop: readIntOperand(c.e, c.frame, c.instr, 2) !== 0,
    delayMs: readIntOperand(c.e, c.frame, c.instr, 3),
  });
};

/**
 * `bgm-play` 意图：曲号解析成功时带上 `res`（表命中），否则**不带该键**
 * （`AudioIntent.res` 是可选字段 —— 发 `res: undefined` 会让 `deepEqual` 断言与"未命中"难以区分）。
 */
function bgmPlayIntent(c: StepCtx, bgm: number, loop: boolean): AudioIntent {
  const res = resolveBgmResource(c.e, bgm);
  return res ? { kind: 'bgm-play', bgm, loop, res } : { kind: 'bgm-play', bgm, loop };
}

/** `0xB7`（循环）/ `0xB9`（不循环）：在 BGM 当前槽播曲（引擎 `sub_489F80`）。 */
const op_bgm_slot: OpHandlerLike = (c) => {
  const bgm = readIntOperand(c.e, c.frame, c.instr, 1);
  emit(c, bgmPlayIntent(c, bgm, c.instr.opcode === 0xb7));
};

/**
 * `0xBF` play-bgm：与 0xB7 同为"播 BGM（循环）"，但引擎还会先清 `effect_flags` bit 0x200 并推进淡出，
 * 再按两个配置决定"语音在播时是否让路"：`set:KeepMusicVoice` 与 `sound:MusicFadeOnVoicePlaying`。
 * 这里把两个配置作为**策略**下发给宿主（宿主按策略压低 BGM，见 `audioEngine.ts` 的说明）。
 */
const op_play_bgm: OpHandlerLike = (c) => {
  const keep = cfgBool(c, 'set:keepmusicvoice', false);
  const fadeOnVoice = cfgBool(c, 'sound:musicfadeonvoiceplaying', false);
  emit(c, { kind: 'policy', keepMusicVoice: keep, fadeOnVoice });
  if ((c.e.effectFlags & 0x200) !== 0) {
    c.e.effectFlags &= ~0x200; // 引擎：清 bit0x200 并 sub_489E50(Music,100)（推进淡出）
    emit(c, { kind: 'bgm-fade', value: 0, step: 100 });
  }
  const bgm = readIntOperand(c.e, c.frame, c.instr, 1);
  emit(c, bgmPlayIntent(c, bgm, true));
};

/** 读一个布尔配置（缺省 false；键统一小写，与 `parseIni` 的口径一致）。 */
function cfgBool(c: StepCtx, key: string, fallback: boolean): boolean {
  if (!c.e.config) return fallback;
  const map = c.e.config.values;
  const v = map.get(key);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n !== 0 : v !== '' && v !== '0';
}

/** `0xBB`：SE 总开关（引擎 `sub_408D90`：与现状比较后写配置 `sound:SE`，关时停 0..9 通道）。 */
const op_se_enable: OpHandlerLike = (c) => {
  const on = readIntOperand(c.e, c.frame, c.instr, 1) !== 0;
  setConfigValue(c.e, 'sound:se', on ? 1 : 0);
  emit(c, { kind: 'enable', target: 'se', on });
};

/**
 * `0xBC`：BGM 开关/模式（引擎 `sub_408CF0(op1-1)`）：op1 = 1..3；把 `sound:Music` 的值 **±3** 写回
 * （`< 0` 视为关），并通知宿主切换 BGM 开关。
 */
const op_bgm_mode: OpHandlerLike = (c) => {
  const raw = readIntOperand(c.e, c.frame, c.instr, 1);
  if (raw < 1 || raw > 3) return; // 引擎：op1 不在 1..3 时不动作
  const a2 = raw - 1; // 0 = 关；1/2 = 开（两种模式）
  const cur = cfgNum(c, 'sound:music', 0);
  if (a2 !== 0 && cur < 0) setConfigValue(c.e, 'sound:music', cur + 3);
  else if (a2 === 0 && cur >= 0) setConfigValue(c.e, 'sound:music', cur - 3);
  emit(c, { kind: 'bgm-mode', mode: a2 });
};

/** `0xC2`：BGM 淡变到 op1（0..10000），每帧推进 op2。 */
const op_bgm_fade: OpHandlerLike = (c) => {
  emit(c, {
    kind: 'bgm-fade',
    value: readIntOperand(c.e, c.frame, c.instr, 1),
    step: readIntOperand(c.e, c.frame, c.instr, 2),
  });
};

/** `0xC4`（循环位 0）/ `0x1BD`（循环位 1）：播语音到通道 0（ADV 位在时寄存）。 */
const op_play_voice: OpHandlerLike = (c) => {
  voicePlayOrDefer(c, 0, readIntOperand(c.e, c.frame, c.instr, 1), c.instr.opcode === 0x1bd);
};

/** `0x2F4`：播语音（op1 = id、op2 = 附带/循环位、op3 = 语音通道，0..2）+ 登记文本项记录（记录表未建模）。 */
const op_voice_play_slot: OpHandlerLike = (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  const loop = readIntOperand(c.e, c.frame, c.instr, 2) !== 0;
  const ch = readIntOperand(c.e, c.frame, c.instr, 3);
  voicePlayOrDefer(c, ch, id, loop);
};

/** `0x2C0`（通道 0）/ `0x2F5`（op4 = 通道）：把语音排入通道（带延迟；引擎 `sub_4BBA40`）。 */
const op_voice_queue: OpHandlerLike = (c) => {
  const ch = c.instr.opcode === 0x2f5 ? readIntOperand(c.e, c.frame, c.instr, 4) : 0;
  emit(c, {
    kind: 'voice-queue',
    ch,
    id: readIntOperand(c.e, c.frame, c.instr, 1),
    aux: readIntOperand(c.e, c.frame, c.instr, 2),
    delayMs: readIntOperand(c.e, c.frame, c.instr, 3),
  });
};

/** `0x2F6`：复位语音通道（停播 + 清状态 + 丢弃寄存）。 */
const op_voice_reset: OpHandlerLike = (c) => {
  emit(c, { kind: 'voice-reset', ch: readIntOperand(c.e, c.frame, c.instr, 1) });
};

/** `0x2F7`：置语音通道状态位（引擎 `Engine[21315+ch] = 1`）。 */
const op_voice_flag: OpHandlerLike = (c) => {
  emit(c, { kind: 'voice-flag', ch: readIntOperand(c.e, c.frame, c.instr, 1) });
};

/** `0x2F8`：设语音通道 **pan**（±10000，0 = 中央）。 */
const op_voice_pan: OpHandlerLike = (c) => {
  emit(c, {
    kind: 'voice-pan',
    ch: readIntOperand(c.e, c.frame, c.instr, 1),
    pan: readIntOperand(c.e, c.frame, c.instr, 2),
  });
};

/** `0x2FF`：语音通道音量因子**预备**（引擎 `Engine[21318+ch]=1`、`[21321+ch]=op2`，尚未生效）。 */
const op_voice_factor_prepare: OpHandlerLike = (c) => {
  emit(c, {
    kind: 'voice-factor-prepare',
    ch: readIntOperand(c.e, c.frame, c.instr, 1),
    value: readIntOperand(c.e, c.frame, c.instr, 2),
  });
};

/** `0x302`：语音通道音量因子**生效**并应用（引擎 `Engine[21318+ch]=0x10000` → `sub_4BBC30`）。 */
const op_voice_factor_apply: OpHandlerLike = (c) => {
  emit(c, {
    kind: 'voice-factor-apply',
    ch: readIntOperand(c.e, c.frame, c.instr, 1),
    value: readIntOperand(c.e, c.frame, c.instr, 2),
  });
};

/** 读一个整数配置（缺省 0）。 */
function cfgNum(c: StepCtx, key: string, fallback: number): number {
  if (!c.e.config) return fallback;
  const v = c.e.config.values.get(key);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `0xC6`：设音量 —— op1 = 类别（0 = 主 / 1 = BGM / 2 = SE / 3 = 语音 / 4 = 影片）、op2 = 值。
 * 引擎同时把值写进配置 `sound:Volume0..4`（所以设置界面的滑块改完能持久化），越界走报错分支不写。
 */
const op_set_volume: OpHandlerLike = (c) => {
  const category = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  if (category < 0 || category > 4) return; // 引擎：sprintf("setVolume") 报错，不写
  setConfigValue(c.e, `sound:volume${category}`, value);
  emit(c, { kind: 'volume', category, value });
};

/** 便于统一标注 handler 类型（与 `OpHandler` 同形，但本模块不 import 它以免多一圈依赖）。 */
type OpHandlerLike = (c: StepCtx) => void;

/** 音频指令族（`NATIVE_OPS`：经 `NativeBridge.audio` 落到宿主音频引擎）。 */
export const AUDIO_OPS: OpTable = [
  [0xb4, op_se_load],
  [0xb5, op_se_play],
  [0xba, op_se_play],
  [0xb6, op_se_stop],
  [0x2bf, op_se_delay],
  [0xb7, op_bgm_slot],
  [0xb9, op_bgm_slot],
  [0xbf, op_play_bgm],
  [0xbb, op_se_enable],
  [0xbc, op_bgm_mode],
  [0xc2, op_bgm_fade],
  [0xc4, op_play_voice],
  [0x1bd, op_play_voice],
  [0x2f4, op_voice_play_slot],
  [0x2c0, op_voice_queue],
  [0x2f5, op_voice_queue],
  [0x2f6, op_voice_reset],
  [0x2f7, op_voice_flag],
  [0x2f8, op_voice_pan],
  [0x2ff, op_voice_factor_prepare],
  [0x302, op_voice_factor_apply],
  [0xc6, op_set_volume],
];

/** 音频族用到的量程常量（导出便于测试断言，避免测试里写魔法数）。 */
export const AUDIO_VOLUME_MAX = VOLUME_MAX;
export type { AudioBus };

/**
 * **启动时把配置里的声音设置灌进音频引擎**（引擎 raw 23696-23721 / 14947-14977 的等价物）。
 *
 * 为什么需要：`0xC6` 只在**脚本设音量**时被调用，而玩家的音量是**写在 `SYS4REG.INI`** 里的
 * （`[sound] Volume0..4`）。引擎启动时读它并逐个应用；漏掉这一步的话，用户在设置界面调好的音量
 * 只有"这次会话里再拖动一次滑块"才生效 —— 表现是"每次启动都巨响"，且**不报错**。
 *
 * 只在键**真的存在**时下发（引擎的判据是 `>= 0`，缺省键不覆盖引擎内置值）。
 */
export function audioBootIntents(cfg: { values: Map<string, number | string> } | null | undefined): AudioIntent[] {
  if (!cfg) return [];
  const out: AudioIntent[] = [];
  const num = (key: string): number | null => {
    const v = cfg.values.get(key);
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (let category = 0; category <= 4; category++) {
    const v = num(`sound:volume${category}`);
    if (v !== null) out.push({ kind: 'volume', category, value: v });
  }
  const keep = num('set:keepmusicvoice');
  const fade = num('sound:musicfadeonvoiceplaying');
  if (keep !== null || fade !== null) {
    out.push({ kind: 'policy', keepMusicVoice: (keep ?? 0) !== 0, fadeOnVoice: (fade ?? 0) !== 0 });
  }
  // 三条总开关（引擎用 sound:SE / sound:Voice / sound:Music 决定各模块 `[261]`）
  const se = num('sound:se');
  if (se !== null) out.push({ kind: 'enable', target: 'se', on: se !== 0 });
  const voice = num('sound:voice');
  if (voice !== null) out.push({ kind: 'enable', target: 'voice', on: voice !== 0 });
  const music = num('sound:music');
  if (music !== null) out.push({ kind: 'bgm-mode', mode: music >= 0 ? 1 : 0 });
  return out;
}
