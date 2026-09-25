/**
 * 控制流 + 脚本装载：jmp / call / call-frame / jcc / ret / call-script / exit / exit-script / abort。
 *
 * 这一族是**唯一**会改写 `ip` / `cur` 的地方，因此 `StepCtx.jump()` 的语义在此定义：
 * `jump(index)` = 下一指令下标；`jump(-1)` = 「控制流已转移，不要自动推进」。
 *
 * `ExitScript` 是**解释器信号**（用异常穿越 handler 边界到 stepOnce 调用方），
 * 不是错误 —— 见 interpreter.run 的捕获。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { parseScriptBytes } from '../../script/bin.js';
import type { Engine, Frame } from '../engine.js';
import { branchTarget, branchTargetError } from './shared.js';

/**
 * 取本族的**操作数计划视图**；缺计划 = 编程错误（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 *
 * ★本族（`tickets/T-0082` 批次"控制流 + 队列族"）15 条。**label 口径**：引擎取 label 也走
 * `readIntOperand`（`sub_41BF50`）⇒ 计划层 `int(n)` 就是正确读法（`0x8C`/`0xA0`/`0x8F` 三处一致）。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：控制流/队列族走操作数计划层，但没有声明计划`);
  return p;
}
import { loadScriptIntoFrame } from '../scriptFrame.js';
import { resolveSlotRetStack } from '../engineSlot.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { FIELD_REVEAL_INPUT_CONSUMED, QUEUE_INT_SLOTS } from '../engine.js';
import { ShowMessageError } from '../native.js';
import { cfgInt } from '../../engineConfig.js';
import { CFG, registryDefault } from '../../configRegistry.js';
import type { OpTable } from './shared.js';

/**
 * 引擎的两条「层级过深」报错串（`sub_41C6A0` raw 26779 与 `sub_41C7C0` raw 26850 **逐字相同**，
 * `sprintf` 的实参都是 40）—— 两者都走 `_CxxThrowException(&pExceptionObject, &_TI1_AVCommand_ShowMessage_Exception__)`，
 * 异常码分别是 65537（`0x3`）/ 65537（`0x6`）。`tickets/T-0156`。
 */
const SCRIPT_DEPTH_TEXT = 'ファイルの階層が深すぎます．最大は40です．';

const op_jmp: OpHandler = (c) => {
  const plan = planFor(c);
  // 引擎 sub_4203D0：op1 经 readIntOperand 取值；op1==-1(0xFFFFFFFF) = 不跳（落下句），非错误。
  const t = (plan.int(1) ?? 0);
  if (t === -1) return;
  // ★两级解析（`tickets/T-0179`）：引擎 raw 29397 是 `ip = ip_base + 4*目标`、**不校验** ⇒
  //   labelMap 未命中时回落 `dwordToInstr`（旧实现抛 `jmp: unknown label` 是宿主自造硬错误）。
  const p = branchTarget(c.frame, t);
  if (p === null) throw branchTargetError('jmp', t);
  c.jump(p);
};

const op_call: OpHandler = (c) => {
  const plan = planFor(c);
  // 同脚本内 call label：压**下一条指令的 dword 偏移**到返回栈、跳转。
  //   ★与引擎同口径：`sub_420560`（raw 29457-29471）压 `((ip-ip_base)>>2) + 3`（本指令 3 dword 长）
  //   ⇒ 返回栈里存的是 **dword 偏移**，不是数组下标（`ret` 再经 `dwordToInstr` 换回来）。
  //   operand==-1(0xFFFFFFFF) 则不跳（弹回）。
  const a = plan.int(1) ?? -1;
  const retDword = (c.frame.script?.instructions[c.frame.ip]?.index ?? 0) + 3;
  c.frame.retStack.push(retDword);
  if (a === -1) {
    c.frame.retStack.pop(); // 无目标，弹回（no-op）
    return;
  }
  // ★两级解析（`tickets/T-0179`）：引擎 raw 29469 同样不校验目标。
  const p = branchTarget(c.frame, a);
  if (p === null) throw branchTargetError('call', a);
  c.jump(p);
};

/** call-frame (0x8, 引擎 sub_41C900)：调用/切换到「已预装的固定帧」op1（SYSTEM4 i006/load-frame 预装，见 flow-control §11.2）。
 *  备份调用方：调用方 ip += 1（返回后从下一条继续）、callRet=caller；目标帧 caller=caller、ip=0；cur=目标帧。
 *  被调帧跑完 exit(0x2) 依其 caller 返回调用帧。 */
const op_call_frame: OpHandler = (c) => {
  const plan = planFor(c);
  const frameIdx = (plan.int(1) ?? 0);
  // ★`tickets/T-0156`（**读体订正**）：`sub_41C900`（= **0x8**）本体里**没有**任何 `op1` 值域/深度校验
  //   （raw 26886-26892：`383108 = cur` → `v2 = op1` → `cur = v2` → 只查 `frames[v2].ipBase == 0`）。
  //   那条 `if (v4 >= 40)` 的深度门属 **`0x6`**（`sub_41C7C0` raw 26847-26853，见 `op_load_into_frame`）——
  //   工作清单把 `sub_41C7C0` 记成了 0x8。这里的 `frameIdx < 0 || >= 40` 是**重写侧的下标边界**（JS 数组
  //   越界会落到 `undefined`），属**披露的加严**，不是引擎门。
  if (frameIdx < 0 || frameIdx >= 40) {
    throw new Error(`call-frame: frame index ${frameIdx} 越界（引擎无此校验，见 handler 注释）`);
  }
  const target = c.e.frames[frameIdx]!;
  // ★引擎 raw 26891-26904：目标帧**未预装**（`frames[v2][95781] == 0`，即无脚本）⇒ 组
  //   `"この階層にはファイルが読み込まれていません．Depth=%d"`（实参 = 帧号）抛 ShowMessage（异常码 **65541**），
  //   并先把 `cur` 还原成 `383108`（= 调用方）。旧实现是普通 `throw new Error`（宿主看不到引擎文本）。
  if (!target.script) {
    throw new ShowMessageError(
      `この階層にはファイルが読み込まれていません．Depth=${frameIdx}`,
      0x8,
      `目标帧 ${frameIdx} 未预装脚本（raw 26891-26904，异常码 65541；需先 load-frame 0x6）`,
    );
  }
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
  const plan = planFor(c);
  const cond = (plan.int(1) ?? 0);
  // 引擎 sub_4209B0：分支目标(2/3)也经 readIntOperand 取值（可为变量 label；-1=落下句）。
  const branchLab = (n: number): number | null => {
    const t = plan.int(n) ?? -1;
    return t === -1 ? null : t;
  };
  /**
   * 目标解析（`tickets/T-0179` 起：**两级**）。
   *
   * 引擎 `sub_4209B0` raw 29620-29636 的落点是 `frame.ip = ip_base + 4 * v3` —— **对目标不做任何
   * 校验或查找**，只有 `-1` 有特殊含义（落下句，raw 29624/29631）。两级解析与 `jmp`/`call` 共用
   * （`shared.ts` 的 `branchTarget`：`labelMap` → 未命中回落 `script.dwordToInstr`）。
   * ⇒ 非标签目标在引擎里**同样会跳**；只有当目标**越出脚本**（两级都查不到）时才抛 ——
   * 引擎此时会把 ip 指到脚本缓冲区之外（宿主侧护栏）。
   */
  const resolveBranch = (t: number): number | null => branchTarget(c.frame, t);
  const outOfRange = (which: string, t: number): Error => branchTargetError(`jcc ${which}`, t);
  if (cond !== 0) {
    const t = branchLab(2);
    if (t !== null) {
      const p = resolveBranch(t);
      if (p === null) throw outOfRange('true', t);
      c.jump(p);
    }
    // t==null：真分支不跳 → 落到下一句（不设 jump）
  } else {
    const t = branchLab(3);
    if (t !== null) {
      const p = resolveBranch(t);
      if (p === null) throw outOfRange('false', t);
      c.jump(p);
    }
    // t==null：假分支不跳 → 落到下一句
  }
};

