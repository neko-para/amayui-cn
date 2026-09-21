/**
 * **per-opcode 操作数计划**（`tickets/T-0082` RF-A；审计 `docs-new/99-records/2026-09-audit/audit-2026-09-opcodes.md`）。
 *
 * ## 为什么有这一层（根因）
 * 修前每个 handler 各自手写 `readIntOperand(e, frame, instr, n)` 的**顺序与类型**，于是
 * 「读几位、什么类型、写哪几位」没有任何单一真源：
 *  - 审计的 13 处错读里，最典型的一类是**类型错位**（`0x34B` 把 `op2`(delay) 当缩放百分数、
 *    把 `op4..op6` 三个 float 整个丢掉；`0x348` 把轴角旋转当缩放）—— 这类错**不报错**，
 *    只是把 `0x3F800000` 这种位模式当成 1065353216 用；
 *  - 还有一类是**读位数与引擎的 arity 槽不符**（少读 ⇒ 脚本那一格永远是旧值）。
 *
 * ⇒ 本模块把「一条指令的操作数长什么样」变成**声明**（`OperandPlan`），由这里的共享执行器统一读，
 *   handler 只消费计划结果；再据此自动核验三方一致：
 *   **引擎 arity 槽 N**（`_this[30*cur + 95805]`，真源 = 反编译体）⟷ **文档 argc**（`scripts/asm/opcodes.json`）
 *   ⟷ **计划 argc**（本文件）⟷ **handler 实际碰过的位**（守卫 `test/opcode-operands.test.ts`）。
 *
 * ## arity 槽（帧字段 `Frame.arity`）
 * 引擎**每条 handler 体**都写「本指令占几个 dword」：`_this[30*cur+95805] = N`，关系 **N = 2*argc + 1**
 * （每个操作数 2 dword：类型 + 载荷）；唯一的例外是**控制流指令自己定 ip** 的那 3 条
 * （`0x2` exit / `0x84` 文本回调 / `0xd5` 阶梯动画时间表）—— 它们的体里写 **0**，于是派发器那行
 * `_this[30*cur+95782] += 4 * _this[30*cur+95805]`（raw **20165**）**不前进**，由 handler 自己改 ip。
 *
 * ★**它在 emulator 里的等价物是解析器的 dword 索引表**（`BinInstruction.index`，装载时算好）
 * —— 所以本字段不是"用来推进 ip 的"，而是**用来核验口径的**：`Frame.arity` 由派发器按引擎公式写入，
 * `StepTrace.arity` 把它报给控制窗，守卫再拿它与反编译体里解析出的 N 逐条对照（`test/opcode-arity.test.ts`）。
 * 这样"文档写 8、体只读 7"这类不一致（审计实证 `0x1E`）在 CI 里立即可见。
 *
 * ## 纪律
 *  - **新写的 handler 必须走计划层**；老 handler 按批迁移（迁移期间允许两条路径并存）。
 *  - 计划只声明**引擎体真的读/写**的位（不补"读了再丢"的死读，见 `test/opcode-operands.test.ts` 的白名单纪律）。
 *  - `evidence` 必须写得出处（raw 行区间 / 审计条目 / 语料锚点）。
 */
import type { Engine, Frame } from './engine.js';
import type { BinInstruction } from '../script/bin.js';
import type { Ref } from './ref.js';
import {
  readFloatOperand,
  readIntOperand,
  readStringOperand,
  refFromOperand,
  writeFloatOperand,
  writeIntOperand,
  writeStringOperand,
} from './operand.js';

/** 操作数类型（计划声明用）：`any` = 引擎按操作数自身的 tag 决定（族内混排）。 */
export type OperandKind = 'int' | 'float' | 'str' | 'ptr' | 'any';

/** 操作数方向：`r` 只读、`w` 只写、`rw` 先读后写。缺省 = 全 `r`。 */
export type OperandIo = 'r' | 'w' | 'rw';

export interface OperandPlan {
  /** 操作数个数（= 文档 argc = `(N-1)/2`）。 */
  readonly argc: number;
  /** 逐位类型；长度必须 = `argc`。 */
  readonly kinds: readonly OperandKind[];
  /** 逐位方向；缺省全 `r`（长度给了就必须 = `argc`）。 */
  readonly io?: readonly OperandIo[];
  /** 出处：raw 行区间 / 审计条目 / 语料锚点（守卫会检查非空）。 */
  readonly evidence: string;
}

