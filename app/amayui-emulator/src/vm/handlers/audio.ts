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
 * | `0xC3` | 写音乐运行态「当前曲 id」（**不播**） | （无意图；只改 `Music[259]`） |
 * | `0xBB` / `0xBC` | SE 总开关 / BGM 模式开关 | `enable` / `bgm-mode`（+ 停一次再重播当前曲） |
 * | `0xC2` | BGM 淡变（目标 0 ⇒ 清当前曲 id；目标非 0 ⇒ 起播当前曲） | `bgm-fade`（可能先 `bgm-play`） |
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
import { pushVoiceRecord } from './text-items.js';
import type { AudioIntent, AudioBus } from '../../audio/audioEngine.js';
import { setConfigValue } from './msgwin.js';
import { cfgEquals, cfgInt } from '../../engineConfig.js';
import { CFG, cfgSoundVolumeKey } from '../../configRegistry.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
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

/**
 * `0xB8`（`sub_419720` raw 24817-24829，**0 操作数**）：**停止 BGM**。
 *
 * ```c
 * _this[帧状态槽] = 1;
 * if ((_this[174801] & 0x200) != 0) { _this[174801] &= ~0x200; sub_489E50(Music, 100); } // 推进淡出
 * return sub_489B50(Music);                                                              // 停
 * ```
 * 与 `0xBC`（BGM 开关/模式）不同：它**不动 `sound:Music` 配置**，只停当前正在播的曲子。
 * 语料用途：`MMODE`（BGM 鉴赏）进界面时先停掉 ROOM 的背景音乐（`MMODE.txt:63`），
 * 试听切换时也各停一次（`:462`/`:552`）。
 */
