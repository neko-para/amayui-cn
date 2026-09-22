/**
 * 引擎配置（SYS4REG.INI）加载 + 配置类 opcode 的取值测试。
 *
 * 事实来源：raw 23649-23745（启动装载后灌引擎字段）、sub_4900F0（路径）/ sub_4963E0（解析）/
 *   sub_4957F0（按 "section:key" 取整型）、0xC0 `sub_42E510`（读运行态 `_this[174713]` = 当前曲 id）/
 *   0x131 `sub_42F7D0`（直接读 `message:MesWinAlpha`）/ 0x2CE `sub_430A20`（`_this[167990]!=0` ←
 *   `display:ScreenMode`）。
 *
 * ★**取值断言一律用夹具 INI**（`tickets/T-0034`）：真游戏的 `SYS4REG.INI` 是**玩家数据**，
 *   玩家改一次设置（或真游戏自己重写）就会变 ⇒ 断言它的具体取值会让测试随开发机状态变红
 *   （实测：`MessageSpeed` 由 5 被改成 50，两条断言当场红，而代码一行未改）。
 *   真 INI 只用来做「结构 + 自洽」断言（键在 ⇒ 写进引擎字段的值必须等于读出来的同一个值）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseIni, cfgInt, cfgStr, applyConfigToEngine, CONFIG_FIELD_BINDINGS, DEFAULT_GAME_VERSION } from '../src/engineConfig.js';
import { INI_FILE, resolveSystemPaths } from '../src/arch/systemPaths.js';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { dec, asI32, enc } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
/**
 * 玩家数据的 base 那侧：**真游戏的** `SYS4REG.INI`（`%LOCALAPPDATA%\Eushully\<game>\`）。
 * ★只用于「结构 + 自洽」断言 —— 具体取值属**玩家数据**，见文件头与 `tickets/T-0034`。
 */
const INI = path.join(resolveSystemPaths(ROOT).baseDir, INI_FILE);
const HAS_REAL_INI = fs.existsSync(INI);
/** 真 INI 的文本（不存在 ⇒ null）。 */
function realIniText(): string | null {
  return HAS_REAL_INI ? fs.readFileSync(INI, 'utf8') : null;
}
/**
 * **夹具 INI**（确定性）：所有「取值」断言都读它 ⇒ 任何机器上结果一致。
 *
 * ★数值刻意与真游戏默认值**不同**（`Music=3` 而不是 2、`MessageSpeed=7` 而不是 5/50、`MesWinAlpha=6` 而不是 8）
 *   ⇒ 「某处不小心读了真 INI」会当场断言失败，而不是碰巧通过（这正是本票要防的漂移）。
 */
const FIXTURE_INI = [
  '[display]',
  'ScreenMode=1',
  'FullScreenBit=32',
  '[sound]',
  'Sound=1',
  'Music=3',
  'Voice=2',
  'SE=1',
  '[message]',
  'Font=Amayui CN',
  'RMouseEvent=1',
  'MesWinAlpha=6',
  'MessageSpeed=7',
  'MessageFade=250',
  '[system]',
  'UseMMX=1',
  '',
].join('\r\n');

test('parseIni：分节 / 数字 / 字符串 / 空值 / 大小写不敏感', () => {
  const cfg = parseIni(
    ['; 注释', '[display]', 'ScreenMode=1', 'FullScreenBit=32', 'ForceScreen=0', '', '[message]', 'Font=Amayui CN', 'SaveBMPPath=', '# 注释2'].join('\n'),
  );
  assert.deepEqual(cfg.sections, ['display', 'message']);
  assert.equal(cfgInt(cfg, 'display:screenmode'), 1);
  assert.equal(cfgInt(cfg, 'DISPLAY:ScreenMode'), 1, '键名大小写不敏感');
  assert.equal(cfgInt(cfg, 'display:forcrescreen', 7), 7, '缺键返回 fallback');
  assert.equal(cfgStr(cfg, 'message:font'), 'Amayui CN');
  assert.equal(cfgStr(cfg, 'message:savebmppath'), '', '空值保留为空串');
});

