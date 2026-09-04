/** 最小 opcode 处理器集 + 子系统 opcode 路由（NativeBridge stub）。
 *  未在任何表中出现的 opcode 由解释器硬报错（ADR-005）。
 *  M0 只覆盖：算术/位/比较/mov、jmp/call/jcc/ret、call-script、comment/dev_ukn、exit。
 *  其余控制流/子系统语义在 M1/M2 逐步补齐。
 */
import type { OpHandler, StepCtx } from './step.js';
import { readIntOperand, writeIntOperand, operandArg } from './operand.js';
import { asI32 } from './bits.js';
import { parseScriptBytes } from '../script/bin.js';
import type { Frame } from './engine.js';

/** 把 label 值(dword index)解析为指令下标；找不到返回 null。 */
function labelPos(frame: Frame, raw: number): number | null {
  const p = frame.labelMap.get(raw);
  return p === undefined ? null : p;
}

/** 单目/双目一元：read(2) [op] read(3) -> write(1)。用于算术/比较。 */
function binOp(apply: (l: number, r: number) => number): OpHandler {
  return (c) => {
    const l = readIntOperand(c.e, c.frame, c.instr, 2);
    const r = readIntOperand(c.e, c.frame, c.instr, 3);
    writeIntOperand(c.e, c.frame, c.instr, 1, apply(l, r));
  };
}

// ---- 算术/位运算 (0x50-0x59) ----
const op_add = binOp((l, r) => (l + r) | 0);
const op_sub = binOp((l, r) => (l - r) | 0);
const op_mul = binOp((l, r) => Math.imul(l, r));
const op_div = binOp((l, r) => Math.trunc(l / r));
const op_mod = binOp((l, r) => ((l % r) + r) % r); // C 的 % 对负数是剩余（符号跟随被除数）；AGE 语义按需在 M1 定
const op_and = binOp((l, r) => l & r);
const op_or = binOp((l, r) => l | r);
const op_sar = binOp((l, r) => l >> (r & 31));
const op_shl = binOp((l, r) => (l << (r & 31)) | 0);
// ---- 比较 (0x5A-0x5F)：结果 0/1 ----
const op_eq = binOp((l, r) => (asI32(l) === asI32(r) ? 1 : 0));
const op_ne = binOp((l, r) => (asI32(l) !== asI32(r) ? 1 : 0));
const op_lt = binOp((l, r) => (asI32(l) < asI32(r) ? 1 : 0));
const op_lte = binOp((l, r) => (asI32(l) <= asI32(r) ? 1 : 0));
const op_gr = binOp((l, r) => (asI32(l) > asI32(r) ? 1 : 0));
const op_gre = binOp((l, r) => (asI32(l) >= asI32(r) ? 1 : 0));

// ---- mov (0x55) ----
const op_mov: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

// ---- 控制流 ----
const op_jmp: OpHandler = (c) => {
  const a = operandArg(c.instr, 1);
  const p = labelPos(c.frame, a.raw);
  if (p === null) throw new Error(`jmp: unknown label 0x${a.raw.toString(16)}`);
  c.jump(p);
};

const op_call: OpHandler = (c) => {
  // 同脚本内 call label：压下一指令到返回栈、跳转。operand==-1(0xFFFFFFFF) 则不跳（弹回）。
  const a = operandArg(c.instr, 1);
  c.frame.retStack.push(c.frame.ip + 1);
  if (a.raw === 0xffffffff) {
    c.frame.retStack.pop(); // 无目标，弹回（no-op）
    return;
  }
  const p = labelPos(c.frame, a.raw);
  if (p === null) throw new Error(`call: unknown label 0x${a.raw.toString(16)}`);
  c.jump(p);
};

const op_jcc: OpHandler = (c) => {
  const cond = readIntOperand(c.e, c.frame, c.instr, 1);
  const aTrue = c.instr.args[1];
  const aFalse = c.instr.args[2];
  if (cond !== 0) {
    const p = labelPos(c.frame, aTrue!.raw);
    if (p === null) throw new Error(`jcc: unknown true label 0x${aTrue!.raw.toString(16)}`);
    c.jump(p);
  } else if (aFalse && aFalse.raw !== 0xffffffff) {
    const p = labelPos(c.frame, aFalse.raw);
    if (p === null) throw new Error(`jcc: unknown false label 0x${aFalse.raw.toString(16)}`);
    c.jump(p);
  } else {
    // 双 fc fallthrough
  }
};

// ---- ret (0x5)：同脚本子程序返回（弹返回栈跳回；空则 no-op 落到下一指令） ----
const op_ret: OpHandler = (c) => {
  const top = c.frame.retStack.pop();
  if (top !== undefined) {
    c.jump(top);
  }
  // 栈空：同脚本函数调用栈为空 → 不跳，落到下一指令（引擎里 arity=1 前进 1 dword）
};

