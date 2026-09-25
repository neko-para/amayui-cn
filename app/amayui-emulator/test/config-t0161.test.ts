/** @tier T0 @kind core @subsystem config */

/**
 * **T-0161（引擎字段 / 配置读写批）—— 配置侧的逐条守卫**。
 *
 * 夹具 = `harness.mkEngine` + `stepOnce`（**产品同款驱动**，不新造 `mk()` 变体 —— 见
 * `test/harness-convergence.test.ts` 的 T-0020 棘轮）；本文件不依赖任何未入库的真游戏资源
 * （配置全用合成 INI 文本，故声明 **T0**，见 `test/organization.test.ts` 的 R2）。
 *
 * 本文件只钉六条（全部按**读体**结论，锚点见各条注释）：
 *  1. `0x2EB`（`sub_434830` raw 42575-42593）取 `GetConfig("set:GameVersion")` 写 op1。
 *     ★体里对取到的串**无任何兜底**（`sub_40C210(v3, v2, strlen(v2))`），但**引擎侧的空串不可达**：
 *     构造期已把该键注入内建 `"1.00"`（raw 111627-111629 `sub_40C210(v9, a100, 4u); sub_434E00(...,
 *     aSetGameversion, ...)`），而 `SYS4REG.INI` 的装载器 `sub_492CB0`（raw 111846-112310）逐条读了
 *     60 余个键、**没有** `set:GameVersion`（大写键 `GAMEVERSION` 只出现在**另一个**函数
 *     `sub_494220`（raw 112319-112853，注册表数据块应用器，配置对象 vtable 第 3 项 `.data:00529808`）里，
 *     与 INI 的 `[set]` 节无关）。⇒ emulator 的「INI → 缺省」两层本身就是**替代物**；替代物里
 *     "键存在但值为空串"只可能来自 emulator **自己**导出的 INI（`configRegistry.ts` 的
 *     `set:GameVersion` 条目 `def: ''` 经 `formatIni` 全量写出 `GameVersion=`，实机 overlay 实测如此）
 *     ⇒ 必须当「未指定」处理、回落到 `DEFAULT_GAME_VERSION`，否则 TITLE 第一段为空、
 *     `atoi("") = 0` ⇒ 屏幕上是 "0.00.0000"。
 *  2. `0x2EB` 的两层口径（近似，审计 `0x2eb approximation`）：**INI 有非空值 ⇒ 以它为准**。
 *     旧守卫（`config-version-substr.test.ts:141`）用的是 `1.07.0019` —— 与缺省**同值**，
 *     区分不出「读到 INI」与「回落到缺省」；这里用一个**不同**的值把优先级钉死。
 *  3. `0xC5`（`sub_42E540` raw 38626-38667）越界 selector（`op1 != 0` 且 ∉ 1..4）走**唯一的 else**
 *     （raw 38657-38661）：`sprintf_s(_this + 8, 0x400u, aGetvolume); sub_4034D0(...)`，
 *     `aGetvolume = "GetVolumeの引数が不正です．\r\n"`（raw 4442）。该链路
 *     `sub_4034D0`（raw 9433-9435）→ `sub_4976A0`（raw 114428-114457，加 `(%s：%d行目)` 头）→
 *     `sub_497620`（raw 114402-114416）→ `sub_438CC0`（raw 45660-45667）**本质是 `WriteFile`**
 *     ⇒ 只是**诊断输出**（不弹窗、不中断、不写操作数）。emulator 修前连诊断都没有（注释自称
 *     「'skip' 只记不写」，代码里没有"记"）。
 *  4. `0xC5` 与 `0xC7` 的 `selector = 0` **不对称**：前者体是 `if (op1) … else Volume0`（0 合法），
 *     后者四支都是 `== 1/2/3/4`（0 落到 raw 38715-38716 的报错支，`aGetsoundmode` raw 4443）。
 *  5. `0x131`（`sub_42F7D0` raw 39350-39356）直读配置 `message:MesWinAlpha` —— 引擎注册表构造
 *     `sub_491880` 在 raw 111471-111472 注入内建缺省 **8**（`v13 = 8; sub_434D00(v2, aMessageMeswina,
 *     &v13)`），所以**缺键/无 INI** 时 `GetConfig` 回 8；emulator 修前回 0。
 *  6. `0x141`（`sub_4228C0` raw 30999-31017）越界（unsigned `op1 > 0x10`）走
 *     `sub_408050(_this + 8, 1024, aGetmeswina); sub_4034D0(...)`，`aGetmeswina =
 *     "GetMesWinAの引数が不正です．\r\n"`（raw 4427）—— 与 `0xC5` **同一条诊断链路**（审计原文
 *     "把该串当消息派发（= 玩家可见的错误提示）"过强：它不弹窗）。
 *  7. 配置注册表键名（审计 `msgwin-cancel-key-state stale-ledger`）：能力条目 note 说门控是
 *     `GetConfig("set:CancelMessageKey")`，实际引擎里的键名常量是
 *     `aSetCancelmessk[25] = "set:CancelMesSkipOnClick"`（raw 4346），它既在**权威键表**
 *     （`configRegistry.ts`，`def: 0`）也在工程证据 INI 里 —— 三态机休眠是因为**值 0**，不是因为缺键。
 *  8. `set:DrawMode` ⇒ `_this[166964]` 的绑定（`0x201` 的字段生产端，raw 23572-23574）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { StubNative } from '../src/vm/native.js';
import { decIntSlot } from '../src/vm/ref.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import {
  applyConfigToEngine,
  cfgInt,
  cfgStr,
  DEFAULT_GAME_VERSION,
  ENGINE_BUILTIN_GAME_VERSION,
  parseIni,
} from '../src/engineConfig.js';
import { CFG, CONFIG_REGISTRY_KEYS, isRegistryKey, registryDefault } from '../src/configRegistry.js';
import type { Engine } from '../src/vm/engine.js';
import { im, instr, loc, mkEngine } from './harness.js';

/** 本帧 `local-string` 池槽（type 0xB）—— 只有池操作数能做**写目标**。 */
const locStr = (i: number): BinArg => ({ type: 0xb, raw: i }) as unknown as BinArg;

