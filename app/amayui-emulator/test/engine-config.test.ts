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
  // ★message:MesWinAlpha **不进任何字段**（引擎只由 0x131/0x141 按名直读直写配置）。
  //   21668×4 = 86672 = Font+1376 = message:MessageSpeed ⇒ 历史误绑会让 MesWinAlpha=8 顶掉 MessageSpeed=5。
  assert.equal(get(21668), 5, 'message:MessageSpeed=5 → _this[21668]（0x7F 读）；不得被 MesWinAlpha 覆盖');
  assert.equal(get(80106), 250, 'message:MessageFade=250 → _this[80106]（0x2EE 写）');
  assert.equal(get(20980), 1, 'sound:SE=1（下标 20980 = raw 字节 83920）');
  assert.equal(get(21293), 1, 'sound:Voice=1（下标 21293 = raw 字节 85172）');
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

  // 0x131 → **直接读配置** message:MesWinAlpha = 8（不读任何 Engine 字段）
  loadScriptIntoFrame(e.curScript(), oneOp(0x131, 2), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(2), 8);

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
  // 复位成 INI 里的 8，避免影响后续断言
  loadScriptIntoFrame(e.curScript(), oneOp(0x141, 9), 'TEST.BIN');
  setLocal(9, 8);
  await stepOnce(e);

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

  // 0x80：_this[21631] = op1（窗格/部件索引）
  loadScriptIntoFrame(e.curScript(), nOp(0x80, [0x30], [0x3]), 'TEST.BIN');
  e.globals.int.set(0x30, enc(e.key, 9));
  await stepOnce(e);
  assert.equal(e.engineValues.get(21631), 9, '0x80 应把 op1(=9) 写进消息窗部件索引');

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
  const cfg = parseIni(fs.readFileSync(INI, 'utf8'));
  // [opcode, argc, 期望 handlerKind]
  // 分类规则：能完整建模（哪怕不产出画面）⇒ 'implemented'；经 NativeBridge 落宿主 ⇒ 'native'；
  //           引擎内部且 emulator 无事可做 ⇒ 'engine-internal'（纯 no-op）。
  const cases: [number, number, string][] = [
    [0x7f, 1, 'implemented'], // 消息速度读数（真实现：读 engineValues[21668] = message:MessageSpeed）
    [0x80, 1, 'implemented'], // 消息窗部件索引 setter（真实现：写 engineValues[21631]）
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
    [0x346, 0, 'engine-internal'],
    [0x349, 4, 'engine-internal'],
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
