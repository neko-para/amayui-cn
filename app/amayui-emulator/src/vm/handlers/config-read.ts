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
  /**
   * ★**逐选择器的布尔口径**（覆盖 `bool`）：引擎在 `0xC7`（`sub_42E670` raw 38678-38714）里对
   * `sound:Music` 用的是 `v2 >= 0`（**只有负值算关**），而 `SE`/`Voice`/`Movie` 用的是 `v != 0`
   * （raw 38697/38709）。同一不对称口径在 raw 11090（`sub_405460` case 1）也出现。
   */
  boolMode?: Record<number, 'nonzero' | 'nonneg'>;
  /**
   * 选择器越界时的行为：`'skip'` = **不写操作数**（引擎在这些 opcode 里就是"只报错、不写"），
   * 并按 `errText` 留一条诊断。
   */
  onBadSelector?: 'skip';
  /**
   * ★**越界时引擎写进 remote-debug 流的那句常量**（`sprintf_s(_this + 8, …, aXxx); sub_4034D0(…)`）。
   *
   * 为什么要它（审计 2026-09 `0xC5 missing-branch`）：这些 handler 的注释原写「'skip' 只记不写」，
   * 但代码里**没有"记"** —— 脚本给了越界档位时真机有诊断输出、emulator 连一行日志都没有。
   * 该链路 `sub_4034D0`（raw 9433-9435）→ `sub_4976A0`（raw 114428-114457，栈帧在时前缀
   * `(%s：%d行目) `）→ `sub_497620`（raw 114402-114416）→ `sub_438CC0`（raw 45660-45667，
   * `WriteFile` 到 debug 句柄）⇒ **只是诊断输出**：不弹窗、不中断、不改控制流、不写操作数。
   * 因此 emulator 的等价物就是 `c.log(引擎那句)`。
   */
  errText?: string;
}

/**
 * 配置读取族越界时引擎的常量串（逐条对 raw 的 `char aXxx[]` 定义取证）。
 * ★这四条都是「`sub_408050(_this + 8, 1024, aXxx); sub_4034D0(_this, _this + 8);`」同一条诊断链路。
 */
const ENGINE_TEXT_GET_VOLUME = 'GetVolumeの引数が不正です．\r\n'; // raw 4442（0xC5：sub_42E540 raw 38657-38661）
const ENGINE_TEXT_GET_SOUND_MODE = 'GetSoundModeの引数が不正です．\r\n'; // raw 4443（0xC7：sub_42E670 raw 38715-38716）
const ENGINE_TEXT_GET_AUTO_MES_SP = 'GetAutoMesSpの引数が不正です．\r\n'; // raw 4408（0x1B8：sub_42D2F0 raw 38058-38062）
const ENGINE_TEXT_GET_AUTO_MES_PI = 'GetAutoMesPiの引数が不正です．\r\n'; // raw 4435（0x2E6：sub_431110 raw 40366-40370）

