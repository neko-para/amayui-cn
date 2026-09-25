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
 * | `0x1BA` | **SetSoundMode**：按 op1 类别（1 音乐 / 2 SE / 3 语音 / 4 影片）设该路声音的开关 | 同上面三条（复用同一批意图）+ 写 `sound:*` 配置 |
 * | `0xC1` | **BGM 暂停/继续切换**（翻转 `Music[260]`，把新值下发给当前音源对象） | `bgm-pause` |
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
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { ADV_ACTIVE } from '../engine.js';
import type { Engine } from '../engine.js';
import { pushVoiceRecord } from './text-items.js';
import type { AudioIntent, AudioBus } from '../../audio/audioEngine.js';
import { setConfigValue } from './msgwin.js';
import { cfgEquals, cfgInt } from '../../engineConfig.js';
import { CFG, cfgSoundVolumeKey } from '../../configRegistry.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { resolveBgmResource } from './music-table.js';

/**
 * 取本族的**操作数计划视图**；缺计划 = 编程错误（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 *
 * ★本族（`tickets/T-0082` 批次"音频族整表"）**20 条一次迁完**：形状最单一（除三条 argc 0 外全是
 * "读 op1..opN → 交给宿主"）⇒ 迁移是机械的，且由「计划 ⟷ 实现」逐位核对 + 行为测试背书。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：音频指令族走操作数计划层，但没有声明计划`);
  return p;
}
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
  const p = planFor(c);
  emit(c, { kind: 'se-load', id: (p.int(1) ?? 0), ch: (p.int(2) ?? 0) });
};

/** `0xB5` / `0xBA`：SE 通道起播（循环标志 = 0xB5 为 0、0xBA 为 1；引擎 SoundBuffer `+9296`）。 */
const op_se_play: OpHandlerLike = (c) => {
  // ★走操作数计划层（`tickets/T-0082` 批次"共用 handler 的两族"）：只读 op1（通道）。
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：SE 起播走操作数计划层，但没有声明计划`);
  emit(c, { kind: 'se-play', ch: p.int(1) ?? 0, loop: c.instr.opcode === 0xba });
};

/** `0xB6`：SE 通道停止/释放（引擎 `sub_4B5050` → `sub_4B6390` + 清 `SE[303+ch]`/`[262+ch]`）。 */
const op_se_stop: OpHandlerLike = (c) => {
  const p = planFor(c);
  emit(c, { kind: 'se-stop', ch: (p.int(1) ?? 0) });
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
  const p = planFor(c);
  // ★`sub_489B50` 的第一件事就是 `Music[259] = 0`（raw 106185）—— 即"停"同时**清当前曲 id**。
  //   这一点是读档 BGM 还原链的一半：`SAVE.txt:934 i0b8`（确认读档后）清掉 id，读档再把存档里的
  //   id 装回（raw 19911 = 镜像 `[2]`），最后 `CALLBACK_LOAD.BIN:20 i0b7 0` 用它重播。
  setMusicId(c.e, 0);
  setMusicPaused(c.e, false); // 引擎同一函数第二行：`Music[260] = 0`（raw 106186）⇒ 停播一律回到"非暂停"
  if ((c.e.effectFlags & 0x200) !== 0) {
    c.e.effectFlags &= ~0x200; // 引擎：清 bit0x200
    emit(c, { kind: 'bgm-fade', value: 0, step: 100 }); // 引擎：sub_489E50(Music, 100) 推进淡出（步长恒 100）
  }
  emit(c, { kind: 'bgm-stop' });
};

/** `0x2BF`：延迟播 SE —— op1 = 通道、op2 = 循环标志、op3 = 延迟毫秒（引擎武装 + 每帧 `sub_4B5230`）。 */
const op_se_delay: OpHandlerLike = (c) => {
  const p = planFor(c);
  const ch = (p.int(1) ?? 0);
  const loop = (p.int(2) ?? 0) !== 0;
  const delayMs = (p.int(3) ?? 0);
  if (ch < 0 || ch >= 10) {
    // ★引擎 `sub_4B5170` 的值域门是 `if ( a2 < 10 )`（raw 137725），越界走
    //   `sprintf_s(_this + 8, 0x400u, aSetdelaySound); sub_4034C0(...)`（raw 137736-137737）
    //   ⇒ 「越界 = 不武装」**加**「引擎会报错」。审计 P3 `0x2bf missing-branch`（票 `T-0152`）
    //   说的就是后者那条可观测串在 emulator 侧丢失 ⇒ 这里补日志（不改"不武装"这一半）。
    c.log(
      `0x2BF SetDelaySound：SE 通道越界（op1=${ch}，引擎 raw 137725 的门是 a2 < 10）` +
        `—— 引擎显示「関数：SetDelay エラー：不正なSound番号です」（raw 5197 的串常量 / raw 137736-137737 的调用），不武装`,
    );
    return;
  }
  emit(c, { kind: 'se-delay', ch, loop, delayMs });
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
 * 音乐运行态：**暂停位**（`Music[260]` = `_this[174714]`，见 `engineFieldIds.ts`）。
 * 清 0 的三个点与引擎同一批：`sub_489B50`（停，raw 106186）、`sub_489F80`（起播，raw 106365）、
 * `sub_489C20`（起播，raw 106240）。
 */
function setMusicPaused(e: StepCtx['e'], paused: boolean): void {
  e.engineValues.set(ENGINE_FIELD.musicPaused, paused ? 1 : 0);
}
function musicPaused(e: StepCtx['e']): boolean {
  return (e.engineValues.get(ENGINE_FIELD.musicPaused) ?? 0) !== 0;
}

/**
 * `sound:Music` 的**运行态镜像 = 当前音源槽号**（`Music[258]`）。
 *
 * 引擎的绑定有两处：`sub_489970`（Music 构造，raw 106096）把 `Music[258]` 初始化成 **−1**；
 * boot（raw 23678-23682）与声音重初始化（`sub_40A8A0` raw 14933-14937）各调一次
 * `sub_489B40(Music, …, get(sound:Music))` ⇒ `Music[258] = sound:Music`。
 * 槽号的含义由 `Music[269+slot]` 的对象决定：**−1 = NoMusic**（raw 106112-106114 三个槽都指向同一个
 * NoMusic 单例）、0 = CD（`sub_404150`）、1 = MIDI（`sub_485D40`）、2 = PCM（`sub_48D970`，raw 106115-106132）。
 * ⇒ 本工程把「≥ 0」当作"音源已选/音乐开"，与 `op_bgm_mode` 的 ±3 口径一致。
 *
 * 缺键按**负值**读（⇒ 视为开）：依据 `sub_405460`（raw 11090-11099）与 boot 的
 * `if (get(sound:VolumeN) >= 0)` 判据 —— 引擎把缺键读成负数。
 */
function musicSourceSlot(e: StepCtx['e']): number {
  return e.config ? cfgInt(e.config, CFG.soundMusic, -1) : -1;
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
  // ★操作数走计划层（`tickets/T-0082`）：只读 op1（曲 id；`0` = 重播当前曲）。
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：BGM 起播走操作数计划层，但没有声明计划`);
  const arg = p.int(1) ?? 0;
  const id = arg !== 0 ? arg : musicId(c.e);
  if (id === 0) return; // 引擎：当前曲 id 也是 0 ⇒ sub_489B50（此刻本来就没在播）
  if (arg !== 0) setMusicId(c.e, arg);
  setMusicPaused(c.e, false); // 引擎 sub_489F80 的起播分支：`Music[260] = 0`（raw 106364-106365）
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
  const p = planFor(c);
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
  //   ★`Music[261]` 的**旧值**要先取：`sub_489C20` 的"是否重起"判据用的是旧值（`Music[261] != a3`）。
  const oldLoop = musicLoop(c.e);
  setMusicLoop(c.e, true);
  const arg = (p.int(1) ?? 0);
  if (arg === 0) {
    const cur = musicId(c.e);
    if (cur !== 0) {
      setMusicPaused(c.e, false); // 引擎 sub_489C20 的 LABEL_5：起播前 `Music[260] = 0`（raw 106240）
      emit(c, bgmPlayIntent(c.e, cur, true));
    } else {
      emit(c, { kind: 'bgm-stop' }); // 引擎：sub_489B50（它自己清 Music[260]/[259]）
    }
    return;
  }
  // ★`sub_489C20` 的清暂停只在"真的重起"时发生：判据是 `Music[259] != a2 || Music[261] != a3`（a3 恒 1）
  //   ⇒ 同曲 + 原本就是循环时**不动 `Music[260]`**（已暂停的曲子被重新 play-bgm 同一首仍是暂停的）。
  if (musicId(c.e) !== arg || !oldLoop) setMusicPaused(c.e, false);
  setMusicId(c.e, arg);
  emit(c, bgmPlayIntent(c.e, arg, true));
};

