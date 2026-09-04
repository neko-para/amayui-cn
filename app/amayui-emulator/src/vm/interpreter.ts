/** 解释器主循环（每步 await，以支持异步文件代理的 call-script）。 */
import type { Engine } from './engine.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS, ExitScript, ScriptReset, loadScriptIntoFrame } from './ops.js';
import { makeCtx } from './step.js';
import { parseScriptBytes } from '../script/bin.js';

/** 未实现 opcode 硬报错（ADR-005）。 */
export class NotImplementedOp extends Error {
  constructor(
    public readonly opcode: number,
    public readonly name: string,
    public readonly scriptSig: string,
    public readonly byteOffset: number,
  ) {
    super(`unimplemented opcode 0x${opcode.toString(16)} (${name}) in script ${scriptSig} @ 0x${byteOffset.toString(16)}`);
  }
}

export interface StepTrace {
  opcode: number;
  name: string;
  ip: number;
  byteOffset: number;
  handlerKind: 'implemented' | 'native' | 'engine-internal' | 'unimplemented';
  script: string;
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
  const handler = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
  const handlerKind: StepTrace['handlerKind'] = OPS.has(op)
    ? 'implemented'
    : NATIVE_OPS.has(op)
      ? 'native'
      : ENGINE_INTERNAL_OPS.has(op)
        ? 'engine-internal'
        : 'unimplemented';
  if (!handler) {
    throw new NotImplementedOp(instr.opcode, instr.name, frame.script.signature, instr.byteOffset);
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
  return { opcode: instr.opcode, name: instr.name, ip: frame.ip, byteOffset: instr.byteOffset, handlerKind, script: frame.script.signature };
}

export interface RunResult {
  executed: number;
  stoppedAt?: StepTrace;
  exited: boolean;
  /** exit-script(0x9) 全量重置后的状态（帧/全局已清空） */
  reset?: boolean;
  error?: unknown;
}

/** 从当前状态运行解释器；steps 为 0/undefined 则一直跑到退出/异常。 */
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
