/** 最小 opcode 处理器集 + 子系统 opcode 路由（NativeBridge stub）。
 *  未在任何表中出现的 opcode 由解释器硬报错（ADR-005）。
 *  M0 只覆盖：算术/位/比较/mov、jmp/call/jcc/ret、call-script、comment/dev_ukn、exit。
 *  其余控制流/子系统语义在 M1/M2 逐步补齐。
 */
import type { OpHandler, StepCtx } from './step.js';
import { readIntOperand, writeIntOperand, operandArg, refFromOperand, setRefOperand, readStringOperand, writeStringOperand, readFloatOperand, writeFloatOperand, readIndexOperand, readStringIndexOperand } from './operand.js';
import { asI32, atoi, dec, enc } from './bits.js';
import { refAt, readRef, writeRef } from './ref.js';
import { parseScriptBytes } from '../script/bin.js';
import type { Engine, Frame } from './engine.js';
import { SLEEP_GATE } from './engine.js';
import { cfgInt } from '../engineConfig.js';

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

/** op_mov (0x55) */
const op_fmov: OpHandler = (c) => {
  const v = readFloatOperand(c.e, c.frame, c.instr, 2);
  writeFloatOperand(c.e, c.frame, c.instr, 1, v);
};

/** float 双目：readFloat(2) [op] readFloat(3) -> writeFloat(1)。 */
function floatBinOp(apply: (l: number, r: number) => number): OpHandler {
  return (c) => {
    const l = readFloatOperand(c.e, c.frame, c.instr, 2);
    const r = readFloatOperand(c.e, c.frame, c.instr, 3);
    writeFloatOperand(c.e, c.frame, c.instr, 1, apply(l, r));
  };
}

/** int→float（0x2d6 专用已内联 in OPS 表）。 */

// ---- 位运算（0x135/0x136/0x13F）----
const op_bit_set: OpHandler = (c) => {
  const bit = readIntOperand(c.e, c.frame, c.instr, 2);
  if (bit > 0x1f) throw new Error(`bit-set: bit ${bit} > 31`);
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  writeIntOperand(c.e, c.frame, c.instr, 1, v | (1 << bit));
};
const op_bit_reset: OpHandler = (c) => {
  const bit = readIntOperand(c.e, c.frame, c.instr, 2);
  if (bit > 0x1f) throw new Error(`bit-reset: bit ${bit} > 31`);
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  writeIntOperand(c.e, c.frame, c.instr, 1, v & ~(1 << bit));
};
const op_check_bit: OpHandler = (c) => {
  const bit = readIntOperand(c.e, c.frame, c.instr, 3);
  if (bit > 0x1f) throw new Error(`check-bit: bit ${bit} > 31`);
  const v = readIntOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, ((1 << bit) & v) !== 0 ? 1 : 0);
};

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

/** random (0x60)：`op1 = rand() % op2`。op1 若为指针则写穿。 */
const op_random: OpHandler = (c) => {
  const mod = readIntOperand(c.e, c.frame, c.instr, 2);
  if (mod === 0) throw new Error('random: 模数为 0（引擎会抛除零异常）');
  // 近似引擎 rand()%mod：rand() 返回 [0,2^31)，与 Math.random() 近似（M0 非确定性，后续可换 LCG）。
  writeIntOperand(c.e, c.frame, c.instr, 1, ((Math.random() * 0x80000000) | 0) % mod);
};

/** memcpy (0x1B0)：`dest = src` 拷 op3 个元素（age-shared 注释 size=4*op3，即 op3 个 int）。 */
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
const op_strlen: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, s.length);
};

/** atoi (0x2ec)：`op1 = atoi(string op2)`（字符串→整数）。 */
const op_atoi: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, atoi(s));
};

/** set-string (0x192)：`string op1 = op2`（写全局/局部串槽；**VM 核心，非 native stub**）。 */
const op_set_string: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  writeStringOperand(c.e, c.frame, c.instr, 1, s);
};

/** concat (0x193)：`string op1 = op2 + op3`（字符串拼接；VM 核心）。 */
const op_concat: OpHandler = (c) => {
  const a = readStringOperand(c.e, c.frame, c.instr, 2);
  const b = readStringOperand(c.e, c.frame, c.instr, 3);
  writeStringOperand(c.e, c.frame, c.instr, 1, a + b);
};

// ---- 字符串表族（save/load-int=str→int 表 `_this+5452`；save/load-string=str→str 表 `_this+5472`；见 opcode-table.md）----

/** 组查询键：引擎 `wsprintfA("%c%8.8x", 哨兵, idx)`。int 表哨兵=3；string 表哨兵=5。 */
function stringTableKey(sentinel: number, idx: number): string {
  return String.fromCharCode(sentinel) + ((idx >>> 0).toString(16).padStart(8, '0'));
}

/** 0x1A2 save-int (sub_434F60)：把 op1 的值登记到引擎 `_this+5452` 字符串→整型表，键 = stringTableKey(3, op1 索引)。 */
const op_save_int: OpHandler = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 1);
  const key = stringTableKey(3, readIndexOperand(c.e, c.frame, c.instr, 1));
  c.e.stringIndexTable.set(key, value);
};

/** 0x1A3 load-int (sub_42DF40)：按 op1 索引查 `_this+5452` 表，命中取 *v3、未命中取 0，写回 op1（VM 可见）。 */
const op_load_int: OpHandler = (c) => {
  const key = stringTableKey(3, readIndexOperand(c.e, c.frame, c.instr, 1));
  const value = c.e.stringIndexTable.get(key) ?? 0;
  writeIntOperand(c.e, c.frame, c.instr, 1, value);
};

/** 0x1A9 save-string (sub_434FE0)：把 op1 的字符串登记到引擎 `_this+5472` 字符串→字符串表，键 = stringTableKey(5, op1 字符串索引)。 */
const op_save_string: OpHandler = (c) => {
  const str = readStringOperand(c.e, c.frame, c.instr, 1);
  const key = stringTableKey(5, readStringIndexOperand(c.e, c.frame, c.instr, 1));
  c.e.stringTable.set(key, str);
};

/** 0x1AA load-string (sub_433A70)：按 op1 字符串索引查 `_this+5472` 表，命中取字符串、未命中取空串，写回 op1（VM 可见）。 */
const op_load_string: OpHandler = (c) => {
  const key = stringTableKey(5, readStringIndexOperand(c.e, c.frame, c.instr, 1));
  const str = c.e.stringTable.get(key) ?? '';
  writeStringOperand(c.e, c.frame, c.instr, 1, str);
};

// ---- 引擎全局时间阈值槽 `_this[97058]`（0x148 读 / 0x149 写，get/set 对；见 analysis/sub_42FEC0/sub_4229A0）----
// 引擎里该槽被 sub_4B9240 用作「光标贴顶/Alt→弹系统对话框」的去抖时长；
// **emulator 暂无对应逻辑使用此值**，仅为让 0x148/0x149 可执行（原 0x148 未映射会抛 NotImplementedOp）而建模为固定变量读写。
/** 0x149 (sub_4229A0)：`op1 → _this[97058]`（写）。 */
const op_write_global_slot: OpHandler = (c) => {
  c.e.globalSlot97058 = readIntOperand(c.e, c.frame, c.instr, 1);
};

/** 0x148 (sub_42FEC0)：`op1 = _this[97058]`（读）。 */
const op_read_global_slot: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.globalSlot97058);
};

// ---- 控制流 ----
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
  let script: import('../script/bin.js').ScriptBinary;
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

// 系统调用 opcode -> 走 NativeBridge（记录即可，无界面）。后续按需逐个转真。

