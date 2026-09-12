/**
 * 控制流 + 脚本装载：jmp / call / call-frame / jcc / ret / call-script / exit / exit-script / abort。
 *
 * 这一族是**唯一**会改写 `ip` / `cur` 的地方，因此 `StepCtx.jump()` 的语义在此定义：
 * `jump(index)` = 下一指令下标；`jump(-1)` = 「控制流已转移，不要自动推进」。
 *
 * `ExitScript` / `ScriptReset` 是**解释器信号**（用异常穿越 handler 边界到 stepOnce 调用方），
 * 不是错误 —— 见 interpreter.run 的捕获。
 */
import type { OpHandler, StepCtx } from '../step.js';
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
const op_exit: OpHandler = async (c) => {
  const caller = c.frame.caller;
  if (caller === DISPATCH_SENTINEL) {
    // ★引擎 `sub_41A820` 的 -10 分支（raw 25661-25673）：派发脚本跑完 —— 还原现场、继续派发下一条；
    //   队列排空则回到派发发起者（INIT2）已经推进过的下一条指令。见 `dispatchNextRequest` 的说明。
    await dispatchNextRequest(c);
    return;
  }
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

// ---------------------------------------------------------------------------
// 脚本请求派发：0x143 (i143) —— 扩展包 $n$AUTORUN 的激活入口
// ---------------------------------------------------------------------------

/** 引擎的**派发帧**：`sub_40FB60` 把正请求脚本装进 `cur = 37`（raw 18987）。emulator 同样是 40 帧 ⇒ 帧 37 可用。 */
const DISPATCH_FRAME = 37;
/**
 * **派发哨兵**：引擎 `exit`(0x2) 在 `frame.caller == -10` 时走「还原现场 + 继续派发」（raw 25661-25673）。
 * 装载到帧 37 的派发脚本其 `caller` 恒为此值 ⇒ 它的 `exit` 回到派发链而不是"返回调用层"。
 */
const DISPATCH_SENTINEL = -10;

/**
 * 把队列里的下一条请求装载起来执行（引擎 `sub_40FB60`，raw 18954-19016）。
 *
 * 引擎语义（逐条对齐）：
 *  - 弹出队首请求 `id`（正数 = 装载脚本）；
 *  - `saved_cur/saved_flags = cur/effect_flags`（383112/383116），`dispatching = 1`（497400），
 *    `cur = 37`，`sub_40ED40(this, …, id)` 装载并开始执行 —— **发起者（INIT2）被挂起**；
 *  - 队列排空时由 `exit` 的 `-10` 分支还原 `cur/effect_flags`（raw 25663-25668）⇒ 发起者接着跑下一条指令。
 *
 * 调用方：`op_dispatch_script_requests`（首条）与 `op_exit` 的 `-10` 分支（后续各条）。
 */
async function dispatchNextRequest(c: StepCtx): Promise<void> {
  const e = c.e;
  if (e.scriptRequests.length === 0) {
    // 队列排空：还原派发前的现场（引擎 383112/383116）⇒ 发起者（INIT2）在 ip 已推进处继续。
    if (e.dispatchSavedCur >= 0) {
      e.cur = e.dispatchSavedCur;
      e.effectFlags = e.dispatchSavedFlags;
      e.dispatchSavedCur = -1;
      e.dispatching = false;
    }
    c.jump(-1); // 控制流已回到发起者，不要让 stepOnce 再推进它的 ip（i143 已手动 +1）
    return;
  }
  if (e.dispatchSavedCur < 0) {
    e.dispatchSavedCur = e.cur;
    e.dispatchSavedFlags = e.effectFlags;
  }
  const id = e.scriptRequests[0]!;
  if (!e.fileSource) throw new Error('i143: no FileSource');
  // ★包未装载 ⇒ readScript 抛 MissingAppendPackError（引擎「拡張ファイル情報ファイル %d は…」异常）
  const src = await e.fileSource.readScript(id);
  if (!src) throw new Error(`i143: cannot load script 0x${id.toString(16)}`);
  e.scriptRequests.shift();
  const frame = e.frames[DISPATCH_FRAME]!;
  const script = parseScriptBytes(src.data);
  loadScriptIntoFrame(frame, script, src.name);
  frame.caller = DISPATCH_SENTINEL;
  frame.frameArg = 0;
  e.dispatching = true;
  e.cur = DISPATCH_FRAME;
  frame.ip = 0;
  c.log(`  [dispatch] 0x${id.toString(16)} -> ${src.name}（扩展包 ${id >>> 24} 的 $n$AUTORUN，帧 ${DISPATCH_FRAME}）`);
  c.jump(-1); // 控制到派发帧
}

/**
 * 0x143 (`i143`，引擎 sub_41A000 raw 25168-25191)：**派发已装载扩展包的 `$n$AUTORUN`**。
 *
 * 引擎：置 `dispatching`（防重入，使 queueScript 只入队）→ 遍历 `FileDB.packs` 槽 1..255，
 * 对每个**非空槽**（该包已装载）`queueScript(slot<<24)` → 清 `dispatching` → `ip += 4`（1 条指令）→
 * `sub_40FB60` 派发首条。
 *
 * 脚本侧唯一调用点 = `INIT2.txt:140`（在本体 40 张 INIT 之后、场景设置之前）⇒ 扩展包内容覆盖在本体之后。
 * 包里没有 `*.AAI` ⇒ 槽全为 NULL ⇒ **静默跳过**（与引擎一致，不是错误）。
 */
const op_dispatch_script_requests: OpHandler = async (c) => {
  const e = c.e;
  // 引擎 `frames[cur].ip += 4`：本条指令只消费一个 dword，之后（派发链跑完）从下一条继续。
  c.frame.ip += 1;
  c.jump(-1);
  if (!e.fileSource?.appendPackNumbers) return; // 宿主未提供扩展包表 ⇒ 视作「一个包都没装」
  const packs = await e.fileSource.appendPackNumbers();
  if (packs.length === 0) return;
  e.dispatching = true; // 循环内只入队（与引擎 497400=1 同义）
  // ★按包号升序入队：引擎遍历的是 `FileDB.packs` 槽 1..255（槽序 = 包号序），与宿主给的顺序无关。
  for (const n of [...packs].sort((a, b) => a - b)) e.scriptRequests.push(n << 24); // 包号<<24 = 该包文件 #0
  e.dispatching = false;
  await dispatchNextRequest(c);
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

/**
 * 把解析好的脚本装入一个帧（建立 labelMap + **重建局部池**）。
 *
 * ★★**一次载入 = 一次新调用**：引擎 `sub_40ED40`（loadScriptFrame）读脚本后**建局部池
 * 并把 `local_int` 填 `enc_zero`** ⇒ 启动、`call-script`(0x3)、`load-frame`(0x6)、
 * `exit-script` 后重载根脚本，每一次都看不见上一次的局部量。
 *
 * 漏掉这一步的症状（2026 实测）：**帧槽会被复用** —— 最典型是脚本自己 `exit` 之后又被调用方
 * `call-script` 调回来（`CONFIG1` 的"切左侧分类"就是这么实现的：置 `7dd=1` → 退出脚本 →
 * CONFIG.BIN 重新调用）。此时上一次调用的局部量会泄漏进新一次调用：
 * ```
 * 上一页滚到底 ⇒ local5620(滚动起点)=6
 * 新一页 12 项 ⇒ local5624(最大起点)=3
 * 拇指顶 3f6 = 106 + (428 − 拇指高)·5620/5624 → 320   ← 轨道只有 106..534 ⇒ 拇指溢出轨道
 * ```
 * 全局池（`Engine.globals.*`）**不在此列**：那是跨脚本状态（"上次选的分类" `12721e` 就在里面，
 * 所以切完分类高亮才记得住）。
 *
 * 注意 `call-frame`(0x8) 跑的是**已预装**的固定帧、不再走本函数 ⇒ 固定帧被反复调用时局部量照旧保留
 * （与引擎一致：`sub_41C900` 不重建池）。
 */
export function loadScriptIntoFrame(frame: Frame, script: import('../../script/bin.js').ScriptBinary, name?: string): void {
  frame.script = script;
  frame.name = name ?? script.signature;
  frame.ip = 0;
  frame.retStack = [];
  frame.labelMap.clear();
  for (let i = 0; i < script.instructions.length; i++) {
    frame.labelMap.set(script.instructions[i]!.index, i);
  }
  frame.locals.clear(); // ★ 重建局部池（见上方说明）
  frame.strTable = [];
  frame.arrayContainer.clear();
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
    f.locals.clear(); // 全量重置也要把各帧的局部池清掉（根帧随后的 loadScriptIntoFrame 会再建一次）
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
  // 引擎 exit-script 是整体复位（sub_428A60：释放 40 帧 + 清全局内存池 + 引擎复位）⇒ 派发队列与现场一并作废。
  c.e.scriptRequests.length = 0;
  c.e.dispatching = false;
  c.e.dispatchSavedCur = -1;
  c.e.advFields.clear();
  c.e.globalSlot97058 = 0;
  c.e.msgwin.reset();
  c.e.native.msgWinClearAll?.(); // 文本图层也要清（引擎：换脚本即整块清 0，见 sub_40DF10）
  c.e.routes.reset();
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
  [0x143, op_dispatch_script_requests], // i143：派发已装载扩展包的 $n$AUTORUN（见上）
  [0x1a7, op_comment],
  [0x1a8, op_dev_ukn],
  [0x1, op_abort],
  [0x2, op_exit],
  [0x9, op_exit_script],
];