// ---------------------------------------------------------------------------
// 声音开关（`0xBB` / `0xBC` / `0x1BA` 三个 handler 共用的四段体）
// ---------------------------------------------------------------------------

/**
 * **`sub_406DF0(Engine, 类别, a3)` 的门与值域**（raw 12041-12110）—— 四个开关分支的共同收尾。
 *
 * 审计 P2 `0x1ba missing-consumer`（票 `T-0152`）要的是"四段体末尾各调一次 `sub_406DF0`，
 * 而 emulator 一次都不调"。读体后这条**只成立一半**，这里把两半分开写清：
 *
 * ```c
 * v4 = a3 != 0;                                   // ← a3 被**归一成 0/1**（不是原值直写）
 * if ( (_this[174801] & 0x2000) != 0 && _this[94671]
 *      && GetConfig(set:DependMovie) == a2 )      // ← **外层门**
 *   { *(_DWORD *)(_this[94671] + 1120) = v4; sub_4863C0(…, v4 ? _this[94671][1116] : 0); }
 * for ( v6 = _this + 94672; v10 = 1000; v10; ++v6, --v10 )   // ← 1000 格影片播放器表
 *   if ( *v6 && <该播放器的依赖类别> == a2 ) { *(_DWORD *)(*v6 + 1144) = v4; sub_4879E0(…); }
 * ```
 *
 * ① **可建模的那半 = 外层门**：`set:DependMovieSound` 等于本类别、且当前有影片在放
 *    （`effect_flags & 0x2000`，即"movie"位）时，**字幕/音轨跟随开关**。本工程把这一步落成
 *    一条宿主意图 `{kind:'movie-dependent-audio', category, on}`（宿主未接 ⇒ 由闸门 A 留痕）
 *    **加**一行诊断：这是"不假装实现播放器、但也不再一次都不调"的最小落点。
 * ② **未建模的那半 = 1000 格播放器表本体**：影片播放器对象在重写侧根本没有（0x20F play-movie /
 *    `sub_4246B0` 那条线归 `T-0153` 的对象表），所以 `+1144`/`+1120` 两格**没有承载对象**。
 *    ⇒ 这一半**有据登记**（不是缺口遗漏），重开条件 = 影片播放器对象表进 emulator 时一起接。
 *
 * ★**`on` 是"归一成 0/1"而不是 op2 原值**：raw 12052 的 `v4 = a3 != 0` ⇒ 传入 7 与传入 1
 * 对影片音轨的效果相同（`+1144` 只会是 1）。这与 `switchSeEnable` 的 `on ? 1 : 0` 同口径。
 */
function applyDependentMovie(c: StepCtx, category: number, a3: number): void {
  const e = c.e;
  const on = a3 !== 0 ? 1 : 0; // ★raw 12052：v4 = a3 != 0
  const moviePlaying = (e.effectFlags & 0x2000) !== 0;
  const want = e.config ? cfgInt(e.config, CFG.setDependMovie, -1) : -1;
  const gate = moviePlaying && want === category;
  if (gate) emit(c, { kind: 'movie-dependent-audio', category, on });
  c.log(
    `sub_406DF0 收尾（类别 ${category}，值 ${on}）：外层门 set:DependMovieSound=${want} §` +
      `movie=${moviePlaying} ⇒ ${gate ? '满足（已下发 movie-dependent-audio）' : '不满足（无动作）'}；` +
      '1000 格影片播放器表未建模（有据登记，重开条件 = 影片对象表进 emulator）',
  );
}