const op_bgm_stop: OpHandlerLike = (c) => {
  // ★`sub_489B50` 的第一件事就是 `Music[259] = 0`（raw 106185）—— 即"停"同时**清当前曲 id**。
  //   这一点是读档 BGM 还原链的一半：`SAVE.txt:934 i0b8`（确认读档后）清掉 id，读档再把存档里的
  //   id 装回（raw 19911 = 镜像 `[2]`），最后 `CALLBACK_LOAD.BIN:20 i0b7 0` 用它重播。
  setMusicId(c.e, 0);
  if ((c.e.effectFlags & 0x200) !== 0) {
    c.e.effectFlags &= ~0x200; // 引擎：清 bit0x200
    emit(c, { kind: 'bgm-fade', value: 0, step: 100 }); // 引擎：sub_489E50(Music, 100) 推进淡出
  }
  emit(c, { kind: 'bgm-stop' });
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
 *
 * ★同时把命中的统一文件 id 记成「已使用」（引擎 `sub_48DB80` 解析曲号时就 `sub_4559C0` 打开了文件
 * ⇒ `sub_454960` 写 FileDB 的已使用表）—— 这正是「回想 → BGM 鉴赏」里曲子被解锁的唯一途径（见
 * `handlers/resource-usage.ts` 的 `0x19D`）。
 */
function bgmPlayIntent(e: StepCtx['e'], bgm: number, loop: boolean): AudioIntent {
  const res = resolveBgmResource(e, bgm);
  if (res && 'id' in res) e.markFileUsed(res.id);
  return res ? { kind: 'bgm-play', bgm, loop, res } : { kind: 'bgm-play', bgm, loop };
}

/**
 * **读档时重播存档里的当前曲**（引擎 `CALLBACK_LOAD.BIN:20` 的 `i0b7 0` 的等价物）。
 *
 * 引擎的完整链条（见 `docs-new/03-engine/save-data.md` §7.7、`sound-system.md` §5）：
 * ```
 * 存档：镜像[2] = Music[259]（当前曲 id；写侧 raw 17469-17471）
 * 读档：Engine[174713] = 镜像[2]（raw 19911）+ 帧 0 ← CALLBACK_LOAD.BIN
 * CALLBACK_LOAD：`i0b7 0` ⇒ sub_489F80(Music, 0, 1) ⇒ 曲 id 非 0 ⇒ 重新起播该曲（循环位 = 1）
 * ```
 * ★**为什么必须补这一跳**：读档落点是"存档当时那句话"（`0xAE` 的 `0x71` 表下标），而场景的
 * `play-bgm` 通常在**进入消息循环之前**（实测 `SN0000.BIN`：`i0ae` = 指令 737、`play-bgm d` = 752、
 * 落点 = 794）⇒ 续跑那一遍会**跳过 play-bgm**，而 `SAVE.txt:934` 又刚把 BGM 停掉 ⇒ 读档后整场没音乐。
 * 引擎靠这里重播；emulator 此前跳过了 `CALLBACK_LOAD` 这一跳（`SLOT_GAPS ⑥`）⇒ BGM 丢了。
 *
 * `loop` 恒为 `true`：`sub_489F80` 的第一件事就是 `Music[261] = a3`，而 `CALLBACK_LOAD` 传的是 1。
 */
export function bgmReplayIntent(e: StepCtx['e'], id: number): AudioIntent {
  return bgmPlayIntent(e, id, true);
}

/** 音乐运行态：当前曲 id（`Music[259]` = `_this[174713]`）。 */
function musicId(e: StepCtx['e']): number {
  return e.engineValues.get(ENGINE_FIELD.musicField) ?? 0;
}
function setMusicId(e: StepCtx['e'], id: number): void {
  e.engineValues.set(ENGINE_FIELD.musicField, id);
}
/** 音乐运行态：循环位（`Music[261]` = `_this[174715]`）。 */
function musicLoop(e: StepCtx['e']): boolean {
  return (e.engineValues.get(ENGINE_FIELD.musicLoopField) ?? 0) !== 0;
}
function setMusicLoop(e: StepCtx['e'], loop: boolean): void {
  e.engineValues.set(ENGINE_FIELD.musicLoopField, loop ? 1 : 0);
}

/**
 * `0xB7`（循环）/ `0xB9`（不循环）：在 BGM 当前槽播曲（引擎 `sub_489F80` raw 106352-106372）。
 *
 * ```c
 * _this[261] = a3;            // 循环位
 * if (a2) { _this[259] = a2; goto PLAY; }
 * if (_this[259]) goto PLAY;  // ★a2 == 0 ⇒ **重播当前曲**
 * sub_489B50(_this);          // 当前曲也没有 ⇒ 停
 * ```
 * ★**`i0b7 0` 不是"播曲号 0"而是"重播当前曲"**（语料里 0xB7 的 30 处全是 `i0b7 0`）。这条习语出现在
 * 两处：① `CALLBACK_LOAD.txt:20`（读档还原 BGM，见 `bgmReplayIntent`）；② 各 ADV 场景换曲：
 * `i0b8`（停并清 id）→ `i0b7 0`（置循环位）→ `i0c3 <新曲号>`（登记新曲，不播）→
 * `i0c2 <目标音量> <步长>`（淡入 ⇒ `sub_489D10` 见"音量为 0 且曲 id 非 0"就起播）——
 * 例 `src/SC0010.txt:1648-1652`（`i0c3 35`）。修前把它当曲号 0 发出去 ⇒ 换曲习语整条静音。
 */
const op_bgm_slot: OpHandlerLike = (c) => {
  const loop = c.instr.opcode === 0xb7;
  setMusicLoop(c.e, loop);
  const arg = readIntOperand(c.e, c.frame, c.instr, 1);
  const id = arg !== 0 ? arg : musicId(c.e);
  if (id === 0) return; // 引擎：当前曲 id 也是 0 ⇒ sub_489B50（此刻本来就没在播）
  if (arg !== 0) setMusicId(c.e, arg);
  emit(c, bgmPlayIntent(c.e, id, loop));
};

/**
 * `0xBF` play-bgm：与 0xB7 同为"播 BGM（循环）"，但引擎还会先清 `effect_flags` bit 0x200 并推进淡出，
 * 再按两个配置决定"语音在播时是否让路"：`set:KeepMusicVoice` 与 `sound:MusicFadeOnVoicePlaying`。
 * 这里把两个配置作为**策略**下发给宿主（宿主按策略压低 BGM，见 `audioEngine.ts` 的说明）。
 *
 * ★引擎还有第三个判据（raw 29773）：`!_this[122503]`（**跳读态**，由 `0x1BF` 置位）。
 * 跳读态在时**不做**"给语音让路"的暂停 ⇒ 这里把 `fadeOnVoice` 一并按它收敛，让宿主行为与真机一致。
 */
const op_play_bgm: OpHandlerLike = (c) => {
  // ★键名曾是拼错的 'set:keepmusicvoice'（raw 0 次）⇒ 恒读 fallback、BGM 让路永不生效；
  //   且引擎判据是 **== 1**（raw 29769-29777），不是"非 0"（T-0057 R1）。
  const cfg = c.e.config;
  const keep = cfg ? cfgEquals(cfg, CFG.soundKeepMusicVolume, 1) : false;
  const skipRead = (c.e.engineValues.get(ENGINE_FIELD.skipReadActive) ?? 0) !== 0;
  const fadeOnVoice = (cfg ? cfgEquals(cfg, CFG.soundMusicFadeOnVoicePlaying, 1) : false) && !skipRead;
  emit(c, { kind: 'policy', keepMusicVoice: keep, fadeOnVoice });
  if ((c.e.effectFlags & 0x200) !== 0) {
    c.e.effectFlags &= ~0x200; // 引擎：清 bit0x200 并 sub_489E50(Music,100)（推进淡出）
    emit(c, { kind: 'bgm-fade', value: 0, step: 100 });
  }
  // ★`sub_489C20(Music, op1, 1)`（raw 106225-106253）：`Music[261] = 1` 恒执行；`op1 == 0` 时与
  //   `0xB7 0` 同义（当前曲 id 非 0 ⇒ 重播，否则 `sub_489B50` 停）；同曲同循环已在播 ⇒ 什么都不做
  //   （宿主 `bgmPlay` 里那条 `#bgm.bgm === bgm && playback && loop` 就是它）。
  setMusicLoop(c.e, true);
  const arg = readIntOperand(c.e, c.frame, c.instr, 1);
  if (arg === 0) {
    const cur = musicId(c.e);
    if (cur !== 0) emit(c, bgmPlayIntent(c.e, cur, true));
    else emit(c, { kind: 'bgm-stop' }); // 引擎：sub_489B50
    return;
  }
  setMusicId(c.e, arg);
  emit(c, bgmPlayIntent(c.e, arg, true));
};

/** `0xBB`：SE 总开关（引擎 `sub_408D90`：与现状比较后写配置 `sound:SE`，关时停 0..9 通道）。 */
const op_se_enable: OpHandlerLike = (c) => {
  const on = readIntOperand(c.e, c.frame, c.instr, 1) !== 0;
  setConfigValue(c.e, CFG.soundSE, on ? 1 : 0);
  emit(c, { kind: 'enable', target: 'se', on });
};

/**
 * `0xBC`：BGM 开关/模式（引擎 `sub_420DC0` → `sub_408CF0(op1-1)`）：把 `sound:Music` 的值 **±3** 写回
 * （`< 0` 视为关），并通知宿主切换 BGM 开关。
 *
 * ★操作数口径按 raw 收（`sub_420DC0` raw 29893-29801：`result = op1; if (result <= 2) sub_408CF0(result-1)`）：
 * op1 ≤ 2 才动作，`a2 = op1 - 1`（a2 = 0 = 关；a2 ≠ 0（含 −1）= 开）。opcode-table 旧写的"1..3"与 raw
 * 不一致（多算了 3、漏了 0），语料 0 处 ⇒ 按 raw 实现。
 *
 * ★引擎在开关切换时**停一次再重播当前曲**（`sub_408CF0` raw 13521-13534）：
 * `v6 = Music[259]` → 改配置 → `sub_489B50`（停 + 清 id）→ `Music[259] = v6`（装回）→
 * `sub_489F80(Music, 0, Music[261])`（用当前循环位重播）。所以这里补 `bgm-stop` + 重播；
 * 关模式时宿主 `#enabled.bgm = false`（`bgm-play` 只记 id 不起播）⇒ 语义仍正确。
 */
const op_bgm_mode: OpHandlerLike = (c) => {
  const raw = readIntOperand(c.e, c.frame, c.instr, 1);
  if (raw > 2) return; // 引擎：`result <= 2` 才动作
  const a2 = raw - 1; // 0 = 关；其余（含 −1/1）= 开
  const cur = c.e.config ? cfgInt(c.e.config, CFG.soundMusic, 0) : 0;
  if (a2 !== 0 && cur < 0) setConfigValue(c.e, CFG.soundMusic, cur + 3);
  else if (a2 === 0 && cur >= 0) setConfigValue(c.e, CFG.soundMusic, cur - 3);
  emit(c, { kind: 'bgm-mode', mode: a2 });
  const id = musicId(c.e);
  const loop = musicLoop(c.e);
  emit(c, { kind: 'bgm-stop' });
  if (id !== 0) emit(c, bgmPlayIntent(c.e, id, loop));
};

/**
 * `0xC2`：BGM 淡变到 op1（0..10000），每帧推进 op2（引擎 `sub_489D10`/`sub_489E50`）。
 *
 * ★两处必须一起做（`sub_489D10` raw 106287-106318 的副作用）：
 *  - **目标为 0 ⇒ 立刻清当前曲 id**（raw 106317-106318 `if (!Music[265]) Music[259] = 0`；
 *    `Music[265]` 就是这里写的目标）；
 *  - **目标非 0 且曲 id 非 0 ⇒ 起播当前曲**（raw 106291-106316：音量为 0 或槽没在播时 `setPosition(0)`
 *    + `play(Music[259], Music[261])`）—— 这是"`i0c3 <曲号>` 登记 + `i0c2 <音量> <步长>` 淡入"习语里
 *    **真正把曲放起来**的那一步（宿主的 `bgmPlay` 自带同曲同循环不重启 ⇒ 正在播时不会被打断）。
 */
const op_bgm_fade: OpHandlerLike = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 1);
  const step = readIntOperand(c.e, c.frame, c.instr, 2);
  const id = musicId(c.e);
  if (value <= 0) setMusicId(c.e, 0);
  else if (id !== 0) emit(c, bgmPlayIntent(c.e, id, musicLoop(c.e)));
  emit(c, { kind: 'bgm-fade', value, step });
};

