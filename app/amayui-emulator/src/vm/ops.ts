/** 最小 opcode 处理器集 + 子系统 opcode 路由（NativeBridge stub）。
 *  未在任何表中出现的 opcode 由解释器硬报错（ADR-005）。
 *  M0 只覆盖：算术/位/比较/mov、jmp/call/jcc/ret、call-script、comment/dev_ukn、exit。
 *  其余控制流/子系统语义在 M1/M2 逐步补齐。
 */
import type { OpHandler, StepCtx } from './step.js';
import { readIntOperand, writeIntOperand, operandArg, refFromOperand, setRefOperand, readStringOperand, writeStringOperand, readFloatOperand, writeFloatOperand } from './operand.js';
import { asI32, atoi } from './bits.js';
import { refAt, readRef, writeRef } from './ref.js';
import { parseScriptBytes } from '../script/bin.js';
import type { Frame } from './engine.js';
import { SLEEP_GATE } from './engine.js';

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
  // 语义（docs/re/src/02）：cond!=0 → 跳 A（A==0xFFFFFFFF 则不跳，落到下句）；cond==0 → 跳 B（B==0xFFFFFFFF 则不跳）。
  if (cond !== 0) {
    if (aTrue && aTrue.raw !== 0xffffffff) {
      const p = labelPos(c.frame, aTrue.raw);
      if (p === null) throw new Error(`jcc: unknown true label 0x${aTrue.raw.toString(16)}`);
      c.jump(p);
    }
    // A==0xFFFFFFFF：真分支不跳 → 落到下一句（不设 jump）
  } else if (aFalse && aFalse.raw !== 0xffffffff) {
    const p = labelPos(c.frame, aFalse.raw);
    if (p === null) throw new Error(`jcc: unknown false label 0x${aFalse.raw.toString(16)}`);
    c.jump(p);
  }
  // 双 0xFFFFFFFF / 假分支 0xFFFFFFFF：fallthrough
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
 * 0x6 (u00417E80)：**预装脚本 op1 到指定帧 op2**（SYSTEM4 的帧布局初始化；handler 体会保存/恢复 cur）。
 *  handler：`v3=op1(idx); v4=op2(frame); save cur; cur=v4; sub_40ED40(...); restore cur;`
 *  ⇒ 效果 = 把脚本索引 op1 解析并装入 frame[op2]（cur 不变，供后续切换）。
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

/** 0x2DE (u0042BAC0)：`op1 = system.stringResourceId(op2 字符串)`（设置/消息子系统查找，-1=未找到）。
 *  读 op2 字符串 + 写 op1 结果，故虽为核心流程但值来自子系统；按 native 路由（StubNative 返回 -1）。 */
const op_string_resource_id: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  const id = c.native.stringResourceId?.(s) ?? -1;
  writeIntOperand(c.e, c.frame, c.instr, 1, id);
};

/** 0x106 等：引擎配置 getter（读 _this[字段] 写 op1）。各 opcode 读不同字段，此处按 opcode 读取建模值。 */
const op_get_engine_value: OpHandler = (c) => {
  // 仅 0x130 已知读 _this[96983]（engine.cpp sub_42F7A0=38664；构造函数默认置 1，见 Engine.engineValues）。
  // SYSTEM4 据此决定是否执行 `call-script LOGO`（开场版权/背景 = SO006+SO005）。其余 getter 无界面态保持 0。
  let v = 0;
  if (c.instr.opcode === 0x130) v = c.e.engineValues.get(96983) ?? 0;
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
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

/** 0x108 (u00415E70, sub_42EDC0)：`op1 = 鼠标按钮值`。bit0=左、bit1=右（sub_477220 约定）。 */
const op_read_mouse_buttons: OpHandler = (c) => {
  const b = c.e.input.readButtons();
  writeIntOperand(c.e, c.frame, c.instr, 1, b);
};

/** 0x109 (u00415EC0, sub_42EE10)：`op1=X, op2=Y`（虚拟坐标；未初始化/出窗 = -100000）。 */
const op_read_mouse_pos: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.readX());
  writeIntOperand(c.e, c.frame, c.instr, 2, c.e.input.readY());
};

/** 0xCC (mouse_callback, sub_421980)：注册鼠标跳转目标。op2=label。 */
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
 *   op4=触点旗标(v9[4]=dwFlags)、op5=触点项[3](v9[3]=dwID)；**无触点写 op1=0**，handler 随即落回 i109/i108 读**光标**。
 * emulator：只建模【鼠标光标】，**没有触摸/手势触点缓冲**；故**恒 op1=0（无触点）**——坐标/按钮由 label_0000047c 里的 i109/i108
 * （读光标位置/按钮）提供，从而不误把光标当"触点按下"（引擎桌面鼠标下 0x2FC 返回 0）。 */
