/**
 * 控制流 + 脚本装载：jmp / call / call-frame / jcc / ret / call-script / exit / exit-script / abort。
 *
 * 这一族是**唯一**会改写 `ip` / `cur` 的地方，因此 `StepCtx.jump()` 的语义在此定义：
 * `jump(index)` = 下一指令下标；`jump(-1)` = 「控制流已转移，不要自动推进」。
 *
 * `ExitScript` / `ScriptReset` 是**解释器信号**（用异常穿越 handler 边界到 stepOnce 调用方），
 * 不是错误 —— 见 interpreter.run 的捕获。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, operandArg } from '../operand.js';
import { parseScriptBytes } from '../../script/bin.js';
import type { Frame } from '../engine.js';
import { labelPos } from './shared.js';
import type { OpTable } from './shared.js';

const op_jmp: OpHandler = (c) => {
  // 引擎 sub_4203D0：op1 经 readIntOperand 取值；op1==-1(0xFFFFFFFF) = 不跳（落下句），非错误。
  const t = readIntOperand(c.e, c.frame, c.instr, 1);
  if (t === -1) return;
  const p = labelPos(c.frame, t);
  if (p === null) throw new Error(`jmp: unknown label 0x${(t >>> 0).toString(16)}`);
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

/** call-frame (0x8, 引擎 sub_41C900)：调用/切换到「已预装的固定帧」op1（SYSTEM4 i006/load-frame 预装，见 flow-control §11.2）。
 *  备份调用方：调用方 ip += 1（返回后从下一条继续）、callRet=caller；目标帧 caller=caller、ip=0；cur=目标帧。
 *  被调帧跑完 exit(0x2) 依其 caller 返回调用帧。 */
const op_call_frame: OpHandler = (c) => {
  const frameIdx = readIntOperand(c.e, c.frame, c.instr, 1);
  if (frameIdx < 0 || frameIdx >= 40) throw new Error(`call-frame: frame index ${frameIdx} 越界`);
  const target = c.e.frames[frameIdx]!;
  if (!target.script) throw new Error(`call-frame: frame ${frameIdx} 未预装脚本（需先 load-frame 0x6）`);
  const caller = c.e.cur;
  c.e.frames[caller]!.ip += 1;   // 调用方退回后从下一条继续（引擎以帧状态=3 使恢复时 ip+=4*3）
  c.e.callRet = caller;
  target.caller = caller;
  target.frameArg = 0;
  c.e.cur = frameIdx;
  target.ip = 0;                 // 目标帧从起始执行
  c.jump(-1);                    // 控制转到新帧（不再自动推进）
};