const CFG_READ: Record<number, CfgReadSpec> = {
  /**
   * `sound:Volume0..4` → op2（op1 = 0..4）。
   *
   * ★体里 op1 的形状与 `0xC7` **不对称**（`sub_42E540` raw 38635-38667）：先判 `if (op1)`，
   * 为 0 走 **else** 写 `Volume0`；非 0 再过 `== 1/2/3/4`，都不中就落到**唯一的 else**
   * （raw 38657-38661）报 `aGetvolume` 且**不写**。⇒ 负值（如 -1）和 ≥5 都走报错路径（无符号/有符号
   * 都不匹配那些 `==`），emulator 的 `keys[sel] === undefined` 判定与之一致。
   */
  0xc5: {
    operand: 2,
    selector: 1,
    keys: { 0: 'sound:volume0', 1: 'sound:volume1', 2: 'sound:volume2', 3: 'sound:volume3', 4: 'sound:volume4' },
    onBadSelector: 'skip',
    errText: ENGINE_TEXT_GET_VOLUME,
  },
  // sound:Music(≥0)/SE/Voice/Movie（非 0）→ op2（op1 = 1..4）
  // ★越界（含 **op1 == 0** —— 体的四个分支都是 `== 1/2/3/4`，0 会落到最后的报错支）⇒ 报 aGetsoundmode
  0xc7: {
    operand: 2,
    selector: 1,
    keys: { 1: CFG.soundMusic, 2: CFG.soundSE, 3: CFG.soundVoice, 4: CFG.soundMovie },
    /**
     * ★引擎 `sub_42E670`（raw 38678-38714）逐支口径**不同**：
     * `op1 == 1`（`sound:Music`）判 `v2 >= 0`（raw 38683：**只有负值**才写 0）；
     * `op1 == 2/3/4`（SE/Voice/Movie）判 `v != 0`（raw 38697/38709）。
     * 修前统一按「非 0 ⇒ 1」处理 ⇒ `Music=0`（本机 overlay 正是 0）时引擎写 1、emulator 写 0，
     * 设置界面的"音乐开/关"读反（审计 P1 `0xc7`/票 `T-0161`）。
     */
    boolMode: { 1: 'nonneg', 2: 'nonzero', 3: 'nonzero', 4: 'nonzero' },
    onBadSelector: 'skip',
    errText: ENGINE_TEXT_GET_SOUND_MODE,
  },
  // message:AutoMessageTime0/1 → op2（op1 = 0/1；其它值报 aGetautomessp，raw 38058-38062）
  0x1b8: {
    operand: 2,
    selector: 1,
    keys: { 0: CFG.messageAutoMessageTime0, 1: CFG.messageAutoMessageTime1 },
    onBadSelector: 'skip',
    errText: ENGINE_TEXT_GET_AUTO_MES_SP,
  },
  // message:AdvanceMesOnWheel → op1
  0x2cc: { operand: 1, key: CFG.messageAdvanceMesOnWheel },
  // message:AutoMessagePitch0/1 → op2（op1 = 0/1；其它值报 aGetautomespi，raw 40366-40370）
  0x2e6: {
    operand: 2,
    selector: 1,
    keys: { 0: CFG.messageAutoMessagePitch0, 1: CFG.messageAutoMessagePitch1 },
    onBadSelector: 'skip',
    errText: ENGINE_TEXT_GET_AUTO_MES_PI,
  },
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
  let sel: number | undefined;
  if (spec.selector !== undefined) {
    sel = p.int(spec.selector);
    if (sel === undefined) return;
    key = spec.keys?.[sel];
    if (key === undefined) {
      // 越界：引擎走报错分支（**不写操作数**，但会把 aXxx 那句经 `sub_4034D0` 写给 remote-debug 流）
      // ⇒ emulator 的等价物 = 一行诊断（不是静默，见 `CfgReadSpec.errText`）。
      if (spec.errText !== undefined) {
        c.log(`0x${c.instr.opcode.toString(16)}：${spec.errText.trim()}（op1=${sel} 不在 ${Object.keys(spec.keys ?? {}).join('/')} 内）`);
      }
      return;
    }
  }
  if (key === undefined) return;
  let v = cfg(c, key);
  // ★逐选择器口径（`0xC7` 的 `sound:Music` 是 `>= 0`，其余是 `!= 0`）见 `CfgReadSpec.boolMode`。
  const mode = sel !== undefined ? spec.boolMode?.[sel] : undefined;
  if (mode === 'nonneg') v = v >= 0 ? 1 : 0;
  else if (mode === 'nonzero' || spec.bool) v = v !== 0 ? 1 : 0;
  p.setInt(spec.operand, v);
};

