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
  readIndexOperand,
  readIntOperand,
  readStringOperand,
  refFromOperand,
  setRefOperand,
  writeFloatOperand,
  writeIntOperand,
  writeStringOperand,
} from './operand.js';

/** 操作数类型（计划声明用）：`any` = 引擎按操作数自身的 tag 决定（族内混排）。 */
export type OperandKind = 'int' | 'float' | 'str' | 'ptr' | 'any';

/**
 * 操作数方向：`r` 只读、`w` 只写、`rw` 先读后写、**`unused` = 指令里有这一格但**没人消费**。
 * 缺省 = 全 `r`。
 *
 * ★`unused` 的用处：引擎里有若干指令**带着一格从不使用的操作数**（真正的"死格"）——
 * 实测：`0x1D3` 的 op3（`sub_457960(Font,&out,op3,op4,op5)` 的 op3 未用）、`0x1D4` 的 op3（"死读"）、
 * `0x2F3` 的 op4、`0x1A1` 的 op1（引擎既不读也不写）。没有这个方向时只有两条路：
 * ① 谎报成 `w`（会被方向判据当成"写出目标"）；② 把整条指令排除出计划层（丢掉真实形状）。
 * ⇒ 加这一个方向，既保住"计划 = 形状真源"，又让"这一格没人用"变成**可声明、可核验**的事实。
 * 语义边界：`unused` 说的是**引擎/实现都不消费**；"引擎读、我们没消费端"（如 `0x33F`）**不是** `unused`，
 * 那种条目不进计划层（判据见批次注释）。
 */
export type OperandIo = 'r' | 'w' | 'rw' | 'unused';

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
  /**
   * 读第 n 位的**下标**（不是值）—— 引擎 `sub_418A30(n)` / `sub_418AE0(n)` 的口径：
   * 「把第 n 个操作数当**槽号/索引**用」（字符串表族 `0x1A2/0x1A3/0x1A9/0x1AA` 的键就是它）。
   *
   * ★与 `int(n)` 的区别是本质的：`int(n)` 读**槽里的值**，`index(n)` 读**槽号本身**。
   * 引擎的表族正是拿槽号当键（`wsprintfA("%c%8.8x", 哨兵, idx)`）⇒ 少了这个访问器，
   * 表族只能继续手写 `readIndexOperand`，计划层就覆盖不到它们。
   */
  index(n: number): number | undefined;
  /** 写第 n 位（方向必须允许写）。 */
  setInt(n: number, v: number): void;
  setFloat(n: number, v: number): void;
  setStr(n: number, s: string): void;
  /**
   * 写第 n 位为**引用**（指针型目标）—— 取址/数组族（`0x61`/`0x63`/`0x2C9`）的结果就是"元素地址"。
   *
   * ★与 `setStr` 同形（方向检查 + 记账），只是落到 `setRefOperand`；没有它就覆盖不到取址族。
   */
  setPtr(n: number, r: Ref): void;
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
    index(n) {
      if (!has(n)) return undefined;
      // 下标与类型无关（任何操作数都有槽号）⇒ 不限 kind；方向仍按"读"处理
      touched.add(n);
      return readIndexOperand(src.e, src.frame, src.instr, n);
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
    setPtr(n, r) {
      if (!has(n)) return;
      const io = ioOf(n);
      if (io !== 'w' && io !== 'rw') denyIo(n, '写');
      touched.add(n);
      setRefOperand(src.e, src.frame, src.instr, n, r);
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

// ---------------------------------------------------------------------------
// 批次：**引擎字段写入族**（共用 handler `op_engine_field_store`，14 条）
//
// 这 14 条形状完全一样：「读 op_n（int）→ 写一个 `ENGINE_FIELD`」，方向全 `r`（写的是引擎字段，
// 不是操作数）。字段映射的真源 = `handlers/engine-fields.ts` 的 `ENGINE_FIELD_STORE`。
//
// ★为什么 `argc`/`kinds` 可以照抄而**不算猜**：两条既有守卫已经把这三方焊死了 ——
//  ① `test/opcode-arity.test.ts` + `test/arityScan.ts`：文档 argc ⟷ **反编译体里写的 N**
//     （`_this[30*cur+95805] = N`，N = 2*argc+1）逐条比对；
//  ② `test/opcode-operands.test.ts`：已注册 handler 必须**碰满** 1..argc（漏读要么修、要么进白名单
//     并写原因）。本族 14 条**都不在白名单里** ⇒ 现实现已经碰满每一格。
//  ⇒ 本批计划的唯一新增信息是**类型**（全部 int）与"方向全读"，其余由上面两条守卫背书。
//
// ★`0x1a4` 是唯一的两位（描边偏移 dx/dy，映射到两个字段）。
// ---------------------------------------------------------------------------

/** 字段真源 = `engineFieldIds.ts`（每格带 raw 写入点）；计划只声明"读几格、什么类型"。 */
const FIELD_STORE_EVIDENCE =
  'argc 由 `test/opcode-arity.test.ts`（文档 ⟷ 体 `_this[30*cur+95805]=N`，N=2*argc+1）背书；' +
  '类型 int：体 `sub_41BF50(_this, n)`（raw 一族）后直写 `ENGINE_FIELD`，见 handlers/engine-fields.ts 的 ENGINE_FIELD_STORE';

declarePlan(0x76, { argc: 1, kinds: ['int'], evidence: `填充色 → Font+1360（+ bgrToRgb）。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x77, { argc: 1, kinds: ['int'], evidence: `描边色 → Font+1364（+ bgrToRgb）。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x78, { argc: 1, kinds: ['int'], evidence: `描边档位 outlineMode。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x8b, { argc: 1, kinds: ['int'], evidence: `行间距 Font+1380。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x10f, { argc: 1, kinds: ['int'], evidence: `帧字段 122369。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x1a4, { argc: 2, kinds: ['int', 'int'], evidence: `描边偏移 dx/dy（两格各写一个字段）。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x1cf, { argc: 1, kinds: ['int'], evidence: `消息跳读态 122504（sub_4213C0）。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x21b, { argc: 1, kinds: ['int'], evidence: `引擎布尔寄存器（写成 0/1）。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x24e, { argc: 1, kinds: ['int'], evidence: `消息字段 92340。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x252, { argc: 1, kinds: ['int'], evidence: `消息系统配置 92323。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x25b, { argc: 1, kinds: ['int'], evidence: `消息态图像 92381。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x261, { argc: 1, kinds: ['int'], evidence: `竖排标志 Font+235108。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x2db, { argc: 1, kinds: ['int'], evidence: `文本属性 fontMetricsMode 71744。${FIELD_STORE_EVIDENCE}` });
declarePlan(0x2e9, { argc: 1, kinds: ['int'], evidence: `ADV 自动翻页行基准 122464（审计 op-2-01）。${FIELD_STORE_EVIDENCE}` });

// ---------------------------------------------------------------------------
// 批次：**配置读取族**（7 条，`handlers/config-read.ts` 的 `op_cfg_read`）
//
// 形状 = 「读配置键 → **写回脚本操作数**」：方向**不是**全 `r` —— 结果位是 `w`、选择器位是 `r`。
// 这是计划表第一次用到 `io`（此前 27 条全是只读）⇒ 也顺带把"计划声明的方向"这条判据跑起来。
//
// 出处 = 该文件头部的实证表（每条的 handler + raw 行区间 + 读法/写回列），逐条抄进 evidence。
// `argc` 由 `test/opcode-arity.test.ts`（文档 argc ⟷ 体 `_this[30*cur+95805]=N`）背书。
// ---------------------------------------------------------------------------

declarePlan(0xc5, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'w'],
  evidence: 'config-read.ts:12：sub_42E540 raw 38626-38667 —— op1 选 0..4（sound:Volume0..4；越界报错不写）、op2 = 写回目标',
});
declarePlan(0xc7, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'w'],
  evidence: 'config-read.ts:13：sub_42E670 raw 38671-38716 —— op1 选 1..4（Music/SE/Voice/Movie，非 0→1）、op2 = 写回目标',
});
declarePlan(0x1b8, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'w'],
  evidence: 'config-read.ts:14：sub_42D2F0 —— op1 选 0/1（message:AutoMessageTime0/1）、op2 = 写回目标',
});
declarePlan(0x2cc, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence: 'config-read.ts:15：sub_4309E0 raw 40101-40107 —— 无选择器，op1 = 写回目标（message:AdvanceMesOnWheel）',
});
declarePlan(0x2e6, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'w'],
  evidence: 'config-read.ts:16：sub_431110 raw 40353-40376 —— op1 选 0/1（message:AutoMessagePitch0/1）、op2 = 写回目标',
});
declarePlan(0x2ea, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence: 'config-read.ts:17：sub_4311B0 raw 40380-40386 —— 无选择器，op1 = 写回目标（message:AutoMessageOption）',
});
declarePlan(0x2ed, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence:
    'config-read.ts:76-84：sub_431230 raw 40401-40409（arity 槽 3 ⇒ argc 1）—— `GetConfig("message:MessageFade")` → `sub_42B4B0(_this, 1, v2)` 写回 op1（T-0098）',
});

// ---------------------------------------------------------------------------
// 批次：**字符串 → 整型/字符串回写族**（6 条，`handlers/strings.ts` 与 `config-read.ts`）
//
// 形状 = 「读一两个字符串操作数 → 把结果写回 op1」：`0x2c5/0x2c6/0x1a6` 写 **int**、
// `0x194/0x195` 写比较结果（int）、`0x2eb` 写 **string**（配置串）。
// ⇒ 计划表第一次出现 `str` 类型位与 `w` 的字符串位；守卫 `test/operand-plan.test.ts` 的
//   合成实参按计划类型构造（str 位给字符串型实参），所以这些位也能被机械核验。
// ---------------------------------------------------------------------------

