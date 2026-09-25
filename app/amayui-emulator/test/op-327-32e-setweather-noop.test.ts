/** @tier T0 @kind core @subsystem ops */

/**
 * **SETWEATHER 族不再硬停**（`tickets/T-0093`，2026-09 轮 6）。
 *
 * 背景：`SETWEATHER` 是**被剧情脚本调用**的（`call-script 47 // SETWEATHER`：`SC0500:26212`、
 * `SC0070:29136`、`SC2060:28374,30048`、`SC4000:4359`、`SC4160:5752`、`SC5450:3573`、`SC5530:4181`、
 * `$1$SC4330:4993` …），而 `0x327`/`0x328`/`0x329`/`0x32C`/`0x32E` 五条此前**不在任何注册表里**
 * ⇒ 每次走到 SETWEATHER 就抛 `NotImplementedOp`（整段剧情走不完）。
 *
 * 本轮按 `stubs.ts` 的「有据 no-op」口径登记为 `engine-internal`：五条**全部落在 emulator 没有的
 * 3D 子系统**（Effect3D 管理器 / 3D 网格 / mesh 装载 / 3D 相机 / 3D 图元），逐条机械扫描确认
 * **体内没有任何操作数写原语**（`sub_42B4B0`/`sub_42BA00`/`sub_418B90`/`sub_418CC0` 零命中）、
 * 不改 ip/cur（只写长度槽）⇒ 跳过与"读了再丢"对脚本可观测行为一致。
 *
 * 本文件钉三件事：① 五条都已注册且分类为 `engine-internal`；② 带**非平凡实参**跑一步**不抛错**、
 * 也不改变 `ip`（= 不再硬停，且控制流不被扰动）；③ 缺口台账里这五条的处置是 `engine-internal`
 * 且带票（防止有人把它们降回 `deferred`/`unimplemented` 而让硬停悄悄回来）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { scriptDerived } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const H = 0x3c;
const T_IMM = 0x0;

/** SETWEATHER 族的五条 handler 地址（体行号见 stubs.ts 的块注释）。 */
const FAMILY: { op: number; argc: number; handler: string }[] = [
  { op: 0x327, argc: 1, handler: 'sub_426E70' },
  { op: 0x328, argc: 3, handler: 'sub_432300' },
  { op: 0x329, argc: 2, handler: 'sub_426EB0' },
  { op: 0x32c, argc: 6, handler: 'sub_426FC0' },
  { op: 0x32e, argc: 11, handler: 'sub_427110' },
];

function script(opcode: number, argc: number): ScriptBinary {
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc,
    // 全部给"非平凡"立即数（|v| > 1）—— 与语料形态同类，确保走的是真实派发而不是空参特例
    args: Array.from({ length: argc }, (_, i) => ({ type: T_IMM, raw: 0x64 + i })),
    byteOffset: H,
    index: 0,
  };
  return {
    ...scriptDerived(),
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
}

// ★2026-09-23：SETWEATHER 族的注册表棘轮已并入 `test/registry-classification.test.ts`（`tickets/T-0129`）；
//   本文件只保留**行为**用例（下面两条）。

test('★SETWEATHER 族 5 条：带非平凡实参跑一步不抛错，且 ip 照常前进 1 条', async () => {
  for (const { op, argc, handler } of FAMILY) {
    const e = new Engine(new StubNative(() => {}));
    loadScriptIntoFrame(e.curScript(), script(op, argc), 'TEST.BIN');
    const before = e.curScript().ip;
    // 不抛错 = 不再硬停（此前 `NotImplementedOp`）
    const t = await stepOnce(e);
    assert.equal(t.handlerKind, 'engine-internal', `0x${op.toString(16)}（${handler}）应记为 engine-internal`);
    assert.equal(
      e.curScript().ip,
      before + 1,
      `0x${op.toString(16)} 不得改 ip/cur（跳过与"读了再丢"可观测等价）`,
    );
  }
});

test('★缺口台账：这五条是 engine-internal/partial 且带票（不许静默退回硬停）', () => {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/opcode-gaps.json'), 'utf8'));
  for (const { op } of FAMILY) {
    const e = g.entries.find((x: { opcode: number }) => x.opcode === op);
    assert.ok(e, `0x${op.toString(16)} 必须在 analysis/opcode-gaps.json 里`);
    // ★2026-09-24（`tickets/T-0149`）：台账新增 `partial`（= 有据 no-op 这一半仍成立，但相对引擎体仍缺
    //   某条能力，逐条见其 `missing[]`）。本族的处置允许是这两者之一；**下面两条（带票 + note 写清
    //   "为什么不建模"）一个字都没放宽**，那才是这张测试要守的东西。
    assert.ok(
      ['engine-internal', 'partial'].includes(e.disposition),
      `0x${op.toString(16)} 的处置必须是 engine-internal 或 partial（实际 ${e.disposition}）`,
    );
    assert.ok(e.ticket, `0x${op.toString(16)} 必须带票（改 disposition 前先看票）`);
    assert.ok(/no-op/.test(e.note) || /为什么/.test(e.note), `0x${op.toString(16)} 的 note 必须写清"为什么不建模"`);
  }
});