/**
 * 夹具（**唯一**，不新造 `mk()` 变体）：`mkEngine` 建引擎 + 装合成脚本，`stepOnce` 逐条执行；
 * `StubNative` 的日志回调就是 handler 里 `c.log(...)` 的出口（`interpreter.ts:201`）。
 */
function rig(ops: BinInstruction[], ini?: string): { e: Engine; logs: string[] } {
  const logs: string[] = [];
  const e = mkEngine(ops, 'T0161.BIN', new StubNative((m) => void logs.push(m)));
  if (ini !== undefined) e.config = parseIni(ini);
  return { e, logs };
}

/** 读本帧 `local-int` 槽的**真值**（池里是 ENC 位模式，必须 `decIntSlot`）。 */
const decodeLocal = (e: Engine, n: number): number | undefined =>
  decIntSlot(e.key, e.curScript().locals.int.get(n));

// ---------------------------------------------------------------------------
// 1) 0x2EB：取值口径（空串 → 缺省；INI 非空值 → 覆盖缺省）
// ---------------------------------------------------------------------------

test('★0x2EB：INI 里 `GameVersion=`（空值）⇒ 回落到 DEFAULT_GAME_VERSION（不是空串）', async () => {
  const { e } = rig([instr(0x2eb, [locStr(0)])], '[set]\r\nGameVersion=\r\n');
  await stepOnce(e);
  assert.equal(
    e.curScript().locals.str.get(0),
    DEFAULT_GAME_VERSION,
    '空值在引擎侧不可达（构造内建 1.00 且 INI 装载器 sub_492CB0 不读该键）⇒ 替代物按"未指定"处理',
  );
  // 反面：`cfgStr` 本身**不改语义**（配置层对空串仍原样返回）——防止把回退塞进公共读函数。
  const cfg = parseIni('[set]\r\nGameVersion=\r\n');
  assert.equal(cfgStr(cfg, CFG.setGameVersion, DEFAULT_GAME_VERSION), '', 'cfgStr 对"键在、值为空串"仍返回空串');
});

test('0x2EB：INI 有**非空**值 ⇒ 以它为准（两层口径的优先级；用与缺省不同的值）', async () => {
  const { e } = rig([instr(0x2eb, [locStr(0)])], '[set]\r\nGameVersion=9.99.9999\r\n');
  await stepOnce(e);
  assert.equal(e.curScript().locals.str.get(0), '9.99.9999');
  assert.notEqual(DEFAULT_GAME_VERSION, '9.99.9999', '该值必须与缺省不同，否则这条断言区分不出两层');
  // 引擎内建常量与 emulator 缺省是**两个**不同的串（三层口径里的第 1 层已被替代物换掉）
  assert.equal(ENGINE_BUILTIN_GAME_VERSION, '1.00');
  assert.equal(DEFAULT_GAME_VERSION, '1.07.0019');
});