/** 0x2DE (u0042BAC0)：`op1 = system.stringResourceId(op2 字符串)`（设置/消息子系统查找，-1=未找到）。
 *  读 op2 字符串 + 写 op1 结果，故虽为核心流程但值来自子系统；按 native 路由（StubNative 返回 -1）。 */
const op_string_resource_id: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  const id = c.native.stringResourceId?.(s) ?? -1;
  writeIntOperand(c.e, c.frame, c.instr, 1, id);
};

/** 0x106/0x130/0x131/0x201/0x2DC 等：引擎配置 getter（读 `_this[字段]` 写 op1）。 */
const op_get_engine_value: OpHandler = (c) => {
  let v = 0;
  if (c.instr.opcode === 0x130) {
    // 0x130(load-show-logo)：读 `_this[96983]`（构造=1 播版权页；exit-script 置 0）。
    //   SYSTEM4 据此决定是否 `call-script LOGO`。
    v = c.e.engineValues.get(96983) ?? 0;
  } else if (c.instr.opcode === 0x131) {
    // 0x131（sub_42F7D0，raw 39355）：**直接读配置注册表** `message:MesWinAlpha` 写 op1
    //   （`v2 = GetConfig(_this[174405], "message:MesWinAlpha")`）。emulator 用启动加载的 SYS4REG.INI 取值。
    v = c.e.config ? cfgInt(c.e.config, 'message:meswinalpha', 0) : (c.e.engineValues.get(21668) ?? 0);
  } else {
    // 其余 getter（0x106/0x201/0x2DC…）：对应引擎字段尚未逐一定位 → 保持 0（与旧行为一致）。
    v = 0;
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

/**
 * 0xC0（sub_42E510, raw 38618）：读引擎音乐字段 `_this[174713]` → op1
 *   （`sub_42B4B0(_this, 1, _this[174713])`）。该字段由启动时 `sound:Music` 填充（raw 23678-23681），
 *   写回侧是 0xC3（sub_420F10）。CONFIG.txt 用 `i0c0 (local-int 2)` 读系统值。
 */
const op_get_music_field: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(174713) ?? 0);
};

/**
 * 0x2CE（sub_430A20, raw 40111）：`op1 = (_this[167990] != 0)` —— 显示模式/屏幕态 getter。
 *   该字段由启动时 `display:ScreenMode` 填充（raw 11980 `... = GetConfig(aDisplayScreenm) != 0`；raw 21660 处可翻转）。
 *   CONFIG1.txt:1459/1702 读它，且 **1702 的结果立刻被 `ne` 消费** → 当 no-op 跳过会让分支走错。
 */
const op_get_screen_mode: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.engineValues.get(167990) ?? 0) !== 0 ? 1 : 0);
};

/**
 * **「消息窗/消息渲染」与「声音」子系统的引擎内部指令 → 显式 no-op**（默认插桩，无需用户逐条跳过）。
 *
 * 判定依据 = 逐条读 handler 体（`engine/天结_unpacked.exe_utf8.c`）：体内只出现 `readIntOperand`
 *   + 对 `_this[引擎字段]` 的赋值/文本区写入，**既不 `writeIntOperand` 回写操作数，也不改 `ip`/`cur`**。
 * 这类操作 emulator 无对应子系统，效果不可观测 → 与 `ENGINE_INTERNAL_OPS` 同一取舍，但**单列并写明依据**，
 * 避免日后被当成"漏实现"。设置界面（CONFIG2/CONFIG1）实测出现次数最多的一批就在其中。
 *
 * 逐条依据：
 *  - `0x7F`(sub_42D1F0, raw 38011)   `op1 = _this[21668]`（消息窗 α；键 `message:MesWinAlpha`）
 *  - `0x80`(sub_41F690, raw 28787)   `_this[21631] = op1`（消息窗部件索引 **setter**：读 op1 写字段）
 *  - `0xC5`(sub_42E540, raw 38626)   读 op1 选键（`sound:Volume1..4`）→ `GetConfig` → 写 op2（音量显示；声音子系统）
 *  - `0x196`(sub_41FC20, raw 29032)  display-furigana：读 op1/op2/op3 写消息文本区（`WideCharToMultiByte` 组串）
 *  - `0x300`(sub_426990, raw 33743)  `_this[v2+122466] = op2 | (_this[..] & 0x10000)`、`_this[v2+122476] = op3`（消息窗对象表）
 *  - `0x301`(sub_4269F0, raw 33757)  `_this[v2+122486] = 0` + `sub_404F80(_this+21324, v2)`（清消息窗对象项）
 */
const op_msg_ui_internal: OpHandler = () => {
  // 有意为空：见上方逐条依据（消息窗/文本子系统状态写入，无 VM 可见副作用）。
};

/**
 * **消息窗（メッセージウィンドウ）一族 —— 真实现（写/读引擎字段）**。
 *
 * 引擎里这些 handler 就是"读操作数 → 写 `_this[字段]` / 读字段 → 写 op1"，语义可完全建模；
 * emulator 只是**不渲染**消息窗，所以看不到画面效果，但这属于"已实现"而不是"插桩跳过"。
 * 字段（DWORD 下标）：
 *  - `_this[21631]`（0x151FC）：消息窗当前窗格/部件索引 ← 0x80 setter；
 *  - `_this[21668]`（0x15290）：消息窗 α（键 `message:MesWinAlpha`，启动由 SYS4REG.INI 填充）← 0x7F getter；
 *  - `_this[122466 + v]`（0x77988 区）：消息窗对象**旗标**（op2 按位或，保留 bit16）、`_this[122476 + v]`：同项的值；
 *  - `_this[122486 + v]`（0x779D8 区）：消息窗对象项（0x301 清零后调 `sub_404F80(_this+21324, v)` 重算布局——
 *    该布局子系统 emulator 未建模，故只保留字段清零这一步）。
 */
const op_set_msgwin_part: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(21631, v);
};
const op_get_msgwin_alpha: OpHandler = (c) => {
  // 引擎：`op1 = _this[21668]`（该字段启动时由 `message:MesWinAlpha` 填充）
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(21668) ?? 0);
};
const op_msgwin_slot_flags: OpHandler = (c) => {
  // 引擎：`v2 = readIntOperand(1)`（对象项下标）；`_this[v2+122466] = readIntOperand(2) | _this[v2+122466] & 0x10000`；
  //       `_this[v2+122476] = readIntOperand(3)`
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  const flags = readIntOperand(c.e, c.frame, c.instr, 2);
  const value = readIntOperand(c.e, c.frame, c.instr, 3);
  const slot = v + 122466;
  c.e.engineValues.set(slot, (flags | ((c.e.engineValues.get(slot) ?? 0) & 0x10000)) | 0);
  c.e.engineValues.set(v + 122476, value);
};
const op_msgwin_slot_clear: OpHandler = (c) => {
  // 引擎：`v2 = readIntOperand(1)`；`_this[v2+122486] = 0`；`sub_404F80(_this+21324, v2)`（消息窗布局重算，未建模 → no-op）
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(v + 122486, 0);
};

/**
 * **`ENGINE_FIELD_STORE` 一族：读操作数 → 写「可建模的引擎字段」**（真实现）。
 *
 * 这些 handler 在引擎里就是 `_this[字段] = readIntOperand(n)`（个别是 `op2` 覆盖、或多字段），
 * **不回写操作数、不改控制流**，因此 emulator 可以把字段值原样存进 `Engine.engineValues`：
 *  - 语义完整（同族的 getter opcode 能读回一致的值，如 `0x21B`↔`0x247`）；
 *  - 只是这些字段在 emulator 里不驱动任何渲染/声音输出。
 * 早前为"跑到 TITLE"把它们统一当 no-op 插桩；现按引擎语义补齐字段写入。
 *
 * 规格：`{ 操作数序号(1-based) → [目标字段] }`；`transform` 可选（如布尔化、位组装）。
 */
