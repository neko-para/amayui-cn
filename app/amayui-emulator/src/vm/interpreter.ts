/** 解释器主循环（每步 await，以支持异步文件代理的 call-script）。 */
import type { Engine, Frame } from './engine.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS, ExitScript, ScriptReset, loadScriptIntoFrame } from './ops.js';
import { readIntOperand, readFloatOperand } from './operand.js';
import { makeCtx } from './step.js';
import type { OpHandler } from './step.js';
import { parseScriptBytes, type BinInstruction } from '../script/bin.js';

/** 未实现 opcode 硬报错（ADR-005）。带上足够多的定位信息，供控制窗展示 + 「作为桩函数跳过」后从同一条指令重试。 */
export class NotImplementedOp extends Error {
  constructor(
    public readonly opcode: number,
    public readonly name: string,
    public readonly scriptName: string,
    public readonly byteOffset: number,
    /** 当前帧 ip（指令下标）——重试时的落点，也是给控制窗看的位置。 */
    public readonly instrIndex = -1,
  ) {
    super(`unimplemented opcode 0x${opcode.toString(16)} (${name}) in script ${scriptName} @ 0x${byteOffset.toString(16)}`);
  }
}

export interface StepTrace {
  opcode: number;
  name: string;
  ip: number;
  byteOffset: number;
  /**
   * handler 来源：implemented/native/engine-internal 为静态表；**user-stub = 用户在控制窗点「作为桩函数跳过」
   * 后登记的运行时 no-op 桩**（见 Engine.unknownOpStubs）；unimplemented 理论上不再由 stepOnce 返回（直接抛错）。
   */
  handlerKind: 'implemented' | 'native' | 'engine-internal' | 'user-stub' | 'unimplemented';
  script: string;
  /**
   * 本指令操作数的可读形式（`0x3#41`；`#` 后为已解码值/旁注）。供场景执行报告与缺口归因。
   *
   * ★**惰性求值**：格式化要逐操作数读池，对"每步都算"是纯浪费（一次会话可达数十万步）。
   * 因此只有真正用到它（写 JSONL / 打印缺口）时才计算。注意：读取发生在 handler **之后**，
   * 若 handler 改写过操作数，这里看到的是改后的值（对追踪而言可接受）。
   */
  readonly operands: string[];
  /**
   * **闸门 B：能力缺口**。仅当本条指令**被当作 no-op 跳过**（`noop===true` 或 `user-stub`）
   * 但**收到了非平凡实参**时才有值 —— 即"脚本真的传了参数想做点什么，而我没做"。
   *
   * 判据（`significantOperands`）：立即数 |v|>1；池里的 int/float 解码值 |v|>1；
   * 任何指针/字符串/数组操作数（说明脚本传了真实对象）。
   * 只用它降噪：像 `i32f 0`（关灯索引 0）这类"空转"调用不会进缺口清单。
   */
  gap?: { operands: string[] };
}

/**
 * 解析当前指令的 handler 及其来源。查找顺序：
 *   静态实现表 → native 桩表 → 引擎内部插桩表 → **用户运行时登记的未知指令桩**（Engine.unknownOpStubs）。
 * 用户桩只作最后兜底，不会遮蔽任何已知实现；查不到则返回 null（由 stepOnce 抛 NotImplementedOp）。
 *
 * 注：`engine-internal` 表里**全部是纯 no-op**（见 `handlers/stubs.ts`），因此不再有"noop"标志——
 * 一个 handler 只要真的写了操作数/引擎字段，它就应该在 `OPS` 里。
 */
function resolveHandler(e: Engine, op: number): { handler: OpHandler | undefined; kind: StepTrace['handlerKind'] } {
  if (OPS.has(op)) return { handler: OPS.get(op), kind: 'implemented' };
  if (NATIVE_OPS.has(op)) return { handler: NATIVE_OPS.get(op), kind: 'native' };
  if (ENGINE_INTERNAL_OPS.has(op)) return { handler: ENGINE_INTERNAL_OPS.get(op), kind: 'engine-internal' };
  // 用户桩句柄目前恒为 no-op（表值只表示"已跳过"），这里统一映射到同一个 no-op handler。
  if (e.unknownOpStubs.has(op)) return { handler: op_user_stub, kind: 'user-stub' };
  return { handler: undefined, kind: 'unimplemented' };
}