// ---- ret (0x5)：同脚本子程序返回（弹返回栈跳回；空则 no-op 落到下一指令） ----
/**
 * `0x5`（`sub_41A9B0` raw 25704-25727）：先弹**帧内返回栈**（`frame.retStack`，raw 25711-25716），
 * 顶 != -1 时再弹**全局「消息回调 effect_flags 保存栈」**（raw 25718-25723：`top = _this[107437]`、
 * `result >= 0` 才 `v3 = base[top--]` 并 `_this[174801] = v3`）。
 *
 * ★**第二段（effect_flags 恢复）今天不落**，理由是"没有压入端"而不是"没找到"：
 *  - 压入点全库**只有两处**（`grep 'sub_409D40('` 实测 7 命中，其中队列基址 = `_this + 429732` 的
 *    只有 raw 20022 / 20082），**两处都在 `sub_411590`（定义 raw 19946）体内**；
 *  - `sub_411590` 的**唯一**调用点是 raw 20884 —— 主循环在 `effect_flags & 0x100000`（跳读位）时的
 *    `sub_411590(_this) + Sleep(5)` 自旋循环。而 `0x100000` 的唯一常态置位端是 raw 20350，
 *    紧跟 raw 20351 就是 `sub_411560(_this, "CALLBACK_TEXT.BIN")`；
 *  - emulator **没有** `sub_411560`/`sub_40FC90` 那条"按名装载回调脚本并立刻把控制交给它"的口
 *    （见 `engine.ts` 的 `#textRewindWheel` 已知缺口：`CALLBACK_TEXT.BIN` 在本资源树 0 命中 ⇒ 真机
 *    那一跳也是 no-op）⇒ 这个自旋循环在 emulator 里**没有对应现场**，插在别处（如 `#textRewindWheel`
 *    的 `|= 0x100000` 之后）会把 `effectFlags` 的 bit20 立刻清掉，反而**制造**与引擎的分叉。
 *  ⇒ **只补这里的 `pop` = 弹一本永远没人压过的栈 = 假实现**；**重开条件** = 先把
 *    `sub_411560`（装载 + 立即派发回调脚本）建模，再按 raw 20022-20023 同序在那一跳补
 *    `pushEffectFlags()` + `effectFlags &= 0x7FEFFFFF`，**同批**接回这里的 `pop`。
 *  ★避免重复投入：raw 28868 / 28885 / 28938 三处 `sub_409D40` 收的是**另一个**队列对象
 *    （`_this + 107433`，交叉脚本请求队列 = `dispatchSavedCur`/`dispatchSavedFlags` 那一格），
 *    不是本栈的压入点；raw 30748 是 `0x138` 的 `Stack_int` 族。
 */
const op_ret: OpHandler = (c) => {
  const plan = planFor(c);
  const top = c.frame.retStack.pop();
  if (top !== undefined && top !== -1) {
    // ★返回栈里存的是 **dword 偏移**（引擎 `sub_41A9B0` raw 25704-25727：`ip = ip_base + 4*v2`）
    //   ⇒ 必须经 `dwordToInstr` 换回指令数组下标。直接用会把偏移当 index 落错指令。
    // ★`tickets/T-0156`：`-1` 是**空槽哨兵**（raw 25713-25714 `v2 = …; if ( v2 != -1 ) { ip = … }`）
    //   ⇒ 不跳、落到下一句（引擎同时把步长槽置 1 = 前进一条）。旧实现只判 `undefined`，
    //   `-1` 会走 `dwordToInstr[-1]`（取不到就抛，映像里恰好有 -1 键则落错指令）。
    const idx = c.frame.script?.dwordToInstr[top];
    if (idx === undefined) throw new Error(`ret: 返回点 dword 偏移 ${top} 不在脚本映像里（${c.frame.name}）`);
    c.jump(idx);
  }
  // 空槽 / 栈空：同脚本函数调用栈为空 → 不跳，落到下一指令（引擎里步长槽=1，前进 1 dword）
};

/** 0x1 abort (sub_418E60)：程序中止。引擎 `_CxxThrowException(&1, Command_Exit)`——立即退出整个程序。
 *  emulator：抛 `ExitScript`（程序退出信号），渲染器捕获后关闭主窗口；headless(run.ts) 捕获后停执行。 */

const op_abort: OpHandler = (c) => {
  const plan = planFor(c);
  throw new ExitScript();
};

// ---- exit (0x2)：跨脚本返回调用层（cur=frame.caller；顶层无调用层才程序退出） ----

/**
 * **`sub_40F750`（raw 18877-18951）的 a2/a3 分派表** —— 引擎 `exit` 的 -11 分支最后就是调它
 * （先 `_this[95777] = -1`，再读两次配置）。三条支路**没有任何一条会退出程序**：它只调
 * `sub_40ED40`（把脚本装进 `cur` 帧）与 `sub_4380F0`（存档对象上的时间戳：raw 45095-45103
 * `_this[259] = _this[260]; _this[258] = timeGetTime()/1000`）。listing 侧只出现
 * `0040F78B/0040F845/0040F900/0040FA46`（`sub_40ED40`）与 `0040FA15/0040FB55`（`sub_4380F0`）。
 *
 * | 参数 | 条件 | 体做了什么 |
 * |---|---|---|
 * | `a2 == 1` | `a3 == 10` / `a3 == 20` | `sub_40ED40(this, …, 263*cur+124365 / +129938)` 装**该版本**记录里的脚本，再按记录还原两张表的当前下标（263 步长槽位组） |
 * | `a2 == 1` | `a3 ∉ {10,20}` | **什么都不做**（raw 18899 的 `return result`） |
 * | `a2 == 2` | — | `sub_40ED40(this, …, 261*cur+140771)` 装记录脚本 + 恢复 ip/返回栈（`261*cur+140772/140773+i`），随后 `sub_4380F0` |
 * | `a2 == 3` | — | 同上，槽位组换成 `261*cur+156524/156525/156526` |
 * | 其它 | — | **什么都不做**（raw 18934 的 `return result`） |
 */
