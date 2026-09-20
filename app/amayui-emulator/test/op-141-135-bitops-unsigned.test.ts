/**
 * `0x141`（SetMesWinAlpha）与 `0x135`/`0x136`/`0x13F`（位指令族）的**操作数越界口径**：
 * 与体同形 = **无符号比较** + **打错误串后继续**（不是抛异常）。`tickets/T-0097` ②。
 *
 * ## 体（逐行原文）
 * `0x141` `sub_4228C0` raw 30999-31017：
 * ```c
 * *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 3;      // arity ⇒ argc 1
 * if ( (unsigned int)sub_41BF50((_DWORD *)_this, 1) > 0x10 ) {               // ★unsigned
 *     sub_408050((char *)(_this + 8), 1024, aGetmeswina);                    //   "GetMesWinAlpha…" 错误串
 *     sub_4034D0((void **)_this, (const char *)(_this + 8));                 //   ★打印（返回 void）
 * } else { … SetConfig("message:MesWinAlpha", sub_41BF50(_this, 1)) … }       //   同一个操作数再读一次
 * ```
 * `0x135` `sub_42F8B0` raw 39401-39421（`0x136`/`0x13F` 是同一形状：raw 39423-39443 / 39548-39568）：
 * ```c
 * unsigned int v2 = sub_41BF50((_DWORD *)_this, 2);                          // ★unsigned：位号 = op2
 * v3 = v2;
 * if ( v2 > 0x1F ) { sub_408050(…, aSetbit); sub_4034D0(…); }                // ★打印，不抛
 * else { v4 = sub_41BF50(_this, 1); sub_42B4B0(_this, 1, (1 << v3) | v4); }
 * ```
 * ⇒ 两条口径：① 比较是 **unsigned**（`-1` = `0xFFFFFFFF` 也越界）；② 越界分支**不写 op1**、**不抛异常**，
 *    只打印错误串后继续 —— 与 `0x107`/`0x10B`/`0xFE` 那族不同（那三条体里是
 *    `_CxxThrowException(…, Command_ShowMessage)`，真的抛；见 raw 30431/30451/30626）。
 *
 * ## 修前（被本文件钉住的两种错法）
 * - 有符号 `v > 0x10` / `bit > 0x1f` ⇒ `-1` 被当成"没越界"**照写**（`0x141` 写坏配置；位指令 `1 << -1` = bit31）；
 * - 位指令越界抛 JS `Error` ⇒ 真机是"打印一行然后继续"，emulator 变成硬停（可观测不等价）。
 * 两条语料都是 **0 处**（`i141`/`i135`/`i136`/`i13f` 全库无使用）⇒ 不可见，但口径必须与体一致。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { dec, enc } from '../src/vm/bits.js';
import { cfgInt } from '../src/engineConfig.js';
import { CFG } from '../src/configRegistry.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_GLOBAL_INT = 0x3;

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

/**
 * 跑一条合成指令。`slots` = 按操作数序号给出槽值与**脚本侧的值**（写进 global-int 池，过 ENC）。
 * 返回引擎、stub 收到过的日志、以及"读回第 n 个操作数"的函数。
 */
async function run(
  opcode: number,
  args: { type: number; raw: number; value?: number }[],
): Promise<{ e: Engine; logs: string[]; read: (slot: number) => number }> {
  const logs: string[] = [];
  const e = new Engine(new StubNative((m) => logs.push(m)));
  e.key = 0x12345678; // 非零 key：操作数读写真的过 ENC/DEC
  // 先放一份**空**注册表：这样才能区分"没写这个键"与"写了默认值"（引擎启动时注册表总是存在）
  e.config = { values: new Map(), sections: [], order: new Map() };
  loadScriptIntoFrame(
    e.curScript(),
    script(
      opcode,
      args.map((a) => ({ type: a.type, raw: a.raw })),
    ),
    'TEST.BIN',
  );
  for (const a of args) if (a.type === T_GLOBAL_INT && a.value !== undefined) e.globals.int.set(a.raw, enc(e.key, a.value));
  const t = await stepOnce(e);
  assert.equal(t.opcode, opcode);
  assert.notEqual(t.handlerKind, 'unimplemented', `0x${opcode.toString(16)} 必须已实现`);
  return { e, logs, read: (slot) => dec(e.key, e.globals.int.get(slot) ?? 0) | 0 };
}

// ---------------------------------------------------------------------------
// 0x141 —— SetConfig("message:MesWinAlpha")，unsigned 越界门
// ---------------------------------------------------------------------------

