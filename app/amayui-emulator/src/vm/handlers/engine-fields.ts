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
import type { Engine } from '../engine.js';
import { emitAllWins } from './msgwin.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import { cfgInt } from '../../engineConfig.js';
import type { OpTable } from './shared.js';

const op_write_global_slot: OpHandler = (c) => {
  c.e.globalSlot97058 = readIntOperand(c.e, c.frame, c.instr, 1);
};

/** 0x148 (sub_42FEC0)：`op1 = _this[97058]`（读）。 */
const op_read_global_slot: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.globalSlot97058);
};

// ---- 控制流 ----

/** 0x106/0x130/0x131/0x201/0x2DC 等：引擎配置 getter（读 `_this[字段]` 写 op1）。 */
const op_get_engine_value: OpHandler = (c) => {
  let v = 0;
  if (c.instr.opcode === 0x130) {
    // 0x130(load-show-logo)：读 `_this[96983]`（构造=1 播版权页；exit-script 置 0）。
    //   SYSTEM4 据此决定是否 `call-script LOGO`。
    v = c.e.engineValues.get(96983) ?? 0;
  } else if (c.instr.opcode === 0x131) {
    // 0x131（sub_42F7D0，raw 39350-39356）：**直接读配置注册表** `message:MesWinAlpha` 写 op1
    //   （`v2 = GetConfig(_this[174405], "message:MesWinAlpha")`）。
    //   ★它**不读任何 Engine 字段** —— 不要回退到 `engineValues`，那里没有这个键的值
    //   （历史上曾把 21668 当成"消息窗 α"，而 21668×4 = 86672 = Font+1376 = message:MessageSpeed）。
    v = c.e.config ? cfgInt(c.e.config, 'message:meswinalpha', 0) : 0;
  } else {
    // 其余 getter（0x106/0x201/0x2DC…）：对应引擎字段尚未逐一定位 → 保持 0（与旧行为一致）。
    v = 0;
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

/**
 * 0xC0（sub_42E510, raw 38618）：读引擎音乐字段 `_this[174713]` → op1
 *   （`sub_42B4B0(_this, 1, _this[174713])`）。该字段由启动时 `sound:Music` 填充（raw 23678-23681），
 *   写回侧是 0xC3（sub_420F10）。CONFIG.txt 用 `i0c0 (local-int 2)` 读系统值。
 */
const op_get_music_field: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(174713) ?? 0);
};

/**
 * 0x2CE（sub_430A20, raw 40111）：`op1 = (_this[167990] != 0)` —— 显示模式/屏幕态 getter。
 *   该字段由启动时 `display:ScreenMode` 填充（raw 11980 `... = GetConfig(aDisplayScreenm) != 0`；raw 21660 处可翻转）。
 *   CONFIG1.txt:1459/1702 读它，且 **1702 的结果立刻被 `ne` 消费** → 当 no-op 跳过会让分支走错。
 */
const op_get_screen_mode: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.engineValues.get(167990) ?? 0) !== 0 ? 1 : 0);
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
  /** 操作数序号 → 目标 `_this[K]` 字段。 */
  map: Record<number, number>;
  /** 取到的值变换（默认原样）。 */
  transform?: (v: number) => number;
  /**
   * 字段写入之后的**副作用钩子**。用于"该字段同时是文本渲染样式来源"的那些指令
   * （`0x76`/`0x77`/`0x78`/`0x8b`/`0x1a4`/`0x261`）：字段值照写（保持既有口径），
   * 再让消息窗把新样式发布给渲染层。
   */
  after?: (e: Engine) => void;
}
const ENGINE_FIELD_STORE: Map<number, FieldStoreSpec> = new Map<number, FieldStoreSpec>([
  // ---- 消息窗（メッセージウィンドウ）属性/几何 ----
  [0x76, { map: { 1: 21664 }, transform: (v) => ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff), after: emitAllWins }], // 填充色（BGR→RGB）；★发布给文本样式
  [0x77, { map: { 1: 21665 }, transform: (v) => ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff), after: emitAllWins }], // 描边色；★发布
  [0x78, { map: { 1: 21667 }, after: emitAllWins }], // 描边档位；★发布
  [0x8b, { map: { 1: 21669 }, after: emitAllWins }], // 第三色；★发布
  [0x1a4, { map: { 1: 21670, 2: 21671 }, after: emitAllWins }], // 描边偏移：_this[21670]=op1(dx)、_this[21671]=op2(dy)；★发布
  [0x252, { map: { 1: 92323 } }], // 消息系统配置
  [0x261, { map: { 1: 80101 }, after: emitAllWins }], // 竖排标志（Font+235108）；★发布
  [0x2ee, { map: { 1: 80106 } }], // 消息派发
  [0x2db, { map: { 1: 71744 } }], // 文本属性（引擎随后 sub_459F40 重排文本）
  [0x25b, { map: { 1: 92381 } }], // 消息态图像：`_this[92381]=op1`（模式位 92379=2 由同族 0x25A 置 1=影片）
  // ---- 数据/配置/标志 ----
  [0x21b, { map: { 1: 166965 }, transform: (v) => (v !== 0 ? 1 : 0) }], // 引擎布尔寄存器（配套 getter 0x247）
  [0x24e, { map: { 1: 92340 } }],
  [0x1cf, { map: { 1: 122504 } }], // 消息跳读态（引擎 sub_4213C0：_this[122504] = op1）
  [0x10f, { map: { 1: 122369 } }],
  // ---- 输入（按键绑定表；emulator 无按键表，但值原样入字段以便口径统一）----
  [0xfe, { map: { 1: 517 } }], // SetKeyTotal（引擎：op1>0x1F 报错，这里照存）
  [0x107, { map: { 2: -1 } }], // SetKey：_this[op1+551]=op2 —— 字段随 op1 变，见下方专用 handler
]);

