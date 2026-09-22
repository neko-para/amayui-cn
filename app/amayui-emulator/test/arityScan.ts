/**
 * **从反编译体里解析 arity 槽**（`tickets/T-0082` 的共享真源读取器）。
 *
 * 引擎每条 handler 体开头都写"本指令占几个 dword"：`_this[30*cur + 95805] = N`（dword 形式）或
 * `*(_DWORD *)(_this + 120*cur + 383220) = N`（字节形式）。关系 **`N = 2*argc + 1`**；
 * **`N = 0` = 控制流指令自己定 ip**（派发器那行 `+= 4*N`，raw 20165）。
 *
 * 为什么抽成模块：两个守卫都要它，而"解析口径"本身是结论的一部分 ——
 *  - `test/opcode-arity.test.ts`：文档 `argc` ⟷ 体里的 N；
 *  - `test/operand-plan.test.ts`：**模型** `aritySlotValue()` ⟷ 体里的 N（含"哪几条写 0"）。
 * 两处各写一份扫描器 ⇒ 迟早漂移成两个口径（这正是 `T-0082` 要消灭的病）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..', '..', '..');
export const ENGINE_C = path.join(ROOT, 'engine/天结_unpacked.exe_utf8.c');

export interface ArityRow {
  op: number;
  /** `scripts/asm/opcodes.json` 的 argc（文档口径）。 */
  argc: number;
  /** 体里写的指令长度（dword 数，含 opcode）；0 = 控制流自己定 ip。 */
  step: number;
  handler: string;
}

export interface ArityScan {
  rows: ArityRow[];
  /** dispatch 表里找不到 handler 的 opcode。 */
  noHandler: number[];
  /** handler 体里没解析出该槽的 opcode（thunk / 体缺失 / 写法不同）。 */
  skipped: number[];
  /** `op → handler`（dispatch 表，字节 675996 + 4*op）。 */
  handlerByOp: Map<number, string>;
}

/** 扫描一次：dispatch 表 + handler 体里的 arity 槽赋值。 */
export function scanArity(): ArityScan {
  const src = fs.readFileSync(ENGINE_C, 'utf8').split('\n');
  // ① dispatch 表：字节 675996 + 4*op
  const handlerByOp = new Map<number, string>();
  for (const l of src) {
    const m = /^\s*\*\(_DWORD \*\)\(_this \+ (\d+)\) = (sub_[0-9A-F]{6});\s*$/.exec(l);
    if (!m) continue;
    const op = (Number(m[1]) - 675996) / 4;
    if (Number.isInteger(op) && op >= 0 && op <= 0x400 && !handlerByOp.has(op)) handlerByOp.set(op, m[2]!);
  }
  // ② handler 体行号
  const bodyAt = new Map<string, number>();
  src.forEach((l, i) => {
    const m = /^\/\/----- \(([0-9A-F]{8})\)/.exec(l);
    if (m) bodyAt.set('sub_' + parseInt(m[1]!, 16).toString(16).toUpperCase(), i);
  });
  const ops = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/asm/opcodes.json'), 'utf8')) as {
    opcode: number;
    argc: number;
  }[];

  const rows: ArityRow[] = [];
  const skipped: number[] = [];
  const noHandler: number[] = [];
  for (const o of ops) {
    const h = handlerByOp.get(o.opcode);
    if (!h) {
      noHandler.push(o.opcode);
      continue;
    }
    const at = bodyAt.get(h);
    if (at === undefined) {
      skipped.push(o.opcode);
      continue;
    }
    // 体范围：到下一个 `//----- (`
    let end = at + 1;
    while (end < src.length && !/^\/\/----- \(/.test(src[end]!)) end++;
    const body = src.slice(at, end).join('\n');
    // 形态 1：`_this[30 * _this[95776] + 95805] = N;`
    //   ★1b：Hex-Rays 有时给赋值加**类型转换**：`_this[30 * (_DWORD)_this[95776] + 95805] = (int *)11;`
    //        （实测 `0x82`/`0x1d1`/`0x2ef`/`0x2f0`/`0x2f1`/`0x2f2`/`0x2f6` 都是这一形态 ⇒ 不认它就白丢 7 条）
    // 形态 2：`*(_DWORD *)(_this + 120 * ... + 383220) = N;`（字节形式）
    //   ★2b：同族的另一种写法是**取址+下标**：`*(_DWORD *)&_this[120 * ... + 383220] = 5;`
    //        （这里是 `]` 不是 `)`；实测 `0x60`/`0x236`/`0x240`/`0x241`/`0x24d`/`0x2c9` 六条 ⇒ 不认它就白丢 6 条）
    let step: number | undefined;
    const m1 = /95805\]\s*=\s*(?:\([^)]*\)\s*)?(\d+)\s*;/.exec(body);
    const m2 = /383220[\)\]]\s*=\s*(\d+)\s*;/.exec(body);
    if (m1) step = Number(m1[1]);
    else if (m2) step = Number(m2[1]);
    if (step === undefined) {
      skipped.push(o.opcode);
      continue;
    }
    rows.push({ op: o.opcode, argc: o.argc, step, handler: h });
  }
  return { rows, skipped, noHandler, handlerByOp };
}
