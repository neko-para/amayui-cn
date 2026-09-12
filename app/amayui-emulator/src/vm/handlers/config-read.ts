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
import { readIntOperand, readStringOperand, writeIntOperand, writeStringOperand } from '../operand.js';
import { cfgInt, cfgStr, DEFAULT_GAME_VERSION } from '../../engineConfig.js';
import type { OpTable } from './shared.js';

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
    keys: { 1: 'sound:music', 2: 'sound:se', 3: 'sound:voice', 4: 'sound:movie' },
    bool: true,
    onBadSelector: 'skip',
  },
  // message:AutoMessageTime0/1 → op2（op1 = 0/1）
  0x1b8: { operand: 2, selector: 1, keys: { 0: 'message:automessagetime0', 1: 'message:automessagetime1' }, onBadSelector: 'skip' },
  // message:AdvanceMesOnWheel → op1
  0x2cc: { operand: 1, key: 'message:advancemesonwheel' },
  // message:AutoMessagePitch0/1 → op2（op1 = 0/1）
  0x2e6: { operand: 2, selector: 1, keys: { 0: 'message:automessagepitch0', 1: 'message:automessagepitch1' }, onBadSelector: 'skip' },
  // message:AutoMessageOption → op1
  0x2ea: { operand: 1, key: 'message:automessageoption' },
};

const op_cfg_read: OpHandler = (c) => {
  const spec = CFG_READ[c.instr.opcode];
  if (!spec) return;
  let key: string | undefined = spec.key;
  if (spec.selector !== undefined) {
    const sel = readIntOperand(c.e, c.frame, c.instr, spec.selector);
    key = spec.keys?.[sel];
    if (key === undefined) return; // 越界：引擎走报错分支（不写操作数）
  }
  if (key === undefined) return;
  let v = cfg(c, key);
  if (spec.bool) v = v !== 0 ? 1 : 0;
  writeIntOperand(c.e, c.frame, c.instr, spec.operand, v);
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
 *   **取值 = `SYS4REG.INI` 的 `[set] GameVersion`，缺省用引擎内建 `"1.00"`**。
 *   `app/amayui-emulator/SYS4REG.INI` 里已显式写了 `GameVersion`（见该文件），
 *   于是 TITLE 的 "Version X.YY.ZZZZ" 不再显示占位值。
 *
 * 真实用例：`TITLE.txt:583` `i2eb (local-string 0)` → 586/589/592 三处 `i2c7` 切片 + `i2ec`(atoi)
 * + `i23b`(CG 数字条) 画成 "Version 1.07.0019"。
 */
const op_cfg_read_string: OpHandler = (c) => {
  const ini = c.e.config ? cfgStr(c.e.config, 'set:gameversion', DEFAULT_GAME_VERSION) : DEFAULT_GAME_VERSION;
  writeStringOperand(c.e, c.frame, c.instr, 1, ini);
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
  const e = c.e;
  const a = readStringOperand(e, c.frame, c.instr, 2);
  const b = readStringOperand(e, c.frame, c.instr, 3);
  writeIntOperand(e, c.frame, c.instr, 1, a === b ? 1 : 0);
};

/** 配置读取指令族（`OPS`：读配置键 → 写回脚本操作数）+ 字符串相等判定 + `set:GameVersion` 字符串读。 */
export const CONFIG_READ_OPS: OpTable = [
  ...Object.keys(CFG_READ).map((op) => [Number(op), op_cfg_read] as const),
  [0x194, op_string_equal],
  [0x2eb, op_cfg_read_string],
];