test('夹具 INI：解析出关键键（确定性 —— 取值断言不再读玩家数据，T-0034）', () => {
  const cfg = parseIni(FIXTURE_INI);
  assert.deepEqual([...cfg.sections].sort(), ['display', 'message', 'sound', 'system']);
  assert.equal(cfgInt(cfg, 'display:screenmode'), 1);
  assert.equal(cfgInt(cfg, 'sound:music'), 3);
  assert.equal(cfgInt(cfg, 'message:meswinalpha'), 6);
  assert.equal(cfgInt(cfg, 'message:messagespeed'), 7);
  assert.equal(cfgInt(cfg, 'message:messagefade'), 250);
  assert.equal(cfgStr(cfg, 'message:font'), 'Amayui CN');
  assert.equal(cfgInt(cfg, 'sound:voice'), 2);
  assert.equal(cfgInt(cfg, 'sound:se'), 1);
  // `[set] GameVersion` 不在 INI 里 ⇒ 取 emulator 缺省（= 被模拟的 amayui_107.exe 的 FileVersion）。
  assert.equal(cfgStr(cfg, 'set:gameversion', DEFAULT_GAME_VERSION), '1.07.0019');
  assert.equal(cfgStr(cfg, 'set:verregpos', ''), '', '没有 VerRegPos ⇒ 不会去查注册表 DisplayVersion');
});

/**
 * **真游戏 INI：只断言"结构与自洽"，不断言玩家的具体取值**（`tickets/T-0034`）。
 *
 * 玩家改一次设置（或真游戏自己重写）就会改这份文件 ⇒ 断言 `MessageSpeed=5` 这类**取值**必然红；
 * 但「引擎自己写的四节俱在」「键在 ⇒ 灌进引擎字段的值 = 读出来的同一个值」是**稳定事实**，可以断言。
 */
test('真实 SYS4REG.INI：结构 + 「配置→字段」自洽（不断言玩家取值，T-0034）', (t) => {
  const text = realIniText();
  if (text === null) {
    t.skip(`本机没有真游戏 ${INI}`);
    return;
  }
  const cfg = parseIni(text);
  // ① 结构：引擎自己写的那四节必须在（`[set]` 由引擎退出时按配置注册表写，本作安装没有）
  for (const s of ['display', 'sound', 'message', 'system']) {
    assert.ok(cfg.sections.includes(s), `真 INI 应有 [${s}] 节；实际 ${cfg.sections.join(',')}`);
  }
  // ② 引擎**总会写**的那批键必须在，且取值可解析（不断言等于多少）
  for (const k of [
    'display:screenmode',
    'sound:music',
    'sound:se',
    'sound:voice',
    'message:font',
    'message:messagespeed',
    'message:messagefade',
    'message:meswinalpha',
  ]) {
    assert.ok(cfg.values.has(k), `真 INI 应有 ${k}（引擎每次退出都会写）`);
  }
  assert.ok(cfgInt(cfg, 'message:messagespeed', -1) >= 0, 'MessageSpeed 应是可解析的整数');
  assert.ok(cfgStr(cfg, 'message:font').length > 0, '字体名不应为空');

  // ③ ★自洽：每个绑定键在 INI 里 ⇒ 灌进引擎字段的值必须 = **读出来的那个值**（经 map 变换）
  const values = new Map<number, number>([[96983, 1]]);
  applyConfigToEngine(cfg, values);
  for (const b of CONFIG_FIELD_BINDINGS) {
    const raw = cfgInt(cfg, b.key, NaN);
    if (Number.isNaN(raw)) continue; // 该键不在这份 INI 里 ⇒ 跳过（不做"必须存在"的要求）
    const want = b.map ? b.map(raw) : raw;
    assert.equal(values.get(b.field), want, `${b.key}=${raw} ⇒ _this[${b.field}] 应为 ${want}（不断言具体数值，只要求一致）`);
  }
  // ④ MessageSpeed 与 MesWinAlpha 必须落在**不同**字段（历史误绑会让后者顶掉前者）
  const ms = cfgInt(cfg, 'message:messagespeed', NaN);
  const alpha = cfgInt(cfg, 'message:meswinalpha', NaN);
  if (!Number.isNaN(ms)) assert.equal(values.get(21668), ms, 'message:MessageSpeed 必须落在 21668');
  assert.notEqual(21668, CONFIG_FIELD_BINDINGS.find((b) => b.key === 'message:meswinalpha')?.field ?? -1, '21668 不得绑给 MesWinAlpha');
  void alpha;
});