/**
 * 未知指令的用户桩：**纯 no-op**（不读操作数、不写 VM 状态、不动控制流，因此 ip 正常 +1）。
 * 语义风险与 ENGINE_INTERNAL_OPS 的插桩跳过一致：若该 opcode 原本会写操作数/跳转，此处会留下不符引擎的
 * 状态（如 op1 保留旧值、条件跳转不发生）——这正是「跳过」的代价，供继续跑通链路用，不是精确语义。
 */
const op_user_stub: OpHandler = () => {};

/** 操作数类型 → 可读标签（只用于报告/归因，不参与语义）。 */
function operandTag(t: number): string {
  switch (t) {
    case 0: return 'imm-int';
    case 1: return 'imm-float';
    case 2: return 'imm-str';
    case 3: return 'g-int';
    case 4: return 'g-float';
    case 5: return 'g-str';
    case 6: return 'g-int*';
    case 7: return 'g-float*';
    case 8: return 'g-str*';
    case 9: return 'l-int';
    case 0xa: return 'l-float';
    case 0xb: return 'l-str';
    case 0xc: return 'l-int*';
    case 0xd: return 'l-float*';
    case 0xe: return 'l-str*';
    case 0x8003: return 'g-int[]';
    case 0x8009: return 'l-int[]';
    default: return `t${t.toString(16)}`;
  }
}

/**
 * 把操作数格式化成可读字符串：`0x3#41`（= 全局 int 池槽 0x41，`#` 后是解码值）。
 * **绝不抛错、绝不改状态**：取值失败只写下标。用于场景执行报告与缺口归因。
 */
export function formatOperands(e: Engine, frame: Frame, instr: BinInstruction): string[] {
  return instr.args.map((a, i) => {
    const label = `${operandTag(a.type)}#${a.raw}`;
    // 只对"值型"操作数解出真实值（指针型需解引用，风险高且对归因无必要）
    if (a.type === 0 || a.type === 3 || a.type === 9) {
      try {
        return `${operandTag(a.type)}#${readIntOperand(e, frame, instr, i + 1)}`;
      } catch {
        return label;
      }
    }
    if (a.type === 4 || a.type === 0xa) {
      try {
        const f = readFloatOperand(e, frame, instr, i + 1);
        return `${operandTag(a.type)}#${Number.isInteger(f) ? f : f.toFixed(3)}`;
      } catch {
        return label;
      }
    }
    return label;
  });
}

/** 操作数是否"非平凡"（脚本真的传了实参，而不是空转）。见 `StepTrace.gap` 的判据说明。 */
export function significantOperands(e: Engine, frame: Frame, instr: BinInstruction): boolean {
  for (let i = 0; i < instr.args.length; i++) {
    const a = instr.args[i]!;
    // 指针 / 字符串 / 数组：脚本传了真实对象或串 ⇒ 一定有意义
    if (a.type >= 6 && a.type <= 8) return true;
    if (a.type >= 0xc && a.type <= 0xe) return true;
    if (a.type === 2 || a.type === 5 || a.type === 0xb) return true;
    if (a.type === 0x8003 || a.type === 0x8009) return true;
    // 值型：|v| > 1 才算"传了参数"（0/1 通常是开关的默认位）
    if (a.type === 0) {
      if (Math.abs(a.raw | 0) > 1) return true;
      continue;
    }
    try {
      const v = a.type === 3 || a.type === 9 ? readIntOperand(e, frame, instr, i + 1) : readFloatOperand(e, frame, instr, i + 1);
      if (Math.abs(v) > 1) return true;
    } catch {
      /* 取不到值 ⇒ 不算显著（避免把解码失败误报成缺口） */
    }
  }
  return false;
}