/** `0x107`（SetKey）：`_this[op1 + 551] = op2`（op1=键位 ≤0x1F）。 */
const op_set_key: OpHandler = (c) => {
  const key = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  if (key <= 0x1f) c.e.engineValues.set(key + 551, value);
};

/** `0x10B`（SetKey 另一表）：`_this[op2 + 1383] = op1`（op1=值 ≤0x1F）。 */
const op_set_key2: OpHandler = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 1);
  const key = readIntOperand(c.e, c.frame, c.instr, 2);
  if (value <= 0x1f) c.e.engineValues.set(key + 1383, value);
};

/** `ENGINE_FIELD_STORE` 的统一 handler。 */
const op_engine_field_store: OpHandler = (c) => {
  const spec = ENGINE_FIELD_STORE.get(c.instr.opcode);
  if (!spec) return;
  for (const [nStr, field] of Object.entries(spec.map)) {
    if (field < 0) continue; // 动态字段由专用 handler 处理
    const v = readIntOperand(c.e, c.frame, c.instr, Number(nStr));
    c.e.engineValues.set(field, spec.transform ? spec.transform(v) : v);
  }
  spec.after?.(c.e);
};

/** `0x247`（sub_430810, raw 40034）：`op1 = (_this[166965] != 0)` —— 引擎布尔寄存器 getter，与 0x21B 成对。 */
const op_get_engine_bool: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.engineValues.get(166965) ?? 0) !== 0 ? 1 : 0);
};

/**
 * **`0x306`（sub_431FC0, raw 40948）：`op1 = GetConfig("system:EffectSkipOnClick")`**
 * —— 纯配置 getter（「点击跳过特效」开关，构造默认 1、配置文件可覆盖为 0）。
 * 修掉先前误用 `ENGINE_INTERNAL_OPS` 里 no-op 的问题：那样会让本指令**不写 op1**。
 */
const op_get_effect_skip: OpHandler = (c) => {
  const v = c.e.config ? cfgInt(c.e.config, 'system:effectskiponclick', 1) : 1;
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
  if (!c.e.config) c.e.config = { values: new Map(), sections: [] };
  c.e.config.values.set('message:meswinalpha', v);
};

export const op_set_engine_flag_174812: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(174812, v);
};

/** 「读操作数 → 写引擎字段」一族 + 引擎字段读写 getter/setter（真实现）。 */
export const ENGINE_FIELD_OPS: OpTable = [
  // 注：消息窗字段/对象表（0x7F/0x80/0x300/0x301/0x212/0x213/0x25D）见 msgwin.ts —— 同属引擎状态，但族谱独立。
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
  [0x25b, op_engine_field_store], // 消息态图像：_this[92381] = op1（模式位 92379 由同族 0x25A 置 1=影片/2=图像）
  [0x21b, op_engine_field_store], // _this[166965] = (op1!=0)（配套 getter 0x247）
  [0x24e, op_engine_field_store], // _this[92340]
  [0x1cf, op_engine_field_store], // **消息跳读态**：`_this[122504] = op1`（sub_4213C0 raw 30069）
  [0x10f, op_engine_field_store], // _this[122369]
  [0xfe, op_engine_field_store], // _this[517]（SetKeyTotal）
  [0x107, op_set_key], // _this[op1+551] = op2
  [0x10b, op_set_key2], // _this[op2+1383] = op1
  [0x247, op_get_engine_bool], // op1 = (_this[166965] != 0)
  [0x142, op_set_engine_flag_174812], // _this[174812] = op1（脚本可控的引擎运行开关；构造/复位默认 1）
  [0x148, op_read_global_slot], // read `_this[97058]` → op1（暂无用，仅建模）
  [0x149, op_write_global_slot], // write op1 → `_this[97058]`（暂无用，仅建模）
];

/** 引擎字段/配置 getter（值来自配置注册表或其它子系统）。 */
export const ENGINE_FIELD_NATIVE_OPS: OpTable = [
  [0x106, op_get_engine_value], // 配置 getter ▶ op1
  [0x130, op_get_engine_value], // load-show-logo：`_this[96983]` ▶ op1（SYSTEM4 用，决定是否播 LOGO）
  [0x131, op_get_engine_value], // 配置 getter（`message:MesWinAlpha`）▶ op1
  [0x201, op_get_engine_value], // 配置 getter ▶ op1
  [0x2dc, op_get_engine_value], // 数组容量 getter ▶ op1
  [0xc0, op_get_music_field], // 音乐字段 `_this[174713]`（由 sound:Music 填充）▶ op1
  [0x2ce, op_get_screen_mode], // 显示模式 `_this[167990]!=0`（由 display:ScreenMode 填充）▶ op1
  [0x306, op_get_effect_skip], // `system:EffectSkipOnClick` ▶ op1（纯配置 getter）
  [0x141, op_set_meswin_alpha], // SetConfig message:MesWinAlpha（op1 > 0x10 报错；0x131 的写入端）
];

