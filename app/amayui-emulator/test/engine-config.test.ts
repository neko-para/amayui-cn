/**
 * 引擎配置（SYS4REG.INI）加载 + 配置类 opcode 的取值测试。
 *
 * 事实来源：raw 23649-23745（启动装载后灌引擎字段）、sub_4900F0（路径）/ sub_4963E0（解析）/
 *   sub_4957F0（按 "section:key" 取整型）、0xC0 `sub_42E510`（`_this[174713]`）/ 0x131 `sub_42F7D0`
 *   （直接读 `message:MesWinAlpha`）/ 0x2CE `sub_430A20`（`_this[167990]!=0` ← `display:ScreenMode`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseIni, cfgInt, cfgStr, applyConfigToEngine, CONFIG_FIELD_BINDINGS } from '../src/engineConfig.js';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { dec, asI32, enc } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const INI = path.join(ROOT, 'app', 'amayui-emulator', 'SYS4REG.INI');

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

test('真实 SYS4REG.INI：解析出 4 个分节与关键键', () => {
  assert.ok(fs.existsSync(INI), `应存在 ${INI}`);
  const cfg = parseIni(fs.readFileSync(INI, 'utf8'));
  assert.deepEqual(cfg.sections.sort(), ['display', 'message', 'sound', 'system']);
  // 与文件内容逐项核对（见该 INI）
  assert.equal(cfgInt(cfg, 'display:screenmode'), 1);
  assert.equal(cfgInt(cfg, 'sound:music'), 2);
  assert.equal(cfgInt(cfg, 'message:meswinalpha'), 8);
  assert.equal(cfgInt(cfg, 'message:messagespeed'), 5);
  assert.equal(cfgInt(cfg, 'message:messagefade'), 250);
  assert.equal(cfgStr(cfg, 'message:font'), 'Amayui CN');
  assert.equal(cfgInt(cfg, 'sound:voice'), 1);
  assert.equal(cfgInt(cfg, 'sound:se'), 1);
});

test('applyConfigToEngine：按绑定写入引擎字段（含 display:ScreenMode 布尔化）', () => {
  const cfg = parseIni(fs.readFileSync(INI, 'utf8'));
  const values = new Map<number, number>([[96983, 1]]); // 构造默认
  const applied = applyConfigToEngine(cfg, values);
  const get = (f: number): number | undefined => values.get(f);

  assert.equal(get(174713), 2, 'sound:Music=2 → _this[174713]（0xC0 读）');
  assert.equal(get(167990), 1, 'display:ScreenMode=1 → _this[167990]（0x2CE 读，布尔化）');
  assert.equal(get(21668), 8, 'message:MesWinAlpha=8 → _this[21668]（0x7F 读）');
  assert.equal(get(86672), 5, 'message:MessageSpeed=5');
  assert.equal(get(320424), 250, 'message:MessageFade=250');
  assert.equal(get(83920), 1, 'sound:SE=1');
  assert.equal(get(85172), 1, 'sound:Voice=1');
  assert.equal(get(96983), 1, '无关字段不受影响（LOGO 开关）');
  assert.ok(applied.length >= 8, `应写入至少 8 个字段（实际 ${applied.length}）`);

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

test('配置类 opcode：0xC0 / 0x131 / 0x2CE 读到由 INI 填充的值（不再是 0 / no-op）', async () => {
  const cfg = parseIni(fs.readFileSync(INI, 'utf8'));
  const e = new Engine(new StubNative(() => {}));
  e.config = cfg;
  applyConfigToEngine(cfg, e.engineValues);
  const read = (slot: number): number => asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));

  // 0xC0 → _this[174713] = sound:Music = 2（注册在 NATIVE_OPS 表，故 kind='native'；语义已由本 handler 实现）
  loadScriptIntoFrame(e.curScript(), oneOp(0xc0, 1), 'TEST.BIN');
  let t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented');
  assert.equal(read(1), 2);

  // 0x131 → 直接读配置 message:MesWinAlpha = 8
  loadScriptIntoFrame(e.curScript(), oneOp(0x131, 2), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(2), 8);

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
 * 分类依据（逐条读 handler 体，见 ops.ts 的 op_msg_ui_internal / op_set_input_field / op_array_addr_op 注释）：
 *  - 消息窗/消息渲染/文本 子系统（0x7F/0x80/0x196/0x300/0x301）与 声音子系统（0xC5）→ 进 ENGINE_INTERNAL_OPS 默认插桩；
 *  - 其余「纯数值操作」（0x142 写 `_this[174812]`、0x12F 数组地址+循环）→ 进 ENGINE_INTERNAL_OPS，但用显式 handler；
 *  - 0x306 配置 getter、0x217 对象变换 → 各自 handler（NATIVE_OPS）。
 * 这样设置界面不再需要用户逐条点「作为桩函数跳过」。
 */
test('消息窗字段一族（0x80 setter / 0x7F getter / 0x300 / 0x301）：真写引擎字段并可读回', async () => {
  const e = new Engine(new StubNative(() => {}));
  const read = (slot: number): number => asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));

  // 0x80：_this[21631] = op1（窗格/部件索引）
  loadScriptIntoFrame(e.curScript(), nOp(0x80, [0x30], [0x3]), 'TEST.BIN');
  e.globals.int.set(0x30, enc(e.key, 9));
  await stepOnce(e);
  assert.equal(e.engineValues.get(21631), 9, '0x80 应把 op1(=9) 写进消息窗部件索引');

  // 0x7F：op1 = _this[21668]（消息窗 α，由 message:MesWinAlpha 填充）
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

test('设置界面涉及的 opcode：分类正确 + 步进不抛错（真实现 / 专门处理 / 纯 no-op 三档）', async () => {
  const cfg = parseIni(fs.readFileSync(INI, 'utf8'));
  // [opcode, argc, 期望 handlerKind, 期望 noop(纯 no-op 插桩)]
  const cases: [number, number, string, boolean][] = [
    [0x7f, 1, 'implemented', false], // 消息窗 α 读数（真实现：读 engineValues[21668]）
    [0x80, 1, 'implemented', false], // 消息窗部件索引 setter（真实现：写 engineValues[21631]）
    [0x300, 3, 'implemented', false], // 消息窗对象旗标/值（真实现：写 engineValues[122466+v]/[122476+v]）
    [0x301, 1, 'implemented', false], // 清消息窗对象项（真实现：写 engineValues[122486+v]=0）
    [0x142, 1, 'engine-internal', false], // 写引擎开关 _this[174812]（专门 handler）
    [0x12f, 4, 'engine-internal', false], // 三数组插入排序 + 重编码（专门 handler）
    [0xc5, 2, 'engine-internal', false], // 声音音量显示（专门 handler，无声音子系统）
    [0x196, 3, 'engine-internal', false], // display-furigana（专门 handler，文本渲染未建模）
    [0x306, 1, 'native', false], // system:EffectSkipOnClick getter
    [0x217, 4, 'native', false], // 对象变换 → native.setObjectTransform
    [0x2ce, 1, 'native', false], // display:ScreenMode getter（上一轮已实现）
    // 真·纯 no-op 插桩（控制窗显示在「真·忽略」栏）
    [0x20c, 0, 'engine-internal', true],
    [0x23d, 1, 'engine-internal', true],
  ];
  for (const [opcode, argc, kind, noop] of cases) {
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
    assert.equal(t.noop, noop, `0x${opcode.toString(16)} 的 noop 标志（true=纯 no-op 插桩 → 控制窗「真·忽略」栏）`);
    assert.equal(e.curScript().ip, 1, `0x${opcode.toString(16)} 应正常推进 ip`);
  }
});