declarePlan(0x2c5, {
  argc: 2,
  kinds: ['int', 'str'],
  io: ['w', 'r'],
  evidence: 'strings.ts 的 0x2C5（sub_430900 raw 40063-40071）：op2 = 字符串，op1 = strlen **字节**数（SJIS 口径）',
});
declarePlan(0x2c6, {
  argc: 2,
  kinds: ['int', 'str'],
  io: ['w', 'r'],
  evidence: 'strings.ts 的 0x2C6（sub_430940 raw 40073-40084）：op2 = 字符串，op1 = `_mbstrlen` **字符**数',
});
declarePlan(0x1a6, {
  argc: 2,
  kinds: ['int', 'str'],
  io: ['w', 'r'],
  evidence: 'strings.ts 的 0x1A6（sub_42D110 raw 37974-37982，arity 槽 5 ⇒ argc 2）：op1 = strlen(op2) >> 1（字节口径的一半）',
});
declarePlan(0x194, {
  argc: 3,
  kinds: ['int', 'str', 'str'],
  io: ['w', 'r', 'r'],
  evidence: 'config-read.ts:18/131：sub_42CF10 raw 37909-37938 —— op1 = (op2 == op3)，两个字符串操作数经 sub_42A420 取出',
});
declarePlan(0x195, {
  argc: 3,
  kinds: ['int', 'str', 'str'],
  io: ['w', 'r', 'r'],
  evidence: 'config-read.ts:151：sub_42D010 raw 37942-37972 —— op1 = (op2 != op3)，与 0x194 逐行同构（只差最后一步取反）',
});
declarePlan(0x2eb, {
  argc: 1,
  kinds: ['str'],
  io: ['w'],
  evidence:
    'config-read.ts:103：sub_434830 raw 42575-42593 —— `GetConfig("set:GameVersion")` 拷成串后 `sub_433310(this, 1, 串)` **写回 op1（字符串型）**',
});

// ---------------------------------------------------------------------------
// 批次：**字符串核心族 + 字符串表族**（13 条，`handlers/strings.ts`）
//
// 两条子族：
//  - 字符串核心：`0x192`(set-string) / `0x193`(concat) / `0x1c8`(to-string) /
//    `0x2c7`(SBSubstr 字节) / `0x2c8`(substr 字符) / `0x2ec`(atoi) / `0x1b2/0x1b3/0x1b4`(文本缓冲)；
//  - 字符串表：`0x1a2`(save-int) / `0x1a3`(load-int) / `0x1a9`(save-string) / `0x1aa`(load-string)
//    —— 它们把操作数当**槽号**用（引擎 `sub_418A30/sub_418AE0`）⇒ 计划层为此新增 `index(n)` 访问器。
//
// 出处 = `analysis/opcodes.json` 的 handler 名与语义列（逐条写进 evidence）；`argc` 由
// `test/opcode-arity.test.ts`（文档 argc ⟷ 体 `_this[30*cur+95805]=N`）背书。
// ★本批之后，`test/opcode-operands.test.ts` 白名单里"需要字符串型操作数"那 9 条全部可以删
//   （守卫的合成实参改成按计划类型构造即不再需要豁免）。
// ---------------------------------------------------------------------------

