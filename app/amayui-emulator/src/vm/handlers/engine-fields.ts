/**
 * 「引擎字段」族：脚本可读写的 `_this[K]` 稀疏状态 + 配置注册表 getter。
 *
 * 两类：
 *  - **真实现**（注册进 OPS）：读操作数 → 写 `Engine.engineValues`（规格见 `ENGINE_FIELD_STORE`），
 *    以及配套 getter（0x247/0xC0/0x2CE/0x131/0x306…）。语义与引擎一致，只是这些字段在 emulator 里
 *    不驱动任何渲染/声音输出。
 *  - **native 路由**（注册进 NATIVE_OPS）：值来自子系统（配置注册表 / 显示模式 / 音乐字段）。
 *
 * 注意：`engineValues` 用**负键**表示「非 `_this` 字段」的专用全局槽（如 0x248 的 `-248`），
 * 与引擎 DWORD 下标空间隔离。
 */
import type { OpHandler } from '../step.js';
import { setConfigValue } from './msgwin.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import { cfgInt } from '../../engineConfig.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { CFG } from '../../configRegistry.js';
import type { OpTable } from './shared.js';

const op_write_global_slot: OpHandler = (c) => {
  c.e.globalSlot97058 = readIntOperand(c.e, c.frame, c.instr, 1);
};

/** 0x148 (sub_42FEC0)：`op1 = _this[97058]`（读）。 */
const op_read_global_slot: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.globalSlot97058);
};

// ---- 控制流 ----

/**
 * **引擎字段 getter 表**（opcode → 要读回的 `_this[K]`）。
 *
 * ★T-0057 R4：旧实现把 0x106/0x201 挂在 `NATIVE_OPS`（对外是"已实现"）里却 `v = 0` 伪造返回值 ——
 * 那正是 ADR-005 点名的"静默旧值/静默 0"型缺陷（脚本拿到的是假答案，且没有任何痕迹）。
 * 现在没有依据的 getter **不进表**：查不到就抛 `NotImplementedOp`，不猜。
 */
const ENGINE_FIELD_GET: Map<number, number> = new Map<number, number>([
  [0x106, ENGINE_FIELD.engineField550], // raw 39043：`sub_42B4B0(_this, 1, _this[550])`
  [0x130, ENGINE_FIELD.logoEnabled], // load-show-logo：`_this[96983]`
  [0x201, ENGINE_FIELD.drawMode], // raw 39862：`sub_42B4B0(_this, 1, _this[166964])`（DrawMode）
]);

/** 0x106/0x130/0x131/0x201 等：引擎字段/配置 getter（读 `_this[字段]` 写 op1）。 */
const op_get_engine_value: OpHandler = (c) => {
  let v: number;
  if (c.instr.opcode === 0x131) {
    // 0x131（sub_42F7D0，raw 39350-39356）：**直接读配置注册表** `message:MesWinAlpha` 写 op1
    //   （`v2 = GetConfig(_this[174405], "message:MesWinAlpha")`）。
    //   ★它**不读任何 Engine 字段** —— 不要回退到 `engineValues`，那里没有这个键的值
    //   （历史上曾把 21668 当成"消息窗 α"，而 21668×4 = 86672 = Font+1376 = message:MessageSpeed）。
    v = c.e.config ? cfgInt(c.e.config, CFG.messageMesWinAlpha, 0) : 0;
  } else {
    const field = ENGINE_FIELD_GET.get(c.instr.opcode);
    if (field === undefined) {
      throw new Error(`0x${c.instr.opcode.toString(16)}: 引擎字段 getter 未定位（不写伪造值；见 T-0057 R4）`);
    }
    v = c.e.engineValues.get(field) ?? 0;
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

/**
 * 0xC0（sub_42E510, raw 38618）：读引擎音乐字段 `_this[174713]` → op1
 *   （`sub_42B4B0(_this, 1, _this[174713])`）。
 *
 * ★这一格是 **Music 模块的运行态「当前曲 id」**（= `Music[259]`，模块内联在 `Engine+174454`），
 *   **不是**配置 `sound:Music`（那个落字节 699240 = 下标 174810）：由 `0xB7`/`0xB9`/`0xBF`/`0xC3` 写、
 *   `0xB8` 清 0、存档镜像 `[2]` 带走、读档装回后由 `i0b7 0` 重播（`tickets/T-0064`；改前曾把它当配置值，
 *   见 `engineConfig.ts` 的同条说明）。CONFIG.txt 用 `i0c0 (local-int 2)` 读"现在放的是哪首"。
 */
const op_get_music_field: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(ENGINE_FIELD.musicField) ?? 0);
};