/**
 * **引擎 `sub_408D90(Engine, a2)`（raw 13545-13571）= SE 总开关**。`0xBB`（a2 = op1）与
 * `0x1BA op1=2`（a2 = op2，**原样**传进来）走同一段体：
 * ```c
 * v3 = Engine[20980];                       // SE 运行态（boot raw 23691 = get(sound:SE) != 0）
 * if ((a2 != 0) == v3) return 0;            // ★与现状相同 ⇒ 直接返回：不写配置、不发意图
 * if (v3) { 释放 SE 通道对象 0..9；Engine[20980] = 0; setConfig(sound:SE, 0); }
 * else    {                        Engine[20980] = 1; setConfig(sound:SE, 1); }
 * sub_406DF0(Engine, 2, a2);                // 影片播放器里依赖 SE 的那些跟着开关（未建模，见下）
 * ```
 * ⇒ `Engine[20980]` 与配置 `sound:SE` 是同一判据的两个副本（raw 23689-23691 / 14940-14942），
 * 本工程只留配置这一份，故以 `cfgInt(sound:SE) != 0` 当"现状"。
 *
 * ★**关方向硬编码写 0、开方向硬编码写 1**（审计 P3 `0xbb approximation`，票 `T-0152` 复核）：
 * 体里是 `SetConfig("sound:SE", 0/1)`（raw 13551-13568），`a2` 只原样转交影片层 ⇒
 * **不存在**"非 0 原样 ±3"这条路径（±3 是音乐开关 `sub_408CF0` 的 `sound:Music`，raw 13525-13540）。
 * ⇒ 本函数的 `on ? 1 : 0` 与引擎一致（手工把 INI 置成 `sound:SE=2` 时，引擎写回 1、本工程也写 1）。
 *
 * ★关闭时引擎逐个 `sub_4B60C0(SE, i)`（i = 0..9）**释放音效通道对象**；宿主等价物是
 * `{kind:'enable', target:'se', on:false}` —— `AudioEngine.setEnabled` 会把 10 条 SE 通道全停掉。
 * ★`sub_406DF0`（raw 12041-12110）遍历最多 1000 个影片播放器、把"依赖该类声音"的那些音轨一起开关 ——
 * 影片层在重写侧未建模 ⇒ 不假装实现（缺口见 `analysis/opcode-gaps.json` 的 0x1BA 条目）。
 */
function switchSeEnable(c: StepCtx, a2: number): void {
  const on = a2 !== 0;
  const cur = c.e.config ? cfgInt(c.e.config, CFG.soundSE, -1) !== 0 : true;
  if (on === cur) return; // 引擎：(a2 != 0) == v3 ⇒ return 0
  setConfigValue(c.e, CFG.soundSE, on ? 1 : 0);
  emit(c, { kind: 'enable', target: 'se', on });
  applyDependentMovie(c, 2, a2);
}

/**
 * **引擎 `sub_408E20(Engine, a2)`（raw 13573-13599）= 语音总开关**（只有 `0x1BA op1=3` 会走到）：
 * 与 `sub_408D90` 同构，运行态字段换成 `Engine[21293]`（boot raw 23693-23695 = `get(sound:Voice) != 0`，
 * 与上文 `0xBB` 那条注释里 `0xC4` 的 `if (Engine[21293]) Engine[122501] = 1` 是同一个字段）。
 * 关闭时释放 3 个语音通道对象（`sub_4B60C0(voice, i + 12)`，i = 0..2 ⇒ 设备通道 12/13/14）；
 * 宿主等价物 = `{kind:'enable', target:'voice', on:false}`（`setEnabled` 会停掉 3 条语音通道）。
 */
function switchVoiceEnable(c: StepCtx, a2: number): void {
  const on = a2 !== 0;
  const cur = c.e.config ? cfgInt(c.e.config, CFG.soundVoice, -1) !== 0 : true;
  if (on === cur) return;
  setConfigValue(c.e, CFG.soundVoice, on ? 1 : 0);
  // ★引擎 `sub_408E20` 体里写 `*(_DWORD *)(_this + 85172) = 1/0`（= `Engine[21293]`）。
  //   `0xC4`/`0x1BD` 末尾读它（`if (Engine[21293]) Engine[122501] = 1`）⇒ 必须落盘（审计 P1 `0xc4` 的一半）。
  c.e.engineValues.set(ENGINE_FIELD.voiceEnabledField, on ? 1 : 0);
  emit(c, { kind: 'enable', target: 'voice', on });
  applyDependentMovie(c, 3, a2);
}

/**
 * **引擎 `sub_408EB0(Engine, a2)`（raw 13601-13609）= 影片声音开关**（只有 `0x1BA op1=4` 会走到）：
 * `if (a2 == get(sound:Movie)) return 0;` → `setConfig(sound:Movie, a2)` → `sub_406DF0(Engine, 4, a2)`。
 *
 * ★这里写 `sound:Movie` 是**有消费者**的：配置整份会被回写进 `SYS4REG.INI`（`run.ts` 的 `saveConfig`
 * + `formatIni`），下次启动再被读（`configRegistry` 的 `sound:Movie`）。而
 * `sub_406DF0` 的**影片播放器音轨下发**在重写侧没有对应物（影片层未建模）⇒ 只记账、不假装。
 */
function switchMovieEnable(c: StepCtx, a2: number): void {
  const cur = c.e.config ? cfgInt(c.e.config, CFG.soundMovie, -1) : -1;
  if (a2 === cur) return;
  setConfigValue(c.e, CFG.soundMovie, a2);
  applyDependentMovie(c, 4, a2);
}

/**
 * **引擎 `sub_408CF0(Engine, a2)`（raw 13514-13543）= 音乐开关**。`0xBC`（a2 = op1 − 1）与
 * `0x1BA op1=1`（a2 = op2，原样）走同一段体：
 * ```c
 * v6 = Music[259];                                  // 记住当前曲
 * v3 = get(sound:Music);                            // 音源槽/音量：< 0 = 关
 * if (a2) { if (v3 < 0) v4 = v3 + 3; }              // 开：−1 → 2（PCM，默认音源）
 * else    { if (v3 >= 0) v4 = v3 - 3; }             // 关：≥ 0 → −3
 * if (无需改动) return 1;                           // ★整条早退（raw 13523-13541：a2≠0 且 v3≥0、
 *                                                   //   或 a2==0 且 v3<0 时**什么都不做**）
 * set(sound:Music, v4); Music[258] = v4;            // 两个副本都写
 * sub_489B50(Music);                                // 停（清 Music[259]/[260]）
 * Music[259] = v6;                                  // 装回
 * sub_489F80(Music, 0, Music[261]);                 // 用当前循环位重播
 * sub_406DF0(Engine, 1, a2);
 * ```
 * ★`a2` 的语义是「**0 = 关 / 非 0 = 开**」，不是档位：`±3` 只把配置在正负之间搬。
 * ⇒ 下发给宿主的 `bgm-mode.mode` 归一成 0/1（`audioBootIntents` 用的也是这个口径）。
 *
 * ★P1 修复（审计 `docs-new/99-records/2026-09-impl-audit/` §4.1 的 `0xbc`，票 `T-0152`）：
 * 修前**没有这条早退** —— 在 `sound:Music >= 0`（已开）时点「开音乐」，引擎什么都不做，
 * emulator 却照发 `bgm-mode` + `bgm-stop`（宿主还真停一次 BGM）。语料里"开关"是设置界面同一行的
 * 反复下发，症状 = 点已开的开关会把 BGM 掐断一下。
 */