declarePlan(0x192, {
  argc: 2,
  kinds: ['str', 'str'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x192 handler=sub_433660（argc 2）—— `op1 = op2`（sub_42A420 读 op2 串 → sub_433310 写回 op1 串；汉化核心指令）',
});
declarePlan(0x193, {
  argc: 3,
  kinds: ['str', 'str', 'str'],
  io: ['w', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x193 handler=sub_433710（argc 3）—— `op1 = op2 + op3`（op2 在前；sub_42AA90 拼接 → sub_433310 写回 op1 串）',
});
declarePlan(0x1c8, {
  argc: 2,
  kinds: ['str', 'int'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x1c8 handler=sub_433820（argc 2；strings.ts:45-53 引 raw 41989-42010）—— `op1（串）= "%d"(op2)`',
});
declarePlan(0x2c7, {
  argc: 4,
  kinds: ['str', 'str', 'int', 'int'],
  io: ['w', 'r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x2c7 handler=sub_433FD0（argc 4；raw 42259-42376）—— `op1（串）= substr(串op2, op3=起始字节, op4=字节长度)`（SJIS 边界修正）',
});
declarePlan(0x2c8, {
  argc: 4,
  kinds: ['str', 'str', 'int', 'int'],
  io: ['w', 'r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x2c8 handler=sub_434260（argc 4；raw 42379-42457）—— 同上但 op3/op4 是**字符**下标与长度',
});
declarePlan(0x2ec, {
  argc: 2,
  kinds: ['int', 'str'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x2ec handler=sub_4311F0（argc 2；raw .c 40390）—— `op1 = atoi(串op2)`',
});
declarePlan(0x1b2, {
  argc: 1,
  kinds: ['str'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0x1b2 handler=sub_42A9B0（argc 1；raw 36550-36558）—— 把 op1 串**追加**到文本缓冲（`Engine+497344`），不写操作数',
});
declarePlan(0x1b3, {
  argc: 0,
  kinds: [],
  io: [],
  evidence: 'analysis/opcodes.json：0x1b3 handler=sub_42AA00（argc 0；raw 36560-36565）—— 往同一缓冲追加 `"\\r\\n"`（raw 4320），无操作数',
});
declarePlan(0x1b4, {
  argc: 0,
  kinds: [],
  io: [],
  evidence: 'analysis/opcodes.json：0x1b4 handler=sub_428DB0（argc 0；raw 35322-35331）—— 取出文本缓冲整段并清空，无操作数',
});
declarePlan(0x1a2, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0x1a2 handler=sub_434F60（argc 1）—— save-int：读 op1 的**值**+**槽号**作键（`wsprintfA("%c%8.8x",3,idx)`）登记进 `_this+5452`，**不写操作数**',
});
declarePlan(0x1a3, {
  argc: 1,
  kinds: ['int'],
  io: ['rw'],
  evidence: 'analysis/opcodes.json：0x1a3 handler=sub_42DF40（argc 1）—— load-int：`sub_418A30(1)` 读 op1 **槽号**作键查表，命中把值 `sub_42B4B0(_this,1,v)` **写回 op1**',
});
declarePlan(0x1a9, {
  argc: 1,
  kinds: ['str'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0x1a9 handler=sub_434FE0（argc 1）—— save-string：读 op1 串与其**字符串索引**（`sub_418AE0(1)`）作键登记进 `_this+5472`，**不写操作数**',
});
declarePlan(0x1aa, {
  argc: 1,
  kinds: ['str'],
  io: ['rw'],
  evidence: 'analysis/opcodes.json：0x1aa handler=sub_433A70（argc 1）—— load-string：`sub_418AE0(1)` 读索引查表，命中把串**写回 op1**',
});

// ---------------------------------------------------------------------------
// 批次：**审计点名的"操作数类型/顺序/多写少写"条**（7 条）
//
// 这 7 条正是 `tickets/T-0082` 的 `why` 与 `docs-new/03-engine/plan-2026-09.md` 的 RF-A 行点名的
// 操作数类缺陷（行为早已照体修好、各有守卫，缺的只是"走计划层"这一层）。本批补齐后，
// **两处点名的 opcode 全部有操作数计划**。
//
// ★两条 argc 0 的（`0x100`/`0x305`）也照样声明：计划层要能表达"这条指令没有操作数"
//   （`kinds: []`），否则"计划覆盖面"就会有一类永远说不清的洞。
// ★`0x2fc` 的方向**全是 `w`**：引擎在**无触点路径**上只写 `op1 = 0` 就返回，`op2..op5` **保持不动**
//   （raw 40798-40799；审计 `op-10-003`）⇒ 五个位都是"写出目标"，没有读位。
//   这也是 `test/opcode-operands.test.ts` 里 `0x2fc`/`0x1a0` 白名单条目**必须留着**的原因：
//   那条守卫只能看"碰没碰"，分不清读/写，而这两条按引擎语义就是"某些位不碰"。
// ---------------------------------------------------------------------------

declarePlan(0x100, {
  argc: 0,
  kinds: [],
  io: [],
  evidence:
    'analysis/opcodes.json：0x100 handler=sub_419AF0（argc 0，raw 25009-25048）—— 按键跳读派发：读 `Engine[174802]` 掩码与扫描游标，**无操作数**',
});
declarePlan(0x304, {
  argc: 0,
  kinds: [],
  io: [],
  evidence:
    'analysis/opcodes.json：0x304 handler=sub_41A420（argc 0，raw 25385-25399）—— 文本块开始（`0x305` 的配对方）：置 `Engine[122497]=1` + `win+296 = win+132`（保存行游标），**无操作数**',
});
declarePlan(0x305, {
  argc: 0,
  kinds: [],
  io: [],
  evidence:
    'analysis/opcodes.json：0x305 handler=sub_41B1C0（argc 0）—— 文本块结束（`0x304` 的配对方）：取回行游标 + 把余下的行一次性贴出 + 清 `Engine[122497]`，**无操作数**',
});
declarePlan(0x1ce, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence:
    'analysis/opcodes.json：0x1ce handler=sub_420280（argc 1）—— 逐字/字格显现开关：`op1 != 0` ⇒ 置 `effect_flags |= 0x40000000` + 清游标；`op1 == 0` ⇒ 只对当前窗收尾（只读 op1）',
});
declarePlan(0x1a0, {
  argc: 9,
  kinds: ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'],
  io: ['w', 'r', 'w', 'w', 'w', 'w', 'w', 'w', 'w'],
  evidence:
    'analysis/opcodes.json：0x1a0 handler=sub_42DC70（argc 9，raw 38381-38403）—— **读槽头**：op2 = 槽号（读）；op1 = 结果码（写：0 成功 / 1 打不开 / 2 解析失败）；op3..op9 = 年/月/日/时/分/秒/游玩秒数（写，**仅成功分支**，且写序在 op1 之前；审计 `op-2-06`）',
});
declarePlan(0x1b9, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'r'],
  evidence:
    'analysis/opcodes.json：0x1b9 handler=sub_41FF60（argc 2，raw 29191-29220）—— `message:AutoMessageTime{idx} <ms>`：op1 = idx（**严格 0/1**，其它值只打错误串、不写键）、op2 = 时长（两格都只读，写的是配置键）',
});
declarePlan(0x2e7, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'r'],
  evidence:
    'analysis/opcodes.json：0x2e7 handler=sub_426540（argc 2，raw 33534-33562）—— `message:AutoMessagePitch{idx} <ms>`：与 `0x1b9` 同形同门（审计 `op-10-001` 的"自造回退到 Pitch0"已修）',
});
declarePlan(0x2fc, {
  argc: 5,
  kinds: ['int', 'int', 'int', 'int', 'int'],
  io: ['w', 'w', 'w', 'w', 'w'],
  evidence:
    'analysis/opcodes.json：0x2fc handler=sub_431BA0（argc 5，raw 40798-40825）—— 读触摸触点：**无触点路径只写 `op1 = 0` 后立即返回**（op2..op5 保持不动）、有触点才写 op2=虚屏X/op3=虚屏Y/op4=旗标/op5=dwID ⇒ 五个位全 `w`、无读位（审计 `op-10-003`）',
});

// ---------------------------------------------------------------------------
// 批次：**共用 handler 的两族**（12 条，`handlers/engine-fields.ts` 与 `handlers/audio.ts`）
//
// 机械分组统计（未迁计划的 315 条已核对行）：按**引擎** handler 分组已无 ≥3 条的族；按
// **emulator** handler 只剩 6 个共用函数 —— 本批吃掉其中 5 个的 12 条：
//  - **配置/字段 getter 族**（4 条）：全是「读字段/配置 → **写回 op1**」⇒ io 只有 `w`、无读位。
//    ★注意与"引擎字段写入族"正相反：那边的 `w` 是写**引擎字段**，这里的 `w` 是写**操作数**。
//  - **音频起播/寄存族**（6 条）+ **语音排队族**（2 条）：全是「读操作数 → 交给宿主音频」⇒ 只读。
// ---------------------------------------------------------------------------

declarePlan(0x106, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence: 'analysis/opcodes.json：0x106 handler=sub_42ED90（argc 1，raw .c 39040）—— 配置 getter：`op1 = Engine[550]`',
});
declarePlan(0x130, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence:
    'analysis/opcodes.json：0x130（argc 1）—— LOGO/版权页开关 getter：`op1 = _this[96983]`（SYSTEM4 据此判断是否 `call-script LOGO`）',
});
declarePlan(0x131, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence:
    'analysis/opcodes.json：0x131 handler=sub_42F7D0（argc 1，raw 39350-39356）—— `GetMesWinAlpha`：`op1 = GetConfig("message:MesWinAlpha")`（按名直读配置注册表，**不读 Engine 字段**）',
});
declarePlan(0x201, {
  argc: 1,
  kinds: ['int'],
  io: ['w'],
  evidence: 'analysis/opcodes.json：0x201 handler=sub_4302B0（argc 1，raw .c 39859）—— 配置 getter：`op1 = Engine[166964]`（= DrawMode）',
});
declarePlan(0xb5, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0xb5 handler=sub_420B90（argc 1）—— SE 通道起播（播一次）：op1 = 通道',
});
declarePlan(0xba, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0xba handler=sub_420BC0（argc 1，raw 29709-29717）—— SE 通道起播（循环）：同 0xB5，只是循环标志 = 1（语料 154 处）',
});
declarePlan(0xb7, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0xb7（argc 1）—— BGM 当前槽起播（循环=1）：op1 = 曲 id（`op1 == 0` = 重播当前曲）',
});
declarePlan(0xb9, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0xb9（argc 1）—— BGM 当前槽起播（循环=0）：同 0xB7 的淡出清理，循环位 = 0',
});
declarePlan(0xc4, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0xc4（argc 1）—— play-voice（通道 0，播一次）：op1 = 语音 id（ADV 激活时**只寄存**）',
});
declarePlan(0x1bd, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0x1bd（argc 1）—— play-voice（循环位=1）：同 0xC4 的寄存/起播/登记三件套，循环标志传 1',
});
declarePlan(0x2c0, {
  argc: 3,
  kinds: ['int', 'int', 'int'],
  io: ['r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x2c0（argc 3，raw 142563）—— 语音排队到通道 0（带延迟）：op1=id、op2=附带值、op3=延迟毫秒',
});
declarePlan(0x2f5, {
  argc: 4,
  kinds: ['int', 'int', 'int', 'int'],
  io: ['r', 'r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x2f5（argc 4）—— 语音排队到**指定通道**（带延迟）：op1=id、op2=附带值、op3=延迟、op4=通道槽（语料 30 处）',
});

// ---------------------------------------------------------------------------
// 批次：**VM 纯计算族**（`handlers/arithmetic.ts`，**28 条一次到位**）
//
// 这一族形状最规整（也最适合用**工厂函数**批量迁移）：
//  - `binOp`（int 双目，15 条：`0x50..0x5F` 去掉 `mov`）：`op1 = op2 <op> op3` ⇒ `w,r,r`
//  - `floatBinOp`（float 双目，5 条：`0x2D0..0x2D4`）：同上但类型是 float
//  - `mov`/`fmov`/`random`/`int→float`/`fabs`（5 条）：`w,r`
//  - 位族 `0x135`/`0x136`（`op1 |= …` / `op1 &= ~…` ⇒ **op1 是 `rw`**）/`0x13F`（`op1 = bit(op2,op3)`）
//  - `0x2D6` int→float：**两个位类型不同**（op1 写 float、op2 读 int）
//
// ★出处：`analysis/opcodes.json` 的语义列逐条写明了形状（本族不必另读体）；
//   `argc` 由 `test/opcode-arity.test.ts` 的"文档 ⟷ 体 `N=2*argc+1`"背书。
// ---------------------------------------------------------------------------

/** int 双目（`w,r,r`）：`op1 = op2 <op> op3`。 */
const INT_BIN_OPS: [number, string][] = [
  [0x50, 'add'],
  [0x51, 'sub'],
  [0x52, 'mul'],
  [0x53, 'div'],
  [0x54, 'mod（C 截断语义；除零 ⇒ 引擎抛异常）'],
  [0x56, 'and'],
  [0x57, 'or'],
  [0x58, 'sar'],
  [0x59, 'shl'],
  [0x5a, 'eq'],
  [0x5b, 'ne'],
  [0x5c, 'lt'],
  [0x5d, 'lte'],
  [0x5e, 'gr'],
  [0x5f, 'gre'],
];
for (const [op, mn] of INT_BIN_OPS) {
  declarePlan(op, {
    argc: 3,
    kinds: ['int', 'int', 'int'],
    io: ['w', 'r', 'r'],
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（${mn}，argc 3）—— \`op1 = op2 <op> op3\`（read op2/op3 → write op1）`,
  });
}

/** float 双目（`w,r,r`）：`op1 = 浮点op2 <op> 浮点op3`。 */
const FLOAT_BIN_OPS: [number, string][] = [
  [0x2d0, 'fadd'],
  [0x2d1, 'fsub'],
  [0x2d2, 'fmul'],
  [0x2d3, 'fdiv'],
  [0x2d4, 'fmod'],
];
for (const [op, mn] of FLOAT_BIN_OPS) {
  declarePlan(op, {
    argc: 3,
    kinds: ['float', 'float', 'float'],
    io: ['w', 'r', 'r'],
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（${mn}，argc 3）—— \`op1 = 浮点op2 <op> 浮点op3\`（read op2/op3 → write float op1）`,
  });
}

// int/float 单目（`w,r`）
declarePlan(0x55, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x55（mov，argc 2）—— `op1 = op2`',
});
declarePlan(0x60, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x60 handler=sub_42CA50（argc 2，raw .c 37715）—— `op1 = rand() % op2`',
});
declarePlan(0x2d5, {
  argc: 2,
  kinds: ['float', 'float'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x2d5（float mov，argc 2）—— `op1 = op2`（读写都用 float）',
});
declarePlan(0x2d6, {
  argc: 2,
  kinds: ['float', 'int'],
  io: ['w', 'r'],
  evidence:
    'analysis/opcodes.json：0x2d6（argc 2）—— **整数→浮点**：写回 float op1、读整数 op2 ⇒ 两位类型**不同**（计划表里唯一一条"写 float 读 int"）',
});
declarePlan(0x191, {
  argc: 2,
  kinds: ['float', 'float'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x191 handler=sub_42CEC0（argc 2，raw 37896-37906）—— **fabs**：`op1 = fabs(op2)`（浮点；语料 13 处）',
});

// 位族：0x135/0x136 的 **op1 既是读也是写**
declarePlan(0x135, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['rw', 'r'],
  evidence:
    'analysis/opcodes.json：0x135 handler=sub_42F8B0（argc 2，raw 39401-39421）—— SetBit：`op1 |= (1<<op2)` ⇒ **op1 读+写**；op2 > 0x1F（**无符号**）⇒ 打错误串后继续、**不写 op1**（越界路径不碰 op1，见 `handlers/arithmetic.ts` 的说明）',
});
declarePlan(0x136, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['rw', 'r'],
  evidence:
    'analysis/opcodes.json：0x136 handler=sub_42F920（argc 2，raw 39423-39443）—— RemBit：`op1 &= ~(1<<op2)` ⇒ **op1 读+写**；越界同 0x135',
});
declarePlan(0x13f, {
  argc: 3,
  kinds: ['int', 'int', 'int'],
  io: ['w', 'r', 'r'],
  evidence:
    'analysis/opcodes.json：0x13f handler=sub_42F990（argc 3，raw 39548-39568）—— GetBit：`op1 = ((1<<op3) & op2) != 0` ⇒ 结果写 op1、读 op2/op3（**位号是 op3**，与 0x135 的 op2 不同）',
});

