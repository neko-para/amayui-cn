/**
 * **arity 槽自动核验**（`tickets/T-0082` 的 B2 第二步；审计 `docs-new/99-records/2026-09-audit/audit-2026-09-opcodes.md`）。
 *
 * 引擎的**每条** handler 体开头都会写"本指令的操作数个数槽"：`_this[30*cur + 95805] = N`（dword 形式）或
 * `*(_DWORD *)(_this + 120*cur + 383220) = N`（字节形式）。两者的关系是 **`N = 2*argc + 1`**
 * （每个操作数 2 dword：类型 + 载荷），已由多条已核对指令证实（argc 0→1、1→3、2→5、5→11、7→15、8→17）。
 *
 * ⇒ 这是**引擎自带的 argc 真源**，可以机械地和 `scripts/asm/opcodes.json` 的 `argc` 列对照：
 * 对不上就说明文档/语料/实现三方有一边错（审计已实证 `0x1E` 文档写 8 而体只读 7 个）。
 *
 * 本守卫：
 *  ① 逐 opcode 从 dispatch 表（字节 675996 + 4*op）找到 handler，再从体里解析 N（解析不到的记为 skipped）；
 *  ② 断言 `N === 2*argc + 1`；例外必须写进 `ALLOW` 白名单（每条写清原因 + 票），新增不一致即红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArityRow, scanArity } from './arityScan.js';

/**
 * 已知的例外/空洞：**只允许存量**，新增即红。
 * - `control-flow`：`N === 0` —— 控制流指令自己定 ip（引擎派发器不前进），例如 `exit`/`jmp`/`jcc`/`call`/`ret`/`i199`/`i0ae`。
 * - `doc-argc-missing`：`opcodes.json` 的 `argc` 为 null（= `opcode-table.md` 的 argc 列留空），
 *   而体里的 N 给出了真值 `argc = (N-1)/2` ⇒ 文档列待补（本守卫把真值记在这里，免得再来回读体）。
 */
const ALLOW_ZERO: Record<string, string> = {
  '0x2': 'exit：跨脚本返回（自己定 ip）',
  '0x84': '审计 P2 `op-8-F?`：op1 是控制流目标 ⇒ 体写 0（自己定 ip）',
  '0xd5': '阶梯动画时间表：op1 = 输入打断 label ⇒ 体写 0（控制流）',
};

/** `argc` 列缺失的行：**已由引擎 arity 槽补齐 15 行**（0x24b/0x24c/0x255/0x2ca/0x2cb/0x2ed/0x309/0x331/0x333/0x336/0x338/0x339/0x33a/0x33c/0x343），现在必须为 0。 */
const ALLOW_MISSING_ARGC = false;

interface Row extends ArityRow {}

/** 扫描口径已抽到 `test/arityScan.ts`（`test/operand-plan.test.ts` 用同一份 —— 两个守卫不许各有各的解析）。 */
function scan(): { rows: Row[]; skipped: number[]; noHandler: number[] } {
  return scanArity();
}

test('★arity 槽核验：体里的指令长度 N 必须 = 2*argc+1（N=0 只允许控制流；新增不一致即红）', () => {
  const { rows, skipped } = scan();
  const bad: string[] = [];
  const zeros: string[] = [];
  const missing: Row[] = [];
  for (const r of rows) {
    const key = `0x${r.op.toString(16)}`;
    if (r.step === 0) {
      if (!ALLOW_ZERO[key]) zeros.push(`${key}(${r.handler}) 体写 0（控制流白名单里没有它）`);
      continue;
    }
    if (r.argc === null || r.argc === undefined) {
      missing.push(r);
      continue;
    }
    const want = 2 * r.argc + 1;
    if (r.step !== want) bad.push(`${key}(${r.handler}) 体写 ${r.step}，argc=${r.argc} ⇒ 应为 ${want}`);
  }
  assert.deepEqual(bad, [], `指令长度与文档 argc 不一致（加进白名单前先核体）：\n  ${bad.join('\n  ')}`);
  assert.deepEqual(zeros, [], `体写 0 但不在控制流白名单里：\n  ${zeros.join('\n  ')}`);
  if (!ALLOW_MISSING_ARGC) assert.deepEqual(missing, [], `argc 列缺失：${missing.length} 条`);
  // 覆盖率：解析到的 opcode 数不能太少（否则说明解析口径坏了）
  assert.ok(rows.length > 250, `解析覆盖异常：只解析出 ${rows.length} 条（跳过 ${skipped.length}）`);
  // ★把"文档 argc 空洞"的量级报出来（引擎体给出了真值 ⇒ 补列是机械工作，见 T-0082）
  console.log(
    `[arity] 解析 ${rows.length} 条；N=0（控制流）${rows.filter((r) => r.step === 0).length} 条；` +
      `文档 argc 缺失 ${missing.length} 条（引擎真值：${missing
        .slice(0, 12)
        .map((r) => `0x${r.op.toString(16)}=${(r.step - 1) / 2}`)
        .join(' ')} …）`,
  );
});

test('★arity 槽核验：解析覆盖率与几何关系自检（N = 0（控制流）或奇数 ≥1）', () => {
  const { rows } = scan();
  for (const r of rows) {
    assert.ok(
      r.step === 0 || (r.step >= 1 && r.step % 2 === 1),
      `0x${r.op.toString(16)} 的 arity 槽值 ${r.step} 既不是 0（控制流）也不是奇数 ⇒ 解析口径需复核`,
    );
  }
  // 至少覆盖 250 条，且其中 argc>0 的占多数（证明不是只解析到 argc=0）
  assert.ok(rows.filter((r) => r.argc > 0).length > 150, 'argc>0 的覆盖数异常');
});
