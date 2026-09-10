/**
 * 同族「鼠标输入读取」三个 opcode 的实现测试：`0x108`（按钮）/ `0x109`（位置）/ `0x10D`（滚轮增量·一次性消费）。
 *
 * - `0x108`(sub_42EDC0)：`op1 = 鼠标按钮值`（bit0=左/bit1=右）
 * - `0x109`(sub_42EE10)：`op1=X, op2=Y`（虚拟坐标；出窗=-100000）
 * - `0x10D`(sub_42EF50，本文件重点)：`v2 = _this[1949]`（累加器 byte 0x1E74）→ **立即清零** → `writeIntOperand(op1, v2)`
 *
 * 0x10D 语义 = 「取走自上次读取以来的滚轮累计，并清零」：
 *  - 值 = 引擎单位（一格 ±120；**上滚正 / 下滚负**，与脚本 `gr (local 403) 0` 的翻页方向实证一致）；
 *  - 读一次就归零：脚本主循环靠 `jcc (local 403) <翻页label>` 判"本帧有没有滚"；
 *  - `0x108`/`0x109` 是**非消费式**读取，不应影响滚轮累加器。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { dec, asI32 } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const HEADER_LEN = 0x3c;
/** operand arg type 0x9 = local-int（operand.ts 未导出该常量，此处按类型值直接构造）。 */
const T_LOCAL_INT = 0x9;

/** 造一个最小 v4 脚本：一条指令 `i10d <local-int slot>`（每条指令 = opcode 4 字节 + 1 操作数 8 字节）。 */
function wheelScript(slot: number): ScriptBinary {
  const instr: BinInstruction = {
    opcode: 0x10d,
    name: 'i10d',
    argc: 1,
    args: [{ type: T_LOCAL_INT, raw: slot }],
    byteOffset: HEADER_LEN,
    index: 0,
  };
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: HEADER_LEN,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(HEADER_LEN + 12),
  };
}

function engineWith(slot: number): { e: Engine; input: InputManager; read: () => number } {
  const input = new InputManager();
  const e = new Engine(new StubNative(() => {}), input);
  loadScriptIntoFrame(e.curScript(), wheelScript(slot), 'TEST.BIN');
  // local-int 槽存的是 ENC 位模式，读回要 DEC（与 engine.readLocalInt 同语义）；再 asI32 取有符号值
  // （引擎累加器是 int32，下滚为负；emulator 的 readIntOperand 同样是 i32 视角）
  const read = (): number => asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));
  return { e, input, read };
}

test('0x10D：无滚轮 → 写 0 且 ip+1（已实现，不再走 engine-internal/未实现）', async () => {
  const { e, read } = engineWith(5);
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0x10d);
  assert.equal(t.handlerKind, 'implemented');
  assert.equal(read(), 0);
  assert.equal(e.curScript().ip, 1);
});

test('0x10D：上滚 3 格（+120/格）→ op1=+360，且读后累加器清零（一次性消费）', async () => {
  const { e, input, read } = engineWith(5);
  input.addWheel(120);
  input.addWheel(120);
  input.addWheel(120);
  assert.equal(input.wheelDelta, 360, '渲染器注入的多格应累加');

  await stepOnce(e);
  assert.equal(read(), 360, 'op1 应拿到累计增量');
  assert.equal(input.wheelDelta, 0, '★读后必须清零');

  // 再读（期间无新滚轮）→ 0：脚本靠这个判"本帧没滚"
  loadScriptIntoFrame(e.curScript(), wheelScript(5), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(), 0);
});

test('0x10D：下滚为负（方向与脚本 `gr (local 403) 0` 的「上滚>0」约定一致）', async () => {
  const { e, input, read } = engineWith(5);
  input.addWheel(-120); // 下滚一格
  await stepOnce(e);
  assert.equal(read(), -120);
});

test('InputManager：滚轮是"读时消费"，不被 consumeEdges() 擦除', () => {
  const input = new InputManager();
  input.addWheel(120);
  input.consumeEdges(); // poll-input(0x101)/输入派发会清按下沿与 mouseMoved
  assert.equal(input.wheelDelta, 120, '滚轮不随按下沿一起清（否则轮询期间未读就丢，引擎只在 0x10D/ADV 分支清）');
  assert.equal(input.consumeWheelDelta(), 120);
  assert.equal(input.wheelDelta, 0);
});

/** 造一个最小 v4 脚本：一条指令 + 若干操作数（每条操作数 8 字节）。 */
function oneInstr(opcode: number, args: { type: number; raw: number }[]): ScriptBinary {
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: HEADER_LEN,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [
      {
        opcode,
        name: `i${opcode.toString(16)}`,
        argc: args.length,
        args: args.map((a) => ({ type: a.type, raw: a.raw })),
        byteOffset: HEADER_LEN,
        index: 0,
      },
    ],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(HEADER_LEN + 4 + 8 * args.length),
  };
}

test('0x108 / 0x109（同族，已实现）：按钮与位置读到操作数，且不影响滚轮累加器', async () => {
  const input = new InputManager();
  const e = new Engine(new StubNative(() => {}), input);
  const li = (slot: number) => ({ type: T_LOCAL_INT, raw: slot });
  const read = (slot: number) => asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));

  // 0x108：op1 = 按钮值（左=bit0、右=bit1）
  loadScriptIntoFrame(e.curScript(), oneInstr(0x108, [li(10)]), 'TEST.BIN');
  input.pressMouse(0);
  input.pressMouse(1);
  let t = await stepOnce(e);
  assert.equal(t.handlerKind, 'implemented');
  assert.equal(read(10), 3, '左右同时按下 → bit0|bit1 = 3');
  input.releaseMouse(0);
  input.releaseMouse(1);

  // 0x109：op1=X, op2=Y（虚拟坐标；出窗为 -100000）
  loadScriptIntoFrame(e.curScript(), oneInstr(0x109, [li(11), li(12)]), 'TEST.BIN');
  input.setCursor(640, 360, true);
  t = await stepOnce(e);
  assert.equal(t.handlerKind, 'implemented');
  assert.equal(read(11), 640);
  assert.equal(read(12), 360);
  input.setCursor(-100000, -100000, false); // 出窗
  loadScriptIntoFrame(e.curScript(), oneInstr(0x109, [li(11), li(12)]), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(11), -100000, '无光标时应读 -100000（引擎未初始化约定）');
  assert.equal(read(12), -100000);

  // 三者互不干扰：0x108/0x109 是非消费式读取，滚轮累加器应在 0x10D 读取前保持不变
  loadScriptIntoFrame(e.curScript(), oneInstr(0x108, [li(10)]), 'TEST.BIN');
  input.setCursor(100, 100, true);
  input.addWheel(240);
  await stepOnce(e); // 0x108
  loadScriptIntoFrame(e.curScript(), oneInstr(0x109, [li(11), li(12)]), 'TEST.BIN');
  await stepOnce(e); // 0x109
  assert.equal(input.wheelDelta, 240, '0x108/0x109 不得消费滚轮累加器');
  loadScriptIntoFrame(e.curScript(), oneInstr(0x10d, [li(13)]), 'TEST.BIN');
  await stepOnce(e); // 0x10D
  assert.equal(read(13), 240);
  assert.equal(input.wheelDelta, 0, '0x10D 才清零');
});