// ---------------------------------------------------------------------------
// 批次：**音频族整表**（`handlers/audio.ts`，20 条）
//
// 形状最单一的一族：除三条 argc 0（`0xb8` 停 BGM / `0xc1` BGM 暂停翻转 / `0x1bc` 清消息声音字段）外，
// **全是"读 op1..opN → 交给宿主音频"**，没有任何一条写操作数 ⇒ 计划里没有 w/rw。
// ⇒ 这一批的迁移是**机械的**（`readIntOperand(c.e, c.frame, c.instr, n)` → `p.int(n)`）；
//   正因为形状单一，"脚本化迁移 + 强验证（typecheck + 「计划 ⟷ 实现」逐位核对 + 行为测试）"是安全的。
// ---------------------------------------------------------------------------

/** `[opcode, argc, 说明]`：音频族（全只读 int）。 */
const AUDIO_READ_OPS: [number, number, string][] = [
  [0xb4, 2, 'play-sound-effect（SE 装载）：id / 通道 0..9'],
  [0xb6, 1, 'SE 通道停止/释放：通道'],
  [0xb8, 0, '停 BGM（0 操作数；同时清当前曲 id）'],
  [0xbb, 1, 'SE 总开关：开关值'],
  [0xbc, 1, 'BGM 开关/模式：模式值（`> 2` ⇒ 引擎不动作）'],
  [0xbf, 1, 'play-bgm：音乐 id'],
  [0xc1, 0, 'BGM 暂停/继续翻转（0 操作数）'],
  [0xc2, 2, 'BGM 淡变：目标值 / 步长'],
  [0xc3, 1, '写运行态当前曲 id（只登记、不起播）'],
  [0xc6, 2, '设音量：类别 0..4 / 值'],
  [0x1ba, 2, 'SetSoundMode：类别（1 音乐/2 SE/3 语音/4 影片）/ 开关值'],
  [0x1bc, 0, '清消息/声音字段 + 释放 3 个语音通道对象（0 操作数）'],
  [0x1c9, 3, '音频设备/驱动初始化：id / 数据 / 大小（语料 0 处）'],
  [0x2bf, 3, '延迟播 SE：通道 / 循环标志 / 延迟毫秒'],
  [0x2f4, 3, '播语音（id / 附带值 / 通道）+ 登记文本项记录'],
  [0x2f6, 1, '复位语音通道：通道 0..2'],
  [0x2f7, 1, '置语音通道状态位：通道'],
  [0x2f8, 2, '设语音通道 pan：通道 / pan（±10000）'],
  [0x2ff, 2, '语音通道音量因子**预备**：通道 / 值'],
  [0x302, 2, '语音通道音量因子**应用**：通道 / 因子 0..10000'],
];
for (const [op, argc, what] of AUDIO_READ_OPS) {
  declarePlan(op, {
    argc,
    kinds: Array.from({ length: argc }, () => 'int' as const),
    io: Array.from({ length: argc }, () => 'r' as const),
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（本族只读操作数、不写操作数）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**绘制项/场景变换族**（`handlers/gfx-item.ts`，31 条）
//
// 形状按"读/写"分三类（逐条来自 `analysis/opcodes.json` 的语义列 **+ 该 handler 的实际读法**）：
//  - **全读**（23 条）：变换/动画窗/循环层/顶点色等 ⇒ `kinds` 里 int handle 与 float 分量混排；
//  - **getter**（5 条）：`0x215`/`0x216` 写 op1；`0x218`/`0x21a` 写 op2/3/4（**float**）；
//    `0x228` 写 op1（int）+ op3/4/5（**float**）、且失败分支**不写** op3..5；
//  - **指针位**（1 条）：`0x320` 的 op2..op8 是**指针型**（`refFromOperand`，顶点数组）⇒ `kinds` 用 `ptr`。
// 另两条 argc 0：`0x1f6`（清空绘制容器四表）/`0x244`（批量清 A 层动画窗起点）。
// ---------------------------------------------------------------------------

/** `[opcode, argc, kinds, io, 说明]`：绘制项/场景变换族。 */
const GFX_ITEM_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x1f6, 0, [], [], '清空绘制容器全部 4 张表 + 复位脏标志（唯一整批清场）'],
  [0x1fd, 4, ['int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r'], '绘制项「立即缩放」：handle + sx/sy/sz（÷100）'],
  [0x1ff, 4, ['int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r'], 'DrawItem 像素平移：handle + x/y/z（像素）'],
  [0x214, 2, ['int', 'int'], ['r', 'r'], '交换两条绘图项记录：两个 handle（都输入）'],
  [0x215, 2, ['int', 'int'], ['w', 'r'], 'getter：op1 = 绘制项→纹理槽号（不存在 ⇒ −1；写 op1）'],
  [0x216, 2, ['int', 'int'], ['w', 'r'], 'getter：op1 = 纹理槽→imgid（写 op1）'],
  [0x217, 4, ['int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r'], '绘制项 pivot：handle + 3 float'],
  [0x218, 4, ['int', 'float', 'float', 'float'], ['r', 'w', 'w', 'w'], 'getter：op2/3/4 = pivot 三元组（float）'],
  [0x219, 4, ['int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r'], '绘制项描画位置：handle + 3 float'],
  [0x21a, 4, ['int', 'float', 'float', 'float'], ['r', 'w', 'w', 'w'], 'getter：op2/3/4 = 描画位置三元组（float）'],
  [0x21d, 2, ['int', 'int'], ['r', 'r'], 'CopyScene：源 handle + 目标 handle'],
  [0x21e, 6, ['int', 'int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r', 'r'], '缩放动画窗（窗1）：handle/delay/dur + 三分量（÷100）'],
  [0x21f, 7, ['int', 'int', 'int', 'float', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r', 'r', 'r'], '旋转动画窗（窗2）：handle/delay/dur + 轴 xyz + 角度'],
  [0x220, 6, ['int', 'int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r', 'r'], '平移动画窗（窗3）：handle/delay/dur + 位移（不除 256）'],
  [0x223, 8, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '转场记录 Scene+1048 写入端 · 类别 0（全屏交叉淡化）：**无条件读满 op1..op8**'],
  [0x228, 5, ['int', 'int', 'float', 'float', 'float'], ['w', 'r', 'w', 'w', 'w'], 'getter：op1 = 查表失败?1:0、op3/4/5 = 当前平移（**失败分支不写** op3..5）'],
  [0x22a, 3, ['float', 'float', 'float'], ['r', 'r', 'r'], 'Scene 级「立即缩放」：sx/sy/sz（÷100）'],
  [0x22c, 3, ['float', 'float', 'float'], ['r', 'r', 'r'], 'Scene 级「立即平移」：x/y/z（像素）'],
  [0x22d, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], 'Scene 级「立即带轴缩放」：2 int + 三分量（÷100）'],
  [0x22f, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], 'Scene 级「立即旋转轴/角」：2 int + 轴/角（不除）'],
  [0x230, 1, ['int'], ['r'], 'B 层 bit2：停全部循环动画通道：handle'],
  [0x231, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], 'B 层：贴图换格循环：handle/周期/总格数/每行列数'],
  [0x232, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], 'B 层：颜色往复：handle/周期/alpha/rgb'],
  [0x233, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], 'B 层：缩放往复：handle/周期 + 三分量（÷100）'],
  [0x234, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], 'B 层：匀速旋转：handle/周期 + 轴三分量'],
  [0x235, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], 'B 层：平移往复（三角波）：handle/周期 + 三分量'],
  [0x239, 6, ['int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r'], 'flipbook 动画窗（窗4）：handle/delay/dur/总帧数/每行列数/标志'],
  [0x244, 0, [], [], '批量清绘制项 A 层动画窗起点（flags & 2 的项）'],
  [0x320, 10, ['int', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '顶点网格配置：handle + **7 个指针位**（顶点数组）+ 顶点数 + 层'],
  [0x322, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], 'set-vertex-color：网格 id / 索引 / α / rgb'],
  [0x323, 5, ['int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r'], 'set-vertex-color-alpha：网格 id / delay / count / α / rgb'],
];
for (const [op, argc, kinds, io, what] of GFX_ITEM_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（形状与方向的依据 = 语义列 + handlers/gfx-item.ts 的实际读法）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**引擎字段/getter 杂项族**（`handlers/engine-fields.ts` 的剩余 20 条）
//
// 形状只有两种（最干净的一批）：
//  - **写 op1 的 getter**（5 条：`0xc0` 当前曲 id / `0xd0` 墙钟毫秒 / `0x148` 全局槽 /
//    `0x247` 引擎布尔 / `0x2ce` 显示模式 / `0x306` EffectSkipOnClick）⇒ `io: ['w']`；
//  - **只读 op1..op2**（14 条）⇒ `io` 全 `r`；
//  - `argc 0` 三条（`0xad` 秒计时器 / `0xd9` 清 flag 0x1000 / `0x1ad` 存 cur / `0x1bf` 跳读态置）⇒ `kinds: []`。
// ---------------------------------------------------------------------------

/** `[opcode, argc, io, 说明]`：引擎字段/getter 杂项族（kinds 恒为 int）。 */
const ENGINE_FIELD_MISC: [number, number, OperandIo[], string][] = [
  [0xad, 0, [], '秒计时器推进（0 操作数）'],
  [0xc0, 1, ['w'], 'getter：op1 = 运行态当前曲 id（`Music[259]`）'],
  [0xd0, 1, ['w'], 'getter：op1 = 墙钟毫秒'],
  [0xd9, 0, [], '清 effect_flags 的 0x1000 位（0 操作数）'],
  [0xfe, 1, ['r'], 'SetKeyTotal：op1 > 0x1F（无符号）⇒ 抛 ShowMessage（T-0098 ③）'],
  [0x107, 2, ['r', 'r'], 'SetKey：op1 = 键下标、op2 = 值（op1 ≤ 0x1F 才写表）'],
  [0x10b, 2, ['r', 'r'], 'SetKey（另一表）：op1 = 值、op2 = 键下标（op1 ≤ 0x1F 才写表）'],
  [0x141, 1, ['r'], 'SetMesWinAlpha：op1 > 0x10（无符号）⇒ 走错误串分支不写配置'],
  [0x142, 1, ['r'], '脚本写引擎运行开关 `_this[174812] = op1`'],
  [0x148, 1, ['w'], 'getter：op1 = 全局时间阈值槽 `_this[97058]`'],
  [0x149, 1, ['r'], '写全局时间阈值槽：`_this[97058] = op1`'],
  [0x1ad, 0, [], '`Engine[166963] = cur`（存档序列化用；语料 1100 处，0 操作数）'],
  [0x1b1, 1, ['r'], '`Engine[21672] = op1`（跟随文本模式）'],
  [0x1bf, 0, [], '跳读态置（0 操作数）'],
  [0x247, 1, ['w'], 'getter：op1 = (Engine[166965] != 0)（与 0x21B 成对的布尔寄存器）'],
  [0x25a, 1, ['r'], '消息态影片（模式 1）：`Engine[92379]=1`、`[92380]=op1`'],
  [0x2ce, 1, ['w'], 'getter：op1 = (display:ScreenMode != 0)'],
  [0x2ee, 1, ['r'], '写 `message:MessageFade`：`Font+235128 = op1` + `SetConfig` 双写（T-0097）'],
  [0x306, 1, ['w'], 'getter：op1 = `GetConfig("system:EffectSkipOnClick")`（内建默认 0）'],
  [0x307, 1, ['r'], '`SetConfig("system:EffectSkipOnClick", op1)`（0x306 的唯一写入端）'],
];
for (const [op, argc, io, what] of ENGINE_FIELD_MISC) {
  declarePlan(op, {
    argc,
    kinds: Array.from({ length: argc }, () => 'int' as const),
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/engine-fields.ts 的实际读法）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**帧控制族**（`handlers/frame.ts`，10 条）
//
// 八条 **argc 0**（`0x7c` 重显示返回 / `0xae` 存档版本分支 / `0x199` 重显示文本 /
// `0x1f4` 进停靠锁 / `0x1f5` 退停靠锁 / `0x20c` 绘图帧控制 / `0x21c` 置动画等待位 /
// `0x23c` 帧毫秒时钟）+ 两条只读（`0x7b` 回退游标 2 位、`0xc8` 睡眠 1 位）。
// ---------------------------------------------------------------------------

declarePlan(0x7b, {
  argc: 2,
  kinds: ['int', 'int'],
  io: ['r', 'r'],
  evidence: 'analysis/opcodes.json：0x7b（argc 2）—— 设本帧「重显示」回退游标：op1 主游标 / op2 备用游标（都只读，写的是引擎字段）',
});
declarePlan(0xc8, {
  argc: 1,
  kinds: ['int'],
  io: ['r'],
  evidence: 'analysis/opcodes.json：0xc8（argc 1）—— 睡眠/帧让步：op1 = 毫秒（ADV 激活时引擎直接跳过、**不读**操作数）',
});
for (const [op, what] of [
  [0x7c, '重显示调用返回端'],
  [0xae, '存档版本分支（读档续跑）'],
  [0x199, '重显示文本（0x7B 的读取端）'],
  [0x1f4, '进「停靠」锁'],
  [0x1f5, '退「停靠」锁'],
  [0x20c, '绘图帧控制'],
  [0x21c, '置 0x400 动画等待位'],
  [0x23c, '帧毫秒时钟'],
] as [number, string][]) {
  declarePlan(op, {
    argc: 0,
    kinds: [],
    io: [],
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc 0）—— ${what}（无操作数）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**取址/数组/批量搬运族**（`handlers/memory.ts`，9 条）
//
// 这一族是计划层 `ptr` 位的**主战场**，也促成了 `setPtr` 访问器（`0x61`/`0x63`/`0x2C9` 的结果
// 就是"元素地址"⇒ 写的是**指针操作数**，`setInt/setStr` 都表达不了）：
//  - 写指针位：`0x61`（&op2[op3]）、`0x63`（&op2）、`0x2C9`（可变数组元素引用）；
//  - 只读：`0x64`（字面数组拷贝，目标位是**读**——写的是"透过引用"的槽）、`0x6c`（置零）、
//    `0x12c`（二维取址，同 `0x61` 但写指针）、`0x12f`（索引插入排序）、`0x1b0`（memcpy）、
//    `0x2d8`（bulk 填充）。
// ---------------------------------------------------------------------------

declarePlan(0x61, {
  argc: 3,
  kinds: ['ptr', 'ptr', 'int'],
  io: ['w', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x61（argc 3）—— `op1 = &op2[op3]`：op1 **写指针**、op2 基址(ptr)、op3 下标(int)',
});
declarePlan(0x63, {
  argc: 2,
  kinds: ['ptr', 'ptr'],
  io: ['w', 'r'],
  evidence: 'analysis/opcodes.json：0x63（argc 2）—— `op1 = &op2`：op1 **写指针**、op2 被取址(ptr)',
});
declarePlan(0x64, {
  argc: 2,
  kinds: ['ptr', 'any'],
  io: ['r', 'r'],
  evidence: 'analysis/opcodes.json：0x64（argc 2）—— copy-local-array：op1 = 目标数组(ptr，**读**：写的是"透过引用"的槽)、op2 = 字面数组索引（直接取 `args[1].dataArray`）',
});
declarePlan(0x6c, {
  argc: 2,
  kinds: ['ptr', 'int'],
  io: ['r', 'r'],
  evidence: 'analysis/opcodes.json：0x6c（argc 2）—— copy-to-global = **置零**：op1 起始处(ptr)、op2 = 个数(int)',
});
declarePlan(0x12c, {
  argc: 5,
  kinds: ['ptr', 'ptr', 'int', 'int', 'int'],
  io: ['w', 'r', 'r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x12c（argc 5）—— lookup-array-2d：op1 **写指针**、op2 基址(ptr)、op3 行、op4 列宽、op5 列（后三位 int 读）',
});
declarePlan(0x12f, {
  argc: 4,
  kinds: ['ptr', 'ptr', 'ptr', 'int'],
  io: ['r', 'r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x12f（argc 4）—— 索引插入排序：op1/op2/op3 三个数组基址(ptr 读) + op4 个数(int 读)',
});
declarePlan(0x1b0, {
  argc: 3,
  kinds: ['ptr', 'ptr', 'int'],
  io: ['r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x1b0（argc 3）—— memcpy：op1/op2 两个基址(ptr 读) + op3 个数(int 读；字节数 = 4×op3)',
});
declarePlan(0x2c9, {
  argc: 3,
  kinds: ['ptr', 'ptr', 'int'],
  io: ['w', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x2c9（argc 3）—— 可变数组元素引用：op1 **写指针**（`sub_418CC0`）、op2 基址(ptr)、op3 下标(int；<0 ⇒ 抛错)',
});
declarePlan(0x2d8, {
  argc: 3,
  kinds: ['ptr', 'int', 'int'],
  io: ['r', 'r', 'r'],
  evidence: 'analysis/opcodes.json：0x2d8（argc 3）—— `op1 起 count 个槽填 op2 值`：op1 目标(ptr 读)、op2 值(int)、op3 个数(int)',
});

// ---------------------------------------------------------------------------
// 批次：**控制流 + 队列族**（`handlers/control.ts`，15 条；`0x1a7` 按策略排除）
//
// ★**控制流的 label 口径（迁移前专门核过）**：引擎取 label 也走 `readIntOperand`（`sub_41BF50`），
//   所以计划层的 `int(n)` 正是正确读法 —— `0x8c` jmp 的 `t === -1`（落下句）与 `0xa0` jcc 的
//   "分支目标可为**变量** label"都印证这一点（变量 label 存的是 ENC 过的值 ⇒ 必须解码）。
//   本批把 `0x8f` call 也从 `operandArg().raw` 改成计划读取（立即数两者等价，变量 label 时前者更对）。
//
// ★**`0x1a7`（comment）不纳入**：它的体就是 nop 且 handler 是**零参数**（`() => undefined`）⇒
//   "计划声明它读 op1" 与现实不符（该条本来就在 `opcode-operands` 的白名单里写着"引擎体就是 nop"）。
//   这与 A 类（engine-internal）同性质：**引擎不消费操作数**的条目不进计划层。
// ---------------------------------------------------------------------------

/** `[opcode, argc, io, 说明]`：控制流 + 队列族（kinds 恒 int；`0x134` 的 op2/op3 是**写**）。 */
const CONTROL_PLANS: [number, number, OperandIo[], string][] = [
  [0x1, 0, [], 'abort：程序中止（`_CxxThrowException`），无操作数'],
  [0x2, 0, [], 'exit：跨脚本返回调用层（0 操作数；派发链那一支由解释器处理）'],
  [0x3, 1, ['r'], 'call-script：op1 = 目标脚本索引（压帧 + 装载新脚本）'],
  [0x5, 0, [], 'ret：同脚本子程序返回（弹每帧返回栈；0 操作数）'],
  [0x6, 2, ['r', 'r'], 'load-frame：op1 = 目标脚本索引、op2 = 帧号'],
  [0x8, 1, ['r'], 'call-frame：op1 = 预装帧号'],
  [0x9, 0, [], 'exit-script：全量 teardown + 重载根脚本（0 操作数）'],
  [0x8c, 1, ['r'], 'jmp：op1 = label（`-1` = 落下句）'],
  [0x8f, 1, ['r'], 'call：op1 = label（`-1` = 弹回不跳）'],
  [0xa0, 3, ['r', 'r', 'r'], 'jcc：op1 = 条件、op2 = 真分支 label、op3 = 假分支 label（`-1` = 该分支落下句）'],
  [0x132, 1, ['r'], 'Queue_int 队·重建：op1 = 队下标（>0xA ⇒ 错误串分支）'],
  [0x133, 2, ['r', 'r'], 'Queue_int 队·压入：op1 = 队下标、op2 = 值（越界 ⇒ 不压入）'],
  [0x134, 3, ['r', 'w', 'w'], 'Queue_int 队·弹出：op1 = 队下标；**op2 = 成功位、op3 = 值（都写）**；越界 ⇒ op2/op3 都不写'],
  [0x143, 0, [], '派发扩展包 AUTORUN（0 操作数；消费 1 个 dword 后由 handler 自己 advance）'],
  [0x1a8, 0, [], '写当前帧的指令步长槽（audit `op-6-05` 订正：不是 nop；0 操作数）'],
];
for (const [op, argc, io, what] of CONTROL_PLANS) {
  declarePlan(op, {
    argc,
    kinds: Array.from({ length: argc }, () => 'int' as const),
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/control.ts 的实际读法；label 口径见本批次头部说明）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**消息窗族整表**（`handlers/msgwin.ts`，**51 条一次到位**）
//
// 全库最大的一族，形状却相当规整（`argc` 分布：1×26、3×9、2×4、0×3、4×3、5×2、6/7/8/10 各 1）：
//  - **只读**（44 条）：`0x6e` show-text / `0x70` 窗口几何 / 文本原点 / 换行 / 对齐 / 窗对象字段…
//  - **写 op1 的 getter**（9 条）：`0x7f` 消息速度 / `0x19a` 跳读模式 / `0x1b6` 共存态 / `0x1c7` ADV 激活 /
//    `0x1cb` 跳读态 / `0x1cc` 是否有消息 / `0x2dc` 字体数 / `0x2dd` 字体名（**写字符串**）/ `0x2de` 字体名→下标；
//  - **混合**：`0x6e`(int+str) / `0x196`(int+str+str) / `0x204`(3×int+str) / `0x205`(**op2 是 rw**：读原值再写回) /
//    `0x1a5`/`0x2fe`(str) / `0x2dd`/`0x2de`(str ↔ int)。
//
// ★三条用**变量 n 的辅助读法**（`rd(n)`、`[1..N].map((n) => readIntOperand(…, n))`）——
//   `0x73`(10 位) / `0x90`(7 位) / `0x25c`(8 位)。机械侦察一开始把它们看成"只读 1 位"，
//   逐条读体后确认是**全读**（这正是"形状不能只看正则"的例子）。
// ---------------------------------------------------------------------------

/** `[opcode, argc, kinds, io, 说明]`：消息窗族。 */
const MSGWIN_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x6e, 2, ['int', 'str'], ['r', 'r'], 'show-text：op1 = 窗、op2 = 字符串'],
  [0x6f, 1, ['int'], ['r'], 'end-text-line：op1 = 窗'],
  [0x70, 5, ['int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r'], '窗口几何：win/w/h/x/y'],
  [0x71, 1, ['int'], ['r'], '开始新消息：op1 = 窗'],
  [0x72, 1, ['int'], ['r'], '等待输入（逐字门）：op1 = 窗'],
  [0x73, 10, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '字格设置：op1..op10 **全读**（辅助 `rd(n)`）'],
  [0x74, 1, ['int'], ['r'], '消息速度字段'],
  [0x75, 1, ['int'], ['r'], '主字号'],
  [0x79, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '文本块原点：win/x/y'],
  [0x7a, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '窗对象 +48/+52'],
  [0x7f, 1, ['int'], ['w'], '**getter**：op1 = 消息速度'],
  [0x80, 1, ['int'], ['r'], '默认窗设置'],
  [0x88, 1, ['int'], ['r'], '消息模式'],
  [0x90, 7, ['int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r'], '点击热点表 push：x/y/w/h + 三个 label（`.map` 全读）'],
  [0xfa, 0, [], [], '轮询消息推进（0 操作数）'],
  [0x196, 3, ['int', 'str', 'str'], ['r', 'r', 'r'], '注音：op1 = 窗、op2 = 本文词、op3 = 注音'],
  [0x197, 1, ['int'], ['r'], '注音字号'],
  [0x198, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '窗口位置：win/x/y'],
  [0x19a, 1, ['int'], ['w'], '**getter**：op1 = 跳读模式'],
  [0x19b, 0, [], [], '退出 ADV（0 操作数）'],
  [0x19c, 0, [], [], '进入 ADV（0 操作数）'],
  [0x1a5, 1, ['str'], ['r'], '主字体名（字符串位）'],
  [0x1b5, 1, ['int'], ['r'], '设置消息速度'],
  [0x1b6, 1, ['int'], ['w'], '**getter**：op1 = 共存态'],
  [0x1b7, 1, ['int'], ['r'], '设置共存态'],
  [0x1c1, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '换行设置：win/x/y'],
  [0x1c7, 1, ['int'], ['w'], '**getter**：op1 = ADV 激活位'],
  [0x1ca, 1, ['int'], ['r'], '设置跳读文本态'],
  [0x1cb, 1, ['int'], ['w'], '**getter**：op1 = 跳读文本态'],
  [0x1cc, 1, ['int'], ['w'], '**getter**：op1 = 当前是否有消息'],
  [0x204, 4, ['int', 'int', 'int', 'str'], ['r', 'r', 'r', 'r'], 'draw-string：槽/x/y + 字符串（直绘）'],
  [0x205, 6, ['int', 'int', 'int', 'int', 'int', 'int'], ['r', 'rw', 'r', 'r', 'r', 'r'], 'draw-number-string：读 op1..op6，**op2 读后写回**'],
  [0x20a, 1, ['int'], ['r'], '窗重排：op1 = 窗'],
  [0x212, 2, ['int', 'int'], ['r', 'r'], '窗对象 +100'],
  [0x213, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '窗对象区间（+104/+108）'],
  [0x25c, 8, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '窗对象文本块 +224：op1..op8 **全读**（`.map`）'],
  [0x25d, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '窗对象区间 2（+276/+280）'],
  [0x25e, 5, ['int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r'], '窗对象颜色对：+256/+260/+264/+268/+272'],
  [0x25f, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], '窗对象颜色对 2'],
  [0x260, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], '竖排矩形内边距'],
  [0x2bd, 1, ['int'], ['r'], '主字体加粗'],
  [0x2be, 1, ['int'], ['r'], '注音加粗'],
  [0x2cd, 1, ['int'], ['r'], '滚轮推进消息开关'],
  [0x2dc, 1, ['int'], ['w'], '**getter**：op1 = 字体表项数'],
  [0x2dd, 2, ['str', 'int'], ['w', 'r'], '**getter**：op1（字符串）= 第 op2 项字体名'],
  [0x2de, 2, ['int', 'str'], ['w', 'r'], '**getter**：op1 = 字体名→表下标（op2 是字符串）'],
  [0x2e8, 1, ['int'], ['r'], 'message:AutoMessageOption 写入端'],
  [0x2fe, 1, ['str'], ['r'], '注音字体名（字符串位）'],
  [0x300, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '窗槽标志：win/a/b'],
  [0x301, 1, ['int'], ['r'], '窗槽清场：op1 = 窗'],
  [0x303, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '对齐设置：win/mode/width'],
];
for (const [op, argc, kinds, io, what] of MSGWIN_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/msgwin.ts 的实际读法）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**场景/图元状态族 + 输入族**（`handlers/gfx-state.ts` 18 条 + `handlers/input.ts` 11 条）
//
// `gfx-state.ts`：图元变换 / 槽→槽转送 / 转场记录 / 绘制模式 / 槽标志 / 网格属性…，除 `0x229`/`0x256`
// 是 `2 int + 3 float` 混排外**基本全 int 只读**；三条 argc 0（`0x20e` 图形提交 / `0x224` 清转场表 /
// `0x243` 复位等待门计时器）。
//   ★**`0x33f` 按策略排除**：引擎三格全读（op2=α 带钳位/回退、op3=颜色带回退），但 emulator
//   **没有消费端**（绘制项 `Item+96` 当前 α/当前色、`Scene+1264` 效果常量通路都未建模）
//   ⇒ 实现按"有据豁免"只读 op1（该条在 `opcode-operands` 白名单里有长注，回链 T-0017）。
//   计划若如实声明三读位就会与实现冲突 ⇒ 本票不纳入（同 `0x1a7`：**引擎读了但实现无消费端**的条目不进计划层）。
//
// `input.ts`：鼠标/手柄回调 + 五个 getter（`0x108` 按钮 / `0x109` 位置 / `0x10d` 滚轮 / `0x2e5` 水平滚轮
// 写 op1..op2；`0x12e` 悬停命中读 **op2/5/6/7 四个指针位**且 **op1 是 `rw`**）。
// ★`0xcc`/`0xfb` 的 op2 是 **label**（跳转目标）：与 `0x8f` call 同口径改成计划读取
//   （立即数等价、变量 label 只有解码才对）——`operandArg().raw` 在这里同样是隐患。
// ---------------------------------------------------------------------------

/** `[opcode, argc, kinds, io, 说明]`：场景/图元状态族（`gfx-state.ts`，18 条）。 */
const GFX_STATE_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x1fc, 1, ['int'], ['r'], '复位图元变换：op1 = handle'],
  [0x1fe, 5, ['int', 'float', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], '图元变换 4 浮点：handle + 4 float（原样，不除 100）'],
  [0x207, 8, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '槽→槽 StretchRect：源槽/目标槽 + 两个矩形（8 位全读）'],
  [0x20d, 1, ['int'], ['r'], '设置渲染目标：op1 = 纹理槽'],
  [0x20e, 0, [], [], '图形提交（Clear target+z；0 操作数）'],
  [0x224, 0, [], [], '清转场表（0 操作数）'],
  [0x229, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], '绘制模式 5 元组：2 int + 3 float'],
  [0x238, 1, ['int'], ['r'], '装载 0x400 等待门时长'],
  [0x242, 2, ['int', 'int'], ['r', 'r'], '写 DrawItem +720：handle + 值'],
  [0x243, 0, [], [], '复位等待门计时器（0 操作数）'],
  [0x24f, 10, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], 'SetBlindWipe 转场记录：op1..op10 全读'],
  [0x250, 10, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '转场记录（类别 3 插值）：op1..op10 全读'],
  [0x251, 12, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '转场记录（类别 3）：op1..op12 全读'],
  [0x256, 5, ['int', 'int', 'float', 'float', 'float'], ['r', 'r', 'r', 'r', 'r'], '按 id 找 DrawItem 并写参数：2 int + 3 float'],
  [0x258, 2, ['int', 'int'], ['r', 'r'], '纹理槽标志对：槽 + 标志（语料 11356 处，用量最大）'],
  [0x321, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], 'MeshEntry 属性：handle/a/b'],
  [0x32a, 1, ['int'], ['r'], '释放 3D 模型槽：op1 = 槽'],
  [0x32d, 2, ['int', 'int'], ['r', 'r'], '3D 颜色：op1 钳 255（alpha）、op2（rgb）'],
];
for (const [op, argc, kinds, io, what] of GFX_STATE_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/gfx-state.ts 的实际读法）`,
  });
}

/** `[opcode, argc, kinds, io, 说明]`：输入族（`input.ts`，11 条）。 */
const INPUT_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0xcc, 2, ['int', 'int'], ['r', 'r'], '注册鼠标跳转目标：op1 = 节流槽、op2 = **label**（与 jmp 同尺度）'],
  [0xcd, 0, [], [], '消息/ADV「点击推进」门（0 操作数）'],
  [0xfb, 2, ['int', 'int'], ['r', 'r'], '注册手柄跳转目标：op1 = 掩码位（∈[0,32)）、op2 = **label**'],
  [0xff, 0, [], [], '复位输入/ADV 状态（0 操作数）'],
  [0x101, 0, [], [], '刷输入掩码并复位（0 操作数）'],
  [0x108, 1, ['int'], ['w'], '**getter**：op1 = 鼠标按钮值'],
  [0x109, 2, ['int', 'int'], ['w', 'w'], '**getter**：op1 = X、op2 = Y'],
  [0x10a, 2, ['int', 'int'], ['r', 'r'], '把光标移到虚拟屏坐标（X/Y）'],
  [0x10d, 1, ['int'], ['w'], '**getter**：op1 = 滚轮增量（一次性消费）'],
  [0x12e, 8, ['int', 'ptr', 'int', 'int', 'ptr', 'ptr', 'ptr', 'int'], ['rw', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], '悬停命中测试：op1 起始下标（**读后写回**）、op2/op5/op6/op7 是**指针位**（margin/盒表/平面）、op3/op4/op8 是 int'],
  [0x2e5, 1, ['int'], ['w'], '**getter**：op1 = 水平滚轮增量'],
];
for (const [op, argc, kinds, io, what] of INPUT_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/input.ts 的实际读法；label 口径同控制流族）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**纹理/杂项/文本项/面板/存档槽族**（`gfx-texture.ts` 10 + `gfx-misc.ts` 6 +
//        `text-items.ts` 7 + `panel.ts` 5 + `save-slot.ts` 6 = 34 条）
//
// 五族一次的收尾批：
//  - **纹理**（`gfx-texture.ts`）：`0x1f7` 解绑 / `0x1f8` create-texture / `0x1fa` release / `0x1fb` draw-texture(8 位) /
//    `0x20b` FillTexture / `0x249` 按 id 载纹理；两条 **getter 写回**（`0x208` 写 op2/op3 = 宽高、`0x23f` 写 op1 = 尺寸×1000）。
//  - **杂项**（`gfx-misc.ts`）：三条 argc 0（`0x23d` 销毁 movie 槽 / `0x259` 清槽记录表 / `0x32b` 清网格槽表）+ 三条只读。
//  - **文本项**（`text-items.ts`）：`0x1d0`/`0x1d3`/`0x1d4`/`0x2f3` 四条**查询写回**（写 op1..op3、读的却是靠后的位：
//    `0x1d0` 只读 op3、`0x1d3` 读 op4/op5、`0x1d4` 读 op4、`0x2f3` 读 op5/op6）—— 形状**不是"前 N 位"**，需逐条对照。
//  - **面板**（`panel.ts`）：`0x91`/`0x92` 显示态 + `0x97` 掩码位绑热点（5 位）+ 两条 argc 0。
//  - **存档槽**（`save-slot.ts`）：存档/读档/删/复制/写读 `.STH` —— 都是「op2..op3 读、**op1 写结果码**」。
//    ★**`0x1a1` 按策略排除**：引擎**不消费 op1**（既不读也不写，`test/save-slot.test.ts` 有专门断言
//    "0x1A1 不写操作数（引擎不调 sub_42B4B0）"）⇒ 同 C 类，声明读位会与实现冲突。
// ---------------------------------------------------------------------------

/** `[opcode, argc, kinds, io, 说明]`：纹理族。 */
const GFX_TEXTURE_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x1f7, 2, ['int', 'int'], ['r', 'r'], '解绑纹理：handle + count'],
  [0x1f8, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], 'create-texture：槽/宽/高/标志'],
  [0x1fa, 1, ['int'], ['r'], 'release-texture：op1 = 槽'],
  [0x1fb, 8, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], 'draw-texture：handle + 7 位（8 位全读）'],
  [0x208, 3, ['int', 'int', 'int'], ['r', 'w', 'w'], '**getter**：op1 = 槽；**op2 = 宽、op3 = 高（写）**'],
  [0x20b, 7, ['int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r'], 'FillTexture：槽 + 矩形 + 颜色'],
  [0x23f, 2, ['int', 'int'], ['w', 'r'], '**getter**：op1 = 尺寸×1000（缺项 −1）；op2 = 节点'],
  [0x245, 2, ['int', 'int'], ['r', 'r'], '纹理对象浮点参数：对象 + 值'],
  [0x246, 2, ['int', 'int'], ['r', 'r'], '纹理对象子对象 vtable+56：对象 + 参数'],
  [0x249, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], '按统一 id 载纹理进槽（带颜色）'],
];
for (const [op, argc, kinds, io, what] of GFX_TEXTURE_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/gfx-texture.ts 的实际读法）`,
  });
}

/** `[opcode, argc, kinds, io, 说明]`：杂项族。 */
const GFX_MISC_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x23d, 0, [], [], '销毁 movie/纹理槽 42..999（语料 958 处；0 操作数）'],
  [0x248, 1, ['int'], ['r'], '模块静态配置：op1 → `dword_55052C`'],
  [0x259, 0, [], [], '清两张 1000×2 组 5-DWORD 槽记录表（0 操作数）'],
  [0x32b, 0, [], [], '清 D3DX 网格层级槽表（0 操作数）'],
  [0x32f, 1, ['int'], ['r'], 'D3D 灯光开关：op1 = 灯光索引 0..9'],
  [0x340, 1, ['int'], ['r'], '渲染状态下发：op1 = 状态值（写 `Scene+13948`）'],
];
for (const [op, argc, kinds, io, what] of GFX_MISC_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/gfx-misc.ts 的实际读法）`,
  });
}

/** `[opcode, argc, kinds, io, 说明]`：文本项族（**读位不在前面**，逐条对照）。 */
const TEXT_ITEMS_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x85, 0, [], [], '清两张文本项表（0 操作数）'],
  [0x1bb, 1, ['int'], ['r'], 'SetTB（文本项记账开关）：op1'],
  [0x1d0, 3, ['int', 'int', 'int'], ['w', 'w', 'r'], '回看页索引表·带步数读出：**只读 op3**、写 op1/op2'],
  [0x1d2, 2, ['int', 'int'], ['r', 'r'], '文本项记录表 push：key + value'],
  [0x1d3, 5, ['int', 'int', 'int', 'int', 'int'], ['w', 'w', 'unused', 'r', 'r'], '文本项查询：**读 op4/op5**、写 op1/op2'],
  [0x1d4, 4, ['int', 'int', 'int', 'int'], ['w', 'w', 'unused', 'r'], '文本项查询（通道 0）：**读 op4**、写 op1/op2'],
  [0x2f3, 6, ['int', 'int', 'int', 'int', 'int', 'int'], ['w', 'w', 'w', 'unused', 'r', 'r'], '文本项查询：**读 op5/op6**、写 op1..op3'],
];
for (const [op, argc, kinds, io, what] of TEXT_ITEMS_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/text-items.ts 的实际读法）`,
  });
}

/** `[opcode, argc, kinds, io, 说明]`：面板族。 */
const PANEL_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x91, 1, ['int'], ['r'], '消息面显示态开：op1'],
  [0x92, 2, ['int', 'int'], ['r', 'r'], '显示态开（带回退 label）：op1/op2'],
  [0x93, 0, [], [], '消息面显示态关（0 操作数）'],
  [0x94, 0, [], [], '消息面显示态开（0 操作数）'],
  [0x97, 5, ['int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r'], '把掩码位绑到热点：矩形 + 掩码位（5 位全读）'],
];
for (const [op, argc, kinds, io, what] of PANEL_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/panel.ts 的实际读法）`,
  });
}

/** `[opcode, argc, kinds, io, 说明]`：存档槽族（`0x1a1` 按策略排除：引擎不消费 op1）。 */
const SAVE_SLOT_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  [0x19e, 2, ['int', 'int'], ['w', 'r'], '存档（SAVE）：op2 = 槽号；**op1 = 结果码（写）**'],
  [0x19f, 2, ['int', 'int'], ['w', 'r'], '读档（短版）：同 0x1A1，op1 = 结果码'],
  [0x1a1, 2, ['int', 'int'], ['unused', 'r'], '读档（LOAD，全量）：op2 = 槽号；**op1 = `unused`**（引擎不调 `sub_42B4B0` ⇒ 既不读也不写，`test/save-slot.test.ts` 有专门断言）'],
  [0x1ab, 2, ['int', 'int'], ['w', 'r'], '删槽（.DAT + .STH）：op2 = 槽号；op1 = 结果码'],
  [0x1ac, 3, ['int', 'int', 'int'], ['w', 'r', 'r'], '复制槽（op2 → op3）：op1 = 结果码'],
  [0x1ae, 3, ['int', 'int', 'int'], ['w', 'r', 'r'], '写 .STH（缩略图）：op2 = 槽号、op3 = 缩略图槽；op1 = 结果码'],
  [0x1af, 3, ['int', 'int', 'int'], ['w', 'r', 'r'], '读 .STH（缩略图）：op2 = 槽号、op3 = 缩略图槽；op1 = 结果码'],
];
for (const [op, argc, kinds, io, what] of SAVE_SLOT_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + handlers/save-slot.ts 的实际读法）`,
  });
}