/**
 * `sub_40F750` 的分派表 → 三种结果。
 *
 * ★导出给测试（`tickets/T-0125`）：这张表是**引擎事实**（上面那张表逐行有 raw 依据），此前只能经
 * `SUB40F750_BRANCH_TEXT` 的**日志文案**间接观测 ⇒ 判据钉在文案上（改文案假红、改表可能假绿）。
 * 现在 `test/op-02-exit-minus11.test.ts` 直接对这张真值表断言；"读到的配置真的喂给分派"那一半
 * 由**行为**断言覆盖（`pendingRecord0` + 帧 0 是否换成记录脚本 ⇒ 装 / 不装）。
 */
export function sub40F750Branch(sv1: number, sv2: number): 'record' | 'partial' | 'none' {
  if (sv1 === 1) return sv2 === 10 || sv2 === 20 ? 'partial' : 'none';
  if (sv1 === 2 || sv1 === 3) return 'record';
  return 'none';
}

/** `sub40F750Branch` 的三种结果 → 日志文本（诊断用，不参与语义）。 */
const SUB40F750_BRANCH_TEXT: Record<'record' | 'partial' | 'none', string> = {
  record: '装载记录脚本（a2==2/3：sub_40ED40 + 按记录恢复 ip/返回栈）',
  partial: 'sv1=1 的部分还原（a3∈{10,20}）',
  none: '两支都不进 ⇒ 直接 return（不动作）',
};

/**
 * **`set:SaveVersion1` / `set:SaveVersion2` 的两次取值**（`tickets/T-0092` 验收②）。
 *
 * ★**权威是 listing（`.lst:0041A85A`-`0041A888`），不是 `.c` 的 raw 25651-25658** —— 后者是 Hex-Rays
 * 的误渲染。raw 逐字（`esi+0AA514h` = 配置注册表对象 `Reg`，`DWORD ptr [esi+5D884h]` = `_this[95777]`）：
 *
 * ```text
 * 0041A85A  push    offset aSetSaveversion_0   ; "set:SaveVersion2"
 * 0041A865  mov     dword ptr [esi+5D884h], 0FFFFFFFFh   ; _this[95777] = -1（call_ret）
 * 0041A86F  call    eax                          ; R2 = GetConfig("set:SaveVersion2")
 * 0041A877  push    eax                          ; ★这个 push = 最后那次 sub_40F750 的 a3
 * 0041A87B  push    offset aSetSaveversion       ; "set:SaveVersion1"
 * 0041A886  call    eax                          ; R1 = GetConfig("set:SaveVersion1")
 * 0041A888  push    eax                          ; a2 = R1
 * 0041A88B  call    sub_40F750                   ; sub_40F750(this, a2 = SV1, a3 = SV2)
 * ```
 *
 * 两处 `call eax` 都是 vtable 槽 **+4** = `sub_4904D0`（`retn 4` 的**单参 GetConfig**；写侧是槽 +12 =
 * `sub_492AB0`）⇒ **本分支只有读、没有写**：`0041A877` 那个"多出来的 push"不是"带默认值的第二次读"，
 * 而是跨过中间那次调用、留给 `sub_40F750` 的 a3（`sub_4904D0` 是 `retn 4`，只吃掉自己那个 key）。
 * `.c` 里"get(key, 默认值)"的形态与 `sub_40F750(…, "set:SaveVersion2")`（第 3 实参成了字符串常量）
 * 都是误渲染 —— 同样的"提前 push 一个后面才用到的实参"写法在 `0x42D5F4`（保存槽那条路）也出现，
 * Hex-Rays 在那里同样把版本号渲染成字符串常量。审计 `op-2-10` 的"读 `set:SaveVersion1` 并把结果写回"
 * 即由此而来：**体里没有写回**（写回侧 `sub_434D00`/`sub_492AB0` 在全库只被构造默认值、INI/注册表装载
 * 与那条 `(1,0) → (1,10)` 迁移调用：raw 111711/111713、112666/112668、112826-112833）。
 *
 * 取值来源优先级与 `0xAE`（`handlers/frame.ts` 的 `SAVE_VERSION_BRANCH`）**必须一致**：这份槽自己声明的
 * 版本（`resume.sv1/sv2` = 容器头 +284/+288）优先，其次配置注册表，最后注册表的**内建默认值**
 * （`set:SaveVersion1` = 1、`set:SaveVersion2` = 0）—— 玩家 INI 可能整个没有 `[set]` 段，那时
 * `cfgInt(..., 0)` 得到 0，而 0 不在分派表里（`tickets/T-0065`）。
 */
function readSaveVersionPair(e: Engine): { sv1: number; sv2: number } {
  const cfg1 = e.config
    ? cfgInt(e.config, CFG.setSaveVersion1, registryDefault(CFG.setSaveVersion1))
    : registryDefault(CFG.setSaveVersion1);
  const cfg2 = e.config
    ? cfgInt(e.config, CFG.setSaveVersion2, registryDefault(CFG.setSaveVersion2))
    : registryDefault(CFG.setSaveVersion2);
  return { sv1: e.saveResume?.sv1 ?? cfg1, sv2: e.saveResume?.sv2 ?? cfg2 };
}

