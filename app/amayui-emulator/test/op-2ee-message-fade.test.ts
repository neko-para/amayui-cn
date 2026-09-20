/**
 * `0x2EE <ms>` = **消息淡入时长**：`_this[80106]` **且** `SetConfig("message:MessageFade")`
 * —— 双写（`tickets/T-0097` ①；审计 `op-4-11` cross-source-mismatch）。
 *
 * ## 引擎体（`sub_426650` raw 33590-33603，逐行原文）
 * ```c
 * _this[30 * _this[95776] + 95805] = 3;      // arity 槽 ⇒ argc 1
 * v2 = sub_41BF50(_this, 1);                 // op1
 * v3 = _this[174405];                        // 配置对象（`_this + 697620`）
 * _this[80106] = v2;                         // ★字段：Font+235128（= 320424 字节）
 * v4 = sub_41BF50(_this, 1);                 // ★同一个操作数（两条 `push 1`：.lst 61030/61034）
 * return (*(…)(v3 + 12))(_this + 174405, aMessageMessage_0, v4);   // SetConfig("message:MessageFade", op1)
 * ```
 * `aMessageMessage_0` = `"message:MessageFade"`（raw 4380）；`+12` = 配置对象的 `SetConfig` 虚槽。
 *
 * ## 为什么这条守卫盯的是「**写后读回**」
 * 修前 `0x2EE` 只在 `ENGINE_FIELD_STORE` 里写字段（`[0x2ee, { map: { 1: ENGINE_FIELD.messageFade } }]`）：
 * 值进了 `engineValues`，**没进配置注册表** ⇒ 「重启后回默认」（`CONFIG_FIELD_BINDINGS` 只在启动时把
 * INI 值灌进字段，字段本身不落盘；读侧 `0x2ED` `sub_431230` 走的是 `GetConfig`）。
 * ⇒ 本文件断言：**同一次执行**之后，从**同一份注册表**读回来必须是刚写进去的值；
 * 若有人把它退回"只写字段"，第 2 条断言立刻红。
 *
 * ★读侧的同族对照：`0x2ED`（`sub_431230` raw 40401-40409）= `op1 = GetConfig("message:MessageFade")`，
 *   调度表 `.text:0041701E` 把它装在 `0x2ED` 槽。emulator 侧 `0x2ED` 目前**未注册**（`docs-new` 的
 *   opcode 表记它"仅映射"）⇒ 这里不通过它读回，改为直接读注册表（`cfgInt`）——那正是 `0x2ED` 的取值处。
 *
 * 语料实例（全库唯一一处）：`src/CHECKCONFIG.txt:43` `i2ee fa`（= 250 ms，紧跟在 `mov (global-int 3f36) 0`
 * 之后、`exit` 之前）⇒ 这条指令不是"纸面 opcode"：修前它只写字段、设置界面的"淡入时长"**不落盘**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { enc } from '../src/vm/bits.js';
import { cfgInt, CONFIG_FIELD_BINDINGS, type EngineConfig } from '../src/engineConfig.js';
import { CFG } from '../src/configRegistry.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_GLOBAL_INT = 0x3;

/** 造一条 `0x2EE`（一个 global-int 操作数）。 */
function script(opcode: number, args: { type: number; raw: number }[]): ScriptBinary {
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: args.length,
    args: args.map((a) => ({ type: a.type, raw: a.raw })),
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

/** 跑一次 `i2ee <v>`（op1 = global-int 0x100），返回引擎 + 落盘通知里看到的那份配置。 */
async function run2ee(v: number): Promise<{ e: Engine; notified: EngineConfig | null; field: number }> {
  const e = new Engine(new StubNative(() => {}));
  // 非零 key：确保 ENC/DEC 真起作用（操作数走的是真路径，不是"key=0 恰好抵消"）
  e.key = 0x12345678;
  let notified: EngineConfig | null = null;
  e.onConfigChanged = (cfg) => {
    notified = cfg;
  };
  loadScriptIntoFrame(e.curScript(), script(0x2ee, [{ type: T_GLOBAL_INT, raw: 0x100 }]), 'TEST.BIN');
  e.globals.int.set(0x100, enc(e.key, v));
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0x2ee);
  assert.notEqual(t.handlerKind, 'unimplemented', '0x2EE 必须已实现（不是未实现/桩）');
  assert.equal(e.curScript().ip, 1, 'ip 正常推进（本指令不改控制流）');
  return { e, notified, field: ENGINE_FIELD.messageFade };
}

test('0x2EE：字段（_this[80106]）**与**配置注册表 `message:MessageFade` 双写（★写后读回）', async () => {
  for (const v of [37, 0, 250]) {
    const { e, field } = await run2ee(v);
    assert.equal(e.engineValues.get(field), v, `i2ee ${v} 应写入字段 ${field}（_this[80106]）`);
    // ★写后读回：与读侧（0x2ED / 启动绑定）同一份注册表，缺省给 -1 以便区分"没写"与"写了 0"
    assert.equal(
      cfgInt(e.config!, CFG.messageMessageFade, -1),
      v,
      `i2ee ${v} 必须同时写进配置注册表 ${CFG.messageMessageFade}（否则重启后回默认）`,
    );
  }
});

test('0x2EE：注册表变更要通知宿主落盘（`Engine.onConfigChanged`，T-0097 ① 的"重启后回默认"那一半）', async () => {
  const { notified } = await run2ee(123);
  assert.ok(notified, '`setConfigValue` 必须通知宿主（Electron 走 IPC 写回 SYS4REG.INI）');
  assert.equal(cfgInt(notified!, CFG.messageMessageFade, -1), 123, '通知出去的那份配置里要有新值');
});

test('0x2EE ↔ 启动绑定：注册表键与"启动时灌进哪个字段"指的是**同一个** `_this[80106]`', () => {
  const b = CONFIG_FIELD_BINDINGS.find((x) => x.key === CFG.messageMessageFade);
  assert.ok(b, `CONFIG_FIELD_BINDINGS 必须有 ${CFG.messageMessageFade} 的绑定（启动时把它灌进字段）`);
  assert.equal(b!.field, ENGINE_FIELD.messageFade, '启动绑定的字段必须与 0x2EE 写的是同一格（80106）');
});
