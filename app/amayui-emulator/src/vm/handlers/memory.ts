/**
 * 取址 / 数组 / 批量搬运（ADR-011：指针 = 带标记引用 Ref，读解引用、写写穿）。
 *
 * 这一族是 ADR-010 §10.2 点名的**高危信号**（数据/状态操作），任何 opcode 都不得列为
 * `engine-internal` 跳过，必须精确实现 —— 因此它们集中在一个文件里，便于对照 docs/07 复核。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, refFromOperand, setRefOperand } from '../operand.js';
import { refAt, readRef, writeRef } from '../ref.js';
import type { OpTable } from './shared.js';

// ---- 取址/数组（ADR-011：指针=带标记引用，读解引用/写写穿）----

/** lea (0x63)：`op1 = &op2`。dest 恒为指针型；setRefOperand 写 Ref（直接型=槽引用，指针型=别名拷贝）。 */
const op_lea: OpHandler = (c) => {
  setRefOperand(c.e, c.frame, c.instr, 1, refFromOperand(c.e, c.frame, c.instr, 2));
};

/** lookup-array (0x61)：`op1 = &op2[op3]`（基址 Ref + 索引偏移）。 */
const op_lookup_array: OpHandler = (c) => {
  const base = refFromOperand(c.e, c.frame, c.instr, 2);
  const idx = readIntOperand(c.e, c.frame, c.instr, 3);
  setRefOperand(c.e, c.frame, c.instr, 1, { scope: base.scope, kind: base.kind, index: base.index + idx, stride: base.stride });
};

/** lookup-array-2d (0x12C)：`op1 = &op2[row*colStride + col]`（二维基址）。 */
const op_lookup_array_2d: OpHandler = (c) => {
  const base = refFromOperand(c.e, c.frame, c.instr, 2);
  const row = readIntOperand(c.e, c.frame, c.instr, 3);
  const colStride = readIntOperand(c.e, c.frame, c.instr, 4);
  const col = readIntOperand(c.e, c.frame, c.instr, 5);
  setRefOperand(c.e, c.frame, c.instr, 1, { scope: base.scope, kind: base.kind, index: base.index + row * colStride + col, stride: base.stride });
};


const op_memcpy: OpHandler = (c) => {
  const dest = refFromOperand(c.e, c.frame, c.instr, 1);
  const src = refFromOperand(c.e, c.frame, c.instr, 2);
  const n = readIntOperand(c.e, c.frame, c.instr, 3);
  if (dest.kind !== src.kind || dest.stride !== src.stride) {
    throw new Error(`memcpy: 源/目标类型或步长不一致 src=${src.kind}/${src.stride} dest=${dest.kind}/${dest.stride}`);
  }
  for (let i = 0; i < n; i++) writeRef(c.e, c.frame, refAt(dest, i), readRef(c.e, c.frame, refAt(src, i)));
};

/** copy-local-array (0x64)：把 op2 索引的字面数组（dataArray）逐项编码拷入 op1 指向数组。 */
const op_copy_local_array: OpHandler = (c) => {
  const dest = refFromOperand(c.e, c.frame, c.instr, 1);
  const data = c.instr.args[1]?.dataArray;
  if (!data) throw new Error('copy-local-array: 缺字面数组数据（dataArray）');
  for (let i = 0; i < data.length; i++) writeRef(c.e, c.frame, refAt(dest, i), data[i]!);
};

/**
 * copy-to-global (0x6C)：**置零**（非 mov 值拷贝）。
 *  handler 体（sub_42CE70）：`v2 = &op1; n = op2; while(n--) *v2++ = _this[97060];`
 *  - op2 是**数量**（count），不是值；
 *  - `_this[97060]` = **ENC(0)**（约 ROR(key,11)；由反篡改校验 `ROL(x,11)==key` 在 3 处独立成立唯一确定），
 *    即「编码后的 0」——写入 ENC 池即被 DEC 为 0。
 *  ⇒ 语义 = 从 op1 起的 `count` 个连续槽**置 0**（bulk 零初始化 / memset 式），与 mov 的单值复制不同。
 */
const op_copy_to_global: OpHandler = (c) => {
  const base = refFromOperand(c.e, c.frame, c.instr, 1);
  const count = readIntOperand(c.e, c.frame, c.instr, 2);
  if (count <= 0) return;
  for (let i = 0; i < count; i++) writeRef(c.e, c.frame, refAt(base, i), 0);
};

/**
 * set-array-to (0x2D8)：**用脚本值 bulk 填充**（对比 copy-to-global 的固定 0）。
 *  handler 体（sub_430CF0）：`v2=&op1; v5=ENC(op2值); n=op3; memset32(v2, v5, n);`
 *  - op2 = 填充**值**（脚本可控）；op3 = **数量**；
 *  - 填 `count` 个连续槽为 `ENC(op2)`（回读=op2 值）。
 */
