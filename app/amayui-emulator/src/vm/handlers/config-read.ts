/**
 * **配置读取指令族：读引擎配置键 → 写回脚本操作数**（引擎里是 `GetConfig(...)` + `writeIntOperand`）。
 *
 * ## 为什么必须真实现（而不是当 no-op 跳过）
 * 这类 handler 的**唯一副作用就是回写操作数**。被当 no-op 跳过时脚本不会报错，只会**读到旧值** ——
 * 正是「闸门 B（能力缺口）」针对的静默错误类型。实测 CONFIG1（设置界面）路径上有 7 条这种指令，
 * 其中 6 条属本族（第 7 条 `0x194` 是字符串比较，见文件末尾说明）。
 *
 * ## 引擎实证（`engine/天结_unpacked.exe_utf8.c`）
 * | opcode | handler | 读法 | 写回 | 配置键 |
 * |---|---|---|---|---|
 * | `0xC5` | sub_42E540 raw 38626-38667 | op1 选择 0..4（越界则报错、不写）| op2 | `sound:Volume0..4` |
 * | `0xC7` | sub_42E670 raw 38671-38716 | op1 选择 1..4 | op2 | `sound:Music`(≥0→1) / `sound:SE` / `sound:Voice` / `sound:Movie`（非 0→1）|
 * | `0x1B8`| sub_42D2F0 | op1 选择 0/1 | op2 | `message:AutoMessageTime0/1` |
 * | `0x2CC`| sub_4309E0 raw 40101-40107 | 无 | op1 | `message:AdvanceMesOnWheel` |
 * | `0x2E6`| sub_431110 raw 40353-40376 | op1 选择 0/1 | op2 | `message:AutoMessagePitch0/1` |
 * | `0x2EA`| sub_4311B0 raw 40380-40386 | 无 | op1 | `message:AutoMessageOption` |
 * | `0x194`| sub_42CF10 raw 37909-37938 | op2/op3 两个字符串 | op1 | （无键：字符串相等判定，见下）|
 *
 * ## 与「设置界面」的关系（CONFIG1 的选项就是改这些键）
 * 这些键正是 CONFIG1/CONFIG2 里玩家能改的选项；`SYS4REG.INI` 只是**初值**。
 * 因此本族指令是「设置界面 → 脚本回读」闭环的一半（另一半是 CONFIG1 的写入路径）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { cfgInt, cfgStr, DEFAULT_GAME_VERSION } from '../../engineConfig.js';
import { operandsFor } from '../operandPlan.js';
import type { OpTable } from './shared.js';
import { CFG } from '../../configRegistry.js';

/** 读配置整数键（缺省 0，与引擎 `GetConfig` 缺省一致）。 */
function cfg(c: StepCtx, key: string): number {
  return c.e.config ? cfgInt(c.e.config, key, 0) : 0;
}

/** 配置键 → 写回某操作数的通用 handler（选择器语义见各表）。 */
interface CfgReadSpec {
  /** 写回的操作数序号（1-based）。 */
  operand: number;
  /** 选择器所在的操作数序号；缺省 = 无选择器。 */
  selector?: number;
  /** 选择器取值 → 键。 */
  keys?: Record<number, string>;
  /** 无选择器时的键。 */
  key?: string;
  /** 布尔化（非 0 → 1）。 */
  bool?: boolean;
  /** 选择器越界时的行为：'skip' 只记不写（引擎在 0xC5 里是报错路径）。 */
  onBadSelector?: 'skip';
}

const CFG_READ: Record<number, CfgReadSpec> = {
  // sound:Volume0..4 → op2（op1 = 0..4；引擎越界走报错分支，emulator 不写）
  0xc5: {
    operand: 2,
    selector: 1,
    keys: { 0: 'sound:volume0', 1: 'sound:volume1', 2: 'sound:volume2', 3: 'sound:volume3', 4: 'sound:volume4' },
    onBadSelector: 'skip',
  },
  // sound:Music(≥0)/SE/Voice/Movie（非 0）→ op2（op1 = 1..4）
  0xc7: {
    operand: 2,
    selector: 1,
    keys: { 1: CFG.soundMusic, 2: CFG.soundSE, 3: CFG.soundVoice, 4: CFG.soundMovie },
    bool: true,
    onBadSelector: 'skip',
  },
  // message:AutoMessageTime0/1 → op2（op1 = 0/1）
  0x1b8: { operand: 2, selector: 1, keys: { 0: CFG.messageAutoMessageTime0, 1: CFG.messageAutoMessageTime1 }, onBadSelector: 'skip' },
  // message:AdvanceMesOnWheel → op1
  0x2cc: { operand: 1, key: CFG.messageAdvanceMesOnWheel },
  // message:AutoMessagePitch0/1 → op2（op1 = 0/1）
  0x2e6: { operand: 2, selector: 1, keys: { 0: CFG.messageAutoMessagePitch0, 1: CFG.messageAutoMessagePitch1 }, onBadSelector: 'skip' },
  // message:AutoMessageOption → op1
  0x2ea: { operand: 1, key: CFG.messageAutoMessageOption },
  /**
   * `0x2ED`（`sub_431230` raw 40401-40409，argc 1）：**`message:MessageFade` 的读侧** ——
   * 体全文 = arity 槽 3 + `v2 = GetConfig("message:MessageFade")`（配置对象 vtable+4，键名是**常量**
   * `aMessageMessage_0`，raw 4380）+ `sub_42B4B0(_this, 1, v2)` ⇒ **写回 op1**。
   *
   * ★与写侧 `0x2EE`（`sub_426650`）成对（`tickets/T-0098`）：此前**两条都没被注册**，语料 0 处
   * ⇒ 没爆；写侧由 `T-0097` 补上，读侧由本票补上 ⇒ 现在可以用真指令做闭环
   * （`i2ee v` → `i2ed` 读回 v，见 `test/op-2ed-and-bit-index.test.ts`）。
   */
  0x2ed: { operand: 1, key: CFG.messageMessageFade },
};