interface FieldStoreSpec {
  /** 操作数序号 → 目标 `_this[K]` 字段。 */
  map: Record<number, number>;
  /** 取到的值变换（默认原样）。 */
  transform?: (v: number) => number;
}
const ENGINE_FIELD_STORE: Map<number, FieldStoreSpec> = new Map<number, FieldStoreSpec>([
  // ---- 消息窗（メッセージウィンドウ）属性/几何 ----
  [0x76, { map: { 1: 21664 }, transform: (v) => ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff) }], // 引擎按字节重排组装（BGR）
  [0x77, { map: { 1: 21665 }, transform: (v) => ((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff) }],
  [0x78, { map: { 1: 21667 } }],
  [0x8b, { map: { 1: 21669 } }],
  [0x1a4, { map: { 1: 21670, 2: 21671 } }], // 引擎：_this[21671]=op2；_this[21670]=op1
  [0x252, { map: { 1: 92323 } }], // 消息系统配置
  [0x261, { map: { 1: 80101 } }], // 消息窗配置
  [0x2ee, { map: { 1: 80106 } }], // 消息派发
  [0x2db, { map: { 1: 71744 } }], // 文本属性（引擎随后 sub_459F40 重排文本）
  // ---- 数据/配置/标志 ----
  [0x21b, { map: { 1: 166965 }, transform: (v) => (v !== 0 ? 1 : 0) }], // 引擎布尔寄存器（配套 getter 0x247）
  [0x24e, { map: { 1: 92340 } }],
  [0x10f, { map: { 1: 122369 } }],
  // ---- 输入（按键绑定表；emulator 无按键表，但值原样入字段以便口径统一）----
  [0xfe, { map: { 1: 517 } }], // SetKeyTotal（引擎：op1>0x1F 报错，这里照存）
  [0x107, { map: { 2: -1 } }], // SetKey：_this[op1+551]=op2 —— 字段随 op1 变，见下方专用 handler
]);

/** `0x107`（SetKey）：`_this[op1 + 551] = op2`（op1=键位 ≤0x1F）。 */
const op_set_key: OpHandler = (c) => {
  const key = readIntOperand(c.e, c.frame, c.instr, 1);
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  if (key <= 0x1f) c.e.engineValues.set(key + 551, value);
};

/** `0x10B`（SetKey 另一表）：`_this[op2 + 1383] = op1`（op1=值 ≤0x1F）。 */
const op_set_key2: OpHandler = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 1);
  const key = readIntOperand(c.e, c.frame, c.instr, 2);
  if (value <= 0x1f) c.e.engineValues.set(key + 1383, value);
};

/** `ENGINE_FIELD_STORE` 的统一 handler。 */
const op_engine_field_store: OpHandler = (c) => {
  const spec = ENGINE_FIELD_STORE.get(c.instr.opcode);
  if (!spec) return;
  for (const [nStr, field] of Object.entries(spec.map)) {
    if (field < 0) continue; // 动态字段由专用 handler 处理
    const v = readIntOperand(c.e, c.frame, c.instr, Number(nStr));
    c.e.engineValues.set(field, spec.transform ? spec.transform(v) : v);
  }
};

/** `0x247`（sub_430810, raw 40034）：`op1 = (_this[166965] != 0)` —— 引擎布尔寄存器 getter，与 0x21B 成对。 */
const op_get_engine_bool: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, (c.e.engineValues.get(166965) ?? 0) !== 0 ? 1 : 0);
};

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
const op_sort_index_arrays: OpHandler = (c) => {
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

/**
 * **`0x306`（sub_431FC0, raw 40948）：`op1 = GetConfig("system:EffectSkipOnClick")`**
 * —— 纯配置 getter（「点击跳过特效」开关，构造默认 1、配置文件可覆盖为 0）。
 * 修掉先前误用 `ENGINE_INTERNAL_OPS` 里 no-op 的问题：那样会让本指令**不写 op1**。
 */
const op_get_effect_skip: OpHandler = (c) => {
  const v = c.e.config ? cfgInt(c.e.config, 'system:effectskiponclick', 1) : 1;
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

/**
 * **`0x142`（sub_422930, raw 31020）：`_this[174812] = op1`** —— **脚本向引擎写一个全局开关**。
 *
 * 字段语义（`_this[174812]` = 字节 `0xAAB70` = 699248）——**全工程引用只有 4 处**，可完整定性：
 *  - **写**：只有本 handler（`_this[174812] = op1`，raw 31026）；
 *  - **初始化**：引擎构造 `sub_415640`（raw 22591）与复位 `sub_40DF10`（raw 17961）都置 **1**；
 *  - **读**：只有 `sub_4765C0() { return _this[699248] != 0; }`（raw 91057-91061）——**一个导出给脚本的
 *    布尔查询（引擎内零调用）**，即"脚本可读、脚本可写"的**引擎运行开关**。
 *  - 同族邻居：`sub_4765E0` 读 `effect_flags(699204)` 的 bit26、`sub_476600` 读 `(int)effect_flags < 0`
 *    （= ADV/跳读态），即 `sub_4765xxx` 是一族 Engine 状态查询，本字段是其中的一个通用 flag。
 *
 * 脚本用法（`src/CONFIG.txt`）：
 *  - `L40 i142 0`：在设置页开场（刚布好消息窗 `i070/i079/i213`、`i080 9` 切到第 9 窗格）之后置 **0**；
 *  - `L354 i142 1`：在设置页收尾（`i1bb` 恢复、`i080 8` 回第 8 窗格）之前置回 **1**。
 *  ⇒ 即**进设置页时"挂起"、离开时"恢复"**的状态开关（构造/复位默认 1 = 正常）。
 *
 * emulator 建模：写入 `Engine.engineValues`（稀疏字段表），语义与引擎一致；当前无脚本经 opcode 读回它，
 * 故它不会改变 emulator 的输出，但**必须写**（否则上游若加 getter，值会漂）。
 */
const op_set_engine_flag_174812: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(174812, v);
};

/**
 * `0x217`（sub_423B20, raw 31791）：**对象变换** —— 读 op1=handle、op2/op3/op4 三个 float，
 * 调 `sub_4ACF20(_this+80708, handle, f2, f3, f4)` 设置该绘制项/网格的变换（引擎的绘制容器与我们同构）。
 * emulator 目前不建模「对象变换」→ 转发给 native（当前为记录式 no-op），非"纯数值操作"。
 */
const op_set_object_transform: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const a = readFloatOperand(c.e, c.frame, c.instr, 2);
  const b = readFloatOperand(c.e, c.frame, c.instr, 3);
  const d = readFloatOperand(c.e, c.frame, c.instr, 4);
  c.native.setObjectTransform?.(handle, a, b, d);
};

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

