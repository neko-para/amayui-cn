/**
 * **文本累加缓冲族：`0x1B2` / `0x1B3` / `0x1B4`**（`tickets/T-0076` 的 B3 补；语料 3 + 2 + 1 处）。
 *
 * 引擎依据（三条都不写操作数，容器 `Engine+497344` 全反编译只有这三处使用者）：
 * ```text
 * 0x1B2 sub_42A9B0 raw 36550-36558：arity 槽 = 3；v2 = sub_41B9B0(_this, 1)（取 op1 字符串）；
 *                                  sub_40C660(_this + 124336, v2, strlen(v2))    ⇒ 追加该串
 * 0x1B3 sub_42AA00 raw 36560-36565：arity 槽 = 1；sub_40C660(_this + 124336, asc_51EE84, 2u)
 *                                  而 asc_51EE84 在 raw 4320 = `char asc_51EE84[3] = "\r\n";` ⇒ 追加 CRLF
 * 0x1B4 sub_428DB0 raw 35322-35331：*(_DWORD *)(_this + 120*cur + 383220) = 1；sub_4034F0(_this)；
 *                                  sub_40B420(_this + 497344, 0, 0xFFFFFFFF)      ⇒ 取整段（随后清空）
 * ```
 * 本文件锁三件事：追加语义（含 CRLF 两字节）、取出后缓冲复位、三条都是 argc 0/1 的**无操作数写入**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';

/** 合成一条指令（只给 handler 需要的字段；运行时按真表 argc 取操作数）。 */
function instr(op: number, argc: number, args: { type: number; raw: number }[]): never {
  return { opcode: op, name: `i${op.toString(16)}`, argc, args, byteOffset: 0, index: 0 } as never;
}

test('★0x1B2/0x1B3/0x1B4：文本缓冲累加（含 CRLF）+ 取出复位', async () => {
  const logs: string[] = [];
  const e = new Engine(new StubNative((m) => logs.push(m)));
  const frame = e.frames[0]!;
  // `0x1B2` 的 op1 是字符串操作数：type 0x5 = 全局字符串池下标（`operand.ts` 的 TYPE_GLOBAL_STRING）。
  e.globals.str.set(7, 'HELLO');

  await OPS.get(0x1b2)!(makeCtx(e, frame, instr(0x1b2, 1, [{ type: 0x5, raw: 7 }]), e.native, (m) => logs.push(m)));
  assert.equal(e.textBuffer, 'HELLO', '0x1B2 追加 op1 的字符串');
  await OPS.get(0x1b3)!(makeCtx(e, frame, instr(0x1b3, 0, []), e.native, (m) => logs.push(m)));
  assert.equal(e.textBuffer, 'HELLO\r\n', '★0x1B3 追加的是**两字节** CRLF（asc_51EE84）');
  e.globals.str.set(8, 'WORLD');
  await OPS.get(0x1b2)!(makeCtx(e, frame, instr(0x1b2, 1, [{ type: 0x5, raw: 8 }]), e.native, (m) => logs.push(m)));
  assert.equal(e.textBuffer, 'HELLO\r\nWORLD', '第二次 0x1B2 追加在末尾');

  await OPS.get(0x1b4)!(makeCtx(e, frame, instr(0x1b4, 0, []), e.native, (m) => logs.push(m)));
  assert.equal(e.textBuffer, '', '★0x1B4 取出后缓冲复位（引擎 `sub_40B420(buf, 0, -1)`）');
  assert.ok(
    logs.some((m) => m.includes('0x1B4: 取出文本缓冲') && m.includes('HELLO\\r\\nWORLD')),
    `0x1B4 要把整段文本留在日志里（否则这三条就是沉默的死写）：${logs.join(' | ')}`,
  );
});

test('0x1B4 在缓冲为空时不记日志（不产生噪声）', async () => {
  const logs: string[] = [];
  const e = new Engine(new StubNative((m) => logs.push(m)));
  const frame = e.frames[0]!;
  await OPS.get(0x1b4)!(makeCtx(e, frame, instr(0x1b4, 0, []), e.native, (m) => logs.push(m)));
  assert.equal(logs.filter((m) => m.includes('取出文本缓冲')).length, 0);
});

test('★0x1C8 to-string：op1 = "%d" 十进制字符串(op2)（含负数与有符号 32 位口径）', async () => {
  const e = new Engine(new StubNative(() => {}));
  const frame = e.frames[0]!;
  const run = async (v: number): Promise<string> => {
    // op1 = 出参字符串（全局池下标 9）、op2 = 整数立即数。
    await OPS.get(0x1c8)!(
      makeCtx(e, frame, instr(0x1c8, 2, [{ type: 0x5, raw: 9 }, { type: 0, raw: v }]), e.native, () => {}),
    );
    return e.globals.str.get(9) ?? '';
  };
  assert.equal(await run(0), '0', '0 ⇒ "0"');
  assert.equal(await run(12345), '12345', '十进制、无前导零/空格（`%d`）');
  assert.equal(await run(-7), '-7', '负数带符号（`%d` 有符号）');
  assert.equal(await run(0x7fffffff), '2147483647');
  assert.equal(await run(0xffffffff), '-1', '★`%d` 是有符号 32 位 ⇒ 0xFFFFFFFF 打成 -1（与引擎一致）');
});