/**
 * **arity 槽写 0 的指令**（= 自己定 ip 的控制流）。
 *
 * 真源：反编译体里 `95805] = 0;` 的三条（`test/opcode-arity.test.ts` 的 `ALLOW_ZERO` 与它同源）：
 *  - `0x2` exit（`sub_41A820`）：跨脚本返回；
 *  - `0x84`（`sub_41F790`）：op1 是控制流目标（文本回调状态机）；
 *  - `0xd5`（`sub_42ACC0`）：op1 = 输入打断 label（阶梯动画时间表）。
 *
 * ★注意**不要**把 `jmp`/`call`/`jcc`/`ret` 放进来：它们的体**照写** `2*argc+1`
 * （实测：`0x8c`→3、`0x8f`→3、`0xa0`→7、`0x5`→1），只是 `jmp`/`jcc` 之后派发器的 `+= 4*N`
 * 追不上 handler 自己改的 ip 而已。
 */
export const ZERO_LENGTH_OPS: ReadonlySet<number> = new Set([0x2, 0x84, 0xd5]);

/**
 * 引擎 arity 槽的值（`_this[30*cur + 95805]`），单位 = **dword 数（含 opcode）**。
 * 关系 `N = 2*argc + 1`；控制流三兄弟（`ZERO_LENGTH_OPS`）为 0。
 */
export function operandCountSlotValue(op: number, argc: number): number {
  if (!Number.isInteger(argc) || argc < 0) throw new Error(`argc 非法：${argc}（opcode 0x${op.toString(16)}）`);
  return ZERO_LENGTH_OPS.has(op) ? 0 : 2 * argc + 1;
}

/** 一次计划执行的操作数视图：按**计划声明的类型**读/写，并记账"碰过哪几格"。 */
export interface PlannedOperands {
  readonly op: number;
  readonly plan: OperandPlan;
  readonly argc: number;
  /** 本条指令的 arity 槽值（`2*argc+1`）。 */
  readonly arity: number;
  /** 已碰过的位（1-based；读与写都算）——供守卫核对"读位数"。 */
  readonly touched: ReadonlySet<number>;
  /** 操作数是否存在（测试会构造"缺实参"的指令；缺 ⇒ 返回 undefined 而不是抛，语义见各 handler）。 */
  present(n: number): boolean;
  /** 读第 n 位为 int。★声明为 `float` 的位**不许**用 int 读（审计 `op-9-op840` 的位模式 bug 类）。 */
  int(n: number): number | undefined;
  /** 读第 n 位为 float（声明为 `int` 的位允许 —— 引擎 `sub_41C300` 对 int 型是 int→float 转换）。 */
  float(n: number): number | undefined;
  /** 读第 n 位为字符串。 */
  str(n: number): string | undefined;
  /** 读第 n 位为引用（指针型操作数）。 */
  ptr(n: number): Ref | undefined;
  /** 写第 n 位（方向必须允许写）。 */
  setInt(n: number, v: number): void;
  setFloat(n: number, v: number): void;
  setStr(n: number, s: string): void;
}

/** 计划执行器需要的最小上下文（`StepCtx` 满足它；守卫也可以直接构造）。 */
export interface OperandSource {
  e: Engine;
  frame: Frame;
  instr: BinInstruction;
}

const PLANS = new Map<number, OperandPlan>();

/**
 * 声明一条指令的操作数计划。**重复声明即抛**（同一个 opcode 只能有一个真源）。
 */
export function declarePlan(op: number, plan: OperandPlan): void {
  if (PLANS.has(op)) throw new Error(`opcode 0x${op.toString(16)} 的操作数计划重复声明`);
  if (plan.kinds.length !== plan.argc) {
    throw new Error(`0x${op.toString(16)} 的计划 kinds=${plan.kinds.length} 与 argc=${plan.argc} 不符`);
  }
  if (plan.io && plan.io.length !== plan.argc) {
    throw new Error(`0x${op.toString(16)} 的计划 io=${plan.io.length} 与 argc=${plan.argc} 不符`);
  }
  if (!plan.evidence.trim()) throw new Error(`0x${op.toString(16)} 的计划缺 evidence`);
  PLANS.set(op, plan);
}

