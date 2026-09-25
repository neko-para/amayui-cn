/** @tier T0 @kind core @subsystem ops */

/**
 * **`0xA2`/`0xA3` 的字符串型键**（`tickets/T-0158` 的 P3 `0xa2`/`0xa3` `missing-operand-io`）
 * 与 **`0xA3` 的"目标不在 labelMap"分支的诊断**（P3 `missing-branch`）。
 *
 * 引擎依据（`sub_434F10` raw 42908-42917 / `sub_429830` raw 35742-35758）：
 * 两条都用**取字符串原语** `sub_41B640(_this, 1)` 读**键**（raw 26249-26360）——
 * 字符串族（case 2 立即串池 / 5·11 字符串槽 / 8·14 字符串指针）**原样返回池里的串**，
 * 数值族才走 `_itoa_s`/`%lf` 强转。修前 emulator 用 `String(plan.int(1) ?? 0)`（= `atoi`/空串退路）
 * ⇒ 字符串键会变成内容错误的十进制串（`"menu.b"` ⇒ `0`）⇒ 登记的项永远查不中。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { im, instr, str, mkEngine } from './harness.js';

/** 造一个带日志捕获的 ctx 并跑一条指令。 */
function run(e: ReturnType<typeof mkEngine>, op: number, args: Parameters<typeof instr>[1]) {
  const f = e.curScript();
  const logs: string[] = [];
  const ctx = makeCtx(e, f, instr(op, args), new StubNative(() => {}), (m) => logs.push(m));
  const h = OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 必须注册在已实现表`);
  h!(ctx);
  return { ctx, logs };
}

test('★P3 0xa2/0xa3：op1 是**字符串型**时按引擎 `sub_41B640` 取原串当键（不是 atoi）', () => {
  const e = mkEngine([]);
  const f = e.curScript();
  // 局部字符串槽 0x30（type 0xb = local-string，`a.str` 省略 ⇒ 走池）
  const keyArg = { type: 0xb, raw: 0x30 } as Parameters<typeof instr>[1][number];
  f.locals.str.set(0x30, 'menu.b');
  run(e, 0xa2, [keyArg, im(0x44f)]);
  assert.equal(e.menuMap.get('menu.b'), 0x44f, '★键必须是**池里的原串**');
  assert.equal(e.menuMap.get('0'), undefined, '★修前的行为（字符串 ⇒ atoi ⇒ "0"）必须不再出现');

  // 0xA3：同一个字符串键必须查中
  f.labelMap.set(0x44f, 3);
  const { ctx } = run(e, 0xa3, [keyArg, im(0x7df)]);
  assert.equal(ctx._nextIp, 3, '★字符串键查表命中 ⇒ 跳表值');
});

test('★P3 0xa2/0xa3：`global-string`（type 5）与**立即字面量**（type 2）同样取原串', () => {
  const e = mkEngine([]);
  e.globals.str.set(0x21, 'G-KEY');
  run(e, 0xa2, [{ type: 5, raw: 0x21 } as never, im(0x10)]);
  run(e, 0xa2, [str('LIT'), im(0x20)]);
  assert.equal(e.menuMap.get('G-KEY'), 0x10, 'global-string 取池串');
  assert.equal(e.menuMap.get('LIT'), 0x20, '立即字面量（type 2）取 `a.str`');
});

test('★P3 0xa2/0xa3：**数值族**的键仍是十进制串（不得被本次修复改掉；与 `_itoa_s(DEC(v))` 同形）', () => {
  const e = mkEngine([]);
  run(e, 0xa2, [im(-1), im(0x30)]);
  run(e, 0xa2, [{ type: 9, raw: 0x40 } as never, im(0x31)]); // local-int
  assert.equal(e.menuMap.get('-1'), 0x30, '立即数键 = 半角十进制串（`test/menu.test.ts:37` 同口径）');
  assert.equal(e.menuMap.get('0'), 0x31, '没写过的 local-int ⇒ 缺省 0 ⇒ 键 "0"');
});

test('★P3 0xa2/0xa3：**字符串键与数值键是两个键空间**（语料 0 处混用，但不得互相串味）', () => {
  const e = mkEngine([]);
  const s = { type: 0xb, raw: 0x30 } as never;
  e.curScript().locals.str.set(0x30, '0'); // 内容恰好是 "0" 的**字符串**键
  run(e, 0xa2, [s, im(0x11)]);
  run(e, 0xa2, [im(0), im(0x22)]); // 数值键 0
  assert.equal(e.menuMap.get('0'), 0x22, '数值键 0 写的是它自己那一格');
  assert.equal(e.menuMap.get('0') === e.menuMap.get('0'), true);
  const f = e.curScript();
  f.labelMap.set(0x22, 2);
  f.labelMap.set(0x11, 1);
  // 字符串键 "0" 与数值键 0 在 emulator 的键空间里**是同一个串**（引擎那侧字符串键是原串、
  // 数值键是全角化后的串 ⇒ 两者不同）。这里的断言只钉住"最后一次写覆盖同一格"这一事实，
  // 并把"两键空间未分离"登记为已知偏差（见 changes-c158.md §4 的 operand.ts 交接）。
  assert.equal(e.menuMap.size, 1, '半角口径下 "0"（字符串键）与 "0"（数值键）落同一格');
});

test('★P3 0xa3 missing-branch：目标两级都查不到 ⇒ **抛**（引擎是无条件野跳；修前只记日志、静默顺序执行）', () => {
  const e = mkEngine([]);
  // ★2026-09-25（`T-0179` 本轮）：修前这里是「`c.log` 一句 + 什么都不做」，与引擎 raw 35752/35754 的
  //   `ip = ip_base + 4*目标` 分叉。现在与 `0x8C`/`0x8F`/`0xA0` 同口径：先走 `script.dwordToInstr` 回落
  //   （见 `test/menu-dispatch-target.test.ts`），**两级都查不到**（目标越出脚本）才抛宿主护栏。
  assert.throws(
    () => run(e, 0xa3, [im(9), im(0x7df)]),
    /越出脚本/,
    '★两级都查不到 ⇒ 报"越出脚本"（既不是静默顺序执行，也不是野跳）',
  );
});