const op_set_array_to: OpHandler = (c) => {
  const dest = refFromOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  const count = readIntOperand(c.e, c.frame, c.instr, 3);
  if (count <= 0) return;
  for (let i = 0; i < count; i++) writeRef(c.e, c.frame, refAt(dest, i), value);
};

/** strlen (0x2c5) / mbstrlen (0x2c6)：`op1 = strlen(string op2)`。 */

/**
 * **`0x12F`（sub_42F560, raw 39269-39335）：把「索引数组 A」按 `B[idx] + C[idx]` 升序重排。**
 *
 * 引擎逐句（A = `operandAddress(1)`、B = `(2)`、C = `(3)`、n = `readInt(4)`）：
 * ```
 * A[0] = 0;                                  // 种子：先假定索引 0 在首位
 * for (k = 1; k < n; k++) {                  // 插入排序
 *   j = k - 1;
 *   while (j >= 0 && DEC(B[A[j]]) + DEC(C[A[j]]) > DEC(B[k]) + DEC(C[k])) { A[j+1] = A[j]; j--; }
 *   A[j+1] = k;
 * }
 * for (i = 0; i < n; i++) A[i] = ENC(DEC(A[i]));   // 末尾"原地重编码"
 * ```
 * ★关键（raw 39300/39299-39307 的下标嵌套）：比较里的键是 **`B[A[j]] + C[A[j]]`**
 *   —— 即"用 A 里存的**索引**去查 B/C"，不是"A 位置上的值"、也不是"C 的同位置值"。
 *   所以三个数组的角色是：**A = 索引数组（被排序/写回）、B = 主键、C = 次键**，三者同索引空间。
 *
 * ★订正历史（本条被误读过两次，两次都**静默**）：
 *  1. 曾把 B 记成"只作基址传入、未被使用"——错：B 是主键数组（raw 39300 就在用它）；
 *  2. 曾写成 `DEC(A[j]) + DEC(C[j])`（按位置比 C）并**再叠一层** DEC/ENC——错两层：
 *     键取错 + 双重编解码。它的症状是"排序结果取决于 A 里的**残留内容**"：
 *     `CONFIG1` 首次进入设置时可见行序表是上一轮的残留，
 *     于是「字体系列」被排到第一页最前面；切一次 tab 再回来（A 里已有一轮结果）
 *     顺序又"看起来对了"——**顺序竟然依赖历史**，这本身就是判据错了的铁证。
 *   正确实现后结果只取决于 B/C，与 A 的初始内容无关（有不变量测试守着）。
 *
 * 实测用例：`CONFIG1.txt:1178 i12f (local 7ff) (local 179f) (local 273f) (local 561f)`（n=15）
 * —— `36df` 是描述符源表、`179f` 是主键（`(type顺序<<16)|value顺序`）、`273f` 是次键（该页全 0）。
 */
export const op_sort_index_arrays: OpHandler = (c) => {
  const { e, frame } = c;
  const a = refFromOperand(e, frame, c.instr, 1); // A：索引数组（排序对象 + 写回目标）
  const b = refFromOperand(e, frame, c.instr, 2); // B：主键数组（**按 A 里存的索引取值**）
  const cc = refFromOperand(e, frame, c.instr, 3); // C：次键数组（同上）
  const n = readIntOperand(e, frame, c.instr, 4);
  if (n <= 0) return;
  // `readRef` 已经给出 DEC 视角（写侧 ENC）——**不要再 dec/enc 一层**，见 docs/07 §4.4
  const A = (i: number): number => readRef(e, frame, refAt(a, i));
  /** 索引 `idx` 的排序键 = `B[idx] + C[idx]`（raw 39299-39307）。 */
  const keyOf = (idx: number): number => readRef(e, frame, refAt(b, idx)) + readRef(e, frame, refAt(cc, idx));

  writeRef(e, frame, refAt(a, 0), 0); // *A = 0
  for (let k = 1; k < n; k++) {
    let j = k - 1;
    while (j >= 0 && keyOf(A(j)) > keyOf(k)) {
      writeRef(e, frame, refAt(a, j + 1), A(j)); // A[j+1] = A[j]
      j--;
    }
    writeRef(e, frame, refAt(a, j + 1), k);
  }
  // 末尾"原地重编码"：raw 是 A[i] = ENC(DEC(A[i])) —— readRef/writeRef 版就是"读出来再写回"
  for (let i = 0; i < n; i++) {
    writeRef(e, frame, refAt(a, i), A(i));
  }
};

/** 取址 / 数组 / 批量搬运 / 索引排序（真实现；ADR-011）。 */
export const MEMORY_OPS: OpTable = [
  [0x61, op_lookup_array],
  [0x63, op_lea],
  [0x64, op_copy_local_array],
  [0x6c, op_copy_to_global],
  [0x2d8, op_set_array_to],
  [0x12c, op_lookup_array_2d],
  [0x1b0, op_memcpy],
  [0x12f, op_sort_index_arrays], // 三数组：按 (DEC(A)+DEC(C)) 升序重排索引写 A，末尾 A 原地 ENC 重编码
];