// ---- 引擎渲染配置 opcodes（Plan A：配置对象到场景图，含严格 flag 校验）----
// 操作数布局：与 engine 反编译一致（handle 在 op1；颜色用 (opN<<24)|opN+1 的 ARGB）。
const op_mesh_create: OpHandler = (c) => {
  // u0043AA20 (0x320)：op1=handle, op9=vcount, op10=layer/tail；顶点源暂用默认满屏四边形。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const layer = readIntOperand(c.e, c.frame, c.instr, 10);
  const vcount = readIntOperand(c.e, c.frame, c.instr, 9);
  const verts = Array.from({ length: Math.max(0, vcount) }, () => ({ x: 0, y: 0, u: 0, w: 1, diffuse: 0xffffffff }));
  c.native.createMesh?.({ handle, layer, vcount, verts });
};
const op_set_vertex_color: OpHandler = (c) => {
  // 0x322：op1=handle, op3=alpha, op4=rgb → state0 (ARGB)。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const a = readIntOperand(c.e, c.frame, c.instr, 3);
  const b = readIntOperand(c.e, c.frame, c.instr, 4);
  c.native.setVertexColor?.(handle, ((a & 0xff) << 24) | (b & 0xffffff));
};
const op_set_vertex_color_alpha: OpHandler = (c) => {
  // 0x323：op1=handle, op2=delay, op3=count, op4=alpha, op5=rgb → state1 (ARGB)。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const count = readIntOperand(c.e, c.frame, c.instr, 3);
  const a = readIntOperand(c.e, c.frame, c.instr, 4);
  const b = readIntOperand(c.e, c.frame, c.instr, 5);
  c.native.setVertexColorAlpha?.(handle, delay, count, ((a & 0xff) << 24) | (b & 0xffffff));
};
const op_set_draw_color: OpHandler = (c) => {
  // 0x202：op1=handle, op2=delay, op3=count, op4=alpha, op5=rgb → to (ARGB)。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const delay = readIntOperand(c.e, c.frame, c.instr, 2);
  const count = readIntOperand(c.e, c.frame, c.instr, 3);
  const a = readIntOperand(c.e, c.frame, c.instr, 4);
  const b = readIntOperand(c.e, c.frame, c.instr, 5);
  c.native.setDrawColor?.(handle, delay, count, ((a & 0xff) << 24) | (b & 0xffffff));
};
const op_set_draw_color_alpha: OpHandler = (c) => {
  // 0x203 (sub_4232C0)：op1=handle, op2=blend(+48), op3=alpha(clamp/回退), op4=color(回退) → ARGB。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const alpha = readIntOperand(c.e, c.frame, c.instr, 3);
  const color = readIntOperand(c.e, c.frame, c.instr, 4);
  const argb = ((alpha & 0xff) << 24) | (color & 0xffffff);
  c.native.setDrawColorAlpha?.(handle, argb);
};
const op_release_texture: OpHandler = (c) => {
  // 0x1FA：op1=layer。
  const layer = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.releaseTexture?.(layer);
};
const op_play_movie: OpHandler = (c) => {
  // 0x20F：op1=movieId。
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  c.native.playMovie?.(id);
};
const op_set_wait_flag: OpHandler = (c) => {
  // 0x21C u00416270：置 effect_flags |= 0x400（版权页动画等待）。
  c.native.setWaitFlag?.(0x400);
  c.e.waitFlags |= 0x400;
};

/** 0xC8 sleep (sub_4218D0)：睡眠/帧让步。op1=n。
 * 引擎（raw .c 30288）：非 ADV 激活（(effect_flags&0x8000000)==0）时，n<10 → `Sleep(n)` ms；n>=10 →
 *   `sub_453A60(_this+107440, n)` 设帧率节流（`_this[6]=n` 帧间隔= n ms，sub_453AF0 按 `interval*frame_count - elapsed`
 *   决定 Sleep(剩余)）——两者本质都是 **暂停 ≈ n ms**。ADV 激活则 sleep 跳过。
 * emulator：置 `sleepUntil = nowMs + max(1, n)`、置 `waitFlags |= SLEEP_GATE`；渲染帧循环每帧 present 直到
 *   nowMs >= sleepUntil 才放行（对齐引擎帧让步，避免脚本空转）。 */
const op_sleep: OpHandler = (c) => {
  if (c.e.advActive) return; // 引擎：消息/ADV 激活时 sleep 跳过
  const n = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.sleepUntil = c.e.nowMs + Math.max(1, n);
  c.e.waitFlags |= SLEEP_GATE;
  c.native.sleep?.(n);
};

/** 0xA1 (sub_433A40)：菜单派发表复位。`sub_415530(_this+107679, 0xFFF)` 清空菜单字符串哈希表(容量 0xFFF)。 */
const op_menu_reset: OpHandler = (c) => {
  c.e.menuMap.clear();
  c.native.menuReset?.();
};

/** 0xA2 (sub_434F10)：登记菜单项 key→label。读 op1(键)+op2(值=目标 label) → `sub_434D00(_this+107679, key, &value)` 插入哈希表。
 *  引擎以字符串(sub_41B640)读 key；TITLE 用菜单项序号(-1/0/1/2/3/4)为键 → emulator 取 op1 的 **DEC 值**再字符串化（不能用
 *  readStringOperand，其对 local-int 会返回局部下标，是既有 bug）。 */
const op_menu_bind: OpHandler = (c) => {
  const key = String(readIntOperand(c.e, c.frame, c.instr, 1));
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  c.e.menuMap.set(key, value);
  c.native.menuBind?.(key, value);
};

/** 0xA3 (sub_429830)：按 key 查表派发。`sub_428E00(_this+107679, key)` 查；命中 `ip=str_table+4*值`(跳转)，未命中 `ip=str_table+4*op2`(回退 label)。等效 jmp 到目标指令。 */
const op_menu_dispatch: OpHandler = (c) => {
  const key = String(readIntOperand(c.e, c.frame, c.instr, 1));
  const fallback = readIntOperand(c.e, c.frame, c.instr, 2);
  const target = c.e.menuMap.get(key) ?? fallback;
  const p = labelPos(c.frame, target);
  if (p === null) return;
  c.jump(p);
};

const op_draw_texture: OpHandler = (c) => {
  // 0x1FB draw-texture：op1=handle、op2=layer、op3-6=源矩形、op7/8=目标位置。
  // 必须用 readIntOperand 解析 handle（(local-int 0) 等 ref 才能得 0x30d41，而非 raw=0）。
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const layer = readIntOperand(c.e, c.frame, c.instr, 2);
  const srcX = readIntOperand(c.e, c.frame, c.instr, 3);
  const srcY = readIntOperand(c.e, c.frame, c.instr, 4);
  const srcW = readIntOperand(c.e, c.frame, c.instr, 5);
  const srcH = readIntOperand(c.e, c.frame, c.instr, 6);
  const dstX = readIntOperand(c.e, c.frame, c.instr, 7);
  const dstY = readIntOperand(c.e, c.frame, c.instr, 8);
  c.native.configureDrawItem?.({ handle, layer, srcX, srcY, srcW, srcH, dstX, dstY, tex: handle });
};
const op_set_texture: OpHandler = (c) => {
  // 0x1F9 set-texture：op1=imgid、op2=slot。
  const imgid = readIntOperand(c.e, c.frame, c.instr, 1);
  const slot = readIntOperand(c.e, c.frame, c.instr, 2);
  c.native.bindTexture?.(imgid, slot);
};

/** 0x1F7 detach-texture (sub_422BC0)：纹理/图形子系统方法。op1=handle、op2=count；count≤1 单参(删单)，count>1 双参(删 [handle,handle+count))。 */
const op_detach_texture: OpHandler = (c) => {
  const handle = readIntOperand(c.e, c.frame, c.instr, 1);
  const count = readIntOperand(c.e, c.frame, c.instr, 2);
  c.native.detachTexture?.(handle, count);
};

// ---- 鼠标/输入子系统 opcodes（已读 handler 体；语义见 ../docs-new/03-engine/input-system.md）----

/** `read-mouse-button` (0x108, sub_42EDC0)：`op1 = 鼠标按钮值`。bit0=左、bit1=右（sub_477220 约定）。 */
const op_read_mouse_button: OpHandler = (c) => {
  const b = c.e.input.readButtons();
  writeIntOperand(c.e, c.frame, c.instr, 1, b);
};