test('applyConfigToEngine：按绑定写入引擎字段（夹具 INI，含 display:ScreenMode 布尔化）', () => {
  const cfg = parseIni(FIXTURE_INI);
  const values = new Map<number, number>([[96983, 1]]); // 构造默认
  const applied = applyConfigToEngine(cfg, values);
  const get = (f: number): number | undefined => values.get(f);

  // ★`sound:Music` **不落任何字段**（T-0064）：174713 是 Music 模块的运行态「当前曲 id」，
  //   不是配置值 —— 绑在一起会让每次启动把"现在放的是哪首"覆写成配置数字（读档 BGM 还原会播错曲）。
  assert.equal(get(174713), undefined, '★sound:Music 不得写进 _this[174713]（那是运行态当前曲 id）');
  assert.equal(get(167990), 1, 'display:ScreenMode=1 → _this[167990]（0x2CE 读，布尔化）');
  // ★message:MesWinAlpha **不进任何字段**（引擎只由 0x131/0x141 按名直读直写配置）。
  //   21668×4 = 86672 = Font+1376 = message:MessageSpeed ⇒ 历史误绑会让 MesWinAlpha 顶掉 MessageSpeed。
  //   夹具刻意让两者不同（7 vs 6）⇒ 误绑会立刻显形。
  assert.equal(get(21668), 7, 'message:MessageSpeed=7 → _this[21668]（0x7F 读）；不得被 MesWinAlpha=6 覆盖');
  assert.equal(get(80106), 250, 'message:MessageFade=250 → _this[80106]（0x2EE 写）');
  assert.equal(get(20980), 1, 'sound:SE=1（下标 20980 = raw 字节 83920）');
  assert.equal(get(21293), 2, 'sound:Voice=2（下标 21293 = raw 字节 85172）');
  assert.equal(get(96983), 1, '无关字段不受影响（LOGO 开关）');
  assert.ok(applied.length >= 7, `应写入至少 7 个字段（实际 ${applied.length}；T-0064 起 sound:Music 不在其中）`);

  // 幂等：重复应用结果一致
  const applied2 = applyConfigToEngine(cfg, values);
  assert.deepEqual(applied2, applied);
  // 绑定表键名必须是「小写 section:key」
  for (const b of CONFIG_FIELD_BINDINGS) assert.match(b.key, /^[a-z]+:[a-z0-9_]+$/i);
});

/** 造一条 `op <local-int slot>` 指令。 */
function oneOp(opcode: number, slot: number): ScriptBinary {
  const H = 0x3c;
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: 1,
    args: [{ type: 0x9, raw: slot }],
    byteOffset: H,
    index: 0,
  };
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: H,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 12),
  };
}

/** 造一条 opcode 带多个操作数（按顺序给 slot；类型可用 `T` 前缀指定）。 */
function nOp(opcode: number, slots: number[], types?: number[]): ScriptBinary {
  const H = 0x3c;
  const args = slots.map((raw, i) => ({ type: types?.[i] ?? 0x9, raw }));
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: args.length,
    args,
    byteOffset: H,
    index: 0,
  };
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: H,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * args.length),
  };
}