/**
 * `0xC3`（`sub_420F10` raw 29844-29859）：**写运行期音乐字段** —— `Music[259] = op1`（**不播**）。
 *
 * ```c
 * if ((_this[174801] & 0x200) != 0) { _this[174801] &= ~0x200; sub_489E50(Music, 100); } // 同 0xB7 的序
 * _this[174713] = sub_41BF50(_this, 1);                                                  // 登记曲号
 * ```
 * 语料 30 处，**全部**紧跟 `i0b7 0`（如 `src/SC0010.txt:1649-1650`：`i0b7 0` / `i0c3 35`）——
 * 即"先置循环位、再登记新曲、最后由 `i0c2` 淡入起播"。修前它**不在任何表里**（命中即硬报错），
 * 凡走这条习语的场景（SC0000/SC0010/SC0130/… 共 30 处）都会中断。
 */
const op_set_music_field: OpHandlerLike = (c) => {
  if ((c.e.effectFlags & 0x200) !== 0) {
    c.e.effectFlags &= ~0x200;
    emit(c, { kind: 'bgm-fade', value: 0, step: 100 });
  }
  setMusicId(c.e, readIntOperand(c.e, c.frame, c.instr, 1));
};

/** `0xC4`（循环位 0）/ `0x1BD`（循环位 1）：播语音到通道 0（ADV 位在时寄存）。 */
const op_play_voice: OpHandlerLike = (c) => {
  const loop = c.instr.opcode === 0x1bd;
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  voicePlayOrDefer(c, 0, id, loop);
  // 引擎在同一 handler 末尾（raw 29904-29908 / 30058-30062）往**文本项记录表**压一条语音记录：
  //   `if (!Engine[97055]) sub_45EEA0(Font, 0, op1, 循环位, 0, Engine[5053])`
  // 它是 `0x1D4`/`0x2F3`（`REPLAYVOICE` 的"重播这条语音"）的数据源 ⇒ 必须一起做。
  pushVoiceRecord(c.e, id, loop ? 1 : 0, 0);
};