/**
 * 0x2CE（sub_430A20, raw 40111）：`op1 = (_this[167990] != 0)` —— 显示模式/屏幕态 getter。
 *   该字段由启动时 `display:ScreenMode` 填充（raw 11980 `... = GetConfig(aDisplayScreenm) != 0`；raw 21660 处可翻转）。
 *   CONFIG1.txt:1459/1702 读它，且 **1702 的结果立刻被 `ne` 消费** → 当 no-op 跳过会让分支走错。
 */
const op_get_screen_mode: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.engineValues.get(ENGINE_FIELD.screenMode) ?? 0) !== 0 ? 1 : 0);
};

/**
 * **`ENGINE_FIELD_STORE` 一族：读操作数 → 写「可建模的引擎字段」**（真实现）。
 *
 * 这些 handler 在引擎里就是 `_this[字段] = readIntOperand(n)`（个别是 `op2` 覆盖、或多字段），
 * **不回写操作数、不改控制流**，因此 emulator 可以把字段值原样存进 `Engine.engineValues`：
 *  - 语义完整（同族的 getter opcode 能读回一致的值，如 `0x21B`↔`0x247`）；
 *  - 只是这些字段在 emulator 里不驱动任何渲染/声音输出。
 * 早前为"跑到 TITLE"把它们统一当 no-op 插桩；现按引擎语义补齐字段写入。
 *
 * 规格：`{ 操作数序号(1-based) → [目标字段] }`；`transform` 可选（如布尔化、位组装）。
 */
interface FieldStoreSpec {
  /** 操作数序号 → 目标 `_this[K]` 字段（键必须是 `ENGINE_FIELD.*`，不得是裸数字）。 */
  map: Record<number, number>;
  /** 取到的值变换（默认原样）。 */
  transform?: (v: number) => number;
}
const ENGINE_FIELD_STORE: Map<number, FieldStoreSpec> = new Map<number, FieldStoreSpec>([
  // ---- 消息窗（メッセージウィンドウ）属性/几何 ----
  // ★这些是**全局字体/颜色/描边/竖排**字段。它们**不在写入时重绘任何已排版的窗** ——
  //   引擎在**排版那一刻**就把字形连颜色画进该窗的离屏表面（`sub_46BE30` → `sub_455ED0`），
  //   此后只改全局字段不会回溯；脚本要换样式重画时会重新 `i071`+`show-text`。
  //   （历史上曾在这里挂 `after: emitAllWins`，正是用户实测「角色名颜色溢到 ADV 样例窗」的根因。）
  [0x76, { map: { 1: ENGINE_FIELD.colorFill }, transform: (v) => ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff) }], // 填充色（BGR→RGB）
  [0x77, { map: { 1: ENGINE_FIELD.colorOutline }, transform: (v) => ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff) }], // 描边色
  [0x78, { map: { 1: ENGINE_FIELD.outlineMode } }], // 描边档位
  [0x8b, { map: { 1: ENGINE_FIELD.lineSpacing } }], // **行间距**（Font+1380；旧注"第三色"是错的）
  [0x1a4, { map: { 1: ENGINE_FIELD.outlineDx, 2: ENGINE_FIELD.outlineDy } }], // 描边偏移：_this[21670]=op1(dx)、_this[21671]=op2(dy)
  [0x252, { map: { 1: ENGINE_FIELD.msgSystemConfig } }], // 消息系统配置
  [0x261, { map: { 1: ENGINE_FIELD.verticalText } }], // 竖排标志（Font+235108）
  [0x2ee, { map: { 1: ENGINE_FIELD.messageFade } }], // 消息淡入
  [0x2db, { map: { 1: ENGINE_FIELD.fontMetricsMode } }], // 文本属性（引擎随后 sub_459F40 重排文本）
  [0x25b, { map: { 1: ENGINE_FIELD.msgMediaImageId } }], // 消息态图像：`_this[92381]=op1`（模式位 92379=2 由它在引擎里写）
  // ---- 数据/配置/标志 ----
  [0x21b, { map: { 1: ENGINE_FIELD.engineBool }, transform: (v) => (v !== 0 ? 1 : 0) }], // 引擎布尔寄存器（配套 getter 0x247）
  [0x24e, { map: { 1: ENGINE_FIELD.msgField92340 } }],
  [0x1cf, { map: { 1: ENGINE_FIELD.skipReadState } }], // 消息跳读态（引擎 sub_4213C0：_this[122504] = op1）
  [0x10f, { map: { 1: ENGINE_FIELD.frameField122369 } }],
  // ---- 输入（按键绑定表；emulator 无按键表，但值原样入字段以便口径统一）----
  [0xfe, { map: { 1: ENGINE_FIELD.setKeyTotal } }], // SetKeyTotal（引擎：op1>0x1F 报错，这里照存；见 T-0057 后继）
]);