function switchMusicEnable(c: StepCtx, a2: number): void {
  const cur = c.e.config ? cfgInt(c.e.config, CFG.soundMusic, 0) : 0;
  // 与引擎同构的"要不要改"判据：开 = 只有负值才要改；关 = 只有非负值才要改。
  const next = a2 !== 0 ? (cur < 0 ? cur + 3 : null) : cur >= 0 ? cur - 3 : null;
  if (next === null) return; // ★引擎 raw 13536/13541 的落空路径：整条早退
  setConfigValue(c.e, CFG.soundMusic, next);
  emit(c, { kind: 'bgm-mode', mode: a2 !== 0 ? 1 : 0 });
  const id = musicId(c.e);
  const loop = musicLoop(c.e);
  emit(c, { kind: 'bgm-stop' });
  setMusicPaused(c.e, false); // 引擎 sub_489B50 清 Music[260]（raw 106186）
  if (id !== 0) emit(c, bgmPlayIntent(c.e, id, loop)); // 引擎 sub_489F80 起播分支再清一次（raw 106365）
  applyDependentMovie(c, 1, a2);
}

/** `0xBB`：SE 总开关（`sub_420D90` raw 29782-29789：`sub_408D90(this, op1)`）。 */
const op_se_enable: OpHandlerLike = (c) => {
  const p = planFor(c);
  switchSeEnable(c, (p.int(1) ?? 0));
};

/**
 * `0xBC`：BGM 开关/模式（引擎 `sub_420DC0` → `sub_408CF0(op1-1)`）。
 *
 * ★操作数口径按 raw 收（`sub_420DC0` raw 29797-29800：`result = op1; if (result <= 2) sub_408CF0(result-1)`）：
 * op1 ≤ 2 才动作，`a2 = op1 - 1`（a2 = 0 = 关；a2 ≠ 0（含 −1）= 开）。opcode-table 旧写的"1..3"与 raw
 * 不一致（多算了 3、漏了 0），语料 0 处 ⇒ 按 raw 实现。
 *
 * ★引擎在开关切换时**停一次再重播当前曲**（见 `switchMusicEnable` 的引文）；关模式时宿主
 * `#enabled.bgm = false`（`bgm-play` 只记 id 不起播）⇒ 语义仍正确。
 */
const op_bgm_mode: OpHandlerLike = (c) => {
  const p = planFor(c);
  const raw = (p.int(1) ?? 0);
  if (raw > 2) return; // 引擎：`result <= 2` 才动作
  switchMusicEnable(c, raw - 1);
};

/**
 * **`0x1BA` SetSoundMode**（`sub_421200` raw 29985-30019，语料 11 处 / 2 文件）：op1 = 类别、op2 = 开关值。
 *
 * ```c
 * frames[cur].state = 5;
 * if      (op1 == 1) sub_408CF0(this, op2);   // 音乐
 * else if (op1 == 2) sub_408D90(this, op2);   // SE
 * else if (op1 == 3) sub_408E20(this, op2);   // 语音
 * else if (op1 == 4) sub_408EB0(this, op2);   // 影片
 * else { sprintf(buf, "SetSoundModeの引数が不正です．\r\n"); ShowMessage(buf); }   // raw 30016-30017
 * ```
 * ★与 `0xBB`/`0xBC` 的关系：那两条是**单类专用的窄指令**（`0xBB` = SE、`0xBC` = 音乐），本指令是**通用入口**，
 * 四条分支逐字复用上面三个 helper（`0xBC` 传 `op1 − 1`、本指令音乐分支传 `op2` 原值 —— 这正是两者的差异）。
 * ★语料只用到 op1 = 1/2/3（`CONFIG1.txt:1996-1998/2021-2023/2035/2061` 六处与
 * `INITREGSOUND.txt:10-12` 三处开关音乐/SE/语音；`CONFIG1.txt:2035/2061` 的 op1 是变量 `(local-int 57c3)`
 * ⇒ 就是设置界面那一行的类别），op1 = 4 与非法值在语料里 **0 处**。
 * ★`frames[cur].state = 5` 与全族其它 handler 一样是引擎的"本帧执行态"，本工程整体不建模（见 `0xB4` 一族）。
 */
const op_set_sound_mode: OpHandlerLike = (c) => {
  const p = planFor(c);
  const kind = (p.int(1) ?? 0);
  // ★raw 里 op2 是**在每个分支内**各读一次（29996/30001/30006/30011），非法类别分支不读它；
  //   这里统一在入口读一次：读操作数是纯取值（`readIntOperand_41BF50` 无副作用），对 VM 不可观测，
  //   但统一读能让 `test/opcode-operands.test.ts` 的「1..argc 全被碰」口径守卫覆盖本指令。
  const value = (p.int(2) ?? 0);
  switch (kind) {
    case 1:
      switchMusicEnable(c, value);
      break;
    case 2:
      switchSeEnable(c, value);
      break;
    case 3:
      switchVoiceEnable(c, value);
      break;
    case 4:
      switchMovieEnable(c, value);
      break;
    default:
      c.log(`0x1BA SetSoundMode：类别非法（op1=${kind}）—— 引擎显示「SetSoundModeの引数が不正です．」（raw 30016-30017），不写任何开关`);
  }
};