test('0x2EB：无 config / 无该键 ⇒ DEFAULT_GAME_VERSION（既有口径不回归）', async () => {
  const a = rig([instr(0x2eb, [locStr(0)])], '[message]\r\nMessageSpeed=5\r\n');
  await stepOnce(a.e);
  assert.equal(a.e.curScript().locals.str.get(0), DEFAULT_GAME_VERSION);
  const b = rig([instr(0x2eb, [locStr(0)])]); // 从未装载配置（e.config 保持初值 null）
  await stepOnce(b.e);
  assert.equal(b.e.curScript().locals.str.get(0), DEFAULT_GAME_VERSION);
});

// ---------------------------------------------------------------------------
// 2) 0xC5：越界 selector 的诊断（引擎写 remote-debug 日志）
// ---------------------------------------------------------------------------

test('★0xC5：selector ∉ 0..4 ⇒ 不写 op2，且留下引擎那句 `GetVolumeの引数が不正です．` 诊断', async () => {
  for (const sel of [5, -1, 0x7fffffff]) {
    const { e, logs } = rig([instr(0xc5, [im(sel), loc(7)])], '[sound]\r\nVolume0=10\r\nVolume4=40\r\n');
    e.curScript().locals.int.set(7, 0x55aa); // 预置：越界时引擎不写 op2（raw 38657-38661 只报错）
    await stepOnce(e);
    assert.equal(e.curScript().locals.int.get(7), 0x55aa, `selector=${sel} ⇒ op2 保持原值`);
    assert.ok(
      logs.some((l) => l.includes('GetVolumeの引数が不正です．')),
      `selector=${sel}：应留下 aGetvolume 的诊断（raw 4442；实际 logs=${JSON.stringify(logs)}）`,
    );
  }
});

test('0xC5：selector 0..4 各自读对键（诊断只在越界时出现）', async () => {
  const ini = '[sound]\r\nVolume0=10\r\nVolume1=11\r\nVolume2=12\r\nVolume3=13\r\nVolume4=40\r\n';
  const sels = [0, 1, 2, 3, 4] as const;
  const ops = sels.map((sel) => instr(0xc5, [im(sel), loc(0x100 + sel)]));
  const { e, logs } = rig(ops, ini);
  for (const _ of ops) await stepOnce(e);
  const want = [10, 11, 12, 13, 40];
  sels.forEach((sel, i) => assert.equal(decodeLocal(e, 0x100 + sel), want[i], `Volume${sel}`));
  assert.deepEqual(logs, [], '合法档位不产生任何诊断');
});

test('★0xC5 与 0xC7 的 selector=0 不对称（体形状不同：`if (op1)` vs `== 1/2/3/4`）', async () => {
  // 0xC5（sub_42E540 raw 38635）：`if (op1) {…} else { Volume0 }` ⇒ 0 是**合法**档位。
  const a = rig([instr(0xc5, [im(0), loc(4)])], '[sound]\r\nVolume0=66\r\n');
  await stepOnce(a.e);
  assert.equal(decodeLocal(a.e, 4), 66, '0 ⇒ sound:Volume0');
  assert.deepEqual(a.logs, [], '0 不报错');
  // 0xC7（sub_42E670 raw 38679/38687/38705）：四支都是 `== 1/2/3/4` ⇒ **0 落到最后的报错支**
  // （raw 38715-38716 的 `aGetsoundmode`），既不写 op2 也要有诊断。
  const b = rig([instr(0xc7, [im(0), loc(4)])], '[sound]\r\nMusic=1\r\nSE=1\r\nVoice=1\r\nMovie=1\r\n');
  b.e.curScript().locals.int.set(4, 0x1234);
  await stepOnce(b.e);
  assert.equal(b.e.curScript().locals.int.get(4), 0x1234, '0 ∉ {1,2,3,4} ⇒ 不写 op2');
  assert.ok(
    b.logs.some((l) => l.includes('GetSoundModeの引数が不正です．')),
    `应留下 aGetsoundmode 的诊断（raw 4443；实际 ${JSON.stringify(b.logs)}）`,
  );
});

// ---------------------------------------------------------------------------
// 3) 0x131 / 0x141：MesWinAlpha 的读侧缺省 + 写侧越界诊断
// ---------------------------------------------------------------------------