// ---------------------------------------------------------------------------
// 批次：**收尾族**（`menu` / `stage` / `region-hittest` / `agerc` / `resource-usage` /
//        `music-table` / `gfx-cg` / `control` / `live2d`，共 27 条）
//
// 这是判据 1 的**最后一批**：迁完 C 只剩"策略排除"的三类（见守卫的覆盖账）。
// ★本批又识别出 **2 条 C 类排除**（+ 上批已有的 `0x33F`）：
//   - **`0x14D`**（call-agerc-export，argc 6）：引擎把 op5（数组）与 op6 一起传给 DLL 导出函数
//     （`(*槽表[op1])(Engine[96981], buf, len, op5 数组, op6)`），而 emulator 的 AGERC 宿主缝
//     **不转发这两个操作数** ⇒ 引擎消费、实现无消费端 ⇒ 不纳入（不是 `unused`）。
//   - **`0x308`**（输入触摸注册）：引擎读 op1 调 `sub_407B20`，而 emulator 是 `op_stub_unhandled`
//     桩（该条在白名单里写着"op1/Engine[1954] 未建模"）⇒ 同 C 类。
// ★`0x1A7`（comment）本轮**改判为可声明**：体是 nop ⇒ 用 `unused` 如实声明 op1
//   （handler 零参数、不读任何位 —— 与 `want` 排除 `unused` 后的判据一致）。
// ★`live2d.ts` 的 8 条共用 `optInt(c, n)` 助手 ⇒ **一处中心改动**即可（剩下的 4 条走直读）。
// ---------------------------------------------------------------------------