/**
 * **`0xC1`（`sub_419770` raw 24831-24842，0 操作数）= BGM 暂停/继续 翻转**（语料 1 处：`MMODE.txt:440`）。
 *
 * ```c
 * frames[cur].state = 1;
 * v1 = Music;                                  // _this + 174454（字节 697816）
 * v2 = v1[258];                                // 当前音源槽 = sound:Music（见 musicSourceSlot）
 * v1[260] = (v1[260] == 0);                    // ★翻转暂停位
 * (*(v1[v2 + 269] vtable + 12))(v1[v2 + 269], v1[260]);   // ★后端 SetPause(新值)
 * ```
 * 后端对象 = `Music[269 + slot]`（构造见 `sub_489970` raw 106112-106132）：**−1 = NoMusic**
 * （三个负槽都指向同一个 NoMusic 单例，其槽 3 = `sub_4350E0` 空桩）、0 = CD、1 = MIDI、2 = PCM。
 * 抽象槽 3（vtable+12）在 `MusicBase::vftable`（0x528B7C）里是纯虚函数，三个实现分别是：
 * `CD::Pause`（`sub_404580` raw 10241-10257，MCI 0x809 = PAUSE / 0x855 = RESUME）、
 * `MIDI::Pause`（`sub_485DB0` raw 10309-10314，`mciSendString("pause midi")`，
 * ★**恒发 pause、参数被忽略 ⇒ 该后端永远不恢复**，是引擎自身的不对称）、
 * `PCM::SetPause`（`sub_48DA60` raw 108613-108624 → `sub_4B60C0`/`sub_4B6190`）。
 *
 * ★宿主等价物只有一件事：**暂停/继续当前 BGM** ⇒ `{kind:'bgm-pause', paused}`。音源槽（CD/MIDI/PCM）
 * 在重写侧本来就收敛成 Web Audio 一条 BGM 通路（配置 `sound:Music` 仍照引擎写：`switchMusicEnable` 的 ±3），
 * 所以这里不做"按槽分派"的假动作，只按槽号判"是否有后端"（`slot < 0` = NoMusic ⇒ 引擎那一步是空桩）。
 */