const op_get_mouse_state: OpHandler = (c) => {
  const im = c.e.input;
  im.touchId = 0; // 无触点（dwID=0）
  // 无触点：仅写 op1=0。坐标/按钮由后续 i109(光标X/Y) + i108(按钮) 提供（TITLE label_0000047c 的 no-touch 分支）。
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
  [0x2d8, op_set_array_to],
  [0x12c, op_lookup_array_2d],
  [0x1b0, op_memcpy],
  [0x8c, op_jmp],
  [0x6, op_load_into_frame],
  [0x8f, op_call],
  [0xa0, op_jcc],
  [0x5, op_ret],
  [0x3, op_call_script],
  [0x1a7, op_comment],
  [0x1a8, op_dev_ukn],
  [0x2, op_exit],
  [0x9, op_exit_script],
  // ---- 鼠标/输入子系统（读操作数/跳转/注册目标；语义见 docs-new/03-engine/input-system.md）----
  [0x108, op_read_mouse_buttons],
  [0x109, op_read_mouse_pos],
  [0xcc, op_mouse_callback],
  [0xfb, op_joy_callback],
  [0xff, op_input_reset],
  [0x100, op_input_dispatch],
  [0x101, op_poll_input],
  [0x2fc, op_get_mouse_state],
  [0xcd, op_get_input_type],
  [0x12e, op_hover_hittest], // u0041E940 悬停命中（mouse hover highlight）
]);

/** 子系统 opcode -> NativeBridge 桩（记录后放行，不阻塞 VM）。 */
export const NATIVE_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  [0xb4, stubSubsystem],
  [0xbf, stubSubsystem],
  [0xc4, stubSubsystem],
  [0x2de, op_string_resource_id],
  [0x106, op_get_engine_value],
  [0x130, op_get_engine_value], // _this[96983] -> op1（配置 getter，默认 0）
  [0x131, op_get_engine_value], // 子系统 vtable(_this+174405) -> op1（默认 0）
  [0x201, op_get_engine_value], // _this[166964] -> op1（配置 getter，默认 0）
  [0x2dc, op_get_engine_value], // (_this[71741]-_this[71740])>>5 -> op1（数组容量 getter，默认 0）
  [0x308, stubSubsystem], // sub_407B20(registry, _this[96981], op1)，结果丢弃（子系统/图形副作用）
  [0x341, stubSubsystem], // L2D 模型文件加载（sub_4559C0/…/sub_4A1860；失败弹"L2Dモデルファイル…読み込みに失敗"。无界面 stub）
  [0x345, stubSubsystem], // 图形模型文件加载（sub_427CF0，同 0x341 模式）
  [0x34e, stubSubsystem], // 图形模型文件加载（sub_428200，同 0x341 模式）
  [0x320, op_mesh_create], // 顶点缓冲/几何设置（sub_4ADFE0）→ 建 mesh 到场景图
  [0x322, op_set_vertex_color], // set-vertex-color → mesh state0
  [0x323, op_set_vertex_color_alpha], // set-vertex-color-alpha → mesh 动画窗
  [0x1fc, stubSubsystem], // 纹理/图形子系统方法（sub_4AC470(_this+80708, op1)）
  [0x1fd, stubSubsystem], // 纹理变换 op（读浮点）
  [0x1fe, stubSubsystem], // 纹理变换 op（读 4 浮点）
  [0x1ff, stubSubsystem], // 纹理变换 op（读浮点）
  [0x202, op_set_draw_color], // set-draw-color（sub_4231F0 → 字体/图形颜色动画窗）
  [0x203, op_set_draw_color_alpha], // set-draw-color-alpha（sub_4232C0）
  [0x204, stubSubsystem], // draw-string（读 op3 字符串绘制；无界面 stub）
  [0x205, stubSubsystem], // 纹理/文本 op（sub_4233E0）
  [0x207, stubSubsystem], // 纹理 op（sub_423480）
  [0x208, stubSubsystem], // 图形子系统方法（sub_49ED60(_this+80708, op1,…)）
  [0x1f7, op_detach_texture], // detach-texture（sub_422BC0，读 op1/2）→ native.detachTexture（删单/区间）
  [0x1f8, stubSubsystem], // create-texture（sub_422C20，造纹理对象；LOGO 场景用到）
  [0x1fa, op_release_texture], // release-texture（LOGO 场景用到）
  [0x1fb, op_draw_texture], // draw-texture → configureDrawItem（readIntOperand 解析 handle）
  [0x1f9, op_set_texture], // set-texture → bindTexture
  [0x20f, op_play_movie], // play-movie（LOGO.MPG 视频句柄）
  [0x21c, op_set_wait_flag], // u00416270 → 置 0x400 等待旗标
  [0x1a5, stubSubsystem],
  [0xc8, op_sleep], // sleep（sub_4218D0，读 op1=n；置 SLEEP_GATE 帧让步）
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
const op_engine_internal: OpHandler = () => {
  // 纯 no-op 插桩跳过：不写 VM 状态、不控制流。**不再自打日志**——renderer 的 step trace 已逐条报
  // kind=engine-internal（且带 opcode）；自打 `[engine-internal] ...` 会造成每 op 双行，并在交互脚本
  // （0x20c 每帧一次）下刷屏。需要逐 op 细节看 renderer 的 step trace 即可。
};

