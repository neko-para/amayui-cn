/**
 * 取址 / 数组 / 批量搬运（ADR-011：指针 = 带标记引用 Ref，读解引用、写写穿）。
 *
 * 这一族是 ADR-010 §10.2 点名的**高危信号**（数据/状态操作），任何 opcode 都不得列为
 * `engine-internal` 跳过，必须精确实现 —— 因此它们集中在一个文件里，便于对照 docs/07 复核。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, refFromOperand, setRefOperand } from '../operand.js';
import { asI32, dec, enc } from '../bits.js';
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
 * **`0x12F`（sub_42F560, raw 39269-39335）：三个数组地址上的「索引插入排序 + 并行搬运 + 末尾重编码」**
 * —— 确切语义（读完整 handler 体，并逐句复刻验证过）：
 *   - `op1/op2/op3` 经 `sub_42AEA0`（= operandAddress）取**三个数组基址**：A / B / C；`op4` = 元素个数 `n`；
 *   - `*A = 0`；
 *   - **插入排序**（`dword_55D59C` 从 1 到 n-1）：`while (DEC(A[j]) + DEC(C[j]) > DEC(A[i]) + DEC(C[i])) { A[j+1] = A[j]; j-- }`，
 *     收尾 `A[j+1] = i` —— 即把「索引」按 **(DEC(A[k]) + DEC(C[k])) 升序** 重排后写回 A（实测数据得 `[2,0,1,3,4]`）。
 *     ★比较里的 `A[i]`：`i` 是**正在被填的位置**，其现存元素就是上一轮搬进来的值（raw 里 `dword_55D5A8[4*v4]`，
 *       `v4` 在循环内被写/读），故不是"用 A 的原始值比较"。
 *   - `B`（op2）在本 handler 内**只作为基址被传入、未被使用**（`dword_55D5A4` 只在 raw 39300 出现一次且与 A 同索引；
 *     实际参与比较/搬运的是 A 与 C）。emulator 照此只读 A/C。
 *   - 末尾：对 A 的每个元素原地重编码 `A[i] = ENC(DEC(A[i]))`（raw 39329-39331）——因为数组存量是 ENC、
 *     比较要 DEC，这一步净效果为**恒等**，但为与引擎逐句一致仍照做。
 *   ★数组访存一律 **DEC 读入 / ENC 写出**（与引擎成对做的一样），这样 DEC 回读得到的就是排序后的索引。
 *   实测用例：`CONFIG2.txt:1044 i12f (local 800) (global 14b894) (local be8) 3e8`（n=1000）、
 *   `CONFIG1.txt:1178 i12f (local 7ff) (local 179f) (local 273f) (local 561f)`。
 */
export const op_sort_index_arrays: OpHandler = (c) => {
  const { e, frame } = c;
  const a = refFromOperand(e, frame, c.instr, 1); // A：值/索引数组
  refFromOperand(e, frame, c.instr, 2); // B：辅助表（被 A 间接索引）
  const cc = refFromOperand(e, frame, c.instr, 3); // C：键数组（与 A 同索引）
  const n = readIntOperand(e, frame, c.instr, 4);
  if (n <= 0) return;
  // 取有符号值的辅助：数组里存的是 **ENC 位模式**，引擎比较用的是 **DEC 后的 int32** 视角
  // （raw 39300-39307 的 `__ROR4__(key ^ __ROL4__(x,11), 25)` = DEC(x)）
  const A = (i: number): number => asI32(dec(e.key, readRef(e, frame, refAt(a, i)) >>> 0));
  const C = (i: number): number => asI32(dec(e.key, readRef(e, frame, refAt(cc, i)) >>> 0));

  writeRef(e, frame, refAt(a, 0), enc(e.key, 0)); // *A = 0（引擎写 ENC(0)，即 DEC 回读为 0）
  for (let i = 1; i < n; i++) {
    let j = i - 1;
    // 引擎原始判据：DEC(A[j]) + DEC(C[j]) > DEC(A[i]) + DEC(C[i])
    while (j >= 0 && A(j) + C(j) > A(i) + C(i)) {
      writeRef(e, frame, refAt(a, j + 1), enc(e.key, A(j))); // A[j+1] = A[j]（写回时编码）
      j--;
    }
    writeRef(e, frame, refAt(a, j + 1), enc(e.key, i));
  }
  // 末尾"原地重编码"：raw 是 A[i] = ENC(DEC(A[i])) —— 净效果为恒等，此处直接照做以保持与引擎逐句一致
  for (let i = 0; i < n; i++) {
    writeRef(e, frame, refAt(a, i), enc(e.key, A(i)));
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
];