test('★0x131：缺 `message:MesWinAlpha`（含无 INI）⇒ 写回注册表内建缺省 8，不是 0', async () => {
  const want = registryDefault(CFG.messageMesWinAlpha);
  assert.equal(want, 8, 'raw 111471-111472 `v13 = 8; sub_434D00(v2, aMessageMeswina, &v13)`');
  const a = rig([instr(0x131, [loc(3)])], '[message]\r\nMessageSpeed=5\r\n'); // 无该键
  await stepOnce(a.e);
  assert.equal(decodeLocal(a.e, 3), 8, '缺键 ⇒ GetConfig 回内建缺省');
  const b = rig([instr(0x131, [loc(3)])]); // 根本没读到 INI
  await stepOnce(b.e);
  assert.equal(decodeLocal(b.e, 3), 8, '无 INI ⇒ 引擎注册表仍在 ⇒ 同样回 8');
  const c = rig([instr(0x131, [loc(3)])], '[message]\r\nMesWinAlpha=3\r\n'); // 有值 ⇒ 以 INI 为准
  await stepOnce(c.e);
  assert.equal(decodeLocal(c.e, 3), 3);
});

test('★0x141：op1 无符号 > 0x10 ⇒ 不写配置，且诊断里带引擎的 `GetMesWinAの引数が不正です．`', async () => {
  for (const v of [0x11, -1]) {
    const { e, logs } = rig([instr(0x141, [im(v)])], '[message]\r\nMesWinAlpha=8\r\n');
    await stepOnce(e);
    assert.equal(cfgInt(e.config!, CFG.messageMesWinAlpha, -1), 8, `op1=${v} ⇒ 配置不变`);
    assert.ok(
      logs.some((l) => l.includes('GetMesWinAの引数が不正です．')),
      `op1=${v}：应留下 aGetmeswina 的诊断（raw 4427；实际 logs=${JSON.stringify(logs)}）`,
    );
  }
});

test('0x141：合法档位（无符号 ≤ 0x10）写进配置注册表，且不报诊断', async () => {
  const { e, logs } = rig([instr(0x141, [im(0x10)])], '[message]\r\nMesWinAlpha=8\r\n');
  await stepOnce(e);
  assert.equal(cfgInt(e.config!, CFG.messageMesWinAlpha, -1), 16);
  assert.deepEqual(logs, []);
});

// ---------------------------------------------------------------------------
// 4) 配置注册表：msgwin-cancel-key-state 的门控键名（stale-ledger 订正）
// ---------------------------------------------------------------------------

test('★配置注册表：三态机的门控键名是 `set:CancelMesSkipOnClick`（不是 set:CancelMessageKey）', () => {
  assert.equal(CFG.setCancelMesSkipOnClick, 'set:CancelMesSkipOnClick', 'raw 4346 `aSetCancelmessk[25]`');
  assert.ok(isRegistryKey(CFG.setCancelMesSkipOnClick), '权威键表里必须有它');
  assert.equal(registryDefault(CFG.setCancelMesSkipOnClick), 0, '内建缺省 0 ⇒ 三态机休眠是因为**值**，不是缺键');
  assert.ok(
    CONFIG_REGISTRY_KEYS.some((k) => k.key === CFG.setCancelMesSkipOnClick && k.kind === 'int'),
    '键表条目存在且是 int',
  );
});

test('配置注册表：`set:DrawMode` 是 int 键（0x201 的字段生产者，见 engine-fields 守卫）', () => {
  assert.equal(CFG.setDrawMode, 'set:DrawMode');
  assert.equal(registryDefault(CFG.setDrawMode), 0, 'raw 111732-111733 `v13 = 0; sub_434D00(v2, aSetDrawmode, &v13)`');
  assert.equal(ENGINE_FIELD.drawMode, 166964, 'raw 23574 `*(a1 + 667856) = GetConfig(aSetDrawmode)` ⇒ 667856/4');
});

test('配置绑定：`set:DrawMode` ⇒ `_this[166964]`（构造期无条件写，raw 23572-23574）', () => {
  const cfg = parseIni('[set]\r\nDrawMode=1\r\n');
  const values = new Map<number, number>();
  const applied = applyConfigToEngine(cfg, values);
  assert.equal(values.get(ENGINE_FIELD.drawMode), 1, '0x201 的 getter 必须能读到配置值');
  assert.ok(applied.some((a) => a.field === ENGINE_FIELD.drawMode));
});