test('配置类 opcode：0xC0 / 0x131 / 0x2CE 读到由 INI 填充的值（夹具 INI，不再是 0 / no-op）', async () => {
  const cfg = parseIni(FIXTURE_INI);
  const e = new Engine(new StubNative(() => {}));
  e.config = cfg;
  applyConfigToEngine(cfg, e.engineValues);
  const read = (slot: number): number => asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));

  // 0xC0 → **运行态音乐字段** `_this[174713]`（= `Music[259]` 当前曲 id）。
  //   ★它不是配置值：夹具 INI 的 `sound:Music=3` **不得**出现在这里（T-0064）。
  loadScriptIntoFrame(e.curScript(), oneOp(0xc0, 1), 'TEST.BIN');
  let t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented');
  assert.equal(read(1), 0, '未起播过任何 BGM ⇒ 当前曲 id = 0（不是夹具 INI 的 Music=3）');
  e.engineValues.set(174713, 0x12); // 假装 `play-bgm 12` 起播过
  loadScriptIntoFrame(e.curScript(), oneOp(0xc0, 1), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(1), 0x12, '★0xC0 读的是运行态当前曲 id');

  // 0x131 → **直接读配置** message:MesWinAlpha = 6（不读任何 Engine 字段）
  loadScriptIntoFrame(e.curScript(), oneOp(0x131, 2), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(2), 6);

  // 0x141 → 直写配置 message:MesWinAlpha（>0x10 时报错不写）。0x131 应读回刚写的值。
  //
  // ★顺序很重要：`loadScriptIntoFrame` 会**重建该帧的局部池**（= 引擎 `sub_40ED40` 载入时"建池 + enc_zero"，
  //   见 control.ts 的说明）⇒ 给脚本准备操作数必须在**载入之后**（真实调用方也只能经全局池/引擎字段传值）。
  const setLocal = (slot: number, v: number): void => void e.curScript().locals.int.set(slot, enc(e.key, v));
  loadScriptIntoFrame(e.curScript(), oneOp(0x141, 9), 'TEST.BIN');
  setLocal(9, 9);
  await stepOnce(e);
  loadScriptIntoFrame(e.curScript(), oneOp(0x131, 10), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(10), 9, '0x141 写配置后 0x131 应读回 9');
  loadScriptIntoFrame(e.curScript(), oneOp(0x141, 9), 'TEST.BIN');
  setLocal(9, 0x11);
  await stepOnce(e);
  loadScriptIntoFrame(e.curScript(), oneOp(0x131, 11), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(11), 9, 'op1 > 0x10 ⇒ 报错不写，配置保持原值');
  // 复位成夹具 INI 里的 6，避免影响后续断言
  loadScriptIntoFrame(e.curScript(), oneOp(0x141, 9), 'TEST.BIN');
  setLocal(9, 6);
  await stepOnce(e);

  // ★0x307 → 直写 `system:EffectSkipOnClick`（= 0x306 的**唯一写入端**；审计 P1 op-3-003）。
  //   修前：只登记了 getter ⇒ 脚本 `i307 1` 之后 `i306` 仍读回 INI 默认值（开机写入 INITREGINPUT.txt:6 丢失）。
  loadScriptIntoFrame(e.curScript(), oneOp(0x306, 12), 'TEST.BIN');
  await stepOnce(e);
  const before = read(12);
  loadScriptIntoFrame(e.curScript(), oneOp(0x307, 9), 'TEST.BIN');
  setLocal(9, before === 0 ? 1 : 0); // 写一个与当前不同的值，才能证明"真的写进去了"
  await stepOnce(e);
  loadScriptIntoFrame(e.curScript(), oneOp(0x306, 13), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(13), before === 0 ? 1 : 0, '0x307 写配置后 0x306 必须读回新值（同键同一份注册表）');

  // 0x2CE → _this[167990]!=0 → 1
  loadScriptIntoFrame(e.curScript(), oneOp(0x2ce, 3), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(3), 1);

  // 未加载配置时：0x2CE 退化为 0（不崩）
  const e2 = new Engine(new StubNative(() => {}));
  loadScriptIntoFrame(e2.curScript(), oneOp(0x2ce, 3), 'TEST.BIN');
  await stepOnce(e2);
  assert.equal(asI32(dec(e2.key, e2.curScript().locals.int.get(3) ?? 0)), 0);
});

/**
 * 设置界面（CONFIG2/CONFIG1）实测涉及的一批 opcode：分类 + 覆盖。
 * 分类依据（逐条读 handler 体，见 src/vm/handlers/ 各模块的注释）：
 *  - 消息窗/消息渲染/文本 子系统（0x7F/0x80/0x196/0x300/0x301）与 声音子系统（0xC5）→ 进 ENGINE_INTERNAL_OPS 默认插桩；
 *  - 其余「纯数值操作」（0x142 写 `_this[174812]`、0x12F 数组地址+循环）→ 进 ENGINE_INTERNAL_OPS，但用显式 handler；
 *  - 0x306 配置 getter、0x217 对象变换 → 各自 handler（NATIVE_OPS）。
 * 这样设置界面不再需要用户逐条点「作为桩函数跳过」。
 */