/** `0x2F4`：播语音（op1 = id、op2 = 附带/循环位、op3 = 语音通道，0..2）+ 登记文本项记录。 */
const op_voice_play_slot: OpHandlerLike = (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  const loop = readIntOperand(c.e, c.frame, c.instr, 2) !== 0;
  const ch = readIntOperand(c.e, c.frame, c.instr, 3);
  voicePlayOrDefer(c, ch, id, loop);
  // 引擎 raw 33650-33654：`if (!Engine[97055]) sub_45EEA0(Font, 0, op1, 0, op3, Engine[op3+5053])`
  // ⇒ 选择器 = **通道号**（`0x2F3` 就是按它查回语音 id 的）。
  pushVoiceRecord(c.e, id, 0, ch);
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

// ---------------------------------------------------------------------------
// A5（音频设备 / 清理）—— 2026-09 落地
// ---------------------------------------------------------------------------

/**
 * `0x1BC`（`sub_4197A0` raw 24845-24871）：**清消息/声音字段**（语料 213 处 / 184 个脚本）。
 *
 * 引擎三件事：
 * 1. 若 `Engine[21290]`（byte 85160）非空 ⇒ 对 i=0..2 调 `sub_4B60C0(voiceObj, i + 12)`
 *    （**释放 3 个语音通道对象**，通道号 12/13/14）；
 * 2. 清零 `Engine[21315..21320]`（byte 85260-85280）= **语音通道状态位**（`0x2F7` 写的那组）；
 * 3. 清零 `Engine[122501]`（byte 490004）与 `Engine[122505..122510]`（byte 490020-490040）
 *    = **寄存语音槽**（`0xC4` 的 ADV 分支写 `[122505]=id`/`[122508]=标志`）。
 */
const op_clear_message_sound_fields: OpHandlerLike = (c) => {
  const e = c.e;
  for (let ch = 0; ch < 3; ch++) {
    e.engineValues.set(ENGINE_FIELD.voiceChannelStateBase + ch, 0);
    e.engineValues.set(ENGINE_FIELD.voiceRegBase + ch, 0);
    emit(c, { kind: 'voice-reset', ch });
  }
  e.engineValues.set(ENGINE_FIELD.voiceChannelFactorBase, 0);
  e.engineValues.set(ENGINE_FIELD.voiceChannelFactorBase + 1, 0);
  e.engineValues.set(ENGINE_FIELD.voiceChannelFactorBase + 2, 0);
  e.engineValues.set(ENGINE_FIELD.voiceRegSingle, 0);
  e.engineValues.set(ENGINE_FIELD.voiceRegFlagBase, 0);
  e.engineValues.set(ENGINE_FIELD.voiceRegFlagBase + 1, 0);
  e.engineValues.set(ENGINE_FIELD.voiceRegFlagBase + 2, 0);
};

/**
 * `0x1C9`（`sub_420160` raw 29291-29312）：**音频设备 / 驱动初始化**（语料 0 处）。
 *
 * 引擎：按统一 id（op1）打开音频驱动文件 → `sub_4B8490(Engine+7912, id, data, size)`（装载设备数据）
 * → `sub_4B86E0(Engine+696548, hInstance)`（用宿主 hInstance 初始化音频子系统）
 * → `Engine[18656] = op2`、`Engine[18660] = op3` → 取窗口坐标 `sub_4771D0` → `sub_4B7B70(设备, x, y)`。
 *
 * emulator：**两个参数照写字段**（`18656`/`18660`）；设备/驱动的装载与窗口坐标下发**无宿主等价物**
 * （重写侧用 Web Audio，声部按需惰性创建，没有"驱动文件"这一层）⇒ 记为已登记缺口，不假装实现。
 */
const op_audio_device_init: OpHandlerLike = (c) => {
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.audioDeviceField0, readIntOperand(e, c.frame, c.instr, 2));
  e.engineValues.set(ENGINE_FIELD.audioDeviceField1, readIntOperand(e, c.frame, c.instr, 3));
  c.log('0x1C9: 音频设备/驱动初始化 —— 设备文件装载与窗口坐标下发未建模（重写侧无驱动层，缺口已登记）');
};

