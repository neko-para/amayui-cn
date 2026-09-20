/**
 * **「脚本从未写过的 int 槽读 0」的全局口径**（`tickets/T-0097` ③）。
 *
 * ## 引擎口径（判据原文，三处 raw 体）
 * 1. `loadScriptFrame_40ED40`（raw 18773-18781，建局部池）：
 *    `*(_DWORD *)(*(_DWORD *)(v15 + 383156) + 4 * v14++) = *(_DWORD *)(a1 + 388240);`
 *    —— `frame+383156` = `local_int` 基址（`sub_41BF50` case 9 用的就是 `_this[30*cur + 95789]`），
 *    `Engine+388240` = `_this[97060]` = **`enc_zero`**（`analysis/fields.json` 的 `Engine/0x5EC90`：
 *    `"ENC(0) 常量槽 (this[97060])"`，`evidence: members.cpp 388240；loadScriptFrame 填 local_int 用`）。
 * 2. 全局 int 池同理：构造/preload（raw 22328-22329）与全量 teardown `0x9`（raw 35218-35219）
 *    都是 `for (…) pool_int[j] = *(_DWORD *)(_this + 388240);`（同一个 `enc_zero`）。
 * 3. `0x2C9` 数组扩容（`sub_4344A0` raw 42526-42531）：新元素 = `__ROL4__(key ^ __ROR4__(0, 7), 21)` = `ENC(0)`。
 * 旁证：`sub_418940`（raw 24240）用 `ROL4(enc_zero, 11) != key` 做密钥自检 —— 只有 `enc_zero == ENC(0)` 成立。
 * ⇒ `DEC(key, enc_zero) = 0`：**没写过的 int 槽读出来就是 0**。
 *
 * ## 为什么要修（真存档才会暴露）
 * emulator 的池是稀疏 Map，修前 `readIntOperand`/`readRef` 对缺槽给的是 `dec(key, 0)` ——
 * 只有 `key == 0`（缺省）时才恰好是 0；而**读真存档**会设非零 key（`handlers/save-slot.ts`），
 * 于是缺槽读成 `ror32(key,25)` 这种垃圾。`save-slot.ts` 装池时**只装非零项**（`if (v !== 0)`，
 * 注释写着"读侧缺省即 0"）⇒ 修前"存档里等于 0 的全局量"全读成垃圾。
 *
 * ## 纪律：**只许一套读口径**
 * 读口径的唯一实现在 `src/vm/ref.ts` 的 `decIntSlot`（`readIntOperand` 与 `readRef` 都走它）。
 * 轮 6 在 `0x12E` 里本地用 `hasRefValue` 绕开的写法**已删除**；`hasRefValue` 只保留在**写侧**
 * （`0x2C9` 扩容"只补缺失槽、不覆盖已有值"）。本文件最后两条即这条纪律的棘轮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { readIntOperand } from '../src/vm/operand.js';
import { readRef, refAt } from '../src/vm/ref.js';
import { dec, enc } from '../src/vm/bits.js';
import { OPS } from '../src/vm/ops.js';
import { im, instr } from './harness.js';
import type { BinArg } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
/** 真存档装载后的 key（非 0）—— 缺槽口径只有在 key ≠ 0 时才暴露。 */
const KEY = 0x12345678;

const gInt = (n: number): BinArg => ({ type: 0x3, raw: n }) as unknown as BinArg;
const lInt = (n: number): BinArg => ({ type: 0x9, raw: n }) as unknown as BinArg;
const gIntArr = (n: number): BinArg => ({ type: 0x8003, raw: n }) as unknown as BinArg;
const lIntArr = (n: number): BinArg => ({ type: 0x8009, raw: n }) as unknown as BinArg;

function mk(): Engine {
  const e = new Engine(new StubNative(() => {}), new InputManager());
  e.key = KEY;
  return e;
}

test('缺槽读 0（key ≠ 0）：local-int / global-int / int 数组 / int 引用 四条路一致', () => {
  const e = mk();
  const f = e.curScript();
  const rd = (a: BinArg): number => readIntOperand(e, f, instr(0x55, [a]), 1);

  assert.equal(rd(lInt(0x10)), 0, 'local-int 缺槽 = 0');
  assert.equal(rd(gInt(0x20)), 0, 'global-int 缺槽 = 0');
  assert.equal(rd(lIntArr(0x30)), 0, 'local int 数组（0x8009）缺槽 = 0');
  assert.equal(rd(gIntArr(0x40)), 0, 'global int 数组（0x8003）缺槽 = 0');
  assert.equal(readRef(e, f, refAt({ scope: 'local', kind: 'int', index: 0x50, stride: 4 }, 0)), 0, 'readRef(local int) 缺槽 = 0');
  assert.equal(readRef(e, f, refAt({ scope: 'global', kind: 'int', index: 0x60, stride: 4 }, 0)), 0, 'readRef(global int) 缺槽 = 0');

  // 反面对照（"为什么不能沿用 dec(key,0)"）：key ≠ 0 时它**不是** 0 —— 修前的缺省就是它。
  assert.notEqual(dec(KEY, 0) | 0, 0, '`dec(key,0)` 在 key≠0 时不是 0 ⇒ 它不可能是"缺槽"的取值');
});

