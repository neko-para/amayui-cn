/** 解释器主循环（每步 await，以支持异步文件代理的 call-script）。 */
import type { Engine } from './engine.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS, ExitScript, ScriptReset, loadScriptIntoFrame } from './ops.js';
import { makeCtx } from './step.js';
import type { OpHandler } from './step.js';
import { parseScriptBytes } from '../script/bin.js';

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
}

/**
 * 解析当前指令的 handler 及其来源。查找顺序：
 *   静态实现表 → native 桩表 → 引擎内部插桩表 → **用户运行时登记的未知指令桩**（Engine.unknownOpStubs）。
 * 用户桩只作最后兜底，不会遮蔽任何已知实现；查不到则返回 null（由 stepOnce 抛 NotImplementedOp）。
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
  return { opcode: instr.opcode, name: instr.name, ip: frame.ip, byteOffset: instr.byteOffset, handlerKind, script: frame.name };
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