export const ENGINE_INTERNAL_OPS: Map<number, OpHandler> = new Map<number, OpHandler>([
  [0x2f6, op_engine_internal], // SYSTEM4: 引擎内部按索引初始化 3 槽
  [0x76, op_engine_internal], // 消息窗字段 _this[21664]=BYTE交换(op1) + sub_459F40(_this+21324)（颜色/文本字段）
  [0x77, op_engine_internal], // 同上，_this[21665]（另一消息窗字段）
  [0x74, op_engine_internal], // _this[21668]=op1（消息窗字段）
  [0x75, op_engine_internal], // sub_4185F0(_this+21324, op1)（消息系统方法）
  [0x7a, op_engine_internal], // sub_45A910(_this+21324, op1,op2,op3)（消息系统方法）
  [0x7b, op_engine_internal], // _this[cur+122372]=op1; _this[cur+122412]=op2（每帧引擎寄存器）
  [0x1a4, op_engine_internal], // _this[21671]=op2; _this[21670]=op1（消息窗字段）
  [0x1b5, op_engine_internal], // _this[21668]=op1 + vtable+12(_this+174405,"message",op1)
  [0x1bb, op_engine_internal], // config setter（_this+388220；无效值弹 ShowMessage 异常=子系统）
  [0x1c9, op_engine_internal], // 子系统对象方法 sub_4559C0/sub_455560(_this+680092)
  [0x1cb, op_engine_internal], // _this[107706]=op1; flag + sub_453A90(_this+107650)
  [0x1ce, op_engine_internal], // 同上（0x1CB 同 handler）
  [0x2ee, op_engine_internal], // _this[80106]=op1 + vtable+12(_this+174405,"message",op1)
  [0xfe, op_engine_internal], // _this[517]=op1（set-keytotal；>0x1F 弹 ShowMessage 异常=子系统）
  [0x10b, op_engine_internal], // _this[op2+1383]=op1（按键绑定数组，>0x1F 不写）
  [0x10c, op_engine_internal], // _this[.*]=op2（set-keymulti；>0x1F 弹异常）
  [0x107, op_engine_internal], // _this[op1+551]=op2（按键绑定数组，>0x1F 不写）
  [0x10f, op_engine_internal], // _this[122369]=op1（引擎字段）
  [0x30a, op_engine_internal], // _this[op2+1969]=op1（set-geskey；>0x1F / >7 弹异常=子系统）
  [0x25a, op_engine_internal], // _this[92379]=1;[92380]=op1 + sub_4A5470(_this+80708)
  [0x25b, op_engine_internal], // _this[92379]=2;[92381]=op1 + sub_408440
  [0x25c, op_engine_internal], // 读多操作数设消息窗配置字段（sub_425E70）
  [0x25e, op_engine_internal], // 颜色字节交换后设消息窗字段（sub_425F50）
  [0x25f, op_engine_internal], // 同上（sub_425FF0）
  [0x260, op_engine_internal], // _this[80105/80104/80102]=…（消息窗配置字段）
  [0x245, op_engine_internal], // sub_4081B0(_this[op1+94672], op2/dbl)（子系统对象方法）
  [0x246, op_engine_internal], // sub_…(_this[op1+94672], op2)（子系统对象方法）
  [0x248, op_engine_internal], // dword_55052C=op1（静态配置文件）
  [0x249, op_engine_internal], // vtable 调用 _this[op1+94672]（子系统对象方法）
  [0x143, op_engine_internal], // 遍历 _this+173106 表，对每个非零项 sub_40FC90(_this, i<<24)=注册 APPEND 集合（0xNN000000）；fileSource 已自解析此类索引
  [0x2bd, op_engine_internal], // (v1=_this+21324) op1 非0: v1+218516/1248=700（消息窗字段）
  [0x2be, op_engine_internal], // op1 非0: v1+218588/1308=700（消息窗字段）
  [0x2bf, op_engine_internal], // sub_4B5170(_this+20719, op1,op2,op3)（子系统对象方法）
  [0x2c0, op_engine_internal], // sub_4BBA40(_this+21032, …,0)（子系统对象方法）
  [0x2fe, op_engine_internal], // sub_432DD0(_this+21324, op1字符串)（消息/设置子系统方法）
  [0x340, op_engine_internal], // sub_49A2D0(_this+80708, op1)（L2D/图形子系统方法）
  [0x342, op_engine_internal], // sub_4A1A60(_this+80708, op1)（L2D/图形子系统方法）
  [0x344, op_engine_internal], // sub_4AFBF0(_this+80708, op1, op2)（L2D/图形子系统方法）
  [0x346, op_engine_internal], // sub_4AFC40(_this+80708, op1)（L2D/图形子系统方法）
  [0x349, op_engine_internal], // sub_4AFF80(_this+80708, op1, 浮点…)（L2D/图形子系统方法）
  [0x352, op_engine_internal], // sub_4A1AC0(_this+80708, op1, op2, op3)（L2D/图形子系统方法）
  [0x321, op_engine_internal], // sub_4AE280(_this+80708, op1, op2, op3)（L2D/图形子系统方法）
  [0x322, op_engine_internal], // 读 op 操作数设图形子系统（sub_426C20）
  [0x323, op_engine_internal], // 同上（sub_426CF0）
  [0x325, op_engine_internal], // _this[93384]+1244=op2（图形配置字段）
  [0x326, op_engine_internal], // 读 op（含浮点）设图形子系统（sub_426E10）
  [0x2da, op_engine_internal], // CG 编号 setter（op1>0xA 弹异常=子系统）
  [0x2eb, op_engine_internal], // vtable+8(…,"SetGameVersion") 取版本串建内部串（设置/消息子系统）
  [0x2e8, op_engine_internal], // vtable+12(…,"MessageAutomes_1", op1)（消息/设置子系统方法）
  [0x2dd, op_engine_internal], // 字符串子系统 op（sub_434720 建内部串）
  [0x2c7, op_engine_internal], // 字符串子系统 op（sub_433FD0 字节处理）
  [0x2c8, op_engine_internal], // 字符串子系统 op（sub_434260）
  [0x2c9, op_engine_internal], // 字符串解析 op（sub_4344A0）
  [0x23b, op_engine_internal], // 图形层变换 setter（_this[13869+layer] 结构，读 op1/3/6/7；graphics 子系统）
  [0x24e, op_engine_internal], // _this[92340]=op1（引擎字段）
  [0x21c, op_engine_internal], // _this[174801]|=0x400（旗标；无 VM 可见写）
  [0x21e, op_engine_internal], // sub_4AA180(_this+80708)（L2D/图形子系统方法）

  [0x1f4, op_engine_internal], // 引擎计数器（_this[107438]/[107439]）
  [0x1f5, op_engine_internal], // 读引擎字段（_this[429756]/[429752]/[497400]）
  [0x1f6, op_engine_internal], // sub_4AB7A0(_this+80708)（L2D/图形子系统方法）
  [0x197, op_engine_internal], // sub_418680(_this+21324, op1)（消息/设置子系统方法）
  [0x198, op_engine_internal], // sub_456400(_this+21324, op1,op2,op3)（消息/设置子系统方法）
  [0x8b, op_engine_internal], // _this[21669]=op1（消息窗字段）
  [0x261, op_engine_internal], // _this[80101]=op1（引擎字段）
  [0x2e7, op_engine_internal], // 条件配置 setter（sub_426540）
  [0x2e9, op_engine_internal], // _this[122464]=op1（引擎字段）
  [0xae, op_engine_internal], // save-version 兼容：_this[95780]==0 时 no-op；有存档版本时才按版本推进 IP（新开局=no-op）
  [0xad, op_engine_internal], // sub_4380F0(_this+5191)（子系统，结果丢弃）
  [0xaf, op_engine_internal], // 返回 cur、设 arity（对解释器 no-op）
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
  // 鼠标点击路径安全桩：图形提交 / 悬停位置计算（emulator 暂不渲染/不算，no-op 不崩）
  [0x20c, op_engine_internal], // u00416200 时间戳+present（sub_41A1A0；无界面 no-op；TITLE 点击 handler 入口）
  [0xb5, op_engine_internal], // u0041D050 声音通道控制（sub_420B40；无界面 no-op；TITLE 音效用）
  // 菜单派发表（uninitialized 菜单下点击退化路径；纯跳转表 no-op 不崩）
  [0xa1, op_engine_internal], // u00427C00（sub_433A40）菜单状态初始化（no-op）
  [0xa2, op_engine_internal], // u00427FD0（sub_434F10）间接跳转表设置（no-op）
  [0xa3, op_engine_internal], // u004244D0（sub_429830）菜单当前项设置（no-op）
  [0x23d, op_engine_internal], // u004162F0 释放纹理槽 42..999（sub_41A300；emulator 无界面 no-op）
  [0x32b, op_engine_internal], // u0043AAD0（sub_41A4A0；no-op）
]);