/**
 * 共用 handler：**配置读取族**（`CFG_READ` 的 7 条）。
 *
 * ★已迁到**操作数计划层**（`tickets/T-0082` RF-A 批次"配置读取族"）：本族方向是两态的
 * （选择器 `r` / 结果位 `w`），由 `operandPlan.ts` 的计划声明，这里不再手写"读第几位、写第几位"。
 * 缺计划 = 编程错误 ⇒ 直接抛（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 */
const op_cfg_read: OpHandler = (c) => {
  const spec = CFG_READ[c.instr.opcode];
  if (!spec) return;
  const p = operandsFor(c);
  if (!p) {
    throw new Error(
      `0x${c.instr.opcode.toString(16)}：配置读取族走操作数计划层，但没有声明计划（见 src/vm/operandPlan.ts）`,
    );
  }
  let key: string | undefined = spec.key;
  if (spec.selector !== undefined) {
    const sel = p.int(spec.selector);
    if (sel === undefined) return;
    key = spec.keys?.[sel];
    if (key === undefined) return; // 越界：引擎走报错分支（不写操作数）
  }
  if (key === undefined) return;
  let v = cfg(c, key);
  if (spec.bool) v = v !== 0 ? 1 : 0;
  p.setInt(spec.operand, v);
};

/**
 * `0x2EB`（`sub_434830` raw 42575-42593）：**读配置字符串写回 op1**。
 *
 * 引擎：`v = GetConfig("set:GameVersion")`（走配置对象 vtable+8 的查询，raw 42583）→
 * `sub_40C210` 拷成 std::string → `sub_433310(this, 1, 串)` 写进 **op1**（字符串操作数）。
 *
 * 键值的来源（raw 111337-111644 的"配置缺省安装" + 112835-112851 的注册表覆盖）：
 *  1. 引擎启动时把 `set:GameVersion` 置为内建常量 `a100 = "1.00"`（raw 111627-111629）；
 *  2. 读 `SYS4REG.INI` 时 `[set]` 段的同名键会覆盖它（raw 112426-112433）；
 *  3. 若 `set:VerRegPos` 非空，则再用它去查安装信息的 `DisplayVersion` 覆盖
 *     （`sub_490010` raw 110485-110502，查不到退回 `"1.00.0000"`）。
 *
 * ★emulator 的取舍：不做注册表查询（跨平台、且本机这份是免安装拷贝 ⇒ 引擎也不会走到第 3 步），
 *   **取值 = 当前生效的 `SYS4REG.INI`（overlay → 真游戏那份）的 `[set] GameVersion`**，
 *   缺省用 `DEFAULT_GAME_VERSION`（= 被模拟的 `amayui_107.exe` 的 FileVersion `1.07.0019`；
 *   引擎内建其实是 `1.00`，而真游戏 INI 没有 `[set]` 节 —— 详见 `engineConfig.ts` 的说明）。
 *   于是 TITLE 的 "Version X.YY.ZZZZ" 不再显示占位值。
 *
 * 真实用例：`TITLE.txt:583` `i2eb (local-string 0)` → 586/589/592 三处 `i2c7` 切片 + `i2ec`(atoi)
 * + `i23b`(CG 数字条) 画成 "Version 1.07.0019"。
 */
const op_cfg_read_string: OpHandler = (c) => {
  const ini = c.e.config ? cfgStr(c.e.config, CFG.setGameVersion, DEFAULT_GAME_VERSION) : DEFAULT_GAME_VERSION;
  const p = operandsFor(c);
  if (!p) throw new Error('0x2eb：配置字符串读取走操作数计划层，但没有声明计划');
  p.setStr(1, ini);
};