/** `0x107`（SetKey）：`_this[op1 + keyTableBase] = op2`（op1=键位 ≤0x1F）。 */
const op_set_key: OpHandler = (c) => {
  const key = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  if (key <= 0x1f) c.e.engineValues.set(key + ENGINE_FIELD.keyTableBase, value);
};

/** `0x10B`（SetKey 另一表）：`_this[op2 + keyTable2Base] = op1`（op1=值 ≤0x1F）。 */
const op_set_key2: OpHandler = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 1);
  const key = readIntOperand(c.e, c.frame, c.instr, 2);
  if (value <= 0x1f) c.e.engineValues.set(key + ENGINE_FIELD.keyTable2Base, value);
};

/** `ENGINE_FIELD_STORE` 的统一 handler。 */
const op_engine_field_store: OpHandler = (c) => {
  const spec = ENGINE_FIELD_STORE.get(c.instr.opcode);
  if (!spec) return;
  for (const [nStr, field] of Object.entries(spec.map)) {
    const v = readIntOperand(c.e, c.frame, c.instr, Number(nStr));
    c.e.engineValues.set(field, spec.transform ? spec.transform(v) : v);
  }
};

/** `0x247`（sub_430810, raw 40034）：`op1 = (_this[166965] != 0)` —— 引擎布尔寄存器 getter，与 0x21B 成对。 */
const op_get_engine_bool: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.engineValues.get(ENGINE_FIELD.engineBool) ?? 0) !== 0 ? 1 : 0);
};

/**
 * **`0x306`（sub_431FC0, raw 40948）：`op1 = GetConfig("system:EffectSkipOnClick")`**
 * —— 纯配置 getter（「点击跳过特效」开关，构造默认 1、配置文件可覆盖为 0）。
 * 修掉先前误用 `ENGINE_INTERNAL_OPS` 里 no-op 的问题：那样会让本指令**不写 op1**。
 */