export function planOf(op: number): OperandPlan | undefined {
  return PLANS.get(op);
}

/** 已声明的 opcode（升序）—— 守卫用它报告迁移进度。 */
export function plannedOps(): number[] {
  return [...PLANS.keys()].sort((a, b) => a - b);
}

/**
 * 取本指令的操作数计划视图；**没有计划 ⇒ 返回 `undefined`**（老 handler 继续手写读法）。
 *
 * 类型/方向的越权访问是**编程错误**（不是运行时数据问题）⇒ 直接抛，且消息里带上 opcode 与位号，
 * 这样"把 float 当 int 读"这类审计结论会在第一次跑到时立刻炸出来，而不是静默算出一个巨大的整数。
 */
export function operandsFor(src: OperandSource): PlannedOperands | undefined {
  const op = src.instr.opcode;
  const plan = PLANS.get(op);
  if (!plan) return undefined;
  const touched = new Set<number>();
  const args = src.instr.args;
  const kindOf = (n: number): OperandKind => plan.kinds[n - 1] ?? 'any';
  const ioOf = (n: number): OperandIo => plan.io?.[n - 1] ?? 'r';
  const has = (n: number): boolean => n >= 1 && n <= plan.argc && args.length >= n;
  const deny = (n: number, what: string, got: OperandKind): never => {
    throw new Error(
      `0x${op.toString(16)} 的第 ${n} 位操作数计划声明为 ${got}，不能按 ${what} 访问（计划：${plan.evidence}）`,
    );
  };
  const denyIo = (n: number, what: string): never => {
    throw new Error(`0x${op.toString(16)} 的第 ${n} 位操作数方向为 ${ioOf(n)}，不能${what}（计划：${plan.evidence}）`);
  };
  const view: PlannedOperands = {
    op,
    plan,
    argc: plan.argc,
    arity: operandCountSlotValue(op, plan.argc),
    touched,
    present: has,
    int(n) {
      if (!has(n)) return undefined;
      const k = kindOf(n);
      if (k === 'float') deny(n, 'int', k);
      touched.add(n);
      return readIntOperand(src.e, src.frame, src.instr, n);
    },
    float(n) {
      if (!has(n)) return undefined;
      touched.add(n);
      return readFloatOperand(src.e, src.frame, src.instr, n);
    },
    str(n) {
      if (!has(n)) return undefined;
      const k = kindOf(n);
      if (k !== 'str' && k !== 'any') deny(n, 'str', k);
      touched.add(n);
      return readStringOperand(src.e, src.frame, src.instr, n);
    },
    ptr(n) {
      if (!has(n)) return undefined;
      const k = kindOf(n);
      if (k !== 'ptr' && k !== 'any') deny(n, 'ptr', k);
      touched.add(n);
      return refFromOperand(src.e, src.frame, src.instr, n);
    },
    setInt(n, v) {
      if (!has(n)) return;
      const io = ioOf(n);
      if (io !== 'w' && io !== 'rw') denyIo(n, '写');
      touched.add(n);
      writeIntOperand(src.e, src.frame, src.instr, n, v);
    },
    setFloat(n, v) {
      if (!has(n)) return;
      const io = ioOf(n);
      if (io !== 'w' && io !== 'rw') denyIo(n, '写');
      touched.add(n);
      writeFloatOperand(src.e, src.frame, src.instr, n, v);
    },
    setStr(n, s) {
      if (!has(n)) return;
      const io = ioOf(n);
      if (io !== 'w' && io !== 'rw') denyIo(n, '写');
      touched.add(n);
      writeStringOperand(src.e, src.frame, src.instr, n, s);
    },
  };
  return view;
}

// ---------------------------------------------------------------------------
// 计划表（按子系统分批声明；`evidence` 必填）
//
// ★迁移纪律：**只声明核过体的位与类型**。语料 0 命中的族照样声明（合成指令守卫会覆盖它们）。
// ---------------------------------------------------------------------------

/** Live2D 立绘节点变换族（`handlers/live2d.ts`）：int 参数与 float 分量**混排**是这一族的常态。 */
declarePlan(0x347, {
  argc: 4,
  kinds: ['int', 'float', 'float', 'float'],
  evidence: 'sub_427E10 raw 34567-34580：op1=key(int)、op2..op4=float 三分量（各 ÷100，dbl_5201F0=100.0 raw 4430）',
});