const op_bgm_pause_toggle: OpHandlerLike = (c) => {
  const p = planFor(c);
  const paused = !musicPaused(c.e);
  setMusicPaused(c.e, paused);
  if (musicSourceSlot(c.e) < 0) return; // NoMusic 槽：vtable+12 = sub_4350E0（空桩）
  emit(c, { kind: 'bgm-pause', paused });
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
 *
 * ★**op2 不是每帧步长，是节流毫秒**（审计 P2 `0xc2 approximation`，票 `T-0152`；体：`sub_420E00`
 * raw 29831-29839）：
 * ```c
 * _this[174801] |= 0x200u;
 * v4 = op2 < 1000 ? op2 / 10 : op2 / 1000;      // ← 节流毫秒（sub_453A60(_this+107503, v4)）
 * sub_453A60(_this + 107503, v4);
 * v9 = op2 < 1000 ? 10 : 1;                     // ← sub_489D10 的第 3 实参 = **进度增量**
 * sub_489D10(_this + 174454, op1, v9);
 * ```
 * `sub_489E50(Music, 100)`（raw 106328）才是"每次 CALL 把 `Music[262]` **+100**" ⇒ 推进次数 =
 * `100 / v9`，两次之间至少隔 `v4` 毫秒。修前把 op2 原值当每帧步长 ⇒ `op2 = 500` 时淡变快 2 倍、
 * `op2 = 1200` 时慢约 1.2 倍（语料 943 处 `i0c2` 里 `< 1000` 的约 121 处）。
 *
 * ★**ADV 激活位分叉**（审计 P3 `0xc2 missing-behavior`，票 `T-0152`；体 raw 29815-29823）：
 * `effect_flags & 0x8000000` 置位时走的是**另一条路** —— 只 `sub_489D10(Music, op1, op2)` +
 * `sub_489E50(Music, 100)`，**既不清也不置 bit0x200、不写节流槽、不动 `Music[259]`** ⇒ 这里
 * 只出 `bgm-fade`，不做"目标 0 清曲 id"与"起播当前曲"那两步。
 */
const op_bgm_fade: OpHandlerLike = (c) => {
  const p = planFor(c);
  const value = (p.int(1) ?? 0);
  const step = (p.int(2) ?? 0);
  if (advActive(c)) {
    // ★ADV 路的 `sub_489D10(Music, op1, op2)` 是**原值**（不折算），随后的 `sub_489E50(Music, 100)`
    //   每帧把 `Music[262]` +100 ⇒ 每次 CALL 的增量 = op2（下限 1）、无节流（引擎那一支不写节流槽）。
    emit(c, { kind: 'bgm-fade', value, step: step > 0 ? step : 1 });
    return;
  }
  const id = musicId(c.e);
  if ((c.e.effectFlags & 0x200) !== 0) {
    // 引擎 raw 29826-29830：bit0x200 已置 ⇒ 调 `sub_418580(Music, TransferMusicVolume)`
    // （1 = 按 `Music[262]` 进度把 `Music[264]` 插值到 `Music[265]`；2 = 直接跳到目标）。
    const transfer = c.e.config ? cfgInt(c.e.config, CFG.setTransferMusicVolume, 0) : 0;
    emit(c, { kind: 'bgm-transfer-volume', mode: transfer });
  }
  c.e.effectFlags |= 0x200; // 引擎 raw 29831：`_this[174801] |= 0x200u`
  if (value <= 0) setMusicId(c.e, 0);
  else if (id !== 0) emit(c, bgmPlayIntent(c.e, id, musicLoop(c.e)));
  emit(c, {
    kind: 'bgm-fade',
    value,
    step: step < 1000 ? 10 : 1,
    throttleMs: step < 1000 ? Math.trunc(step / 10) : Math.trunc(step / 1000),
  });
};

/**
 * `0xC3`（`sub_420F10` raw 29844-29859）：**写运行期音乐字段** —— `_this[174713] = op1`（**不播**）。
 *
 * ★口径订正（审计 P3 `0xc3 stale-ledger`，票 `T-0152`）：体里**只有一条写** `_this[174713] = result`，
 * 而 `_this[174713]` 就是 `Music[259]`（Music 模块内联在 `Engine + 174454`）—— **不是两个动作**。
 * 旧注释把 `Music[259]` 与 `174713` 并列成两条写，会被后人读成"引擎还写了别的格"。
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
  const p = planFor(c);
  if ((c.e.effectFlags & 0x200) !== 0) {
    c.e.effectFlags &= ~0x200;
    emit(c, { kind: 'bgm-fade', value: 0, step: 100 });
  }
  setMusicId(c.e, (p.int(1) ?? 0));
};

/**
 * **语音通道状态槽的二态翻转协议**（引擎 `0xC4`/`0x1BD` 共用体 `sub_420F70` raw 29872-29889）：
 * ```c
 * v = _this[21315];                     // 通道状态位（0x2F7 写 1）
 * if (v & 0x10000) _this[21315] = 0;    // 已"消费"⇒ 整个清 0
 * else if (v & 1)  _this[21315] = v | 0x10000;  // 已武装 ⇒ 置"消费"位
 * （对 [21318] 即音量因子槽做同一件事）
 * ```
 * ★这是本次审计 P1（`0xc4`，票 `T-0152`）：宿主侧 `voice-flag`/`voice-factor` 此前**只增不减**，
 * 于是这个"用一次就烧掉"的协议在重写侧完全不存在。
 */
function toggleVoiceSlot(e: Engine, field: number): void {
  const v = e.engineValues.get(field) ?? 0;
  if ((v & 0x10000) !== 0) e.engineValues.set(field, 0);
  else if ((v & 1) !== 0) e.engineValues.set(field, v | 0x10000);
}

/** `0xC4`（循环位 0）/ `0x1BD`（循环位 1）：播语音到通道 0（ADV 位在时寄存）。 */
const op_play_voice: OpHandlerLike = (c) => {
  const loop = c.instr.opcode === 0x1bd;
  // ★操作数走计划层（`tickets/T-0082`）：只读 op1（语音 id）。
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：播语音走操作数计划层，但没有声明计划`);
  const id = p.int(1) ?? 0;
  // ★体开头（raw 29872-29889）：两个槽各做一次二态翻转（通道 0，固定下标 21315/21318）。
  toggleVoiceSlot(c.e, ENGINE_FIELD.voiceChannelStateBase);
  toggleVoiceSlot(c.e, ENGINE_FIELD.voiceChannelFactorBase);
  voicePlayOrDefer(c, 0, id, loop);
  // 引擎在同一 handler 末尾（raw 29904-29908 / 30058-30062）往**文本项记录表**压一条语音记录：
  //   `if (!Engine[97055]) sub_45EEA0(Font, 0, op1, 循环位, 0, Engine[5053])`
  // 它是 `0x1D4`/`0x2F3`（`REPLAYVOICE` 的"重播这条语音"）的数据源 ⇒ 必须一起做。
  pushVoiceRecord(c.e, id, loop ? 1 : 0, 0);
  // ★收尾（raw 29910-29911）：`sound:Voice` 开着的话，把「本帧有语音」记进单格寄存槽。
  if ((c.e.engineValues.get(ENGINE_FIELD.voiceEnabledField) ?? 0) !== 0) {
    c.e.engineValues.set(ENGINE_FIELD.voiceRegSingle, 1);
  }
};

/**
 * `0x2F4`：播语音（op1 = id、op2 = 附带/循环位、op3 = 语音通道，0..2）+ 登记文本项记录。
 *
 * 引擎 `sub_426260`（raw 33616-33656）逐段：
 * ```c
 * _this[frame*30 + 95805] = 7;
 * v2 = op1; v8 = op2; v3 = op3;
 * <v3 的状态位 21315 与因子位 21318 各做一次二态翻转>     // ← 与 0xC4/0x1BD 同一协议
 * sub_407120((int)_this);                                  // ← 帧内收尾（本工程无对应物，见下）
 * if ((_this[174801] & 0x8000000) != 0) {                  // ← ADV 激活位
 *   _this[v3 + 122505] = v2;  _this[v3 + 122508] = v8;      //   寄存
 * } else {
 *   _this[v3 + 122505] = 0;   _this[v3 + 122508] = 0;       //   清寄存槽
 *   sub_4BB840(Engine + 21032, v3, v2, v8, _this[v3 + 5053]);  // 立即起播（第 4 实参 = op2 原值）
 * }
 * if (!_this[97055]) sub_45EEA0(Font, 0, v2, 0, v3, _this[v3 + 5053]);
 * ```
 *
 * ★本轮补的三处（审计 P3 `0x2f4 missing-behavior` + `approximation`，票 `T-0152`）：
 *  1. **两个槽的二态翻转**（用通道号 op3 而不是固定 0）—— 修前 `engineValues` 这几格完全不动；
 *  2. **ADV 寄存分支**：位在时写 `[122505+ch] = id` / `[122508+ch] = op2`，位不在时**清 0**
 *     （修前只发宿主意图，字段面永远看不到这条指令的效果）；
 *  3. **循环位 = `op2 & 1`**（不是 `op2 != 0`）：`sub_4BB840` 只取低 1 位 ⇒ op2 = 2 是"不循环"、
 *     op2 = -1 是"循环"，而 `!= 0` 会把 2 判成循环。
 *
 * ★`sub_407120`（raw 33638）未建模：它是引擎的**帧内文本收尾**（与 `0x1F5`/队列派发同族），
 * 重写侧由帧循环统一收尾 ⇒ 不在这里复制（登记在 `changes-audio.md`）。
 */
const op_voice_play_slot: OpHandlerLike = (c) => {
  const p = planFor(c);
  const id = (p.int(1) ?? 0);
  const raw2 = (p.int(2) ?? 0);
  const loop = (raw2 & 1) !== 0; // ★raw 142663：sub_4BB840 的第 4 实参 = `(unsigned)v3[12] & 1`
  const ch = (p.int(3) ?? 0);
  // ★两个槽各做一次二态翻转（raw 33620-33637；与 0xC4/0x1BD 的 sub_420F70 逐句同形）。
  toggleVoiceSlot(c.e, ENGINE_FIELD.voiceChannelStateBase + ch);
  toggleVoiceSlot(c.e, ENGINE_FIELD.voiceChannelFactorBase + ch);
  // ★ADV 寄存 / 清寄存（raw 33639-33648）。
  if (advActive(c)) {
    c.e.engineValues.set(ENGINE_FIELD.voiceRegBase + ch, id);
    c.e.engineValues.set(ENGINE_FIELD.voiceRegFlagBase + ch, raw2);
  } else {
    c.e.engineValues.set(ENGINE_FIELD.voiceRegBase + ch, 0);
    c.e.engineValues.set(ENGINE_FIELD.voiceRegFlagBase + ch, 0);
  }
  voicePlayOrDefer(c, ch, id, loop);
  // 引擎 raw 33650-33654：`if (!Engine[97055]) sub_45EEA0(Font, 0, op1, 0, op3, Engine[op3+5053])`
  // ⇒ 选择器 = **通道号**（`0x2F3` 就是按它查回语音 id 的）。
  pushVoiceRecord(c.e, id, 0, ch);
};

/** `0x2C0`（通道 0）/ `0x2F5`（op4 = 通道）：把语音排入通道（带延迟；引擎 `sub_4BBA40`）。 */
const op_voice_queue: OpHandlerLike = (c) => {
  // ★操作数走计划层（`tickets/T-0082`）：0x2C0 读 op1..3（argc 3）、0x2F5 多读 op4（argc 4）。
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：语音排队走操作数计划层，但没有声明计划`);
  const ch = c.instr.opcode === 0x2f5 ? (p.int(4) ?? 0) : 0;
  emit(c, {
    kind: 'voice-queue',
    ch,
    id: p.int(1) ?? 0,
    aux: p.int(2) ?? 0,
    delayMs: p.int(3) ?? 0,
  });
};