/** `read-mouse-pos` (0x109, sub_42EE10)：`op1=X, op2=Y`（虚拟坐标；未初始化/出窗 = -100000）。 */
const op_read_mouse_pos: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.readX());
  writeIntOperand(c.e, c.frame, c.instr, 2, c.e.input.readY());
};

/**
 * `read-mouse-wheel` (0x10D, sub_42EF50)：**读鼠标滚轮增量（一次性消费）** → `op1`。
 * 引擎体（raw 39114-39122，本工程分析见 analysis/functions.json 的 op_read_mouse_wheel_42EF50）：
 *   `_this[30*cur+95805]=3;  v2 = _this[1949];  _this[1949] = 0;  writeIntOperand(1, v2);`
 * 即：取 `mouse_wheel_residual`(0x1E74) → **立即清零** → 写 op1。
 * 值语义：自上次读取以来 WM_MOUSEWHEEL 的增量累计（引擎单位：一格 ±120，**上滚正/下滚负**）。
 * 脚本用法（40+ 菜单/列表）：进入时 `read-mouse-wheel` 丢弃残量，主循环反复 `read-mouse-wheel` + `jcc (local) <翻页label>`
 *   → 非 0 即翻页；`gr (local 403) 0` 区分上/下滚（src/$3$AGENCY.txt:258/283/548）。
 * ⚠️与消息泵耦合：引擎的 ADV 推进分支（raw 13938）读同一累加器且**仅 <0（下滚）**才推进文本；
 *   脚本先 read-mouse-wheel 取走 ⇒ 累加器归零 ⇒ 泵侧不再推进（"脚本优先接管滚轮"）。
 *   emulator 的 0xCD get-input-type 走的是「时间节流/ADV 激活」而非滚轮值（见 input.getInputType 注释），
 *   故此处不做泵侧联动；若日后要让滚轮推进 ADV 文本，应在那里按 `<0` 消费。
 */
const op_read_mouse_wheel: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.consumeWheelDelta());
};

/** `mouse-callback` (0xCC, sub_421980)：注册鼠标跳转目标。op2=label。 */
const op_mouse_callback: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const target = operandArg(c.instr, 2).raw; // label 值（与 jmp/call 同尺度）
  c.e.input.mouseSlot = slot;
  c.e.input.mouseJump = target;
};

/** 0xFB (joy_callback, sub_421B80)：注册手柄跳转目标 op2。op1∈[0,32)。 */
const op_joy_callback: OpHandler = (c) => {
  const btn = readIntOperand(c.e, c.frame, c.instr, 1);
  if (btn < 0 || btn >= 32) throw new Error(`joy_callback: 按钮 ${btn} 越界 [0,32)`);
  const target = operandArg(c.instr, 2).raw;
  c.e.input.joyJump[btn] = target;
};

/** 0xFF (u00415A10, sub_419A90)：重置掩码并重刷当前按住态（键盘+鼠标），重置扫描游标。 */
const op_input_reset: OpHandler = (c) => {
  // 引擎：_this[174802]=0; sub_4780D0(键盘+鼠标)；emulator 简化为按当前按住态重建掩码
  c.e.input.flush();
};

/** 0x100 (u00415A60, sub_419AF0)：消息跳读/按键推进派发。扫掩码最低位、按注册表跳转。 */
const op_input_dispatch: OpHandler = (c) => {
  const mask = c.e.input.flush();
  if (mask === 0) return; // 无输入，落回
  let b = 0;
  while (((mask >> b) & 1) === 0) b++;
  // 鼠标位（4/5）→ 鼠标目标；否则按 joy 表（掩码位 = 4 + buttonIndex，故用 b-4）
  const t =
    (b === 4 || b === 5) && c.e.input.mouseJump !== -1
      ? c.e.input.mouseJump
      : c.e.input.joyJump[b - 4] ?? -1;
  if (t === -1 || t === 0xffffffff) return;
  const p = labelPos(c.frame, t);
  if (p !== null) {
    c.e.input.consumeEdges();
    c.jump(p);
  }
};

/** 0x101 (poll-input, sub_419CC0)：刷掩码后复位（清待处理输入）。 */
const op_poll_input: OpHandler = (c) => {
  c.e.input.flush();
  c.e.input.consumeEdges();
};

/** 0xCD (get-input-type, sub_41ACD0)：消息/ADV"点击推进"门。
 * 引擎：`if (now - lastAdvance >= throttle || adv_active)` 才推进（throttle=_this[429812]，adv_active=effect_flags&0x8000000）。
 * **核实：`_this[429812]` 全工程无写入 → bss 0 → 条件恒真 → 引擎 get-input-type 实际不节流（始终推进）**；
 *   emulator 旧 200ms 节流会引入 ~200ms 输入迟滞，故 advanceThrottle=0（见 input.ts）。
 * 推进即：压返回地址 + CALL 注册的 mouseJump 目标（handler 的 ret 回到循环）。**不读/不消费鼠标移动或按下沿**；
 * 未注册目标(==-1/0xFFFFFFFF) → 原地不跳。emulator 旧实现"有鼠标移动/按下才触发"为错。 */
const op_get_input_type: OpHandler = (c) => {
  const input = c.e.input;
  const target = input.getInputType(c.e.nowMs, c.e.advActive);
  if (target === null) return; // 未到节流/未激活/未注册 → 不推进（也不动鼠标/手把边沿）
  const p = labelPos(c.frame, target);
  if (p === null) return;
  c.frame.retStack.push(c.frame.ip + 1); // 压返回地址：handler 的 ret 回到循环下一条
  c.jump(p);
};

/**
 * 0x2FC (sub_431BA0)：读**触摸/手势触点** + 虚拟坐标。
 * 引擎：sub_477980(_this+258,&Point,&a3,&a4) 从**触摸/手势缓冲**取触点（非 GetCursorPos）→ 有触点写 op1=1、op2=虚屏X、op3=虚屏Y、
 *   op4=触点旗标(v9[4]=dwFlags)、op5=触点项[3](v9[3]=dwID)；**无触点写 op1=0**，handler 随即落回 read-mouse-pos/read-mouse-button 读**光标**。
 * emulator：只建模【鼠标光标】，**没有触摸/手势触点缓冲**；故**恒 op1=0（无触点）**——坐标/按钮由 label_0000047c 里的 read-mouse-pos/read-mouse-button
 * （读光标位置/按钮）提供，从而不误把光标当"触点按下"（引擎桌面鼠标下 0x2FC 返回 0）。 */
const op_get_mouse_state: OpHandler = (c) => {
  const im = c.e.input;
  im.touchId = 0; // 无触点（dwID=0）
  // 无触点：仅写 op1=0。坐标/按钮由后续 read-mouse-pos(光标X/Y) + read-mouse-button(按钮) 提供（TITLE label_0000047c 的 no-touch 分支）。
  // 注意：不要把「光标存在」当「触点存在」——那会误置 local 3f2=1(左键恒按下)，破坏 hover 高亮/回退。
  writeIntOperand(c.e, c.frame, c.instr, 1, 0);
  writeIntOperand(c.e, c.frame, c.instr, 2, im.readX());
  writeIntOperand(c.e, c.frame, c.instr, 3, im.readY());
  writeIntOperand(c.e, c.frame, c.instr, 4, 0); // 无触点旗标
  writeIntOperand(c.e, c.frame, c.instr, 5, 0); // 无触点 dwID
};