const op_get_effect_skip: OpHandler = (c) => {
  const v = c.e.config ? cfgInt(c.e.config, CFG.systemEffectSkipOnClick, 1) : 1;
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

/**
 * **`0x142`（sub_422930, raw 31020）：`_this[174812] = op1`** —— **脚本向引擎写一个全局开关**。
 *
 * 字段语义（`_this[174812]` = 字节 `0xAAB70` = 699248）——**全工程引用只有 4 处**，可完整定性：
 *  - **写**：只有本 handler（`_this[174812] = op1`，raw 31026）；
 *  - **初始化**：引擎构造 `sub_415640`（raw 22591）与复位 `sub_40DF10`（raw 17961）都置 **1**；
 *  - **读**：只有 `sub_4765C0() { return _this[699248] != 0; }`（raw 91057-91061）——**一个导出给脚本的
 *    布尔查询（引擎内零调用）**，即"脚本可读、脚本可写"的**引擎运行开关**。
 *  - 同族邻居：`sub_4765E0` 读 `effect_flags(699204)` 的 bit26、`sub_476600` 读 `(int)effect_flags < 0`
 *    （= ADV/跳读态），即 `sub_4765xxx` 是一族 Engine 状态查询，本字段是其中的一个通用 flag。
 *
 * 脚本用法（`src/CONFIG.txt`）：
 *  - `L40 i142 0`：在设置页开场（刚布好消息窗 `i070/i079/i213`、`i080 9` 切到第 9 窗格）之后置 **0**；
 *  - `L354 i142 1`：在设置页收尾（`i1bb` 恢复、`i080 8` 回第 8 窗格）之前置回 **1**。
 *  ⇒ 即**进设置页时"挂起"、离开时"恢复"**的状态开关（构造/复位默认 1 = 正常）。
 *
 * emulator 建模：写入 `Engine.engineValues`（稀疏字段表），语义与引擎一致；当前无脚本经 opcode 读回它，
 * 故它不会改变 emulator 的输出，但**必须写**（否则上游若加 getter，值会漂）。
 */
/**
 * `0x141`（sub_4228C0 raw 30998-31016）：**SetMesWinAlpha** —— `op1 > 0x10` 时报错，
 * 否则 `SetConfig("message:MesWinAlpha", op1)`（**直写配置注册表，不进任何持久字段**）。
 * 与 `0x131`（直读同名键）配对；`src/*.txt` 中两者均 0 次使用，但属同一「配置直读直写族」，不得当 no-op。
 */
const op_set_meswin_alpha: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  if (v > 0x10) return; // 引擎：op1 > 0x10 ⇒ 报错并返回（不写配置）
  setConfigValue(c.e, CFG.messageMesWinAlpha, v); // 统一走 setConfigValue ⇒ 一样会通知落盘
};

export const op_set_engine_flag_174812: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(ENGINE_FIELD.scriptEngineFlag, v);
};

/**
 * **`0x1BF`（`sub_419840` raw 24874-24885）：跳读态置**（0 操作数，不写任何操作数）。
 *
 * ```c
 * if ((_this[122504] & 0x10000) != 0) _this[122504] = 0;   // 清掉"某模式"位（整字段归零）
 * if ((_this[122504] & 1) == 0)        _this[122503] = 1;  // 不是"通常消息模式" ⇒ 进入跳读态
 * ```
 * `122504` 由 `0x1CF`（`sub_4213C0`）写入（本文件的 `ENGINE_FIELD_STORE` 已建模）；`122503` 的
 * **唯一读者是 `play-bgm`**（`sub_420CC0` raw 29769-29777）：`set:KeepMusicVoice && sound:MusicFadeOnVoicePlaying
 * && !_this[122503]` ⇒ 暂停 BGM 给语音让路 —— 即「快进/跳读时不要把 BGM 压下去」。
 *
 * 为什么不能当 no-op：它**改引擎状态**（且会清 `122504` 的 bit16），下游 `play-bgm` 的分支据此分叉；
 * 跳过它会让"快进时的 BGM 让路"行为与真机相反（语音一来 BGM 就被暂停）。
 */
const op_set_skip_read_state: OpHandler = (c) => {
  const e = c.e;
  const state = e.engineValues.get(ENGINE_FIELD.skipReadState) ?? 0;
  if ((state & 0x10000) !== 0) e.engineValues.set(ENGINE_FIELD.skipReadState, 0);
  if (((e.engineValues.get(ENGINE_FIELD.skipReadState) ?? 0) & 1) === 0) e.engineValues.set(ENGINE_FIELD.skipReadActive, 1);
};