const op_jcc: OpHandler = (c) => {
  const cond = readIntOperand(c.e, c.frame, c.instr, 1);
  // 引擎 sub_4209B0：分支目标(2/3)也经 readIntOperand 取值（可为变量 label；-1=落下句）。
  const branchLab = (n: number): number | null => {
    const t = readIntOperand(c.e, c.frame, c.instr, n);
    return t === -1 ? null : t;
  };
  if (cond !== 0) {
    const t = branchLab(2);
    if (t !== null) {
      const p = labelPos(c.frame, t);
      if (p === null) throw new Error(`jcc: unknown true label 0x${(t >>> 0).toString(16)}`);
      c.jump(p);
    }
    // t==null：真分支不跳 → 落到下一句（不设 jump）
  } else {
    const t = branchLab(3);
    if (t !== null) {
      const p = labelPos(c.frame, t);
      if (p === null) throw new Error(`jcc: unknown false label 0x${(t >>> 0).toString(16)}`);
      c.jump(p);
    }
    // t==null：假分支不跳 → 落到下一句
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

/** 0x1 abort (sub_418E60)：程序中止。引擎 `_CxxThrowException(&1, Command_Exit)`——立即退出整个程序。
 *  emulator：抛 `ExitScript`（程序退出信号），渲染器捕获后关闭主窗口；headless(run.ts) 捕获后停执行。 */

const op_abort: OpHandler = () => {
  throw new ExitScript();
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
  let script: import('../../script/bin.js').ScriptBinary;
  try {
    script = parseScriptBytes(src.data);
  } catch (err) {
    // 诊断：脚本数据过短/解析越界（可能在混合脚本包/非脚本索引上取到被截断的切片）
    throw new Error(
      `call-script: 解析脚本失败 0x${target.toString(16)} -> ${src.name} (data=${src.data.length}B): ${(err as Error).message}`,
    );
  }
  loadScriptIntoFrame(newFrame, script, src.name);
  c.log(`  [call-script] 0x${target.toString(16)} -> ${src.name} (${script.instructions.length} instr)`);
  c.jump(-1); // 控制到新帧
};

/**
 * 0x6 (load-frame，曾名 i006/u00417E80)：**预装脚本 op1 到指定帧 op2**（SYSTEM4 的帧布局初始化；handler 体会保存/恢复 cur）。
 *  handler：`v3=op1(idx); v4=op2(frame); save cur; cur=v4; sub_40ED40(...); restore cur;`
 *  ⇒ 效果 = 把脚本索引 op1 解析并装入 frame[op2]（cur 不变，供后续切换，配合 0x8 call-frame 启动）。
 */
const op_load_into_frame: OpHandler = async (c) => {
  const scriptIdx = readIntOperand(c.e, c.frame, c.instr, 1);
  const frameIdx = readIntOperand(c.e, c.frame, c.instr, 2);
  if (frameIdx < 0 || frameIdx >= 40) throw new Error(`0x6: frame index ${frameIdx} 越界`);
  if (!c.e.fileSource) throw new Error('0x6: no FileSource');
  const src = await c.e.fileSource.readScript(scriptIdx);
  if (!src) throw new Error(`0x6: cannot load script 0x${scriptIdx.toString(16)}`);
  const script = parseScriptBytes(src.data);
  loadScriptIntoFrame(c.e.frames[frameIdx]!, script, src.name);
};

/** 把解析好的脚本装入一个帧（建立 labelMap、局部池）。 */
export function loadScriptIntoFrame(frame: Frame, script: import('../../script/bin.js').ScriptBinary, name?: string): void {
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

/** exit-script (0x9)：全量 teardown → 置 `_this[96983]`(byte 387932)=0 → 重载根脚本 INDEX0 并继续。
 *  引擎 sub_428A60 语义：释放 40 帧 + 清全局内存池 + 引擎整体复位(sub_40DF10) + `_this[387932]=0` +
 *  `sub_40ED40(0,…)` 重载根脚本 0 并继续。GAMEOVER 依赖它回到标题界面。
 *  ★ `+96983` 置 0 是「回标题后不再重播 LOGO/版权页」的关键：SYSTEM4 `load-show-logo(0x130) → jcc → call-script LOGO`，
 *    而 `load-show-logo` 读 `_this[96983]`（构造=1 播放，exit-script=0 跳过）。 */
const op_exit_script: OpHandler = async (c) => {
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
  c.e.globals.strPtr.clear();
  c.e.stringTable.clear();
  c.e.cur = 0;
  c.e.callRet = -1;
  c.e.callLink = -1;
  c.e.callFlag = 0;
  c.e.effectFlags = 0;
  c.e.advFields.clear();
  c.e.globalSlot97058 = 0;
  // ★ 引擎 exit-script 置 _this[96983]=0 → GAMEOVER 回标题后 load-show-logo 读 0，SYSTEM4 跳过 LOGO/版权页。
  c.e.engineValues.set(96983, 0);
  // 重载根脚本 INDEX0（0=SYSTEM4 引导）；根脚本缺失/加载失败 → 程序退出（同引擎 Command_Exit 语义）。
  if (!c.e.fileSource) throw new ExitScript();
  const boot = await c.e.fileSource.readScript(0);
  if (!boot) throw new ExitScript();
  const script = parseScriptBytes(boot.data);
  loadScriptIntoFrame(c.e.frames[0]!, script, boot.name);
  c.e.cur = 0;
  c.jump(0); // 控制流重定位到新根帧 ip=0，继续跑（而非停在 reset）
};

/** 控制流 + 脚本装载（唯一改写 ip/cur 的一族）。 */
export const CONTROL_OPS: OpTable = [
  [0x8c, op_jmp],
  [0x6, op_load_into_frame], // load-frame (0x6)：预装脚本进指定帧（不执行；配合 0x8 call-frame 启动）
  [0x8, op_call_frame], // call-frame (0x8)：调用/切换到已预装帧（配合 0x6 load-frame）
  [0x8f, op_call],
  [0xa0, op_jcc],
  [0x5, op_ret],
  [0x3, op_call_script],
  [0x1a7, op_comment],
  [0x1a8, op_dev_ukn],
  [0x1, op_abort],
  [0x2, op_exit],
  [0x9, op_exit_script],
];