const op_exit: OpHandler = async (c) => {
  const plan = planFor(c);
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
  } else if (caller === -11) {
    // ★引擎 `sub_41A820` 的 **-11** 分支（listing 0041A837-0041A895；`tickets/T-0092`）：
    //   ① `_this[95777] = -1`（raw 0041A865；`fields.json`：0x5D884 = call_ret）；
    //   ② 两次 `GetConfig` 取 `set:SaveVersion1/2`（见 `readSaveVersionPair`，**只读无写回**）；
    //   ③ `sub_40F750(this, SV1, SV2)`（raw 0041A88B；分派表见 `sub40F750Branch`）；
    //   ④ `return`（raw 0041A895）。
    //   ★体里**没有**任何退出程序的路（上表：`sub_40F750` 只调 `sub_40ED40` 装脚本与 `sub_4380F0`
    //   写时间戳）⇒ 本分支**绝不抛 `ExitScript`** —— 旧实现把"没有记录 0"兜底成程序退出，与体相反。
    //   ★本分支**不碰 `frame.caller`**：引擎只写**全局** `_this[95777]`，帧记录的 [0] 格是随后的
    //   `sub_40ED40` 从 call_ret 抄过去的（raw 18637）。返回到 `stepOnce` 后 ip 走**默认推进** ——
    //   `exit` 是 0 操作数指令，引擎 0 操作数的步长槽 = 1（主循环 raw 20165 `ip += 4*step`；`0x1A8`
    //   的体写的也是 1）⇒ 这里**不用** `jump(-1)`（那会让这条 `exit` 原地自旋）。
    c.e.engineValues.set(ENGINE_FIELD.callRet, -1); // ① `_this[95777] = -1`
    const { sv1, sv2 } = readSaveVersionPair(c.e); // ② 两次 GetConfig
    const branch = sub40F750Branch(sv1, sv2); // ③
    const resume = c.e.saveResume;
    if (!resume?.pendingRecord0 || branch === 'none') {
      // ④ 与体同形的兜底：**什么都不做**。两种情形：
      //    ⓐ `sv1/sv2` 不在分派表里（例：注册表内建默认 1/0）⇒ 引擎 `sub_40F750` 直接 return；
      //    ⓑ 无记录 0 可装 ⇒ emulator 手上没有帧记录里的 scriptId（引擎会拿记录区那一格去
      //       `sub_40ED40`；本工程槽/旧布局解析不出记录时，这里如实不动，见 `SLOT_GAPS`）。
      //    两种情形都**不改任何状态**（除了上面那一格 call_ret），也都**不退出程序**。
      c.log(
        `0x2(exit): -11 分支收尾（call_ret = -1 已写）：sub_40F750(sv1=${sv1}, sv2=${sv2}) ⇒ ` +
          `${SUB40F750_BRANCH_TEXT[branch]}；` +
          (resume?.pendingRecord0
            ? '有 pendingRecord0，但版本分派不进装载支 ⇒ 不装载'
            : '无记录 0 可装 ⇒ 不动作') +
          '（引擎此处同样不抛异常、不退出）',
      );
      return;
    }
    // ---- 以下 = 既有正确路径（`tickets/T-0072`）：`sub_40F750` 进装载支 ⇒ 帧 0 ← 记录 0 的脚本 ----
    resume.pendingRecord0 = false;
    const rec0 = resume.frames[0];
    const fs = c.e.fileSource;
    const src = rec0 && fs?.readScript ? await fs.readScript(rec0.scriptId) : null;
    if (rec0 && src) {
      const frame = c.e.frames[c.e.cur]!;
      frame.caller = -1; // 引擎：`_this[95777] = -1` 先置，再由 sub_40ED40 写进帧记录的 [0]
      loadScriptIntoFrame(frame, parseScriptBytes(src.data), src.name, rec0.scriptId);
      frame.retStack = resolveSlotRetStack(frame.script!, rec0).retStack;
      c.e.callRet = -1;
      c.e.markFileUsed(rec0.scriptId);
      c.log(`0x2(exit): CALLBACK_LOAD 收尾 ⇒ 装载记录 0 的脚本 ${src.name}(id=0x${rec0.scriptId.toString(16)})，从入口跑`);
      c.jump(0);
      return;
    }
    // 记录 0 读不到（资源缺失）⇒ 如实中止续跑，不假装成功
    c.e.saveResume = null;
    c.e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    c.log('0x2(exit): CALLBACK_LOAD 收尾时读不到记录 0 的脚本 ⇒ 中止续跑（读档门已清）');
    return;
  } else {
    // caller < 0 且不是 -10/-11：引擎 `sub_41A820` 落到 LABEL_14（raw 25675-25677）
    // `_CxxThrowException(&2, Command_Exit)` ⇒ **程序退出**（-1 = 顶层脚本 `exit`，emulator 同口径；
    // 其它负值走的是同一条 LABEL_14）。
    throw new ExitScript();
  }
};

// ---- call-script (0x3)：跨脚本，异步装载 ----