/**
 * **`0x25A`（`sub_425DB0` raw 33188-33203）：消息态"影片"（模式 1）**。
 *
 * ```c
 * v = op1;
 * v3 = (_this[92377] == 0);          // 92377 = 上一次的显示模式镜像
 * _this[92379] = 1;                  // ★模式位 = 1（影片；同族 0x25B 置 2 = 图像）
 * _this[92380] = v;                  // 影片/图像 id
 * if (v3) sub_4A5470(Scene, v);      // 模式发生变化 ⇒ 立刻下发一次
 * if (!_this[167990]) return sub_4A5470(Scene, _this[92380]);   // 非全屏再下发一次
 * ```
 * `92377` = 上一次模式镜像（引擎主循环 raw 11960/21708 维护）、`167990` = `display:ScreenMode`。
 * ⇒ 脚本可观测的是**两个字段**（模式 1 + id）；`sub_4A5470(Scene, id)` 属宿主渲染侧
 * （影片/图像叠加 = 复评台账里**明确排除**的"播放视频"子系统）⇒ 字段照写、下发部分记为缺口。
 * 语料 `i25a` 0 处；同族的 `0x25B`（图像）也有 0 处。
 */
const op_set_media_movie: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
  e.engineValues.set(ENGINE_FIELD.mediaMode, 1); // 模式 1 = 影片
  e.engineValues.set(ENGINE_FIELD.mediaId, v);
  // 引擎：模式变化时（92377 == 0）与"非全屏"时各下发一次 Scene 图层；宿主无影片子系统 ⇒ 只记字段。
};

// ---------------------------------------------------------------------------
// A5（单行字段 / 计时）—— 2026-09 落地
// ---------------------------------------------------------------------------

/** `0xD9`（sub_419970 raw 24939）：清 `effect_flags & 0x1000`（派发中时同清 `Engine[95779]` 的该位）。 */
const op_clear_flag_1000: OpHandler = (c) => {
  const e = c.e;
  e.effectFlags &= ~0x1000;
  if ((e.engineValues.get(ENGINE_FIELD.dispatchInProgress) ?? 0) !== 0) {
    // 引擎：`if (_this[124350]) _this[95779] &= ~0x1000;`（124350 = 脚本派发中标志）
    e.engineValues.set(ENGINE_FIELD.dispatchSavedFlags, (e.engineValues.get(ENGINE_FIELD.dispatchSavedFlags) ?? 0) & ~0x1000);
  }
};

/**
 * `0xAD`（sub_4192C0 raw 24627 → `sub_4380F0` raw 45095-45103）：**秒计时器推进**。
 *
 * 引擎（对象 = `_this + 5191`）：
 * ```c
 * obj[259] = obj[260];                                   // 上一秒 ← 当前秒（对外读的口）
 * v2 = 274877907i64 * timeGetTime();                     // 64 位乘
 * obj[258] = HIDWORD(v2) >> 6;                           // ≈ ms / 1000 = 秒
 * ```
 * ⇒ `_this[5191+259]=5450 ← _this[5191+260]=5451`、`_this[5191+258]=5449 ← timeGetTime()/1000`。
 * `274877907 / 2^38 = 1/1000.0000009…`（定点近似）。emulator 用 `BigInt` 复刻同一算术
 * （`Number((274877907n * BigInt(nowMs)) >> 38n)`），避免 JS 双精度在 2^59 量级丢位。
 */
const op_seconds_timer: OpHandler = (c) => {
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.timerSecondsPrev, e.engineValues.get(ENGINE_FIELD.timerSeconds) ?? 0);
  const ms = BigInt(e.nowMs | 0);
  e.engineValues.set(ENGINE_FIELD.timerMsDiv1000, Number((274877907n * ms) >> 38n) | 0);
};

/** `0x1AD`（sub_4196F0 raw 24806）：`Engine[166963] = cur`（存档序列化用的"当前帧"记忆；语料 1100 处）。 */
const op_store_cur_166963: OpHandler = (c) => {
  c.e.engineValues.set(ENGINE_FIELD.storedCur, c.e.cur);
};

/** `0x1B1`（sub_41FEA0 raw 29155）：`Engine[21672] = op1`。 */
const op_set_field_21672: OpHandler = (c) => {
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.followTextMode, readIntOperand(e, c.frame, c.instr, 1));
};