/**
 * `0x2F6`：复位语音通道（停播 + 清状态 + 丢弃寄存）。
 *
 * 引擎 `sub_426820`（raw 33677-33692）：`sub_4BB9F0(Voice, op1)` 释放设备通道并清
 * `Voice[op1+280/262/265/277]`，随后**清四个 Engine 槽**：`[21315+op1]`（状态位）、`[21318+op1]`（因子位）、
 * `[122505+op1]`/`[122508+op1]`（寄存语音），最后**两条收尾**：
 * ```c
 * result = sub_404CB0(_this + 21032);   // = "3 路语音里是否还有正忙的"
 * _this[122501] = (int *)result;        // ★刷那一格（raw 33691-33692）
 * return result;
 * ```
 *
 * ★**`122501` 不是缺口**（审计 P2 `0x2f6 missing-operand-io` 的收尾条，票 `T-0152` 订正原 finding）：
 * 该格**已有模型** —— 它是 `0x1BC` 清 0 的三格之一、也是 `0xC4`/`0x1BD` 在
 * `if (Engine[21293]) Engine[122501] = 1`（raw 29910-29911）里写的同一个槽
 * （`ENGINE_FIELD.voiceRegSingle = 122501`）。这里按 `sub_404CB0` 的口径刷：
 * **复位完之后三路语音里还有没有武装/在播的** —— 用引擎自己的那两组字段判
 * （`[21315..21317]` 状态位、`[122505..122507]` 寄存 id），不新增宿主回读口
 * （`NativeBridge` 是别的 owner 的面）。
 *
 * ★**通道号不校验**（审计 P3 `0x2f6 overreach`）：引擎对 `ch` 是**无门直接下标**
 * （`_this[v2 + 21315]`），3..14 时会写坏相邻字段；本工程只建模 0..2，但**字段照写**
 * （与引擎"照写"一致，只是不越界写坏）—— 见 `test/t0152-audio-p2.test.ts` 的 ch=3 用例。
 */
const op_voice_reset: OpHandlerLike = (c) => {
  const p = planFor(c);
  const ch = p.int(1) ?? 0;
  emit(c, { kind: 'voice-reset', ch });
  // ★四个 Engine 槽的清零（raw 33685-33690）。★这些写**不受 ch 值域限制**（引擎同形）。
  for (const base of [
    ENGINE_FIELD.voiceChannelStateBase,
    ENGINE_FIELD.voiceChannelFactorBase,
    ENGINE_FIELD.voiceRegBase,
    ENGINE_FIELD.voiceRegFlagBase,
  ]) {
    c.e.engineValues.set(base + ch, 0);
  }
  // ★收尾：`Engine[122501] = "3 路里是否还有正忙的"`（raw 33691-33692）。
  const busy = [0, 1, 2].some(
    (i) =>
      (c.e.engineValues.get(ENGINE_FIELD.voiceChannelStateBase + i) ?? 0) !== 0 ||
      (c.e.engineValues.get(ENGINE_FIELD.voiceRegBase + i) ?? 0) !== 0,
  );
  c.e.engineValues.set(ENGINE_FIELD.voiceRegSingle, busy ? 1 : 0);
};

/**
 * `0x2F7`：置语音通道状态位（引擎 `Engine[21315+ch] = 1`，raw 33694-33703）。
 *
 * ★该槽是 `0xC4`/`0x1BD` 翻转协议的输入（见 `toggleVoiceSlot`），必须真的落盘 —— 修前只发宿主意图。
 */
const op_voice_flag: OpHandlerLike = (c) => {
  const p = planFor(c);
  const ch = p.int(1) ?? 0;
  c.e.engineValues.set(ENGINE_FIELD.voiceChannelStateBase + ch, 1);
  emit(c, { kind: 'voice-flag', ch });
};

/**
 * `0x2F8`：设语音通道 **pan**（±10000，0 = 中央）。
 *
 * 引擎 `sub_4268D0`（raw 33606 起）：把 op2 交给 `sub_4B6940(设备, ch, pan)` 时，
 * 写的是**设备通道格** `_this[a2 + 375]`（byte 1548 + 4·ch；`sub_4B6940` 内部同一格，
 * 见 raw 139063-139089 的 `a2 >= 15` 值域门）—— 审计 P3 `0x2f8 missing-operand-io`（票 `T-0152`）。
 * 本工程把那一格的等价物落进 `engineValues` 的 `voicePanBase + ch`
 * （前者 = 引擎字段面可复核，后者 = 宿主通道对象上的 `v.pan` 负责发声）。
 *
 * ★钳制是**对称 ±10000**（`sub_4B6940` 的两半），与 `audioEngine.clampPan` 同口径。
 */
const op_voice_pan: OpHandlerLike = (c) => {
  const p = planFor(c);
  const ch = (p.int(1) ?? 0);
  const pan = (p.int(2) ?? 0);
  c.e.engineValues.set(
    ENGINE_FIELD.voicePanBase + ch,
    pan < -10000 ? -10000 : pan > 10000 ? 10000 : Math.round(pan),
  );
  emit(c, { kind: 'voice-pan', ch, pan });
};

/**
 * `0x2FF`：语音通道音量因子**预备**（引擎 `sub_426940` raw 33728-33740）：
 * `Engine[21318+ch] = 1`（低位置 1）、`Engine[21321+ch] = op2`（因子值，`0x2710` = 100%）。
 *
 * ★**`Engine[21321+ch]` 是原值直写、不钳位**（审计 P3 `0x2ff approximation`，票 `T-0152`）。
 * 依据：同一格在 `0x302` 里被写成 `0x10000`（65536，raw 33768-33769）——**远超 10000**
 * ⇒ 那一格**不是 0..10000 域**；钳位会把"预备了多大因子"这条信息改掉，而 `0x302` 之后的
 * `sub_4BBC30` 正是拿它决定设备因子（`设备[402+ch] = (Voice[286+ch] & 0x10000) ? Voice[289+ch] : -1`）。
 * ⇒ 字段面写**原值**；钳位只留在宿主"把因子换算成增益"那一步（`audioEngine.#voiceGain`）。
 */
