/**
 * 「读操作数 → 写引擎字段」一族（`ENGINE_FIELD_STORE`）的测试。
 *
 * 这些 opcode 早前为"跑到 TITLE"统一当 no-op 插桩；现按引擎语义补齐字段写入（见 ops.ts 注释与 raw 依据）：
 *  - `0x21B` `sub_423C20`：`_this[166965] = (op1 != 0)` —— 与 getter `0x247`（`sub_430810`）成对；
 *  - `0x76`/`0x77` `sub_41F390`/`sub_41F3F0`：`_this[21664]`/`_this[21665] = BGR 组装(op1)`；
 *  - `0x78` `sub_41F450`：`_this[21667] = op1`；`0x8B` `sub_41FBF0`：`_this[21669] = op1`；
 *  - `0x1A4` `sub_41FE60`：`_this[21671]=op2`、`_this[21670]=op1`；
 *  - `0x252` `_this[92323]`、`0x261` `_this[80101]`、`0x2EE` `_this[80106]`、`0x2DB` `_this[71744]`、`0x24E` `_this[92340]`、`0x10F` `_this[122369]`；
 *  - `0xFE` `_this[517]`（SetKeyTotal）、`0x107` `_this[op1+551]=op2`、`0x10B` `_this[op2+1383]=op1`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { dec, asI32, enc } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_GLOBAL_INT = 0x3;

/** 造一条指令；`vals` 按操作数顺序给出「脚本侧的值」（会被 ENC 写进 global-int 槽）。 */
function mkScript(opcode: number, vals: number[]): { sc: ScriptBinary; slots: number[] } {
  const slots = vals.map((_, i) => 0x40 + i);
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: vals.length,
    args: slots.map((raw) => ({ type: T_GLOBAL_INT, raw })),
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
    raw: new Uint8Array(H + 4 + 8 * vals.length),
  };
  return { sc, slots };
}

/** 跑一条指令，返回引擎字段查表函数。 */
async function run(opcode: number, vals: number[]): Promise<{ get: (f: number) => number | undefined; e: Engine }> {
  const e = new Engine(new StubNative(() => {}));
  e.key = 0x12345678; // 非零 key，确保 ENC/DEC 真起作用
  const { sc, slots } = mkScript(opcode, vals);
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  slots.forEach((slot, i) => e.globals.int.set(slot, enc(e.key, vals[i]!)));
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', `0x${opcode.toString(16)} 应已实现`);
  assert.equal(e.curScript().ip, 1, `0x${opcode.toString(16)} 应推进 ip`);
  return { get: (f) => e.engineValues.get(f), e };
}

test('0x21B：`_this[166965] = (op1 != 0)` 且与 getter 0x247 成对（写 5 → 读 1；写 0 → 读 0）', async () => {
  const a = await run(0x21b, [5]);
  assert.equal(a.get(166965), 1, 'op1=5 → 布尔化 1');

  const b = await run(0x21b, [0]);
  assert.equal(b.get(166965), 0, 'op1=0 → 0');

  // 配套 getter 0x247 读同一字段（engineValues）
  const e = new Engine(new StubNative(() => {}));
  e.key = 0x12345678;
  e.engineValues.set(166965, 7);
  const { sc, slots } = mkScript(0x247, [9]); // 槽值无关紧要（0x247 只写 op1）
  slots.forEach((slot) => e.globals.int.set(slot, 0));
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  await stepOnce(e);
  const got = asI32(dec(e.key, e.globals.int.get(slots[0]!) ?? 0));
  assert.equal(got, 1, '0x247 应把 (_this[166965]!=0) 写回 op1');
});

test('0x76 / 0x77：按字节重排组装后写 `_this[21664]` / `_this[21665]`', async () => {
  // 引擎：`_this[21664] = BYTE2(v) + ((BYTE1(v) + (BYTE0(v) << 8)) << 8)`
  //   = v 的字节循环右移 8 位（0x00AABBCC → 0xCCBBAA）
  const a = await run(0x76, [0x00aabbcc]);
  assert.equal(a.get(21664), 0xccbbaa, '0x00AABBCC → 0xCCBBAA');
  const b = await run(0x77, [0x00112233]);
  assert.equal(b.get(21665), 0x332211, '0x00112233 → 0x332211');
});

test('0x78 / 0x8B / 0x1A4 / 0x252 / 0x261 / 0x2EE / 0x2DB / 0x24E / 0x10F：写入对应字段', async () => {
  const cases: [number, number[], number, number][] = [
    // [opcode, 操作数值, 期望字段, 期望值]
    [0x78, [0x11], 21667, 0x11],
    [0x8b, [0x22], 21669, 0x22],
    [0x1a4, [0x33, 0x44], 21670, 0x33], // op1
    [0x1a4, [0x33, 0x44], 21671, 0x44], // op2
    [0x252, [0x55], 92323, 0x55],
    [0x261, [0x66], 80101, 0x66],
    [0x2ee, [0x77], 80106, 0x77],
    [0x2db, [0x88], 71744, 0x88],
    [0x24e, [0x99], 92340, 0x99],
    [0x10f, [0xaa], 122369, 0xaa],
  ];
  for (const [opcode, vals, field, want] of cases) {
    const r = await run(opcode, vals);
    assert.equal(r.get(field), want, `0x${opcode.toString(16)} → _this[${field}]`);
  }
});

test('0xFE / 0x107 / 0x10B：按键绑定表（含随操作数变化的字段号与 ≤0x1F 约束）', async () => {
  const a = await run(0xfe, [3]);
  assert.equal(a.get(517), 3, 'SetKeyTotal：_this[517] = op1');

  const b = await run(0x107, [2, 0x1234]); // op1=键位 2 → _this[2+551] = op2
  assert.equal(b.get(553), 0x1234, '_this[op1+551] = op2');

  const c = await run(0x10b, [1, 5]); // op1=值 1 → _this[op2+1383] = op1
  assert.equal(c.get(1388), 1, '_this[op2+1383] = op1');

  // 越界：键位 > 0x1F 时引擎不写（emulator 同样不写）
  const d = await run(0x107, [0x20, 0x55]);
  assert.equal(d.get(0x20 + 551), undefined, '键位越界应不写');
});