/**
 * 0x12E (u0041E940, sub_42F230)：鼠标悬停命中（point-in-rect），**几何完全来自脚本数据**。
 * 引擎：op2=margin 数组、op3=x、op4=y、op5=size 盒数组（每项 4 值 dx0/dx1/dy0/dy1）、op6=base X 数组、op7=base Y 数组、op8=count。
 * 逐项判定：`dx0 <= (x - baseX[i]) <= dx1 && dy0 <= (y - baseY[i]) <= dy1` → 命中项 i（写回 op1），否则 -1。
 * 实例（TITLE `u0041E940(local3f5)(local1)(local3f0)(local3f1)(localcd)(local5)(local69)(local0)`）：
 *   baseX=local5[i]、baseY=local69[i]、size=local cd/d1/d5/d9/dd（每项 [0,0x9c,0,0x9c]）、count=local0=5。
 * 说明：不在此模拟/写死任何按钮坐标；命中矩形完全由脚本的数据数组决定。
 */
const op_hover_hittest: OpHandler = (c) => {
  const x = readIntOperand(c.e, c.frame, c.instr, 3);
  const y = readIntOperand(c.e, c.frame, c.instr, 4);
  const count = readIntOperand(c.e, c.frame, c.instr, 8);
  const sizeRef = refFromOperand(c.e, c.frame, c.instr, 5); // size 盒数组
  const bxRef = refFromOperand(c.e, c.frame, c.instr, 6); // base X 数组
  const byRef = refFromOperand(c.e, c.frame, c.instr, 7); // base Y 数组
  let idx = -1;
  for (let i = 0; i < count; i++) {
    const r = i * 4;
    const dx0 = readRef(c.e, c.frame, refAt(sizeRef, r + 0));
    const dx1 = readRef(c.e, c.frame, refAt(sizeRef, r + 1));
    const dy0 = readRef(c.e, c.frame, refAt(sizeRef, r + 2));
    const dy1 = readRef(c.e, c.frame, refAt(sizeRef, r + 3));
    const bx = readRef(c.e, c.frame, refAt(bxRef, i));
    const by = readRef(c.e, c.frame, refAt(byRef, i));
    const px = x - bx;
    const py = y - by;
    if (px >= dx0 && px <= dx1 && py >= dy0 && py <= dy1) {
      idx = i;
      break;
    }
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, idx);
};

// ---- ADV/消息激活态（引擎 effect_flags 的 0x8000000 位；见 opcode-table.md 0x071/0x088/0x19B/0x19C）----
const ADV_FLAG = 0x8000000;
const setAdv = (e: Engine) => void (e.effectFlags |= ADV_FLAG);
const clearAdv = (e: Engine) => void (e.effectFlags &= ~ADV_FLAG);
const advField = (e: Engine, k: number): number => e.advFields.get(k) ?? 0;

/** 0x071 (sub_41ED80) 显示消息/推进文本：进入消息态 → 置 ADV 激活。引擎在"渲染成功"时才置位；emulator 无界面渲染，简化为"显示即 ADV 激活"。 */
const op_message_show: OpHandler = (c) => {
  readIntOperand(c.e, c.frame, c.instr, 1); // 消息文本/索引（emulator 不渲染）
  setAdv(c.e);
  c.e.advFields.set(122455, 1);
  c.e.advFields.set(122496, 0);
};

/** 0x088 (sub_41FAB0) 消息显示/跳读模式：写 `_this[1415]`+全局 `_this[97050]`；非零设 122368，零清 ADV 激活。 */
const op_message_mode: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.advFields.set(1415, v);
  c.e.advFields.set(97050, v);
  if (v !== 0) c.e.advFields.set(122368, 1);
  else clearAdv(c.e);
};

/** 0x19C (sub_419120) 进入消息/ADV：按 97050 / 122455 / 124331 条件置/清 ADV 激活。 */
const op_adv_enter: OpHandler = (c) => {
  c.e.advFields.set(97051, 1);
  c.e.advFields.set(122370, 0);
  if (advField(c.e, 97050) !== 0) {
    c.e.advFields.set(1415, 1);
  } else if (advField(c.e, 122455) === 0) {
    if (advField(c.e, 124331) === 0) {
      c.e.advFields.set(1415, 0);
      clearAdv(c.e);
    }
    return;
  }
  setAdv(c.e);
  c.e.advFields.set(122368, 1);
};

/** 0x19B (sub_4190E0) 退出消息/ADV：清 ADV 激活并复位字段。 */
const op_adv_exit: OpHandler = (c) => {
  clearAdv(c.e);
  c.e.advFields.set(1415, 0);
  c.e.advFields.set(97051, 0);
  c.e.advFields.set(122370, 0);
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
  [0x2d0, floatBinOp((l, r) => l + r)], // fadd
  [0x2d1, floatBinOp((l, r) => l - r)], // fsub
  [0x2d2, floatBinOp((l, r) => l * r)], // fmul
  [0x2d3, floatBinOp((l, r) => l / r)], // fdiv
  [0x2d4, floatBinOp((l, r) => r === 0 ? 0 : l % r)], // fmod
  [0x2d5, op_fmov], // 浮点 mov（op1 = op2）
  [0x2d6, (c) => { // int→float（op1 = (float)op2）
    const v = readIntOperand(c.e, c.frame, c.instr, 2);
    writeFloatOperand(c.e, c.frame, c.instr, 1, v);
  }],
  [0x60, op_random],
  [0x61, op_lookup_array],
  [0x63, op_lea],
  [0x64, op_copy_local_array],
  [0x135, op_bit_set],
  [0x136, op_bit_reset],
  [0x13f, op_check_bit],
  [0x6c, op_copy_to_global],
  [0x2c5, op_strlen],
  [0x2c6, op_strlen],
  [0x2ec, op_atoi],
  [0x192, op_set_string],
  [0x193, op_concat],
  [0x1a2, op_save_int], // save-int：字符串→整型表登记（`_this+5452`）
  [0x1a3, op_load_int], // load-int：查表写回 op1（VM 可见）
  [0x1a9, op_save_string], // save-string：字符串→字符串表登记（`_this+5472`）
  [0x1aa, op_load_string], // load-string：查表写回 op1 字符串（VM 可见）
  [0x148, op_read_global_slot], // read `_this[97058]` → op1（暂无用，仅建模）
  [0x149, op_write_global_slot], // write op1 → `_this[97058]`（暂无用，仅建模）
  [0x2d8, op_set_array_to],
  [0x12c, op_lookup_array_2d],
  [0x1b0, op_memcpy],
  [0x8c, op_jmp],
  [0x6, op_load_into_frame], // load-frame (0x6)：预装脚本进指定帧（不执行；配合 0x8 call-frame 启动）
  [0x8, op_call_frame], // call-frame (0x8)：调用/切换到已预装帧（配合 0x6 load-frame）
  [0x8f, op_call],
  [0xa0, op_jcc],
  [0x5, op_ret],
  [0x3, op_call_script],
  [0x1a7, op_comment],
  [0x1a8, op_dev_ukn],
  // ---- 消息窗（メッセージウィンドウ）一族：真实现（读写引擎字段；emulator 不渲染消息窗）----
  [0x7f, op_get_msgwin_alpha], // op1 = _this[21668]（消息窗 α）
  [0x80, op_set_msgwin_part], // _this[21631] = op1（窗格/部件索引 setter）
  [0x300, op_msgwin_slot_flags], // _this[v+122466] 旗标 / _this[v+122476] 值
  [0x301, op_msgwin_slot_clear], // _this[v+122486] = 0（+ 布局重算未建模）
  // ---- 「读操作数 → 写引擎字段」一族（真实现；规格见 ENGINE_FIELD_STORE）----
  [0x76, op_engine_field_store], // _this[21664]
  [0x77, op_engine_field_store], // _this[21665]
  [0x78, op_engine_field_store], // _this[21667]
  [0x8b, op_engine_field_store], // _this[21669]
  [0x1a4, op_engine_field_store], // _this[21670]/[21671]
  [0x252, op_engine_field_store], // _this[92323]
  [0x261, op_engine_field_store], // _this[80101]
  [0x2ee, op_engine_field_store], // _this[80106]
  [0x2db, op_engine_field_store], // _this[71744]
  [0x21b, op_engine_field_store], // _this[166965] = (op1!=0)（配套 getter 0x247）
  [0x247, op_get_engine_bool], // op1 = (_this[166965] != 0)
  [0x24e, op_engine_field_store], // _this[92340]
  [0x10f, op_engine_field_store], // _this[122369]
  [0xfe, op_engine_field_store], // _this[517]（SetKeyTotal）
  [0x107, op_set_key], // _this[op1+551] = op2
  [0x10b, op_set_key2], // _this[op2+1383] = op1
  [0x1, op_abort],
  [0x2, op_exit],
  [0x9, op_exit_script],
  // ---- 菜单派发（0xA1 复位 / 0xA2 登记 key→label / 0xA3 查表跳转）----
  [0xa1, op_menu_reset],
  [0xa2, op_menu_bind],
  [0xa3, op_menu_dispatch],
  // ---- 鼠标/输入子系统（读操作数/跳转/注册目标；语义见 docs-new/03-engine/input-system.md）----
  [0x108, op_read_mouse_button], // read-mouse-button：读鼠标按钮值 → op1
  [0x109, op_read_mouse_pos], // read-mouse-pos：读鼠标位置 → op1=X, op2=Y
  [0x10d, op_read_mouse_wheel], // read-mouse-wheel：读鼠标滚轮增量（一次性消费）→ op1
  [0xcc, op_mouse_callback],
  [0xfb, op_joy_callback],
  [0xff, op_input_reset],
  [0x100, op_input_dispatch],
  [0x101, op_poll_input],
  [0x2fc, op_get_mouse_state],
  [0xcd, op_get_input_type],
  [0x12e, op_hover_hittest], // u0041E940 悬停命中（mouse hover highlight）
  // ---- ADV/消息激活态（置/清 effect_flags 0x8000000）----
  [0x19c, op_adv_enter],
  [0x19b, op_adv_exit],
  [0x071, op_message_show],
  [0x088, op_message_mode],
]);