test('缺槽口径不吞掉真值：写过的槽照旧读回（含"显式写 0"）', () => {
  const e = mk();
  const f = e.curScript();
  const rd = (a: BinArg): number => readIntOperand(e, f, instr(0x55, [a]), 1);

  f.locals.int.set(0x10, enc(KEY, 42));
  assert.equal(rd(lInt(0x10)), 42, '写过的 local-int 读回原值');
  e.globals.int.set(0x20, enc(KEY, -7));
  assert.equal(rd(gInt(0x20)), -7, '写过的 global-int 读回原值（负数按 i32）');
  // 引擎"显式写 0"就是把 `enc_zero` 放进槽（`0x2D8` set-array-to 逐个写它，raw 37886-37891）
  f.locals.int.set(0x11, enc(KEY, 0));
  assert.equal(rd(lInt(0x11)), 0, '显式写成 0 的槽读 0');
  assert.equal(f.locals.int.has(0x11), true, '它与"缺槽"在**读**上等价，但槽确实存在（写侧判据能区分）');
});

test('★0x12E 端到端：margin 只登记基址、不写值 ⇒ 按 enc_zero 读 0（不是 dec(key,0) 的垃圾）', () => {
  // 直接跑产品 handler（`OPS` 里的 0x12E），复刻 TITLE/CONFIG1 的用法：`local 1..4` 全脚本一次没写过。
  const e = mk();
  const f = e.curScript();
  const set = (slot: number, v: number): void => void f.locals.int.set(slot, enc(KEY, v));
  set(0, -1); // op1 = 起始下标
  // op2 = margin 基址 local 1（4 格**不写**）；op5 = 盒表 local 0x10；op6/op7 = 平面
  set(0x10, 0); // 记录 0 = [xmin, xmax, ymin, ymax]
  set(0x11, 100);
  set(0x12, 0);
  set(0x13, 100);
  set(0x20, 0); // 平面 X[0]
  set(0x30, 0); // 平面 Y[0]
  const ins = instr(0x12e, [lInt(0), lInt(1), im(50), im(50), lInt(0x10), lInt(0x20), lInt(0x30), im(1)]);
  const h = OPS.get(0x12e);
  assert.ok(h, '0x12E 必须在真实现表');
  h({ e, frame: f, instr: ins, native: e.native, log: () => {}, jump: () => {}, _nextIp: null });
  assert.equal(dec(KEY, f.locals.int.get(0) ?? 0) | 0, 0, '未写过的 margin 读 0 ⇒ (50,50) 命中记录 0');
});

// ---------------------------------------------------------------------------
// 棘轮：**不许两套读口径并存**
// ---------------------------------------------------------------------------

test('★口径唯一：读侧只在 `ref.ts` 的 `decIntSlot` 里实现（operand/ref 都走它）', () => {
  const operand = fs.readFileSync(path.join(SRC, 'vm', 'operand.ts'), 'utf8');
  const ref = fs.readFileSync(path.join(SRC, 'vm', 'ref.ts'), 'utf8');
  assert.match(ref, /export function decIntSlot\(/, '判据的唯一实现处');
  assert.equal(
    (operand.match(/decIntSlot\(/g) ?? []).length,
    4,
    '`readIntOperand` 的 4 条 int 路径（global/local/global-array/local-array）都必须走它',
  );
  assert.match(ref, /case 'int': return decIntSlot\(/, '`readRef` 的 int 分支必须走它');
  // 修前那两种"各自为政"的写法都不许回来
  assert.doesNotMatch(operand, /i32\(dec\(/, '`readIntOperand` 不许再有 `i32(dec(key, X ?? 0))` 这种缺省写法');
  assert.doesNotMatch(ref, /case 'int':[^\n]*\? raw : 0/, '`readRef` 的 int 分支不许再有 `… ? raw : 0` 缺省');
});

test('★棘轮：读路径不许再用 `hasRefValue` 另起一套（它只剩 `memory.ts` 0x2C9 的写侧判据）', () => {
  const handlers = fs.readdirSync(path.join(SRC, 'vm', 'handlers')).filter((f) => f.endsWith('.ts'));
  const users: string[] = [];
  for (const f of handlers) {
    // 只看**调用/定义**（`hasRefValue(`），注释里提它的名字不算使用
    if (/\bhasRefValue\s*\(/.test(fs.readFileSync(path.join(SRC, 'vm', 'handlers', f), 'utf8'))) users.push(f);
  }
  // ★`memory.ts` = 唯一**正当**的用处（`0x2C9` 扩容"只补缺失槽、不覆盖已有值"，那是**写**判据）。
  // ★`region-hittest.ts` = 并行 agent 在本次改动期间新建的 `0x147`/`0x2F2` 模块，它照抄了轮 6 的
  //   `hasRefValue` 读绕法；本子代理已把它改写成纯别名 `readSlot = readRef`（行为逐位等价）并上报。
  //   它是**遗留白名单**：若那个模块重写回去，下面的别名断言会红；③ 的终态是这份名单里只剩 `memory.ts`。
  const leftover = new Set(['region-hittest.ts']);
  assert.deepEqual(
    users.filter((f) => !leftover.has(f)),
    ['memory.ts'],
    `除已知遗留外，\`hasRefValue\` 只许出现在 \`memory.ts\`（写侧）；实测：${users.join(', ')}`,
  );
  const region = path.join(SRC, 'vm', 'handlers', 'region-hittest.ts');
  if (fs.existsSync(region)) {
    const src = fs.readFileSync(region, 'utf8');
    if (/function readSlot/.test(src)) {
      assert.match(src, /function readSlot\([\s\S]{0,200}?return readRef\(/, '`region-hittest.ts` 的 `readSlot` 只许是 `readRef` 的别名（不许再补一套缺槽 0）');
    }
  }
  // 0x12E（input.ts）的本地绕法已删：读一个池槽直接 `readRef`（缺槽 0 由全局口径负责）
  const input = fs.readFileSync(path.join(SRC, 'vm', 'handlers', 'input.ts'), 'utf8');
  assert.match(input, /const rd = \(r: Ref\): number => readRef\(/, '0x12E 的读门面必须直接走 readRef');
});