// ---- exit (0x2)：跨脚本返回调用层（cur=frame.caller；顶层无调用层才程序退出） ----
const op_exit: OpHandler = (c) => {
  const caller = c.frame.caller;
  if (caller >= 0) {
    c.e.cur = caller;
    c.e.callRet = caller;
    c.jump(-1); // 控制流已转移，不再自动推进
  } else {
    // caller<0：-1=无调用层（程序退出）；-10/-11 为续跑/存档哨兵（M1 细化，先按程序退出）
    throw new ExitScript();
  }
};

// ---- call-script (0x3)：跨脚本，异步装载 ----
const op_call_script: OpHandler = async (c) => {
  const target = readIntOperand(c.e, c.frame, c.instr, 1); // 目标索引（如 0x5264 或 0）
  if (c.e.cur >= 39) throw new Error(`call-script: 脚本嵌套过深(>40)`);
  // 调用方 IP 前进到下一指令（返回后从此继续）
  c.frame.ip += 1;
  const caller = c.e.cur;
  c.e.callRet = caller;
  c.e.cur = caller + 1;
  const newFrame = c.e.curScript();
  newFrame.caller = caller;
  newFrame.frameArg = 0; // call-script argc=1，仅目标索引，无帧参数
  // 装载目标脚本
  if (!c.e.fileSource) throw new Error('call-script: no FileSource');
  const src = await c.e.fileSource.readScript(target); // async 文件代理
  if (!src) throw new Error(`call-script: cannot load script index 0x${target.toString(16)}`);
  const script = parseScriptBytes(src.data);
  loadScriptIntoFrame(newFrame, script, src.name);
  c.log(`  [call-script] 0x${target.toString(16)} -> ${src.name} (${script.instructions.length} instr)`);
  c.jump(-1); // 控制到新帧
};

/** 把解析好的脚本装入一个帧（建立 labelMap、局部池）。 */
export function loadScriptIntoFrame(frame: Frame, script: import('../script/bin.js').ScriptBinary, name?: string): void {
  frame.script = script;
  frame.name = name ?? script.signature;
  frame.ip = 0;
  frame.retStack = [];
  frame.labelMap.clear();
  for (let i = 0; i < script.instructions.length; i++) {
    frame.labelMap.set(script.instructions[i]!.index, i);
  }
  // 按 local_vars 容量建立局部池（M0 用 Map，无需预分配；这里仅保留观查）
  frame.frameArg = 0;
}

// ---- 杂项 ----
const op_comment: OpHandler = () => undefined;
const op_dev_ukn: OpHandler = () => undefined;

/** 解释器专用信号：脚本 exit (0x2，顶层无调用层=程序退出) / exit-script (0x9，全量重置)。 */
export class ExitScript extends Error {
  constructor() {
    super('script exit');
  }
}

/** exit-script 后的"重置到根"信号（清空了所有脚本帧 + 全局数组）。 */
export class ScriptReset extends Error {
  constructor() {
    super('script reset (exit-script teardown)');
  }
}

/** exit-script (0x9)：清空全部 40 帧 + 重置全局数组（整体 teardown，回到干净初始态，供上层回到根/菜单）。 */
const op_exit_script: OpHandler = (c) => {
  for (const f of c.e.frames) {
    f.script = null;
    f.ip = 0;
    f.name = '';
    f.retStack = [];
    f.labelMap.clear();
    f.caller = -1;
    f.frameArg = 0;
  }
  c.e.globals.int.clear();
  c.e.globals.float.clear();
  c.e.globals.str.clear();
  c.e.globals.ptr.clear();
  c.e.globals.floatPtr.clear();
  c.e.cur = 0;
  c.e.callRet = -1;
  c.e.callLink = -1;
  c.e.callFlag = 0;
  throw new ScriptReset();
};

// 系统调用 opcode -> 走 NativeBridge（记录即可，无界面）。后续按需逐个转真。
const stubSubsystem: OpHandler = (c) => {
  const name = c.instr.name;
  const args = c.instr.args.map((a) => a.raw);
  switch (c.instr.opcode) {
    case 0xb4:
      c.native.playSound?.(args[0] ?? 0, args[1] ?? 0);
      break;
    case 0xbf:
      c.native.playBgm?.(args[0] ?? 0);
      break;
    case 0xc4:
      c.native.playVoice?.(args[0] ?? 0);
      break;
    case 0x1fb:
      c.native.drawTexture?.(args);
      break;
    case 0x1f9:
      c.native.setTexture?.(args);
      break;
    case 0x1a5:
      c.native.setFont?.(args);
      break;
    case 0x192:
      c.native.setString?.(c.instr.args[0]?.str ?? '');
      break;
    case 0xcd:
      c.native.getInputType?.();
      break;
    case 0xc8:
      c.native.sleep?.(args[0] ?? 0);
      break;
    default:
      c.native.unhandled?.(c.instr.opcode, name);
  }
};