declarePlan(0x348, {
  argc: 5,
  kinds: ['int', 'float', 'float', 'float', 'float'],
  evidence:
    'sub_427EA0 raw 34583-34599：op1=key(int)、op2..op4=旋转轴(float，不除 100)、op5=角度(float，度)（审计 op-9-op840-348-is-rotation-not-scale）',
});

declarePlan(0x349, {
  argc: 4,
  kinds: ['int', 'float', 'float', 'float'],
  evidence: 'sub_427F30 raw 34602-34615：op1=key(int)、op2..op4=平移(float，像素)',
});

declarePlan(0x34a, {
  argc: 4,
  kinds: ['int', 'float', 'float', 'float'],
  evidence: 'sub_427FB0 raw 34618-34631：op1=key(int)、op2..op4=基础偏移(float，写 record[2..4])',
});

declarePlan(0x34b, {
  argc: 6,
  kinds: ['int', 'int', 'int', 'float', 'float', 'float'],
  evidence:
    'sub_428030 raw 34633-34651：op1=key(int)、op2=delay(int)、op3=dur(int)、op4..op6=float 三分量（÷100）（审计 op-6-01：旧实现把 op2 当百分数并丢弃 op4..op6）',
});

declarePlan(0x34c, {
  argc: 7,
  kinds: ['int', 'int', 'int', 'float', 'float', 'float', 'float'],
  evidence: 'sub_4280D0 raw 34655-34674：op1=key、op2=delay(int)、op3=dur(int)、op4..op6=轴(float)、op7=角(float 度)',
});

declarePlan(0x34d, {
  argc: 6,
  kinds: ['int', 'int', 'int', 'float', 'float', 'float'],
  evidence: 'sub_428170 raw 34677-34694：op1=key、op2=delay(int)、op3=dur(int)、op4..op6=平移(float，像素)',
});

/** 槽↔槽转送：`0x207`（同尺寸 StretchRect）与 `0x32`（缩放 StretchTexture）。 */
declarePlan(0x32, {
  argc: 10,
  kinds: ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'],
  evidence:
    'sub_41E2D0 raw 27955-28008：op1=源槽、op2=目标槽、op3..6=源矩形 x/y/w/h、op7..10=目标矩形（语料 337 处同形 `i032 2 e 0 0 500 2d0 0 0 140 b4`）',
});

/** 纹理槽绑定族。 */
declarePlan(0x1f9, {
  argc: 3,
  kinds: ['int', 'int', 'int'],
  evidence: 'sub_422CB0 raw 31192-31243：op1=图像 id、op2=槽、op3=颜色（raw 31225-31230 读 op3 并归一化成 0xFFrrggbb）',
});

/** 影片族。 */
declarePlan(0x20f, {
  argc: 3,
  kinds: ['int', 'int', 'int'],
  evidence: 'sub_4237B0 raw 31604-31670（arity 槽 7 ⇒ argc 3）：op1=影片 id、op2=影片槽、op3=音量/模式',
});

/** 绘制项着色族（`handlers/gfx-item.ts`）。 */
declarePlan(0x202, {
  argc: 5,
  kinds: ['int', 'int', 'int', 'int', 'int'],
  evidence: 'sub_4231F0 raw 31382-31405：op1=图元、op2=delay、op3=dur、op4=α（>255 钳、<0 取当前色 α）、op5=颜色（<0 取当前色）',
});

declarePlan(0x203, {
  argc: 4,
  kinds: ['int', 'int', 'int', 'int'],
  evidence: 'sub_4232C0 raw 31419-31451：op1=handle、op2=blend(DrawItem+0x30)、op3=α（clamp/回退）、op4=颜色（<0 回退）（审计 op-4-06）',
});

/** GDI 文本重绘（`tickets/T-0104`）。 */
declarePlan(0x82, {
  argc: 5,
  kinds: ['int', 'int', 'int', 'int', 'int'],
  evidence:
    'sub_41F720 raw 28808-28826（arity 槽 11 ⇒ argc 5）：op1=窗索引、op2=起始文本记录下标、op3=模式/标志位、op4=填充色、op5=描边色（五格全 `sub_41BF50` int 读；转 sub_466000 raw 79319-80311）',
});