/**
 * `0x194`（sub_42CF10 raw 37909-37938）：**字符串相等判定** `op1 = (op2 == op3)`。
 *
 * 引擎：`v2 = sub_42A420(this, buf, 3)`（取 op3 字符串）、`v3 = sub_42A420(this, buf2, 2)`（取 op2 字符串）
 * → `sub_401540(v3, 0, v3.len, v2, v2.len)`。
 *
 * ★`sub_401540`（raw 8024-8059）确证为 **`std::string::compare(pos, len, rhs, rhsLen)`** 语义：
 * 先 `memcmp(this+pos, rhs, min(len,rhsLen))`；相等时再比长度（`v6 >= a5 ? v6 != a5 : -1`）。
 * ⇒ **返回 0 当且仅当两串相等**；`op1 = (cmp == 0)` = 相等为 1。
 *
 * CONFIG1 用它判断"切换字体后字体名有没有变"（CONFIG1.txt:1044-1058）：
 * 备份字体名 → `call-script SELFONT` 改字体 → `i194` 比较 → 依结果走恢复/重载分支。
 */
const op_string_equal: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x194：字符串相等判定走操作数计划层，但没有声明计划');
  const a = p.str(2) ?? '';
  const b = p.str(3) ?? '';
  p.setInt(1, a === b ? 1 : 0);
};

/**
 * `0x195`（sub_42D010 raw 37942-37972）：**字符串不等判定** `op1 = (op2 != op3)` —— `0x194` 的取反兄弟。
 *
 * 引擎体与 `sub_42CF10`（0x194）逐行同构，只差最后一步：
 * ```
 * v2 = sub_42A420(this, v6, 3)                  // op3 字符串
 * v3 = sub_42A420(this, v7, 2)                  // op2 字符串
 * v5 = sub_401540(v3, 0, v3.len, v2, v2.len)    // std::string::compare ⇒ 0 当且仅当相等
 * sub_42B4B0(this, 1, v5 != 0)                  // ★写回 op1：不等 = 1
 * ```
 * ⇒ **`op1 = 1` 当且仅当两串不同**（`op1` 恒为 0/1，不带 compare 的负/正值）。
 *
 * ★**为什么不能跳过**：它**回写 op1**，跳过后 op1 保留上一条指令留下的旧值 ⇒ 紧随其后的
 * `jcc (op1) ffffffff <label>`（"为 0 才跳"）会按旧值分支。真实用例：
 * `src/SETFATE.txt:15-17`（初始化"运命"标志表的 1000 次循环）——
 * ```
 * lookup-array (local-string-ptr 0) (global-string 368c) (local-int 0)   // 角色名表
 * i195 (local-int 7d4) (local-string-ptr 0) ""                          // 7d4 = (名字 != "")
 * jcc (local-int 7d4) ffffffff label_00000278                            // 名字为空 ⇒ 跳过
 * ```
 * 跳过 `0x195` 时 `7d4` 还留着上一行 `lt (local-int 7d4) (local-int 0) 3e8` 的 **1**（= "非空"）
 * ⇒ **空名条目也会被处理**，对它们跑 `lookup-array-2d` 的三张表并置 `global def7c[]` 的位。
 */
const op_string_not_equal: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x195：字符串不等判定走操作数计划层，但没有声明计划');
  const a = p.str(2) ?? '';
  const b = p.str(3) ?? '';
  p.setInt(1, a === b ? 0 : 1);
};

/** 配置读取指令族（`OPS`：读配置键 → 写回脚本操作数）+ 字符串相等/不等判定 + `set:GameVersion` 字符串读。 */
export const CONFIG_READ_OPS: OpTable = [
  ...Object.keys(CFG_READ).map((op) => [Number(op), op_cfg_read] as const),
  [0x194, op_string_equal],
  [0x195, op_string_not_equal],
  [0x2eb, op_cfg_read_string],
];

/**
 * 本族每条 opcode + 它**写回哪一位**（结果位）与**读哪几位**（选择器 / 参与比较的串）。
 *
 * 用途 = 守卫（`test/operand-plan.test.ts`）**从同一张表推导**该族应有的计划，再逐条比对
 * `planOf()` ⇒ 「往 `CFG_READ` 加了一条却忘了声明计划」在 CI 里立即可见（handler 侧会直接抛）。
 */
export function cfgReadPlanOps(): { op: number; argc: number; operand: number; reads: number[] }[] {
  const rows = Object.entries(CFG_READ).map(([op, spec]) => ({
    op: Number(op),
    operand: spec.operand,
    reads: spec.selector !== undefined ? [spec.selector] : [],
  }));
  rows.push({ op: 0x194, operand: 1, reads: [2, 3] }); // op1 = (op2 == op3)
  rows.push({ op: 0x195, operand: 1, reads: [2, 3] }); // op1 = (op2 != op3)
  rows.push({ op: 0x2eb, operand: 1, reads: [] }); // op1（字符串）= set:GameVersion
  return rows
    .map((r) => ({ ...r, argc: Math.max(r.operand, ...r.reads) }))
    .sort((a, b) => a.op - b.op);
}