/**
 * `0x2EB`（`sub_434830` raw 42575-42593）：**读配置字符串写回 op1**。
 *
 * 引擎：`v = GetConfig("set:GameVersion")`（走配置对象 vtable+8 的查询，raw 42583）→
 * `sub_40C210(v3, v2, strlen(v2))` 拷成 std::string → `sub_433310(this, 1, 串)` 写进 **op1**。
 * ★体对取到的串**没有任何兜底**（取到什么写什么，含空串）—— 兜底必须来自"引擎侧根本取不到空串"
 * 这件事本身（见下面第 2 条的订正）。
 *
 * ## 键值的三层结构（**逐条读体后的订正版**，审计 `0x2eb approximation`）
 *  1. **内建 `"1.00"`**：注册表构造 `sub_491880` 在 raw 111627-111629
 *     `sub_40C210((int)v9, a100, 4u); sub_434E00(..., aSetGameversion, ...)`，`a100 = "1.00"`。
 *  2. **`GAMEVERSION` 键覆盖**：**不是** `SYS4REG.INI` 的 `[set]` 节！`SYS4REG.INI` 的装载器
 *     `sub_492CB0`（raw 111846-112310）逐条读了 60 余个键（`sub_4957F0`/`sub_495950`），
 *     **里面没有 `set:GameVersion`**。真正写 `aSetGameversion` 的第二处是
 *     `sub_494220`（raw 112319-112853）—— 它吃一个 `key\0value\0…` 序列化块，用**大写**键名
 *     `REGROOTPATH`(raw 5107) / `REGSUBKEY` / `VERREGPOS`(raw 5105) / `GAMEVERSION`(raw 5104) 逐个
 *     `_stricmp`；该函数只出现在配置对象 vtable 的第三项（`.data:00529808`，同表还有
 *     `sub_492CB0`/`sub_490590`/`sub_491060`）⇒ 那是**注册表数据块**的装载路径，与 INI 无关。
 *  3. **注册表 `DisplayVersion` 覆盖**：`set:VerRegPos` 非空时 `sub_490010`（raw 110485-110502）
 *     查 `HKLM\…\Uninstall\InstallShield_{%s}` 的 `DisplayVersion`，查不到退回 `"1.00.0000"`；
 *     结果在 raw 112835-112851 写回 `aSetGameversion`。
 *
 * ## emulator 的取舍与其**边界**（★本票修的是边界上的那个洞）
 * 不做注册表查询（跨平台；本机是免安装拷贝 ⇒ 第 3 层走不到），**取值 = 当前生效的
 * `SYS4REG.INI` 的 `[set] GameVersion`，缺省用 `DEFAULT_GAME_VERSION`**（= 被模拟的
 * `amayui_107.exe` 的 FileVersion `1.07.0019`；引擎内建其实是 `1.00` —— 详见 `engineConfig.ts`）。
 * 于是 TITLE 的 "Version X.YY.ZZZZ" 不再显示占位值。
 *
 * ★**空串必须当"未指定"**（审计 P2 `0x2eb missing-branch`）：第 1 层保证引擎侧该键**永远非空**
 * （构造期就注入 `"1.00"`），而 INI 装载器**根本不读**这个键 ⇒ 引擎侧的空串**不可达**。
 * 那 emulator 这份 overlay 里的 `GameVersion=`（空值）是从哪来的？—— 是 **emulator 自己**写的：
 * `configRegistry.ts` 的键表把 `set:GameVersion` 的 `def` 记成 `''`，`formatIni` 又是"键表全量导出"，
 * 于是首跑生成的 INI 天然带一行空值（本机 `.tmp/instances/<id>/overlay/SYS4REG.INI` 实测如此，
 * 而 base 那份真游戏 INI 连 `[set]` 节都没有）。若照 `cfgStr` 的"键在就返回字符串（含空串）"口径，
 * op1 就是 `''` ⇒ TITLE 第一段空、`atoi("") = 0` ⇒ 屏幕上 "0.00.0000"。
 * ⇒ 这里把**空串**（一个引擎不可达的取值）映射到 emulator 的缺省 `DEFAULT_GAME_VERSION`，
 * 与"键缺失"同一条路。★`cfgStr` 本身**不改**（配置层对空串仍原样返回，见
 * `test/config-t0161.test.ts` 的反面断言）：回退只属于本 handler 的替代口径。
 *
 * 真实用例：`TITLE.txt:583` `i2eb (local-string 0)` → 586/589/592 三处 `i2c7` 切片 + `i2ec`(atoi)
 * + `i23b`(CG 数字条) 画成 "Version 1.07.0019"。
 */
const op_cfg_read_string: OpHandler = (c) => {
  const raw = c.e.config ? cfgStr(c.e.config, CFG.setGameVersion, DEFAULT_GAME_VERSION) : DEFAULT_GAME_VERSION;
  // ★空串 = "引擎不可达的取值，只可能是 emulator 自己导出的 INI 留下的" ⇒ 当未指定处理（见上）。
  const ini = raw === '' ? DEFAULT_GAME_VERSION : raw;
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