/** 子系统 opcode -> NativeBridge 桩（记录后放行，不阻塞 VM）。语义见 opcode-table.md；此处只记 emulator 路由。 */
export const NATIVE_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  [0xb4, stubSubsystem], // → native.playSound
  [0xbf, stubSubsystem], // → native.playBgm
  [0xc4, stubSubsystem], // → native.playVoice
  [0x2de, op_string_resource_id], // 字符串→索引；StubNative 返回 -1
  [0x106, op_get_engine_value], // 配置 getter ▶ op1
  [0x130, op_get_engine_value], // load-show-logo：`_this[96983]` ▶ op1（SYSTEM4 用，决定是否播 LOGO）
  [0x131, op_get_engine_value], // 配置 getter（`message:MesWinAlpha`）▶ op1
  [0x201, op_get_engine_value], // 配置 getter ▶ op1
  [0x2dc, op_get_engine_value], // 数组容量 getter ▶ op1
  [0xc0, op_get_music_field], // 音乐字段 `_this[174713]`（由 sound:Music 填充）▶ op1
  [0x2ce, op_get_screen_mode], // 显示模式 `_this[167990]!=0`（由 display:ScreenMode 填充）▶ op1
  [0x306, op_get_effect_skip], // `system:EffectSkipOnClick` ▶ op1（纯配置 getter）
  [0x217, op_set_object_transform], // 对象变换 → native.setObjectTransform（记录式）
  [0x308, stubSubsystem], // 输入触摸注册（图形/子系统副作用，丢弃）
  [0x341, stubSubsystem], // L2D 模型加载（无界面 stub）
  [0x345, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x34e, stubSubsystem], // 图形模型加载（无界面 stub）
  [0x320, op_mesh_create], // → native.createMesh（顶点缓冲/几何）
  [0x322, op_set_vertex_color], // → native.setVertexColor（mesh state0）
  [0x323, op_set_vertex_color_alpha], // → native.setVertexColorAlpha（动画窗）
  [0x1fc, stubSubsystem], // 纹理/图形子系统方法
  [0x1fd, stubSubsystem], // 缩放/纹理变换 op
  [0x1fe, stubSubsystem], // 纹理变换 op（4 浮点）
  [0x1ff, stubSubsystem], // 纹理变换 op
  [0x202, op_set_draw_color], // → native.setDrawColor（delay/count/to）
  [0x203, op_set_draw_color_alpha], // → native.setDrawColorAlpha（from）
  [0x204, stubSubsystem], // draw-string（无界面 stub）
  [0x205, stubSubsystem], // 纹理/文本 op
  [0x207, stubSubsystem], // 纹理 op
  [0x208, stubSubsystem], // 图形子系统方法
  [0x1f7, op_detach_texture], // → native.detachTexture（删单/区间）
  [0x1f8, stubSubsystem], // create-texture（LOGO 场景）
  [0x1fa, op_release_texture], // → native.releaseTexture
  [0x1fb, op_draw_texture], // → native.configureDrawItem
  [0x1f9, op_set_texture], // → native.bindTexture
  [0x20f, op_play_movie], // → native.playMovie
  [0x21c, op_set_wait_flag], // → native.setWaitFlag（0x400 等待门）
  [0x1a5, stubSubsystem], // set-font
  [0xc8, op_sleep], // → native.sleep + SLEEP_GATE 帧让步
  [0x6e, stubSubsystem], // show-text
  [0x6f, stubSubsystem], // end-text-line
  [0x72, stubSubsystem], // wait-for-input
]);

/**
 * 引擎内部/子系统操作：不读/写 VM 可见态（全局数组、脚本帧、IP、cur）、不影响控制流 —— emulator 插桩跳过。
 * 语义见 `docs-new/03-engine/opcode-table.md`（本表不再重复引擎 handler/偏移等细节，避免与数据层漂移）。
 * 对"到 TITLE 路径"良性；M1 再按需补成精确语义。
 */
const op_engine_internal: OpHandler = () => {
  // 纯 no-op 插桩跳过：不写 VM 状态、不控制流。**不再自打日志**——renderer 的 step trace 已逐条报
  // kind=engine-internal（且带 opcode）；自打 `[engine-internal] ...` 会造成每 op 双行，并在交互脚本
  // （0x20c 每帧一次）下刷屏。需要逐 op 细节看 renderer 的 step trace 即可。
};

/**
 * `ENGINE_INTERNAL_OPS` 中**带专门 handler（非纯 no-op）**的 opcode。
 *
 * 这张表里的条目分两类，语义不同，日志/控制窗要分开显示：
 *  - **纯 no-op 插桩**（`op_engine_internal`）：只有"不做任何事"这一个语义，属真·忽略；
 *  - **专门处理**（`op_msg_ui_internal` 等）：已按引擎语义读操作数/写状态，只是**不产生 emulator 可渲染的输出**
 *    （消息文本区、声音…）。
 * → `StepTrace.noop` 据此区分，避免把"已执行但无输出"误报成"被忽略"。
 *
 * ★注意：**能完整建模的 opcode 一律注册在 `OPS`（真实现）**，不放这里 —— 例如消息窗字段读写
 *   （0x7F/0x80/0x300/0x301）、数组排序（0x12F）、引擎开关（0x142）。这里只留"引擎有副作用但
 *   emulator 无对应子系统可承接"的少数几条。
 */
export const INTERNAL_WITH_HANDLER: ReadonlySet<number> = new Set<number>([
  0xc5, // 声音音量显示（读 sound:VolumeN，无声音子系统）
  0x142, // _this[174812] = op1（真实现：脚本可控引擎开关）
  0x12f, // 三数组插入排序 + 重编码（真实现）
  0x196, // display-furigana（文本渲染未建模）
]);