/** 「读操作数 → 写引擎字段」一族 + 引擎字段读写 getter/setter（真实现）。 */export const ENGINE_FIELD_OPS: OpTable = [  // 注：消息窗字段/对象表（0x7F/0x80/0x300/0x301/0x212/0x213/0x25D）见 msgwin.ts —— 同属引擎状态，但族谱独立。
  // ---- 「读操作数 → 写引擎字段」一族（真实现；规格见 ENGINE_FIELD_STORE）----
  [0x76, op_engine_field_store], // _this[21664]
  [0x77, op_engine_field_store], // _this[21665]
  [0x78, op_engine_field_store], // _this[21667]
  [0x8b, op_engine_field_store], // _this[21669]
  [0x1a4, op_engine_field_store], // _this[21670]/[21671]
  [0x252, op_engine_field_store], // _this[92323]
  [0x261, op_engine_field_store], // _this[80101]
  [0x2ee, op_engine_field_store], // _this[80106]
  [0x2db, op_engine_field_store], // _this[71744]
  [0x25b, op_engine_field_store], // 消息态图像（模式 2）：_this[92381] = op1（模式位 92379=2 由它在引擎里写；emulator 只存 id）
  [0x25a, op_set_media_movie], // 消息态影片（模式 1）：_this[92379]=1、[92380]=op1（Scene 下发=已登记缺口）
  [0x21b, op_engine_field_store], // _this[166965] = (op1!=0)（配套 getter 0x247）
  [0x24e, op_engine_field_store], // _this[92340]
  [0x1cf, op_engine_field_store], // **消息跳读态**：`_this[122504] = op1`（sub_4213C0 raw 30069）
  [0x1bf, op_set_skip_read_state], // **跳读态置**：按 122504 置 `_this[122503]`（sub_419840 raw 24874）
  [0x10f, op_engine_field_store], // _this[122369]
  [0xfe, op_engine_field_store], // _this[517]（SetKeyTotal）
  [0x107, op_set_key], // _this[op1+551] = op2
  [0x10b, op_set_key2], // _this[op2+1383] = op1
  [0x247, op_get_engine_bool], // op1 = (_this[166965] != 0)
  [0x142, op_set_engine_flag_174812], // _this[174812] = op1（脚本可控的引擎运行开关；构造/复位默认 1）
  [0x148, op_read_global_slot], // read `_this[97058]` → op1（暂无用，仅建模）
  [0x149, op_write_global_slot], // write op1 → `_this[97058]`（暂无用，仅建模）
  // ---- A5（单行字段 / 计时，2026-09）----
  [0xd9, op_clear_flag_1000], // 清 effect_flags & 0x1000（+ `95779` 同位）
  [0xad, op_seconds_timer], // 秒计时器推进（`_this[5449]` ← timeGetTime/1000）
  [0x1ad, op_store_cur_166963], // `_this[166963] = cur`（1100 处）
  [0x1b1, op_set_field_21672], // `_this[21672] = op1`
];

/** 引擎字段/配置 getter（值来自配置注册表或其它子系统）。 */
export const ENGINE_FIELD_NATIVE_OPS: OpTable = [
  [0x106, op_get_engine_value], // 配置 getter ▶ op1
  [0x130, op_get_engine_value], // load-show-logo：`_this[96983]` ▶ op1（SYSTEM4 用，决定是否播 LOGO）
  [0x131, op_get_engine_value], // 配置 getter（`message:MesWinAlpha`）▶ op1
  [0x201, op_get_engine_value], // 配置 getter ▶ op1
  // 注：`0x2DC`（可选字体数量）**不在这里** —— 它不是配置 getter，而是字体表规模，
  //     与 0x2DD/0x2DE 同族，见 msgwin.ts 的 op_font_list_count（原为通用 getter ⇒ 恒 0 ⇒ 字体选择器退化为除零）。
  [0xc0, op_get_music_field], // 音乐字段 `_this[174713]`（由 sound:Music 填充）▶ op1
  [0x2ce, op_get_screen_mode], // 显示模式 `_this[167990]!=0`（由 display:ScreenMode 填充）▶ op1
  [0x306, op_get_effect_skip], // `system:EffectSkipOnClick` ▶ op1（纯配置 getter）
  [0x141, op_set_meswin_alpha], // SetConfig message:MesWinAlpha（op1 > 0x10 报错；0x131 的写入端）
];