const op_call_script: OpHandler = async (c) => {
  const plan = planFor(c);
  const target = (plan.int(1) ?? 0); // 目标索引（如 0x5264 或 0）
  // ★`tickets/T-0156`：两条异常在引擎里**分型**（`sub_41C6A0` raw 26776-26798）：
  //   ① `cur >= 39` ⇒ `sub_408050(_this + 8, 1024, "ファイルの階層が深すぎます．最大は%dです．", 40)` +
  //      `_CxxThrowException(…, &_TI1_AVCommand_ShowMessage_Exception__)`（异常码 65537）= **宿主可见的消息**；
  //   ② 装载失败（`sub_40ED40` 返回 0）⇒ `_CxxThrowException(&2, &_TI1_AVCommand_Exit_Exception__)` = **程序退出**。
  //   旧实现两处都是普通 `throw new Error`（既不是宿主消息、也不是程序退出）。
  if (c.e.cur >= 39) {
    throw new ShowMessageError(SCRIPT_DEPTH_TEXT, 0x3, `脚本嵌套过深：cur=${c.e.cur} ≥ 39（raw 26776-26783，异常码 65537）`);
  }
  // 调用方 IP 前进到下一指令（返回后从此继续）
  c.frame.ip += 1;
  const caller = c.e.cur;
  c.e.callRet = caller;
  c.e.cur = caller + 1;
  const newFrame = c.e.curScript();
  newFrame.caller = caller;
  newFrame.frameArg = 0; // call-script argc=1，仅目标索引，无帧参数
  // 装载目标脚本
  if (!c.e.fileSource) throw new ExitScript(); // 引擎：装载路径取不到文件也走 Command_Exit（码 2）
  const src = await c.e.fileSource.readScript(target); // async 文件代理
  if (!src) {
    // ★raw 26794-26798：装载失败抛 `Command_Exit`（码 2）= 程序退出（**抛出点在状态更新之后**：
    //   raw 26787-26792 已写调用点 `[95804]`、`383108 = cur`、`cur = cur + 1` ⇒ 这里同样先改状态再抛）。
    c.log(`0x3(call-script): 目标脚本 0x${target.toString(16)} 读不到 ⇒ 引擎 Command_Exit（码 2）= 程序退出`);
    throw new ExitScript();
  }
  // ★引擎装载脚本也走 `sub_4559C0`（按统一 id 打开文件）⇒ 记「已使用」（`sub_454960`）。
  //   见 handlers/resource-usage.ts 的 0x19D（回想/CG/BGM 鉴赏的解锁判定读的就是这张表）。
  c.e.markFileUsed(target);
  let script: import('../../script/bin.js').ScriptBinary;
  try {
    script = parseScriptBytes(src.data);
  } catch (err) {
    // 诊断：脚本数据过短/解析越界（可能在混合脚本包/非脚本索引上取到被截断的切片）
    throw new Error(
      `call-script: 解析脚本失败 0x${target.toString(16)} -> ${src.name} (data=${src.data.length}B): ${(err as Error).message}`,
    );
  }
  loadScriptIntoFrame(newFrame, script, src.name, target);
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
 * 把「派发中」写进**引擎字段** `_this[124350]`（byte 497400）并同步 JS 侧镜像 `Engine.dispatching`。
 *
 * 为什么要成对写（`tickets/T-0157`）：`ENGINE_FIELD.dispatchInProgress` 在本票之前**只有读没有写**
 * （读点：`0xD9` 的 `handlers/engine-fields.ts:437`、`0x1F5` 的派发门 raw 25226）⇒ 它永远读回 0，
 * 0x1F5 的门就成了"恒为真"的死键。引擎的写点有 5 处：raw 18149（构造清 0）、18980（`sub_40FB60`
 * 装载时置 1）、25176/25187（`0x143` 的入队循环）、25667（`exit` 的 -10 收尾清 0）。
 * `Engine` 类本身（`src/vm/engine.ts`）不在本票的可写路径内 ⇒ 用这个**唯一的成对写点**代替
 * getter/setter 代理：本文件里所有写 `dispatching` 的地方都必须走它，两个表示才不会各自漂移。
 */
function setDispatching(e: Engine, on: boolean): void {
  e.dispatching = on;
  e.engineValues.set(ENGINE_FIELD.dispatchInProgress, on ? 1 : 0);
}

/**
 * 把队列里的下一条请求装载起来执行（引擎 `sub_40FB60`，raw 18954-19016）。
 *
 * 引擎语义（逐条对齐）：
 *  - **入口停靠闸**（raw 18966 `if ( !*(_DWORD *)(_this + 429752) )`）：停靠标志为 1 时**整段不执行**
 *    —— 不弹队、不装帧、不动 `dispatching`。请求留在队列里，等 0x1F5（raw 25227 先清标志、25229 再调）
 *    或 0x7C（raw 25822）那一刻的重试；
 *  - 弹出队首请求 `id`（正数 = 装载脚本）；
 *  - `saved_cur/saved_flags = cur/effect_flags`（383112/383116），`dispatching = 1`（497400，raw 18980），
 *    `cur = 37`（raw 18987），`sub_40ED40(this, …, id)` 装载并开始执行 —— **发起者（INIT2）被挂起**；
 *  - 队列排空（或停靠中不派发）时由 `exit` 的 `-10` 分支还原 `cur/effect_flags`（raw 25663-25668）⇒ 发起者接着跑下一条指令。
 *
 * 调用方：`op_frame_countdown`（`0x1F5`，raw 25229 —— **停靠结束那一刻的重试派发点**，见 `handlers/frame.ts`）、
 * `op_dispatch_script_requests`（`0x143` 尾部的首条，raw 25190）与 `op_exit` 的 `-10` 分支（后续各条，raw 25672）。
 * ★导出给 `handlers/frame.ts` 用：本函数是本仓 `sub_40FB60` 的**唯一实现**，不得再抄第二份。
 */
export async function dispatchNextRequest(c: StepCtx): Promise<void> {
  const e = c.e;
  // ★raw 18966 的停靠闸。修前（`tickets/T-0157` 之前）这道闸在重写侧**完全不存在** ⇒ 队列任何时刻
  //   都能被直接派发（审计 2026-09 §4.1 第 283 条 `0x1f5 missing-dispatch`）。
  const docked = (e.engineValues.get(ENGINE_FIELD.frameTickLock) ?? 0) !== 0;
  if (e.scriptRequests.length === 0 || docked) {
    // 队列排空 / 停靠中不派发：还原派发前的现场（引擎 383112/383116；`-10` 分支 raw 25663-25668）
    // ⇒ 发起者（INIT2）在 ip 已推进处继续。
    // ★停靠中与排空走同一条收尾：引擎在停靠中也是「`sub_40FB60` 什么都不做」，
    //   调用方（`-10` 分支）在调它**之前**已经还原完现场 ⇒ 发起者照常继续，请求留在队列里。
    if (e.dispatchSavedCur >= 0) {
      e.cur = e.dispatchSavedCur;
      e.effectFlags = e.dispatchSavedFlags;
      e.dispatchSavedCur = -1;
      setDispatching(e, false); // 引擎 raw 25667（497400 = 0）
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
  e.markFileUsed(id); // 引擎同样走 sub_4559C0（见 handlers/resource-usage.ts）
  e.scriptRequests.shift();
  const frame = e.frames[DISPATCH_FRAME]!;
  const script = parseScriptBytes(src.data);
  loadScriptIntoFrame(frame, script, src.name, id);
  frame.caller = DISPATCH_SENTINEL;
  frame.frameArg = 0;
  setDispatching(e, true); // 引擎 raw 18980（497400 = 1）
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
  const plan = planFor(c);
  const e = c.e;
  // 引擎 `frames[cur].ip += 4`：本条指令只消费一个 dword，之后（派发链跑完）从下一条继续。
  c.frame.ip += 1;
  c.jump(-1);
  if (!e.fileSource?.appendPackNumbers) return; // 宿主未提供扩展包表 ⇒ 视作「一个包都没装」
  const packs = await e.fileSource.appendPackNumbers();
  if (packs.length === 0) return;
  setDispatching(e, true); // 引擎 raw 25176（循环内只入队：497400 = 1）
  // ★按包号升序入队：引擎遍历的是 `FileDB.packs` 槽 1..255（槽序 = 包号序），与宿主给的顺序无关。
  for (const n of [...packs].sort((a, b) => a - b)) e.scriptRequests.push(n << 24); // 包号<<24 = 该包文件 #0
  setDispatching(e, false); // 引擎 raw 25187（循环结束：497400 = 0）
  await dispatchNextRequest(c); // 引擎 raw 25190（0x143 尾部调 sub_40FB60 派发首条）
};

/**
 * 0x6 (load-frame，曾名 i006/u00417E80)：**预装脚本 op1 到指定帧 op2**（SYSTEM4 的帧布局初始化；handler 体会保存/恢复 cur）。
 *  handler：`v3=op1(idx); v4=op2(frame); save cur; cur=v4; sub_40ED40(...); restore cur;`
 *  ⇒ 效果 = 把脚本索引 op1 解析并装入 frame[op2]（cur 不变，供后续切换，配合 0x8 call-frame 启动）。
 */
const op_load_into_frame: OpHandler = async (c) => {
  const plan = planFor(c);
  const scriptIdx = (plan.int(1) ?? 0);
  const frameIdx = (plan.int(2) ?? 0);
  // ★`tickets/T-0156`：引擎 `sub_41C7C0` 只有 `if (v4 >= 40)` 一条门（raw 26847-26853，**与 `0x3` 同一句
  //   报错串**、异常码 65537）⇒ 走 ShowMessageError；负数帧号引擎不校验（披露的加严，同 `0x8`）。
  if (frameIdx >= 40) {
    throw new ShowMessageError(SCRIPT_DEPTH_TEXT, 0x6, `目标帧号 ${frameIdx} ≥ 40（raw 26847-26853，异常码 65537）`);
  }
  if (frameIdx < 0) throw new Error(`0x6: frame index ${frameIdx} 越界（引擎无此校验，见 handler 注释）`);
  if (!c.e.fileSource) throw new Error('0x6: no FileSource');
  const src = await c.e.fileSource.readScript(scriptIdx);
  if (!src) throw new Error(`0x6: cannot load script 0x${scriptIdx.toString(16)}`);
  const script = parseScriptBytes(src.data);
  // ★`tickets/T-0156`：引擎 `sub_40ED40` raw 18637 `frames[目标][95795] = _this[383108]`，而 `0x6` 的体
  //   （raw 26845）把 `383108` 设成**装载前的 cur** ⇒ 目标帧的 `caller` = 发起装载的那一帧（不是 -1）。
  const caller = c.e.cur;
  loadScriptIntoFrame(c.e.frames[frameIdx]!, script, src.name, scriptIdx);
  c.e.frames[frameIdx]!.caller = caller;
};

// ★`loadScriptIntoFrame` 已搬到叶子模块 `../scriptFrame.js`（`tickets/T-0089` 消环）：
//   这里（顶部 import + 本行 re-export）让既有 `from "./control.js"` / `from "../ops.js"` 的调用点不受影响。
export { loadScriptIntoFrame };

// ---- 杂项 ----

const op_comment: OpHandler = () => undefined;

/**
 * `0x1A8`（助记符 `dev_ukn`）：**不是空实现** —— 引擎 handler `sub_419690`（raw 24775-24783）的体是
 * ```c
 * result = _this[95776];                 // 当前帧下标
 * _this[30 * result + 95805] = 1;        // ★写"当前帧的指令步长槽" = 1 个 dword
 * return result;
 * ```
 * 该槽（`frames[cur] + 0x74`）在全文件**唯一**的读取点是主循环 raw 20165：
 * `_this[30*cur + 95782] += 4 * _this[30*cur + 95805]`（95782 = ip）⇒ 写 1 表示 **ip 前进 4 字节
 * = 1 条指令**，与 0 操作数指令的取值相同，也正是 emulator `interpreter.stepOnce` 的默认推进
 * （`curFrame.ip += 1`）。emulator **不建模**该槽（它只是派发器的内部计数器）⇒ 本 handler 对 VM
 * 不可观测，但**依据必须写成"写步长槽"**，不能写成"体内什么都不做"。
 *
 * ★订正（审计 `op-6-05`）：`0xAF` 的 handler 也是 `sub_419690`（raw 22898；`676696 = 675996 + 4*0xAF`），
 * 体与本条**逐字相同** ⇒ "唯一一条体内什么都不做的指令"这句话对两者都不成立（见 stubs.ts 的订正）。
 */
const op_dev_ukn: OpHandler = (c) => {
  // 0x1A8：写当前帧的指令步长槽（emulator 不建模该槽）⇒ 顺序上仍取一次计划视图（argc 0，不读位）
  planFor(c);
};

/** 解释器专用信号：脚本 exit (0x2，顶层无调用层=程序退出) / exit-script (0x9，全量重置)。 */
export class ExitScript extends Error {
  constructor() {
    super('script exit');
  }
}

/** exit-script (0x9)：全量 teardown → 置 `_this[96983]`(byte 387932)=0 → 重载根脚本 INDEX0 并继续。
 *  引擎 sub_428A60 语义：释放 40 帧 + 清全局内存池 + 引擎整体复位(sub_40DF10) + `_this[387932]=0` +
 *  `sub_40ED40(0,…)` 重载根脚本 0 并继续。GAMEOVER 依赖它回到标题界面。
 *  ★ `+96983` 置 0 是「回标题后不再重播 LOGO/版权页」的关键：SYSTEM4 `load-show-logo(0x130) → jcc → call-script LOGO`，
 *    而 `load-show-logo` 读 `_this[96983]`（构造=1 播放，exit-script=0 跳过）。 */
const op_exit_script: OpHandler = async (c) => {
  const plan = planFor(c);
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
  // ★`tickets/T-0173`：这里原有两行复位 `c.e.callLink = -1; c.e.callFlag = 0;`（引擎 0x5D888/0x5D88C
  //   即 383112/383116 的镜像格），已随字段一并删除 —— 那两格零读者（`callRet` 才是活的），
  //   而它们的**真值**（派发现场）由 `dispatchSavedCur`/`dispatchSavedFlags` 建模，见下面 `dispatchSavedCur = -1`。
  c.e.effectFlags = 0;
  // ★`tickets/T-0169`（承接 `T-0175` ① 与 `T-0161` §5）：整体复位 `sub_40DF10` 把
  //   `Engine[699248]`（= `_this[174812]`，`0x142` 写的那个「脚本引擎开关」）置 **1**
  //   —— raw 17961 `*(_DWORD *)(_this + 699248) = 1;`（与构造 raw 22591 同值）。
  //   构造初值在 `engine.ts` 的 `engineValues` 初值表里；**整体复位**的 emulator 等价物只有本函数
  //   （`sub_40DF10` 的其余复位格 `logoEnabled`/`loadInProgress`/`storedCur` 也都写在这里）
  //   ⇒ 本文件是必须改的那一处（`control.ts` 的改动理由按本单元硬边界写明）。
  c.e.engineValues.set(ENGINE_FIELD.scriptEngineFlag, 1);
  // ★raw 17973：整体复位 `sub_40DF10` 也把 `Engine[388212]`（字节；= `_this[97053]`）清 0 —— 那是逐字泵
  //   `sub_409400` 的「贴完整页出口已消费过这一页」闩锁（写 1 = raw 13941、读 = raw 13917、构造清 0 =
  //   raw 22604）。emulator 的落点 = `src/vm/engine.ts` 的 `FIELD_REVEAL_INPUT_CONSUMED`（`T-0169`）；
  //   不落这一半的话，"exit-script → 新一局"的第一页会带着上一局的闩锁被一次贴完。
  c.e.engineValues.set(FIELD_REVEAL_INPUT_CONSUMED, 0);
  // 引擎 exit-script 是整体复位（sub_428A60：释放 40 帧 + 清全局内存池 + 引擎复位）⇒ 派发队列与现场一并作废。
  c.e.scriptRequests.length = 0;
  // ★`tickets/T-0156`：整体复位 `sub_40DF10`（raw 18080-18109）把 `_this + 388252` 起的 **10** 个
  //   `Queue_int` 槽逐个「析构旧 + `new(0x1C)` + `sub_407C50`（空队）」重建 ⇒ 脚本经 `0x132`/`0x133`
  //   建过、压过值的队**全部回到空队**（旧实现只清 `scriptRequests`，`dispatchQueues` 原样留着）。
  for (let i = 0; i < QUEUE_INT_SLOTS; i++) c.e.dispatchQueues[i] = [];
  setDispatching(c.e, false); // 引擎整体复位 ⇒ 497400 回初值 0（构造点 raw 18149）
  c.e.dispatchSavedCur = -1;
  c.e.advFields.clear();
  c.e.globalSlot97058 = 0;
  c.e.msgwin.reset();
  c.e.native.msgWinClearAll?.(); // 文本图层也要清（引擎：换脚本即整块清 0，见 sub_40DF10）
  c.e.routes.reset();
  // 文本项记录表（引擎 `Font+3364` 的 vector）也是引擎复位整块清掉的一部分：回想/语音重播的账本随脚本作废。
  c.e.textItems.reset();
  // ★阶梯动画时间表同样属于"引擎复位整块清掉"的那批（`sub_40DF10` raw 18050-18054：
  //   `430688 = -1`（写游标）、`430668 = -1`（输入打断 label）、`end = begin`（清条目 vector））。
  //   不清的话，退到标题再进一个"没写 i0d3 就走到 i0d5"的脚本会带着上一次的下标 ⇒ setup 被跳过。
  c.e.stage.reset();
  // ★ 引擎 exit-script 置 _this[96983]=0 → GAMEOVER 回标题后 load-show-logo 读 0，SYSTEM4 跳过 LOGO/版权页。
  c.e.engineValues.set(ENGINE_FIELD.logoEnabled, 0);
  // ★读档续跑现场随整体复位作废（`tickets/T-0059`）：引擎的整块复位（`sub_40DF10`）会清掉
  //   `95780`（读档门）与 `151210` 起的帧镜像；不清的话「新开一局」的第一个 `i0ae` 会走到
  //   **上一局存档的帧栈**上（脚本入口都有 `i0ae`，339 处）。
  c.e.saveResume = null;
  c.e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
  // ★`0x1AD` 记的"存档帧"也要作废（`tickets/T-0061`）：它按引擎口径只在 `i1ad` 时更新，
  //   而新一局的脚本要到进主循环前才 `i1ad` ⇒ 不清的话"回标题 → 新开一局 → 立刻存档"会按
  //   **上一局**的帧号退栈（存出一份指向错误帧的档）。
  c.e.engineValues.set(ENGINE_FIELD.storedCur, -1);
  // 重载根脚本 INDEX0（0=SYSTEM4 引导）；根脚本缺失/加载失败 → 程序退出（同引擎 Command_Exit 语义）。
  if (!c.e.fileSource) throw new ExitScript();
  const boot = await c.e.fileSource.readScript(0);
  if (!boot) throw new ExitScript();
  const script = parseScriptBytes(boot.data);
  loadScriptIntoFrame(c.e.frames[0]!, script, boot.name, 0);
  c.e.cur = 0;
  c.jump(0); // 控制流重定位到新根帧 ip=0，继续跑（而非停在 reset）
};

// ---------------------------------------------------------------------------
// 通用 `Queue_int` 队族：0x132 重建 / 0x133 压入 / 0x134 弹出
// 容器 = 引擎 `_this + 388252`(字节) 起的 **10** 个队列指针（`Engine[4*i+388252]`，i=0..9）⇒
// emulator 的 `Engine.dispatchQueues`（见 `engine.ts` 该字段的注释：`QUEUE_INT_SLOTS = 10` 的引擎证据
// raw 18080-18109 / 18110-18137 / 22655-22674、`sub_407C50` 构造、`sub_409E10` push 的 FIFO 语义）。
// ★`tickets/T-0156` 订正：**不是 11 个槽** —— 引擎三处都是"从 10 数到 1"的 `do/while`
//   （`v15 = 10; … v8 = v15-- == 1;`，先比较后自减 ⇒ 恰好 10 次）。旧注释把 `--` 数成第 11 次。
// 三条 handler 体都以此开头（arity 槽 = `2*argc+1`，引擎自带 argc 真源）：
//   0x132 → `= 3`（argc 1）、0x133 → `= 5`（argc 2）、0x134 → `= 7`（argc 3）。
// ★该槽（`_this + 120*cur + 383220`）是引擎派发器的内部计数器，emulator 不建模（与其它 handler 同）。
// ★★**下标 0xA 越族**：三条 handler 的地址算式都是 `_this + 4*op1 + 388252` ⇒ `op1 = 0xA` 落在
//   **byte 388292**，那正是 `Stack_int` 族的**第一格**（raw 18110 `v18 = (_DWORD *)(_this + 388292)`，
//   `Stack_int` 布局 = `[1]=256(cap)/[2]=256/[3]=buf/[4]=-1`，没有 `Queue_int` 的 `[2]=rd/[3]=wr`）。
//   也就是说 `0xA` 是一次**类型混淆**访问（`0x132` 会把一个 `Queue_int` 对象塞进 `Stack_int` 槽；
//   `0x133`/`0x134` 会按 Queue_int 的字段布局去读 Stack_int 对象 ⇒ 野指针写/读），**不是**本族第 11 个队。
//   本仓**不建模** `Stack_int` 族（`0x137`/`0x138`/`0x139` 见 `stubs.ts`/其它票）⇒ 这里对 `0xA` 显式
//   **拒绝执行并记日志**（与 `> 0xA` 走错误串分支同样是"不动本族任何队列"），把这层语义**写死**而不是
//   让它悄悄落到一个不存在的第 11 格上。残余口径差（引擎真机上是 UB/崩溃）在 `tickets/T-0156` 披露。
const QUEUE_INT_ALIAS_0A = '（0xA 越到 Stack_int 族第一格 byte 388292，raw 18110 ⇒ 类型混淆，emulator 不执行）';
// ---------------------------------------------------------------------------

/**
 * `0x132`（`i132`，`sub_422150` 体起始 **raw 30647**，argc 1）：**重建**第 op1 个 `Queue_int` 队。
 *
 * 引擎体（raw 30647-30681，真分支逐行）：
 * ```c
 * *(_DWORD *)(_this + 120*cur + 383220) = 3;      // arity 槽 ⇒ argc 1
 * v2 = sub_41BF50(_this, 1);                       // op1（readIntOperand）
 * if ( v2 > 0xA )  {                               // ★unsigned 比较（v2 是 unsigned int）
 *     sub_408050(_this + 8, 1024, aResetq);        //   组错误串（aResetq = "RESETQ"）
 *     sub_4034D0(_this, _this + 8);                //   打出错误串 —— **不动队列**（else 才动）
 * } else {
 *     v4 = *(_DWORD **)(_this + 4*v2 + 388252);    // 旧队列
 *     if (v4) (**v4)(v4, 1);                       // 析构旧队列（vtable 槽 0 = 释放）
 *     v5 = operator new(0x1Cu);                    // 新队列对象 28 字节
 *     if (v5) { sub_407C50(v5); *(_DWORD *)(_this + 4*v3 + 388252) = v6; }  // ★v6 见下
 *     else      *(_DWORD *)(_this + 4*v3 + 388252) = 0;
 * }
 * // 4221D8: variable 'v6' is possibly undefined
 * ```
 * ★`sub_407C50`（raw 12653-12663）= `vftable + buf=new[0x400]（**256** int）+ [4]=[5]=256（cap/step）
 *   + [2]=[3]=0（rd/wr）` ⇒ **新队 = 空队**，旧内容整份丢弃。
 * ★raw 30673 写回的 `v6` 是 Hex-Rays 把 `v5`（`operator new` 的返回值）误跟踪成的未定义量
 *   （`// 4221D8: variable 'v6' is possibly undefined`）—— 该分支里 `v5` 非空且 `sub_407C50(v5)` 返回 void
 *   ⇒ 写入的就是**新队列指针**。语义不受影响，emulator 直接写 `dispatchQueues[op1] = []`。
 * ★`v2 > 0xA` 是 **unsigned** 比较 ⇒ 负数（如 -1 = 0xFFFFFFFF）也走错误串分支、不动队列。
 *   重写侧照此用 `>>> 0` 比较（否则 `dispatchQueues[-1]` 会静默落到原型链上）。
 */
const op_queue_reset: OpHandler = (c) => {
  const plan = planFor(c);
  const op1 = (plan.int(1) ?? 0);
  if ((op1 >>> 0) > 0xa) {
    // 引擎：`sub_408050(..., aResetq)` + `sub_4034D0` 打 "RESETQ" 错误串（raw 30661-30662），队列不动。
    c.log(`0x132(RESETQ): 队列下标 ${op1} > 0xA ⇒ 按引擎走错误串分支，不改任何队列`);
    return;
  }
  if (op1 === 0xa) {
    c.log(`0x132(RESETQ): 队列下标 0xA ${QUEUE_INT_ALIAS_0A}，不改任何队列`);
    return;
  }
  c.e.dispatchQueues[op1] = []; // 析构旧队 + new(0x1C) + sub_407C50 ⇒ 空队（旧内容丢弃）
};

/**
 * `0x133`（`i133`，`sub_422240` 体起始 **raw 30683**，argc 2）：**压入**第 op1 个队（值 = op2）。
 *
 * 引擎体（raw 30683-30701，真分支逐行）：
 * ```c
 * *(_DWORD *)(_this + 120*cur + 383220) = 5;       // arity 槽 ⇒ argc 2
 * v2 = sub_41BF50(_this, 1);                        // op1
 * if ( v2 > 0xA ) { sub_408050(..., aAddq); sub_4034D0(...); }   // "ADDQ" 错误串，不压
 * else { v3 = sub_41BF50(_this, 2); sub_409E10(*(_DWORD *)(_this + 4*v2 + 388252), v3); }
 * ```
 * `sub_409E10`（raw 14280 起）= 顺序缓冲上的 push：`[3]`(wr) 处写入 `a2`、`wr++`；
 * 缓冲将满（`[4]`(cap) 不 > `wr+2`）时按 `[5]`(step，构造时 256) **扩容**，或 `rd>0` 时就地把
 * `rd` 起的内容 `memmove` 到头部并 `wr -= rd`、`rd = 0`（**压实**）后重试 ⇒ 净效果 = **FIFO push**。
 * ⇒ emulator = `dispatchQueues[op1].push(op2)`（`number[]` 天然等价；扩容/压实是引擎的缓冲实现细节）。
 * ★披露的口径差：引擎对**已析构（NULL）**的槽（teardown 后，raw 19204 置 0）会空指针解引用；
 *   `dispatchQueues` 是 11 个常驻空数组 ⇒ 此处退化为"往空队压"。合法序列（先 `0x132`）行为一致。
 */
const op_queue_push: OpHandler = (c) => {
  const plan = planFor(c);
  const op1 = (plan.int(1) ?? 0);
  if ((op1 >>> 0) > 0xa) {
    c.log(`0x133(ADDQ): 队列下标 ${op1} > 0xA ⇒ 按引擎走错误串分支，不压入`);
    return;
  }
  if (op1 === 0xa) {
    c.log(`0x133(ADDQ): 队列下标 0xA ${QUEUE_INT_ALIAS_0A}，不压入`);
    return;
  }
  c.e.dispatchQueues[op1]!.push((plan.int(2) ?? 0));
};

/**
 * `0x134`（`i134`，`sub_42F810` 体起始 **raw 39359**，argc 3）：**弹出**第 op1 个队
 * ⇒ **op2 = 成功位，op3 = 值**（两条都用 `sub_42B4B0` = `writeIntOperand` 写回）。
 *
 * 引擎体（raw 39359-39399，真分支逐行）：
 * ```c
 * *(_DWORD *)(_this + 120*cur + 383220) = 7;       // arity 槽 ⇒ argc 3
 * v2 = sub_41BF50(_this, 1);                        // op1
 * if ( v2 > 0xA ) { sub_408050(..., aGetq); sub_4034D0(...); }   // "GETQ" 错误串，两个出参都不写
 * else {
 *   v3 = *(_DWORD **)(_this + 4*v2 + 388252);       // 队列
 *   v4 = v3[2];                                     // rd
 *   if ( v4 < v3[3] ) {                             // rd < wr ⇒ 非空
 *     v5 = *(_DWORD *)(v3[1] + 4*v4);               //   v5 = buf[rd]
 *     v7 = v4 + 1; v3[2] = v7;                      //   rd++
 *     if ( v3[6] < v7 ) v3[6] = v7;                 //   更新 max（[6]）
 *     v6 = 1;                                       //   成功位 = 1
 *   } else { v5 = v8; v6 = 0; }                     // ★空：v5 = **未初始化栈残留**（v8），成功位 = 0
 *   sub_42B4B0(_this, 2, v6);                       // op2 ← 成功位
 *   sub_42B4B0(_this, 3, v5);                       // op3 ← 值
 * }
 * // 42F84D: variable 'v8' is possibly undefined
 * ```
 * ★★**披露的偏差**：队空分支里 `v5 = v8`（raw 39392）是 Hex-Rays 追踪到的**未初始化局部量**
 *   （raw 39399 `// 42F84D: variable 'v8' is possibly undefined`）—— 引擎会把一段**栈残留**当值写进 op3。
 *   emulator 取「空队 ⇒ op3 = 0」这一确定口径（不复制栈残留）。语料唯一使用点
 *   `src/ATSEEK.txt:22-29` 是 `i134 0 (local-int 0) (local-int 1)` 后紧跟 `jcc (local-int 0)`
 *   ⇒ **只读 op2**，op3 在队空时不构成可观测差异。此偏差同时记在
 *   `analysis/opcode-gaps.json` 的 `0x134` note 与 `docs-new/03-engine/opcode-table.md` 该行。
 * ★`sub_42B4B0` 的两条写回**只在 else 分支里** ⇒ `op1 > 0xA` 时 op2/op3 **都不写**（保持原值）。
 */
const op_queue_pop: OpHandler = (c) => {
  const plan = planFor(c);
  const op1 = (plan.int(1) ?? 0);
  if ((op1 >>> 0) > 0xa) {
    c.log(`0x134(GETQ): 队列下标 ${op1} > 0xA ⇒ 按引擎走错误串分支，op2/op3 都不写`);
    return;
  }
  if (op1 === 0xa) {
    // 引擎在 0xA 上按 Queue_int 布局读 Stack_int 对象（`v3[2]` = 256 当 rd、`v3[1]` = cap 当 buf 指针）
    // ⇒ 野指针读/UB。emulator 不建 `Stack_int` 族 ⇒ 拒绝并把两个出参都不写（与越界支同形），如实披露。
    c.log(`0x134(GETQ): 队列下标 0xA ${QUEUE_INT_ALIAS_0A}，op2/op3 都不写`);
    return;
  }
  const q = c.e.dispatchQueues[op1]!;
  const v = q.shift(); // 引擎：`buf[rd]` + `rd++`（FIFO）
  plan.setInt(2, v === undefined ? 0 : 1); // op2 = 成功位（引擎 raw 39395）
  // ★偏差披露（见上方注释）：空队时引擎把未初始化栈残留写进 op3，这里写确定的 0。
  plan.setInt(3, v === undefined ? 0 : v); // op3 = 值（引擎 raw 39396）
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
  [0x1a8, op_dev_ukn], // dev_ukn：引擎体 = 写当前帧步长槽 `95805 = 1`（sub_419690 raw 24775-24783；见上）
  [0x1, op_abort],
  [0x2, op_exit],
  [0x9, op_exit_script],
  // ---- 通用 `Queue_int` 队族（引擎 `_this+388252` 起的 11 个队；语料：ATSEEK 等；`tickets/T-0076` 的 B3）----
  [0x132, op_queue_reset], // 重建第 op1 个队（`sub_422150` raw 30647-30681；op1 > 0xA ⇒ "RESETQ" 错误串、不动队列）
  [0x133, op_queue_push], // 压入 op2（`sub_422240` raw 30683-30701 → `sub_409E10` raw 14280 起；op1 > 0xA ⇒ "ADDQ"）
  [0x134, op_queue_pop], // 弹出 ⇒ op2 = 成功位 / op3 = 值（`sub_42F810` raw 39359-39399；op1 > 0xA ⇒ "GETQ"）
];