/** 已实现的最小 VM 指令表。 */
export const OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  [0x50, op_add],
  [0x51, op_sub],
  [0x52, op_mul],
  [0x53, op_div],
  [0x54, op_mod],
  [0x55, op_mov],
  [0x56, op_and],
  [0x57, op_or],
  [0x58, op_sar],
  [0x59, op_shl],
  [0x5a, op_eq],
  [0x5b, op_ne],
  [0x5c, op_lt],
  [0x5d, op_lte],
  [0x5e, op_gr],
  [0x5f, op_gre],
  [0x8c, op_jmp],
  [0x8f, op_call],
  [0xa0, op_jcc],
  [0x5, op_ret],
  [0x3, op_call_script],
  [0x1a7, op_comment],
  [0x1a8, op_dev_ukn],
  [0x2, op_exit],
  [0x9, op_exit_script],
]);

/** 子系统 opcode -> NativeBridge 桩（记录后放行，不阻塞 VM）。 */
export const NATIVE_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  [0xb4, stubSubsystem],
  [0xbf, stubSubsystem],
  [0xc4, stubSubsystem],
  [0x1fb, stubSubsystem],
  [0x1f9, stubSubsystem],
  [0x1a5, stubSubsystem],
  [0x192, stubSubsystem],
  [0xcd, stubSubsystem],
  [0xc8, stubSubsystem],
  [0x6e, stubSubsystem],
  [0x6f, stubSubsystem],
  [0x72, stubSubsystem],
]);

/**
 * 引擎内部/子系统操作（不读/写 VM 的全局数组、脚本帧、IP、cur；不影响控制流）—— 插桩跳过。
 * 依据 ADR-010：逐条读 handler 体确认（见 docs/06 §2.2）。这些是 AGE 的消息/窗口/配置系统
 * 对 `_this + 21324` / `_this + 174405` 对象的调用、或 `_this[offset] = operand` 的引擎字段 setter，
 * 不触碰解释器可见状态。对"到 TITLE 路径"良性；M1 再按需补成精确语义。
 * 注意：`string-lookup-set`(0x1a3) 本为 VM 核心（写回操作数 1），此处实例为立即数退化且其后为常量 jcc，暂列插桩，M1 细化。
 */
const op_engine_internal: OpHandler = (c) => {
  c.log(
    `[engine-internal] 0x${c.instr.opcode.toString(16)} ${c.instr.name} ${c.instr.args
      .map((a) => (a.type === 2 ? `"${a.str}"` : `0x${a.raw.toString(16)}`))
      .join(' ')}`,
  );
};

export const ENGINE_INTERNAL_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  [0x2f6, op_engine_internal], // SYSTEM4: 引擎内部按索引初始化 3 槽
  [0x2f8, op_engine_internal], // sub_4B6940(v2+12, v4)（子系统对象方法）
  [0x149, op_engine_internal], // _this[97058] = operand (config)
  [0x88, op_engine_internal], // _this[1415]/[97050] + flag (config)
  [0x21b, op_engine_internal], // _this[166965] = (operand!=0)
  [0x1ca, op_engine_internal], // config set-message-read-texture
  [0x252, op_engine_internal], // _this[92323] = operand
  [0x324, op_engine_internal], // sub_453530(_this[93384])
  [0x32f, op_engine_internal], // sub_49A150(_this+80708)
  [0x70, op_engine_internal], // 消息系统 sub_45D660(_this+21324,...)
  [0x71, op_engine_internal], // 消息系统 + 缓冲拷贝
  [0x73, op_engine_internal], // 消息系统 sub_41F250
  [0x78, op_engine_internal], // _this[21667]=op; v1->sub_459F40()
  [0x79, op_engine_internal], // 消息系统 sub_4563A0(_this+21324,...)
  [0x1c1, op_engine_internal], // 消息系统 sub_4563D0(_this+21324,...)
  [0x212, op_engine_internal], // 消息部件 _this[result+21585] 字段
  [0x213, op_engine_internal], // 消息部件 _this[result+21585] 字段
  [0x25d, op_engine_internal], // 消息部件 _this[result+21585]+276/280
  [0x2db, op_engine_internal], // _this[71744]=op; sub_459F40()
  [0x303, op_engine_internal], // 消息系统 sub_456600(_this+21324,...)
  [0x1a3, op_engine_internal], // string-lookup-set：写回操作数1（此处立即数退化），M1 细化
  [0x1a2, op_engine_internal], // 写内部字符串查找表 _this+5452（非可见 VM 态），M1 细化
  [0x1a9, op_engine_internal], // 写内部字符串查找表 _this+5472（非可见 VM 态），M1 细化
]);
