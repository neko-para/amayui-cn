/**
 * **阶梯动画调度器 opcode 族（`0xD3` / `0xD4` / `0xD5`）** —— 状态模型见 `../stageLoop.ts`（含逐行 raw 锚点）。
 *
 * 三条一起用，形态在全语料 7 处完全一致（`SAVE` / `HISTORY` / `ADDEXP` / `BTL`×4）：
 *
 * ```
 * i0d3                                   ; 清表
 * i0d4 <step> <count> <body> <tail>      ; 追加条目（时刻累计）
 * i0d4 1 2 <body> <body>                 ; 收尾哨兵（见 stageLoop.ts 的"派发次数 = 条目数 − 1"）
 * i0d5 ffffffff                          ; 起表 + 置 0x40 门（本指令不前进）
 * <label_xxxx>…                          ; 到点由主循环 sub_408F10 直接派发
 * ```
 *
 * ★`0xD4` 的**操作数 3/4 是 label**（dword 偏移），这一点在反汇编器一侧早已登记：
 * `scripts/asm/age-shared.mjs` 的 `isLabelArgument` 第 3 条就是 `opcode === 0xD4 && x >= 2`
 * —— 本条实现只是把它接到了 VM 上。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { readIntOperand } from '../operand.js';
import { STAGE_GATE } from '../stageLoop.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 收尾批：阶梯动画时间表族（stage），3 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：阶梯动画时间表族（stage）走操作数计划层，但没有声明计划`);
  return p;
}


/**
 * `0xD3`（`sub_42AC40` raw 36668-36685，argc 0）：**清空阶梯时间表**。
 *
 * 引擎体逐行：写游标 `-1`、打断 label `-1`、当前下标 `0`，并把 `begin == end`（清向量）。
 * 返回值（旧 `end` 指针）在本 VM 里无人消费 ⇒ 不复刻。
 */
const op_stage_reset: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.stage.reset();
};

/**
 * `0xD4`（`sub_42E940` raw 38801-38905，argc 4）：**追加时间表条目**。
 *
 * `op1` = 与前一条的**间隔 ms**（第一条相对 `t0` 即 `op1`）、`op2` = 条目数、
 * `op3` = 到点入口 label、`op4` = "落后"时改用的入口 label。
 * 时刻**累计**（`v21 = v2 + readIntOperand(1)`，`v2` = 上一条的 `dword0`）⇒ 多次 `i0d4`
 * 天然接续上一条的时刻，语料就是靠这一点把"重活 N 次 + 收尾 2 次"拼成一条时间轴。
 */
const op_stage_add: OpHandler = (c) => {
  const plan = planFor(c);
  const step = (plan.int(1) ?? 0);
  const count = (plan.int(2) ?? 0);
  const body = (plan.int(3) ?? 0);
  const tail = (plan.int(4) ?? 0);
  c.e.stage.add(step, count, body, tail);
};

/**
 * `0xD5`（`sub_42ACC0` raw 36689-36727，argc 1）：**起表 + 置门**。
 *
 * `op1` = 输入打断 label（**全语料 7/7 处 = `ffffffff` = 不打断**）。
 * 引擎体三段：
 * 1. `95805 = 0`（**本指令不前进** —— `i0d5` 就是时间表的循环回边，脚本体 `ret` 回到这里）；
 * 2. `if (!index) { 刷输入 + 记 exitLabel + 起计时器 + 排序 }` ⇒ **只在第一次执行**；
 * 3. `index < cursor` ⇒ 置 `0x40` 门（调度器接管），否则恢复 `95805 = 3` 让脚本往下走。
 *
 * emulator：`c.jump(c.frame.ip)` = "停在同一条指令"，与 `95805 = 0` 等价。
 */
const op_stage_run: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const exitLabel = (plan.int(1) ?? 0);
  if (e.stage.index === 0) {
    // 引擎 raw 36699-36714：刷输入（消费挂起事件）→ 记身份/打断点 → 起计时器 → 排序。
    // ★输入刷在这里做（`sub_478090` + `sub_477220`）：起表那一刻把待处理输入吃掉，
    //   免得动画刚开始就被上一屏的点击打断。
    e.input.flushPending();
    e.input.consumeEdges();
    e.stage.begin(e.nowMs, exitLabel, e.cur, c.frame.scriptId, c.instr.index);
  }
  if (e.stage.shouldWait()) {
    e.waitFlags |= STAGE_GATE; // 引擎 `_this[699204] |= 0x40`
    c.jump(c.frame.ip); // 引擎 `95805 = 0`：不前进（脚本停在 i0d5 上等调度器）
  }
};

/** 阶梯动画调度器（`0xD3` / `0xD4` / `0xD5`）。 */
export const STAGE_OPS: OpTable = [
  [0xd3, op_stage_reset], // 清空时间表
  [0xd4, op_stage_add], // 追加条目（step / count / body / tail）
  [0xd5, op_stage_run], // 起表 + 排序 + 置 0x40 门（不前进）
];