/** 单步执行当前帧一条指令，返回执行情况。 */
export async function stepOnce(e: Engine): Promise<StepTrace> {
  const frame = e.curScript();
  if (!frame.script) throw new Error('no script loaded in current frame');
  const instr = frame.script.instructions[frame.ip];
  if (!instr) {
    throw new Error(`ip ${frame.ip} out of range in script (${frame.script.instructions.length} instr)`);
  }
  const op = instr.opcode;
  const { handler, kind: handlerKind } = resolveHandler(e, op);
  if (!handler) {
    // 措辞与 throw 分开：**本函数查表/抛错阶段不修改任何 VM 状态**（未读操作数、未推进 ip），
    // 因此调用方在登记用户桩后可以对**同一条指令**直接重试 stepOnce（见 renderer 的暂停/恢复流程）。
    // 用 frame.name（文件名，如 CONFIG.BIN）而非 script.signature（"SYS4450"）作为显示名——前者才是用户可读的脚本名。
    throw new NotImplementedOp(instr.opcode, instr.name, frame.name, instr.byteOffset, frame.ip);
  }
  // 操作数可读形式 + 缺口判据都在 handler 执行**之前**取（handler 可能改写操作数）。
  // ★缺口判据只在"被当作 no-op 跳过"的指令上做（少数），不拖累主路径。
  const isNoopPath = handlerKind === 'user-stub' || handlerKind === 'engine-internal';
  let operands: string[] | null = null;
  let gap: { operands: string[] } | undefined;
  if (isNoopPath && significantOperands(e, frame, instr)) {
    operands = formatOperands(e, frame, instr);
    gap = { operands };
  }
  e.currentOpcode = op; // 供 NativeTap（闸门 A）把"意图被丢弃"归因到指令
  const ctx = makeCtx(e, frame, instr, e.native, (m) => e.native.log(m));
  await handler(ctx);
  // 注意：handler 可能改了 cur（call-script / ret），因此用"当前帧"来推进，而非 handler 前的 frame。
  const curFrame = e.curScript();
  const next = ctx._nextIp;
  if (next === null) {
    curFrame.ip += 1; // 默认顺序推进
  } else if (next === -1) {
    // 控制流已转移（call-script/script-ret），不再自动推进
  } else {
    curFrame.ip = next;
  }
  const trace: StepTrace = {
    opcode: instr.opcode,
    name: instr.name,
    ip: frame.ip,
    byteOffset: instr.byteOffset,
    handlerKind,
    script: frame.name,
    get operands(): string[] {
      if (operands === null) operands = formatOperands(e, frame, instr);
      return operands;
    },
    ...(gap ? { gap } : {}),
  };
  return trace;
}

export interface RunResult {
  executed: number;
  stoppedAt?: StepTrace;
  exited: boolean;
  /** exit-script(0x9) 全量重置后的状态（帧/全局已清空） */
  reset?: boolean;
  error?: unknown;
}

/**
 * 从当前状态运行解释器；steps 为 0/undefined 则一直跑到退出/异常。
 * 注：遇未知 opcode 时 stepOnce 抛 NotImplementedOp（进入 error 字段），调用方若要用「作为桩函数跳过」的
 * 恢复路径，应像 renderer.ts 那样自己持循环（登记 `e.unknownOpStubs` 后对同一条指令重试），而非用本函数。
 */
export async function run(e: Engine, steps?: number): Promise<RunResult> {
  let executed = 0;
  while (steps === undefined || executed < steps) {
    try {
      const trace = await stepOnce(e);
      executed++;
      if (trace.handlerKind === 'unimplemented') {
        return { executed, stoppedAt: trace, exited: false };
      }
    } catch (err) {
      if (err instanceof ExitScript) return { executed, exited: true };
      if (err instanceof ScriptReset) return { executed, exited: false, reset: true };
      return { executed, exited: false, error: err };
    }
  }
  return { executed, exited: false };
}

/** 把脚本字节装入引擎当前帧（供启动时直接 load index 0）。 */
export function loadScriptData(e: Engine, data: Uint8Array, name?: string): void {
  const script = parseScriptBytes(data);
  loadScriptIntoFrame(e.curScript(), script, name);
}