test('消息窗字段一族（0x80 setter / 0x7F getter / 0x300 / 0x301）：真写引擎字段并可读回', async () => {
  const e = new Engine(new StubNative(() => {}));
  const read = (slot: number): number => asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));

  // 0x80：默认窗（引擎 `_this[21631]` = `Font+1228`）；★建模在 `msgwin.defaultWin`（`tickets/T-0101` 的 D5 唯一真源）
  loadScriptIntoFrame(e.curScript(), nOp(0x80, [0x30], [0x3]), 'TEST.BIN');
  e.globals.int.set(0x30, enc(e.key, 9));
  await stepOnce(e);
  assert.equal(e.msgwin.defaultWin, 9, '0x80 应把 op1(=9) 写进默认窗（唯一真源 msgwin.defaultWin）');

  // 0x7F：op1 = _this[21668] = message:MessageSpeed（★不是消息窗 α）
  e.engineValues.set(21668, 8);
  loadScriptIntoFrame(e.curScript(), nOp(0x7f, [7]), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(7), 8, '0x7F 应把 _this[21668] 读到 op1');

  // 0x300：_this[v+122466] = op2 | (旧 & 0x10000)；_this[v+122476] = op3
  e.engineValues.set(3 + 122466, 0x10000); // 旧值只有 bit16
  loadScriptIntoFrame(
    e.curScript(),
    nOp(0x300, [0x31, 0x32, 0x33], [0x3, 0x3, 0x3]),
    'TEST.BIN',
  );
  e.globals.int.set(0x31, enc(e.key, 3));
  e.globals.int.set(0x32, enc(e.key, 0x5));
  e.globals.int.set(0x33, enc(e.key, 42));
  await stepOnce(e);
  assert.equal(e.engineValues.get(3 + 122466), 0x10005, 'op2 按位或，且保留旧值 bit16');
  assert.equal(e.engineValues.get(3 + 122476), 42, 'op3 写入同项的值槽');

  // 0x301：_this[v+122486] = 0
  e.engineValues.set(4 + 122486, 7);
  loadScriptIntoFrame(e.curScript(), nOp(0x301, [0x34], [0x3]), 'TEST.BIN');
  e.globals.int.set(0x34, enc(e.key, 4));
  await stepOnce(e);
  assert.equal(e.engineValues.get(4 + 122486), 0, '0x301 应把该项清零');
});