export const ENGINE_INTERNAL_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  // ============ 声音 子系统 ============
  [0xb5, op_engine_internal], // 声音通道控制（→ sub_4B5020/sub_4B6020）
  // ============ 渲染 / 图形 / 图像 / 纹理（emulator 无界面；只动 `_this+80708` 绘制容器等内部态） ============
  [0x20c, op_engine_internal], // 时间戳+present（帧同步；无操作数）
  [0x340, op_engine_internal], // 渲染
  [0x342, op_engine_internal], // 渲染
  [0x346, op_engine_internal], // 渲染
  [0x349, op_engine_internal], // 渲染
  [0x321, op_engine_internal], // 渲染
  [0x325, op_engine_internal], // 渲染
  [0x326, op_engine_internal], // 渲染
  [0x21e, op_engine_internal], // 渲染
  [0x1f4, op_engine_internal], // 渲染
  [0x1f5, op_engine_internal], // 渲染
  // ============ 消息窗 / 消息渲染 / 文本 / 字体 子系统 ============
  // 分组依据：handler 体只读操作数、写 `_this[消息窗族字段]`（0x151fc/0x152xx 区、`_this+21324` 文本子系统），
  // **不回写操作数、不改控制流**。其中「字段可建模」的已升级为真实现（见 OPS 的 ENGINE_FIELD_STORE 一族与
  // op_get_msgwin_alpha/op_set_msgwin_part/op_msgwin_slot_*），此处只留**宿主无对应子系统**的那些。
  [0x74, op_engine_internal], // 消息窗
  [0x75, op_engine_internal], // → sub_4185F0(_this+21324, op1)（文本子系统方法）
  [0x79, op_engine_internal], // 消息项（sub_41F4E0/sub_4563A0）
  [0x7a, op_engine_internal], // 消息窗
  [0x7b, op_engine_internal], // 消息窗
  [0x70, op_engine_internal], // 消息窗布局（op1..op5 → sub_45D660）
  [0x73, op_engine_internal], // 消息窗布局（10 操作数 → sub_453AD0）
  [0x197, op_engine_internal], // 消息/布局（sub_418680）
  [0x198, op_engine_internal], // 消息/布局
  [0x1b5, op_engine_internal], // 消息窗
  [0x1bb, op_engine_internal], // → sub_4034D0/sub_408050（文本格式化助手）
  [0x1c1, op_engine_internal], // 消息/UI（sub_4563D0）
  [0x1c9, op_engine_internal], // 消息窗
  [0x1ca, op_engine_internal], // SetConfig("message:ReadTextSkip", op1)（写配置注册表）
  [0x1cb, op_engine_internal], // 消息窗
  [0x1ce, op_engine_internal], // 消息窗
  [0x212, op_engine_internal], // 消息窗对象（sub_423A30）
  [0x213, op_engine_internal], // 消息窗对象（sub_423A80）
  [0x245, op_engine_internal], // 消息/UI
  [0x246, op_engine_internal], // 消息/UI
  [0x249, op_engine_internal], // 消息/UI
  [0x25a, op_engine_internal], // 消息/UI
  [0x25c, op_engine_internal], // 消息/UI
  [0x25d, op_engine_internal], // 消息列表对象（sub_425EF0/425F50）
  [0x25e, op_engine_internal], // 消息/UI
  [0x25f, op_engine_internal], // 消息/UI
  [0x260, op_engine_internal], // 消息窗配置（_this[80102..80104]）
  [0x2bd, op_engine_internal], // 文本/字体（op1 真值 → 文本子系统 +218516/+1248 = 700）
  [0x2be, op_engine_internal], // 文本/字体
  [0x2bf, op_engine_internal], // 文本/字体
  [0x2c0, op_engine_internal], // 文本/字体
  [0x2e8, op_engine_internal], // 消息/UI
  [0x2fe, op_engine_internal], // 字体（sub_4332D0：读字符串操作数）
  [0x303, op_engine_internal], // 消息/UI 对象（sub_456600）
  [0x324, op_engine_internal], // sub_453530(_this[93384])：计时/文本刷新（无操作数）
  [0x2f6, op_engine_internal], // 清消息回调槽 _this[v2+122505/122508] + _this[122501]（消息文本回调）
  // ============ 输入 子系统（按键绑定；emulator 无按键表） ============
  [0x10c, op_engine_internal], // SetKeyMulti：_this[_this[op2+1690]+1434]=op1
  [0x30a, op_engine_internal], // 键位注册：op1≤0x1F 且 op2≤7
  // ============ 字符串 / 查表 / 配置 ============
  [0x2c7, op_engine_internal], // 字符串处理（sub_433FD0）
  [0x2c8, op_engine_internal], // 字符串
  [0x2c9, op_engine_internal], // 字符串
  [0x2dd, op_engine_internal], // 字符串
  [0x2eb, op_engine_internal], // 配置/字符串：GetConfig("set:GameVersion") → sub_40C210 拼串
  // ============ 数据字段 / 版本 / 脚本控制 ============
  [0xad, op_engine_internal], // 数据
  [0xae, op_engine_internal], // 版本/存档：读 set:SaveVersion1/2 分支续档（sub_4192F0）
  [0xaf, op_engine_internal], // 数据
  [0x143, op_engine_internal], // 脚本控制：扫 256 请求槽 → queueScript → dispatchQueuedScripts（见 docs）
  // ============ 渲染 / 图形 / 图像 / 纹理 ============
  [0x32f, op_engine_internal], // → sub_49A150(_this+80708, op1)（绘制容器：设图元）
  [0x248, op_engine_internal], // 渲染/配置（sub_425310）
  [0x352, op_engine_internal], // → sub_4A1AC0（网格/顶点）
  [0x344, op_engine_internal], // → sub_4AFBF0（纹理）
  [0x23b, op_engine_internal], // 渲染/绘制（sub_424970）
  [0x25b, op_engine_internal], // 图像资源加载：_this[92379]/[92381] + sub_408440
  [0x1f6, op_engine_internal], // → sub_4AB7A0(_this+80708)：清/重置绘制容器（场景切换用）
  // ============ 数据 / 资源登记 ============
  [0x2da, op_engine_internal], // CG/资源登记（sub_4034D0/sub_426420）
  // ============ 鼠标点击路径安全桩（emulator 暂不渲染/不算，no-op 不崩） ============
  [0x23d, op_engine_internal], // 释放纹理槽
  [0x32b, op_engine_internal], // 图形
  // ============ 声音 ============
  [0x2f8, op_engine_internal], // → sub_4B6940(_this+4666, op1+12, op2)（声音通道/音量）
  // ---- 「消息渲染 / 声音」子系统：emulator 无对应子系统，按引擎语义"读操作数/写状态"但无输出 ----
  //  (0x7F/0x80/0x300/0x301 已升级为真实现，注册在 OPS；这里只留确实未建模的两条)
  [0x196, op_msg_ui_internal], // display-furigana（注音）：写消息文本区（文本渲染未建模）
  [0xc5, op_msg_ui_internal], // 读 op1 选 sound:Volume1..4 → GetConfig → 写 op2（音量显示；无声音子系统）
  // ---- 其余「纯数值操作」（读操作数写引擎字段，无 VM 可见副作用）----
  [0x142, op_set_engine_flag_174812], // _this[174812] = op1（脚本可控的引擎运行开关；构造/复位默认 1）
  [0x12f, op_sort_index_arrays], // 三数组：按 (DEC(A)+DEC(C)) 升序重排索引写 A，末尾 A 原地 ENC 重编码
]);