const op_voice_factor_prepare: OpHandlerLike = (c) => {
  const p = planFor(c);
  const ch = p.int(1) ?? 0;
  const value = p.int(2) ?? 0;
  c.e.engineValues.set(ENGINE_FIELD.voiceChannelFactorBase + ch, 1);
  // ★原值（不 clampVolume）：见上面的 P3 依据 —— 同格可被写成 0x10000。
  c.e.engineValues.set(ENGINE_FIELD.voiceChannelFactorValueBase + ch, value);
  emit(c, { kind: 'voice-factor-prepare', ch, value });
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
 *    ★区间是**六格**（21315..21320）：状态位 21315..21317 + 因子位 21318..21320；
 * 3. 清零 `Engine[122501]`（byte 490004）与 `Engine[122505..122510]`（byte 490020-490040）
 *    = **寄存语音槽**（`0xC4` 的 ADV 分支写 `[122505]=id`/`[122508]=标志`）。
 */
const op_clear_message_sound_fields: OpHandlerLike = (c) => {
  const p = planFor(c);
  const e = c.e;
  // ★**不发 `voice-reset`**（审计 P3 `0x1bc missing-branch`，票 `T-0152`，读体订正）：
  //   引擎那段释放 `for (i = 0; i < 3; ++i) sub_4B60C0(*(int**)(_this + 85160), i + 12);` 被
  //   `if (*(_DWORD *)(_this + 85160))` 门住，而 **`_this + 85160` 在整个反编译里没有任何写者**
  //   （逐字搜 `85160`：只有 raw 13584/13587 与 24851/24854 两处**读**；`Engine[21293]`/`+85172`
  //   才是被写的那格）⇒ 该指针恒为 0、门恒不成立 ⇒ **引擎在这条指令上一个通道都不释放**。
  //   ⇒ emulator 此前"无条件对 3 个通道发 voice-reset（宿主会停掉正在播的语音）"是**多发**的
  //   一次停播，不是漏发；这里改成只做字段清零（引擎真正做的那半）。
  //   重开条件 = 哪天在引擎里找到 `+85160` 的写者（或真机 dump 显示语音会被这条停掉）。
  for (let ch = 0; ch < 3; ch++) {
    e.engineValues.set(ENGINE_FIELD.voiceChannelStateBase + ch, 0);
    e.engineValues.set(ENGINE_FIELD.voiceRegBase + ch, 0);
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
  const p = planFor(c);
  const e = c.e;
  // ★按引擎顺序读 op1（= **驱动 id**）。重写侧没有驱动层 ⇒ 不装载、只**报出来** ——
  //   这不是"读了再丢"：引擎确实读它，日志就是这条指令在本工程的观测面（见 `tickets/T-0082` 的批次说明）。
  const driverId = p.int(1) ?? 0;
  // ★op1 是**装载键**（引擎 `sub_4B8490(Engine+7912, id, 数据, 大小)`，raw 29301-29305）——
  //   重写侧没有驱动层，但字段面要留下它（审计 P3 `0x1c9 missing-consumer`，票 `T-0152`）。
  e.engineValues.set(ENGINE_FIELD.audioDeviceDriverId, driverId);
  e.engineValues.set(ENGINE_FIELD.audioDeviceField0, (p.int(2) ?? 0));
  e.engineValues.set(ENGINE_FIELD.audioDeviceField1, (p.int(3) ?? 0));
  c.log(
    `0x1C9: 音频设备/驱动初始化 —— 驱动 id=${driverId}；设备文件装载与窗口坐标下发未建模（重写侧无驱动层，缺口已登记）`,
  );
};

/**
 * `0x302`：语音通道音量因子**生效**并应用。
 *
 * 引擎 `sub_426A30`（raw 33767-33777）：`Engine[21318+ch] = 0x10000`（"有因子值"位）、
 * `Engine[21321+ch] = op2`，随后 `sub_4BBC30(Voice, ch, sound:Volume3)` 下发到设备通道
 * （`设备[402+ch] = (Voice[286+ch] & 0x10000) ? Voice[289+ch] : -1`）。
 */
const op_voice_factor_apply: OpHandlerLike = (c) => {
  const p = planFor(c);
  const ch = p.int(1) ?? 0;
  const value = p.int(2) ?? 0;
  // ★两个 Engine 槽（raw 33768-33769）：0x10000 = "因子已生效"，值**原值**进 21321
  //   （与 0x2FF 同口径：该格不是 0..10000 域，见 op_voice_factor_prepare 的 P3 依据）。
  // ★引擎**不**"应用即清预备"（审计 P3 `0x302 host-invented`，票 `T-0152`）：体只**写**
  //   `[21321+ch]` 再调 `sub_4BBC30`，没有把 `[21321+ch]` 清 0/置空的动作；宿主侧对应的
  //   `preparedFactor`（= 预备但未生效的因子）因此也不清 —— 见 `voiceFactorApply`。
  c.e.engineValues.set(ENGINE_FIELD.voiceChannelFactorBase + ch, 0x10000);
  c.e.engineValues.set(ENGINE_FIELD.voiceChannelFactorValueBase + ch, value);
  emit(c, { kind: 'voice-factor-apply', ch, value });
};

/**
 * `0xC6`：设音量 —— op1 = 类别（0 = 主 / 1 = BGM / 2 = SE / 3 = 语音 / 4 = 影片）、op2 = 值。
 * 引擎同时把值写进配置 `sound:Volume0..4`（所以设置界面的滑块改完能持久化），越界走报错分支不写。
 */
const op_set_volume: OpHandlerLike = (c) => {
  const p = planFor(c);
  const category = (p.int(1) ?? 0);
  const value = (p.int(2) ?? 0);
  if (category < 0 || category > 4) {
    // 引擎 `sub_42E5C0` raw 29978-29981：`sprintf_s(_this + 8, 0x400u, aSetvolume); sub_4034D0(...)`
    // ⇒ **实际串常量**是 `SetVolumeの引数が不正です．\r\n`（raw 4413），不是 "setVolume"。
    c.log(`0xC6 SetVolume：类别越界（op1=${category}）—— 引擎显示「SetVolumeの引数が不正です．」（raw 4413/29978-29981），不写任何 sound:Volume 键`);
    return;
  }
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
  [0xc1, op_bgm_pause_toggle], // BGM 暂停/继续翻转（翻转 Music[260] → 后端 SetPause）；语料 1 处
  [0x1ba, op_set_sound_mode], // SetSoundMode：op1 类别(1音/2SE/3语音/4影片) + op2 开关；语料 11 处
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