test('设置界面涉及的 opcode：分类正确 + 步进不抛错（implemented / native / engine-internal）', async () => {
  const cfg = parseIni(FIXTURE_INI);
  // [opcode, argc, 期望 handlerKind]
  // 分类规则：能完整建模（哪怕不产出画面）⇒ 'implemented'；经 NativeBridge 落宿主 ⇒ 'native'；
  //           引擎内部且 emulator 无事可做 ⇒ 'engine-internal'（纯 no-op）。
  const cases: [number, number, string][] = [
    [0x7f, 1, 'implemented'], // 消息速度读数（真实现：读 engineValues[21668] = message:MessageSpeed）
    [0x80, 1, 'implemented'], // 默认窗 setter（真实现：写唯一真源 msgwin.defaultWin = 引擎 Font+1228；T-0101 D5）
    [0x300, 3, 'implemented'], // 消息窗对象旗标/值（真实现：写 engineValues[122466+v]/[122476+v]）
    [0x301, 1, 'implemented'], // 清消息窗对象项（真实现：写 engineValues[122486+v]=0）
    [0x142, 1, 'implemented'], // 写引擎开关 _this[174812]（真实现：写 engineValues[174812]）
    [0x12f, 4, 'implemented'], // 三数组插入排序 + 重编码（真实现：读/写数组元素）
    // 2026 升级为真实现（ADV/消息窗状态机，见 src/vm/handlers/msgwin.ts）：
  [0x6e, 2, 'implemented'], // show-text：追加文本 + 分段节流
  [0x6f, 1, 'implemented'], // end-text-line
  [0x72, 1, 'implemented'], // wait-for-input：置等待推进门（bit31）
  [0xfa, 0, 'implemented'], // poll-msg-advance（★此前未注册 ⇒ 命中即硬报错）
  [0x1ca, 1, 'implemented'], // SetConfig message:ReadTextSkip
  [0x212, 2, 'implemented'], // 消息窗对象 +100
  [0x213, 3, 'implemented'], // 消息窗对象 +104/+108
  [0x25d, 3, 'implemented'], // 消息窗对象 +276/+280
  [0x196, 3, 'implemented'], // display-furigana：记录注音
  // 配置读取族（读配置键 → 写回脚本操作数；CONFIG1 路径上的静默错误源头）：
  [0xc5, 2, 'implemented'], // sound:Volume0..4 → op2
  [0xc7, 2, 'implemented'], // sound:Music/SE/Voice/Movie → op2
  [0x1b8, 2, 'implemented'], // message:AutoMessageTime0/1 → op2
  [0x2cc, 1, 'implemented'], // message:AdvanceMesOnWheel → op1
  [0x2e6, 2, 'implemented'], // message:AutoMessagePitch0/1 → op2
  [0x2ea, 1, 'implemented'], // message:AutoMessageOption → op1
  [0x194, 3, 'implemented'], // 字符串相等判定 → op1
      [0x306, 1, 'native'], // system:EffectSkipOnClick getter
    [0x217, 4, 'native'], // 对象变换 pivot → native.setDrawPivot
    [0x2ce, 1, 'native'], // display:ScreenMode getter（上一轮已实现）
    [0x20c, 0, 'implemented'], // 帧刷新（真实现：刷时钟 + native.frameTick）
    [0x1f4, 0, 'implemented'], // 帧计时（真实现：帧计数/时钟寄存器）
    [0x1f6, 0, 'implemented'], // 整批清绘制容器 → native.clearDrawContainer
    [0x1ff, 4, 'implemented'], // DrawItem 像素平移（+0x68 / +0x16C work 矩阵）→ native.setDrawTranslation
    [0x208, 3, 'implemented'], // 纹理尺寸 getter：写回 op2/op3 → native.getTextureSize
    [0x23b, 7, 'implemented'], // 按 CG 数字条画数值 → native.drawCgNumber
    [0x23c, 0, 'implemented'], // 帧毫秒时钟（timeGetTime → _this[92333]/[92334]）
    [0x2da, 8, 'implemented'], // CG 数字条记录登记（7 dword/条）
    [0x25b, 1, 'implemented'], // 消息态图像：_this[92381] = op1（真实现字段写入）
    // 纯 no-op 插桩（控制窗「真·忽略」栏）
    // ★2026-09：原先用 0x346/0x349（当时是 no-op），两条现已是 Live2D 真实现 ⇒ 换 0x324（3D 效果管理器销毁，仍是 engine-internal）。
    [0x324, 0, 'engine-internal'],
    [0x324, 4, 'engine-internal'],
  ];
  for (const [opcode, argc, kind] of cases) {
    const e = new Engine(new StubNative(() => {}));
    e.config = cfg;
    applyConfigToEngine(cfg, e.engineValues);
    const H = 0x3c;
    const instr: BinInstruction = {
      opcode,
      name: `i${opcode.toString(16)}`,
      argc,
      // 操作数一律用 local-int 槽（0x9）：值不重要，只验证 handler 能正常读取/跳过
      args: Array.from({ length: argc }, (_, i) => ({ type: 0x9, raw: 10 + i })),
      byteOffset: H,
      index: 0,
    };
    const sc: ScriptBinary = {
      signature: 'SYS4450 ',
      isVer5: false,
      headerLen: H,
      localVars: [0, 0, 0, 0, 0, 0],
      subHeaderLength: 0,
      tables: [
        { length: 0, offset: 1 },
        { length: 0, offset: 1 },
        { length: 0, offset: 1 },
      ],
      instructions: [instr],
      labelTargets: new Set<number>(),
      raw: new Uint8Array(H + 4 + 8 * argc),
    };
    loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
    const t = await stepOnce(e); // 不抛即通过（关键：不再需要人工点「跳过」）
    assert.equal(t.opcode, opcode, `0x${opcode.toString(16)} 应被 stepOnce 执行`);
    assert.equal(t.handlerKind, kind, `0x${opcode.toString(16)} 的 handlerKind`);
    assert.equal(e.curScript().ip, 1, `0x${opcode.toString(16)} 应正常推进 ip`);
  }
});