/** `[opcode, argc, kinds, io, 说明]`：收尾各族。 */
const FINAL_PLANS: [number, number, OperandKind[], OperandIo[], string][] = [
  // menu
  [0xa1, 0, [], [], '菜单派发表复位（0 操作数）'],
  [0xa2, 2, ['int', 'int'], ['r', 'r'], '登记菜单项 key→label：op1（转成字符串当键）+ op2'],
  [0xa3, 2, ['int', 'int'], ['r', 'r'], '按 key 查表派发：op1（键）+ op2（回退 label）'],
  // stage（阶梯动画时间表）
  [0xd3, 0, [], [], '阶梯动画时间表：清空（0 操作数）'],
  [0xd4, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], '阶梯动画时间表：追加条目（间隔 + 3 个目标）'],
  [0xd5, 1, ['int'], ['r'], '阶梯动画时间表：起表 + 置 0x40 门；op1 = 输入打断 label'],
  // region-hittest（含指针位）
  [0x147, 6, ['int', 'int', 'int', 'ptr', 'ptr', 'int'], ['w', 'r', 'r', 'r', 'r', 'r'], '多边形命中测试：op1 写结果、点 (op2,op3)、**op4/op5 = 池中连续槽起始（ptr）**、op6 = n'],
  [0x2f2, 6, ['int', 'int', 'int', 'ptr', 'int', 'int'], ['w', 'r', 'r', 'r', 'r', 'r'], '椭圆命中测试：op1 写结果、点 (op2,op3)、**op4 = 矩形的池起始（ptr）**、op5/op6 = 偏移'],
  // agerc（0x14D 按策略排除）
  [0x14b, 1, ['int'], ['r'], '加载 AGERC 模块：op1'],
  [0x14c, 2, ['int', 'str'], ['r', 'r'], 'set-agerc-export：op1 = 槽、**op2 = 导出名（字符串）**'],
  // resource-usage
  [0x19d, 2, ['int', 'int'], ['w', 'r'], '已使用文件查询：**op1 ← 是否打开过**（写）、op2 = 统一文件 id'],
  // music-table
  [0x1d6, 2, ['int', 'int'], ['w', 'r'], '音乐表·追加扁平表：**op1 ← 结果**、op2 = 值'],
  [0x1d7, 2, ['int', 'int'], ['w', 'r'], '音乐表·确保组数：**op1 ← 结果**、op2 = 组数'],
  [0x1d8, 3, ['int', 'int', 'int'], ['w', 'r', 'r'], '音乐表·组内登记：**op1 ← 结果**、op2 = 组号、op3 = 值'],
  // gfx-cg（0x2DA 的循环用变量 k ⇒ 形状提取器曾误判"只读 op1"）
  [0x23b, 7, ['int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r'], '按 CG 数字条画数值：起始 id/记录号/数值/x/y/位数/对齐（7 位全读）'],
  [0x2da, 8, ['int', 'int', 'int', 'int', 'int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], 'CG 数字条记录登记：op1 = CG 番号、**op2..op8 由 `for k=2..8` 循环读**'],
  // control（本轮改判为可声明：体是 nop ⇒ op1 `unused`）
  [0x1a7, 1, ['int'], ['unused'], 'comment（dev 注释）：**引擎体就是 nop ⇒ op1 `unused`**（handler 零参数、不读任何位）'],
  // live2d（8 条走 optInt 助手 + 2 条直读）
  [0x341, 2, ['int', 'int'], ['r', 'r'], 'Live2D 模型加载：文件/资源 id + 实例槽'],
  [0x342, 1, ['int'], ['r'], '销毁 Live2D 模型实例槽：槽'],
  [0x344, 2, ['int', 'int'], ['r', 'r'], '建/绑立绘节点：key + 实例槽'],
  [0x345, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], 'Live2D 纹理装载：纹理文件 id + 实例槽 + 模型内纹理号'],
  [0x346, 1, ['int'], ['r'], '节点复位：key'],
  [0x34e, 4, ['int', 'int', 'int', 'int'], ['r', 'r', 'r', 'r'], '装 .MTN 动作：动作文件 id + 3 位'],
  [0x34f, 2, ['int', 'int'], ['r', 'r'], 'Live2D 纹理乘色：实例槽 + 颜色（`< 0` ⇒ 取该槽当前纹理色）'],
  [0x350, 1, ['int'], ['r'], '复位 Live2D 动作队列：实例槽'],
  [0x351, 3, ['int', 'str', 'int'], ['r', 'r', 'r'], 'Live2D 命名参数：实例槽 + **参数名串** + 值'],
  [0x352, 3, ['int', 'int', 'int'], ['r', 'r', 'r'], 'Live2D 槽参数设置：槽号 0..9 + which + value'],
];
for (const [op, argc, kinds, io, what] of FINAL_PLANS) {
  declarePlan(op, {
    argc,
    kinds,
    io,
    evidence: `analysis/opcodes.json：0x${op.toString(16)}（argc ${argc}）—— ${what}（方向依据 = 语义列 + 对应 handler 的实际读法）`,
  });
}