test('0x141：unsigned 越界门 —— `0x10` 可写、`0x11` 与 **`-1`**（= 0xFFFFFFFF）都不写', async () => {
  const key = CFG.messageMesWinAlpha.toLowerCase();
  // (a) 合法上界：0x10
  const ok = await run(0x141, [{ type: T_GLOBAL_INT, raw: 0x100, value: 0x10 }]);
  assert.equal(cfgInt(ok.e.config!, CFG.messageMesWinAlpha, -1), 0x10, '0x10 ≤ 0x10 ⇒ 写进配置');

  // (b) 越界：0x11（有符号/无符号都越界）
  const over = await run(0x141, [{ type: T_GLOBAL_INT, raw: 0x100, value: 0x11 }]);
  assert.equal(over.e.config!.values.has(key), false, '0x11 > 0x10 ⇒ 错误串分支：**一个键都不写**');
  assert.match(over.logs.join('\n'), /0x141/, '越界要走引擎的"错误串"分支（emulator 表现为日志）');

  // (c) ★回归：`-1` 只有按 **unsigned** 解读才越界。旧实现有符号 `v > 0x10` ⇒ 这里会写成 -1。
  const neg = await run(0x141, [{ type: T_GLOBAL_INT, raw: 0x100, value: -1 }]);
  assert.equal(
    neg.e.config!.values.has(key),
    false,
    '`-1`（无符号 0xFFFFFFFF）> 0x10 ⇒ 必须走错误串分支、不写配置（体是 unsigned 比较）',
  );
  assert.match(neg.logs.join('\n'), /0x141/, '负值越界也要走错误串分支');
});

// ---------------------------------------------------------------------------
// 0x135 / 0x136 / 0x13F —— 位指令族，unsigned 位号门 + 错误串（不抛）
// ---------------------------------------------------------------------------

test('0x135 SetBit：位号 ∈ [0,31] 置位（`op1 |= 1 << op2`）', async () => {
  const r = await run(0x135, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 0b10000 }, // op1 = 值（bit4）
    { type: T_GLOBAL_INT, raw: 0x101, value: 3 }, // op2 = 位号
  ]);
  assert.equal(r.read(0x100), 0b11000, 'bit3 置位（0b10000 | 0b1000）');
  // 位号 31：`1 << 31` 在 i32 口径下是负数（引擎 `(1 << v3) | v4` 同样按 int 位模式）
  const r31 = await run(0x135, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 0 },
    { type: T_GLOBAL_INT, raw: 0x101, value: 31 },
  ]);
  assert.equal(r31.read(0x100), -2147483648, 'bit31 置位 = 0x80000000（i32 读回为 −2^31）');
});

test('0x135 SetBit：位号越界（0x20 / **-1**）⇒ 打错误串、**不写 op1**、**不抛异常**', async () => {
  for (const bit of [0x20, -1]) {
    const r = await run(0x135, [
      { type: T_GLOBAL_INT, raw: 0x100, value: 0x55 }, // op1 = 哨兵
      { type: T_GLOBAL_INT, raw: 0x101, value: bit },
    ]);
    assert.equal(r.read(0x100), 0x55, `位号 ${bit} 越界 ⇒ op1 必须原样不动（体：错误串分支不写 op1）`);
    assert.match(r.logs.join('\n'), /0x135\(SETBIT\)/, `位号 ${bit} 越界必须走引擎的错误串分支`);
  }
  // ★这一条是"不抛异常"的正面判据：旧实现 `throw new Error(...)` 会让上面两次 run 直接炸掉
  //   （体里 `sub_4034D0` 只打印、返回 void ⇒ 真机继续下一条指令）。
});

test('0x136 RemBit：清位 + 同一越界门（0x20/**-1** 不写 op1）', async () => {
  const ok = await run(0x136, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 0b1111 },
    { type: T_GLOBAL_INT, raw: 0x101, value: 1 },
  ]);
  assert.equal(ok.read(0x100), 0b1101, 'bit1 清零（`op1 &= ~(1 << op2)`，raw 39441）');

  const bad = await run(0x136, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 0x55 },
    { type: T_GLOBAL_INT, raw: 0x101, value: -1 },
  ]);
  assert.equal(bad.read(0x100), 0x55, '越界 ⇒ 不写 op1');
  assert.match(bad.logs.join('\n'), /0x136\(REMBIT\)/);
});

test('0x13F GetBit：`op1 = (op2 >> op3) & 1`（位号是 **op3**）+ 同一越界门', async () => {
  const ok = await run(0x13f, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 0 }, // op1 = 写目标（bool）
    { type: T_GLOBAL_INT, raw: 0x101, value: 0b1010 }, // op2 = 值
    { type: T_GLOBAL_INT, raw: 0x102, value: 3 }, // op3 = 位号
  ]);
  assert.equal(ok.read(0x100), 1, 'bit3 为 1 ⇒ op1 = 1');

  const zero = await run(0x13f, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 9 },
    { type: T_GLOBAL_INT, raw: 0x101, value: 0b1010 },
    { type: T_GLOBAL_INT, raw: 0x102, value: 0 },
  ]);
  assert.equal(zero.read(0x100), 0, 'bit0 为 0 ⇒ op1 = 0（不是保留旧值 9）');

  const bad = await run(0x13f, [
    { type: T_GLOBAL_INT, raw: 0x100, value: 9 },
    { type: T_GLOBAL_INT, raw: 0x101, value: 0b1010 },
    { type: T_GLOBAL_INT, raw: 0x102, value: -1 },
  ]);
  assert.equal(bad.read(0x100), 9, '位号越界 ⇒ op1 原样不动');
  assert.match(bad.logs.join('\n'), /0x13F\(GETBIT\)/);
});