/** `0x302`：语音通道音量因子**生效**并应用（引擎 `Engine[21318+ch]=0x10000` → `sub_4BBC30`）。 */
const op_voice_factor_apply: OpHandlerLike = (c) => {
  emit(c, {
    kind: 'voice-factor-apply',
    ch: readIntOperand(c.e, c.frame, c.instr, 1),
    value: readIntOperand(c.e, c.frame, c.instr, 2),
  });
};

/**
 * `0xC6`：设音量 —— op1 = 类别（0 = 主 / 1 = BGM / 2 = SE / 3 = 语音 / 4 = 影片）、op2 = 值。
 * 引擎同时把值写进配置 `sound:Volume0..4`（所以设置界面的滑块改完能持久化），越界走报错分支不写。
 */
const op_set_volume: OpHandlerLike = (c) => {
  const category = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  if (category < 0 || category > 4) return; // 引擎：sprintf("setVolume") 报错，不写
  setConfigValue(c.e, cfgSoundVolumeKey(category), value);
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
  [0xb8, op_bgm_stop],
  [0x2bf, op_se_delay],
  [0xb7, op_bgm_slot],
  [0xb9, op_bgm_slot],
  [0xbf, op_play_bgm],
  [0xbb, op_se_enable],
  [0xbc, op_bgm_mode],
  [0xc2, op_bgm_fade],
  [0xc3, op_set_music_field], // 写 Music[259]（当前曲 id，不播）；30 处，全在"换曲淡入"习语里
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
  // ---- A5（音频设备 / 清理，2026-09）----
  [0x1bc, op_clear_message_sound_fields], // 清语音通道状态位 + 寄存槽 + 释放 3 个通道对象（213 处）
  [0x1c9, op_audio_device_init], // 音频设备/驱动初始化 + `Engine[18656]/[18660]`（0 处；装载=已登记缺口）
];

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
    // ★键一律小写查（`parseIni` 的存储口径；CFG.* 常量保留引擎原始大小写）。
    const v = cfg.values.get(key.toLowerCase());
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (let category = 0; category <= 4; category++) {
    const v = num(cfgSoundVolumeKey(category));
    if (v !== null) out.push({ kind: 'volume', category, value: v });
  }
  const keep = num(CFG.soundKeepMusicVolume);
  const fade = num(CFG.soundMusicFadeOnVoicePlaying);
  if (keep !== null || fade !== null) {
    // 与 `op_play_bgm` 同口径：引擎 raw 29769-29777 的判据是 **== 1**，不是「非 0」。
    out.push({ kind: 'policy', keepMusicVoice: keep === 1, fadeOnVoice: fade === 1 });
  }
  // 三条总开关（引擎用 sound:SE / sound:Voice / sound:Music 决定各模块 `[261]`）
  const se = num(CFG.soundSE);
  if (se !== null) out.push({ kind: 'enable', target: 'se', on: se !== 0 });
  const voice = num(CFG.soundVoice);
  if (voice !== null) out.push({ kind: 'enable', target: 'voice', on: voice !== 0 });
  const music = num(CFG.soundMusic);
  if (music !== null) out.push({ kind: 'bgm-mode', mode: music >= 0 ? 1 : 0 });
  return out;
}
