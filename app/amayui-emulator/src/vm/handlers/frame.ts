/**
 * 帧循环 / 计时 / 等待门。
 *
 * 引擎的「帧」概念 = 脚本反复轮询 `0x1F4`(帧计时) / `0x20C`(帧刷新+时钟) / `0x23C`(只刷时钟)；
 * 渲染帧循环（renderer.ts / headlessScene.ts）据此每帧 present 一次，并推进 `Engine.nowMs`。
 *
 * `waitFlags`（= `Engine.effectFlags`）的三个门：
 *  - `0x400` 动画等待门（0x21C set-wait-flag）；
 *  - `SLEEP_GATE` sleep(0xC8) 帧让步；
 *  - `0x8000000` ADV/消息激活态（见 adv.ts）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { SLEEP_GATE } from '../engine.js';

/**
 * 取本族的**操作数计划视图**；缺计划 = 编程错误（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 *
 * ★本族（`tickets/T-0082` 批次"帧控制族"）**10 条**：八条 argc 0 + 两条只读（`0x7b` 回退游标 / `0xc8` 睡眠）。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：帧控制族走操作数计划层，但没有声明计划`);
  return p;
}
import { cfgInt } from '../../engineConfig.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { CFG, registryDefault } from '../../configRegistry.js';
import { parseScriptBytes } from '../../script/bin.js';
import { loadScriptIntoFrame } from '../scriptFrame.js';
import { resolveSlotResumeIp, resolveSlotRetStack } from '../engineSlot.js';
import { applySlotPresentation } from './save-slot.js';
// ★`0x1F5` 的队列重试派发 = 引擎 `sub_40FB60`（raw 25229）⇒ 直接调 control.ts 的那**唯一一份**实现。
import { dispatchNextRequest } from './control.js';
import type { OpTable } from './shared.js';

/** 把「指令的 dword 偏移」换成「指令数组下标」并跳转（引擎里 ip 就是 dword 偏移，重写侧是下标）。 */
function jumpToDword(c: StepCtx, dword: number): void {
  const idx = c.frame.script?.dwordToInstr[dword];
  if (idx === undefined) throw new Error(`跳转目标 dword 偏移 ${dword} 不在脚本映像里（${c.frame.name}）`);
  c.jump(idx);
}

/**
 * **渲染/帧循环一族（真实现，状态建模）** —— 逐条读 handler 体（raw 25194-25236 / 34507 等）：
 *
 * - `0x1F4`（sub_41A090, raw 25194）：**帧计时**。`if (_this[107438]) ++_this[107439]`（累加帧计数）
 *   `else { _this[107438]=1; _this[92334]=_this[92333]; _this[92333]=timeGetTime(); }`
 *   —— 脚本的"帧循环"就是 **反复 i1F4 轮询**（全工程 66510 处），它本身**不是等待**，只是记时间/计帧。
 * - `0x1F5`（sub_41A0E0, raw 25214）：**帧倒计 + 队列重试派发**。`v1=_this[429756]; if (v1<=0) { if (_this[429752]) { v2 = (_this[497400]==0); _this[429752]=0; if (v2) sub_40FB60(); } } else _this[429756]=v1-1;`
 *   —— 计到 0、且停靠标志原值为 1 时清"停靠"标志，并在**非派发中**时调 `sub_40FB60` 放行排队脚本
 *   （= emulator 的 `dispatchNextRequest`，见 `handlers/control.ts`；`tickets/T-0157`）。
 * - `0x261`/`0x2DB`… 同族见 `ENGINE_FIELD_STORE`；`0x20C`（sub_41A1A0, raw 25259）**每帧**刷时钟 +
 *   调绘制容器的 `sub_4B4040`（帧刷新）——emulator 的渲染帧循环已自行 present，故 `sub_4B4040` 无需复刻。
 */
const op_frame_tick: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  if (!e.engineValues.get(ENGINE_FIELD.frameTickLock)) {
    e.engineValues.set(ENGINE_FIELD.frameTickLock, 1);
    e.engineValues.set(ENGINE_FIELD.clockPrev, e.engineValues.get(ENGINE_FIELD.clock) ?? 0);
    e.engineValues.set(ENGINE_FIELD.clock, e.nowMs | 0);
  } else {
    e.engineValues.set(ENGINE_FIELD.frameCount, (e.engineValues.get(ENGINE_FIELD.frameCount) ?? 0) + 1);
  }
};

/**
 * `0x1F5`（sub_41A0E0, raw 25214-25236）：帧倒计到 0 → 清**帧计时停靠锁**（`_this[107438]`）+ 重试派发。
 *
 * 体（raw 25221-25235）三层门，缺一层都会静默偏掉：
 * ```c
 * v1 = *(_DWORD *)(_this + 429756);                 // ① 锁深度（dword 107439）
 * if ( v1 <= 0 ) {
 *   if ( *(_DWORD *)(_this + 429752) ) {            // ② 停靠标志原值必须为 1（dword 107438）
 *     v2 = *(_DWORD *)(_this + 497400) == 0;        // ③ 派发中标志（字节 497400 = dword 124350）
 *     *(_DWORD *)(_this + 429752) = 0;              //    先无条件清停靠标志
 *     if ( v2 ) sub_40FB60(_this);                  //    再按 ③ 决定是否放行脚本队列
 *   }
 * } else { *(_DWORD *)(_this + 429756) = v1 - 1; }
 * ```
 * ★T-0057 R3 修正（保留）：raw 的 `*(_DWORD *)(_this + 429756)` 是**字节**偏移 ⇒ dword 下标 = `429756/4 = 107439`，
 * 与 `0x1F4`（`sub_41A090` 的 `_this[107439]/[107438]`）**是同一对字段**。此前把字节偏移当
 * `engineValues` 的键，结果是"帧计数只增不减 + 停靠锁永不释放 + 0x1F4 再不刷新时钟"（静默）。
 *
 * ★T-0157 修的三处（修前 = 无条件 `frameCount <= 0 ⇒ frameTickLock = 0`，既没有 ② 也没有 ③）：
 *  - **② 停靠标志为 0 ⇒ 整段不进**（连那次 `= 0` 的写都没有）：修前多写一次 0。这一格在停靠结束后
 *    恒 0，多写本身不产生可观测差异，但少了它就无法表达"②"这个门（审计 §4.1 第 181 条的复核结论：
 *    "折叠成一个键"的指控不成立，缺的是这一次派发）；
 *  - **③ 派发中标志为 0 才派发**（raw 25226）：修前完全没有这个判据 —— 见 `dispatchNextRequest` 的
 *    `dispatchInProgress` 写点说明（本票之前该字段只有读没有写，门会退化成恒真）；
 *  - **这一次 `sub_40FB60` 调用整体缺席**（审计 §4.1 第 107/283 条，P1）：修前只清锁，
 *    「停靠期间入队的请求在清停靠那一刻重试派发」这条语义在重写侧不存在。
 *    `dispatchNextRequest`（control.ts）就是本仓的 `sub_40FB60`，其入口停靠闸（raw 18966）在
 *    **清完标志之后**才被调用 ⇒ 必然放行，与引擎同日。
 * ★复核纠正：报告把「队列恰剩 1 项」（`497380 < 497384 && 497384 - 497380 == 1`）记在 0x1F5 头上，
 *   那条判据属于 **0x7C**（`sub_41AB80` raw 25819-25821）；0x1F5 的体里**没有**任何队列长度判据。
 */
const op_frame_countdown: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  const left = e.engineValues.get(ENGINE_FIELD.frameCount) ?? 0;
  if (left > 0) {
    e.engineValues.set(ENGINE_FIELD.frameCount, left - 1); // raw 25234
    return;
  }
  // ② raw 25224：停靠标志原值为 0 ⇒ 什么都不做（引擎连"写 0"都不发生）。
  if (!e.engineValues.get(ENGINE_FIELD.frameTickLock)) return;
  const dispatchAllowed = (e.engineValues.get(ENGINE_FIELD.dispatchInProgress) ?? 0) === 0; // ③ raw 25226
  e.engineValues.set(ENGINE_FIELD.frameTickLock, 0); // raw 25227：先清停靠标志
  if (dispatchAllowed) await dispatchNextRequest(c); // raw 25228-25229：再放行队列（本仓的 sub_40FB60）
};

/** `0x20C`（sub_41A1A0, raw 25259）：每帧刷时钟 + `sub_4B4040(_this+80708)`（帧刷新）。 */
const op_frame_present: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  if (!e.engineValues.get(ENGINE_FIELD.frameTickLock)) {
    e.engineValues.set(ENGINE_FIELD.clockPrev, e.engineValues.get(ENGINE_FIELD.clock) ?? 0);
    e.engineValues.set(ENGINE_FIELD.clock, e.nowMs | 0);
  }
  c.native.frameTick?.();
};

/**
 * **`0x23C`（sub_41A2C0, raw 25308，argc=0）：帧毫秒时钟**（名字像空操作，其实是 `timeGetTime`）。
 * 引擎：`_this[92334] = _this[92333]; _this[92333] = timeGetTime();`（字节 369336 / 369332）。
 * 同一对字段在主循环里以同样两条赋值维护（raw 20750-20751，紧跟 `sub_4B4040` 渲染调用前），
 * 而 `0x20C` 做同样的事**并追加渲染**（raw 25259）。⇒ 0x23C = 「只刷时钟、不渲染」。
 * ★与 `0x1F4`（停靠锁）不同：0x1F4 只在**未锁定**时刷时钟，0x23C 无条件刷（raw 25312-25315）。
 */
const op_frame_clock: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.clockPrev, e.engineValues.get(ENGINE_FIELD.clock) ?? 0);
  e.engineValues.set(ENGINE_FIELD.clock, e.nowMs | 0);
};

const op_set_wait_flag: OpHandler = (c) => {
  const plan = planFor(c);
  // 0x21C u00416270：置 effect_flags |= 0x400（版权页动画等待）。
  c.native.setWaitFlag?.(0x400);
  c.e.waitFlags |= 0x400;
};

/**
 * ★`0xC8`（`sub_4218D0` raw 30288-30314）的**两条语义不同的路径**（`tickets/T-0156`）：
 * ```c
 * if ( (_this[174801] & 0x8000000) == 0 ) {      // ADV 未激活
 *   v3 = sub_41BF50(_this, 1);                   // n
 *   if ( v3 >= 10 ) { _this[174801] |= 1u; sub_453A60(_this + 107440, v3); }  // 帧节流计时器
 *   else            { Sleep(v3); }                                            // 进程级硬阻塞
 * }
 * ```
 *  - `'block'`（`n < 10`，语料 51 处：`sleep 1` 38 / `sleep 0` 12 / 1 处其它）：**同一次脚本派发内**
 *    `Sleep(n)` 毫秒 —— 引擎**不**置 `effect_flags |= 0x20000000`、**不**碰节流计时器、**不**重画；
 *  - `'throttle'`（`n >= 10`，语料 334 处 `sleep 1f4`）：置 `effect_flags |= 1` 并把
 *    `sub_453A60(Engine + 430... , n)` 的**帧间隔槽 `[6] = n`** 立起来，实际等待由主循环的
 *    `sub_453AF0`（raw 66161-66179：`剩余 = n * 帧数 - 已过毫秒`，`剩余 >= 5` 就返回 -1 继续下一轮，
 *    `0 < 剩余 < 5` 才 `Sleep(剩余)`）逐帧摊还 ⇒ **不是**一次性 `Sleep(n)`。
 *  ⇒ 这是**判定函数**（导出给守卫；`test/t0156-control-frame.test.ts` 直接断言边界 9/10）。
 */
export function sleepPath(n: number): 'block' | 'throttle' {
  return n >= 10 ? 'throttle' : 'block';
}

/** 0xC8 sleep (sub_4218D0)：睡眠/帧让步。op1=n。
 * 引擎（raw 30288-30314）分两支，见上方 `sleepPath`：非 ADV 激活（`effect_flags & 0x8000000 == 0`）时，
 *   `n < 10` → `Sleep(n)` 毫秒**同一次派发内的进程级阻塞**；`n >= 10` → `effect_flags |= 1`
 *   + `sub_453A60(_this+107440, n)` 立帧间隔，等待由主循环 `sub_453AF0` 按帧摊还（片 ≤4ms）。
 *
 * ★emulator 的落点与**架构性近似**（`tickets/T-0156`；实测过反例，见下）：
 *  两支都必须**让出本次派发**（= 装 `SLEEP_GATE` + `sleepUntil`），因为引擎的 `Sleep(n)` 阻塞的是
 *  **游戏线程**，而本仓帧循环的 `maxStepsPerFrame` 默认是 `Number.POSITIVE_INFINITY`
 *  （`frame/loop.ts:304`）⇒ 若 `n<10` 支"不装门"，TITLE 的 `sleep 1; jmp` 轮询循环（`src/TITLE.txt:63`）
 *  在**同一帧内永不 yield**，模拟器直接空转冻结（实测：把 `n<10` 支改成不装门后，T1 批量跑挂死）。
 *  旧实现在这里额外做错两件事，本轮修掉：
 *   ① `sleepUntil = nowMs + Math.max(1, n)` 把 `Sleep(0)` 抬成 1ms ⇒ 改 `Math.max(0, n)`（`Sleep(0)` = 让出时间片）；
 *   ② 两支都**没有**武装引擎的节流位 ⇒ 现在只在 `n >= 10` 支写 `effect_flags |= 1`（raw 30306）。
 *  残余口径差（如实登记）：`n < 10` 的"毫秒级硬阻塞"在本仓不消耗真实时间（宿主 `native.sleep` 是 no-op，
 *  `renderer/pixiBackend.ts:373`），只表现为"让出一帧"——扩展点见 `tickets/T-0156/changes-c156.md`。 */
const op_sleep: OpHandler = (c) => {
  const plan = planFor(c);
  if (c.e.advActive) return; // 引擎 raw 30301：`(effect_flags & 0x8000000) != 0` ⇒ **整段不进**（连操作数都不读）
  const n = (plan.int(1) ?? 0);
  // 让出本次派发（= 引擎 `Sleep(n)` 阻塞当前线程的架构等价物）；`Sleep(0)` 同样让出，但不抬成 1ms。
  c.e.sleepUntil = c.e.nowMs + Math.max(0, n);
  c.e.waitFlags |= SLEEP_GATE;
  // raw 30306：`_this[174801] |= 1u` 只在 `n >= 10` 支（帧节流计时器武装位）。
  if (sleepPath(n) === 'throttle') c.e.effectFlags |= 1;
  c.native.sleep?.(n);
};

/**
 * `0x7B`（`sub_41F530` raw 28724-28733）：**设置本帧的「重显示（回退）游标」**。
 *
 * 引擎体只有两句（外加每步元数据）：
 * ```c
 * _this[30*cur + 95805] = 5;                       // 操作数记数（2 个操作数）
 * _this[cur + 122372] = op1;                       // 主回退点：op1 = label 的 **dword 偏移**
 * _this[cur + 122412] = op2;                       // 备用回退点
 * ```
 * **两个读者**（这就是它不能当 no-op 的原因）：
 *  - `0x199`（`sub_418FC0` raw 24492-24529，argc 0）：「**重显示文本**」——按模式位 `Engine[122452] & 0x4000000`
 *    选主/备用游标，把 `frame.ip` 直接设回它（`ip = base + 4*游标`），并挂起本帧（操作数记数置 0 = 不前进）；
 *  - 主循环 `sub_409700`（raw 14001-14008）：`effect_flags & 0x20` 分支下同样回退到主游标。
 * ⇒ 游标值与脚本里 `label_XXX` 同空间 = **dword 偏移**（引擎 `ip = ip_base + 4*游标`）。
 *   ★T-0057 订正：本文件此前把它当"指令数组下标"直接 `jump()` —— 下标与 dword 偏移**不等**
 *   （每条多操作数指令都会拉开差），真语料 `$1$SC0330.txt:42` 的 `i07b label_000036a4` + 后续 `i199`
 *   会跳到错位指令。现在统一经 `dwordToInstr` 换算（与 `call`/`ret` 同口径）。
 * 缺省值 `-1`（引擎在装载/读档时把这两个数组初始化成 -1，raw 18639-18640）。
 *
 * 语料：`i07b` 在 `$1$SC03xx/SC08xx/SG*` 等脚本里有使用（此前注释写"0 处"是漏计）。
 */
const op_set_rewind_cursor: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.rewindMainBase + e.cur, (plan.int(1) ?? 0));
  e.engineValues.set(ENGINE_FIELD.rewindAltBase + e.cur, (plan.int(2) ?? 0));
};

/**
 * `0x199`（`sub_418FC0` raw 24492-24529，argc 0）：**重显示文本**（`0x7B` 的读取端）。
 *
 * ```c
 * _this[174802] = 0;
 * if ((_this[122452] & 0x4000000) == 0) {                 // 未处于"重画"模式
 *   if (_this[cur + 122372] != -1) {
 *     _this[30*cur + 95805] = 0;                          // 不前进（handler 自己定了 ip）
 *     v4 = effect_flags; effect_flags = 0;
 *     _this[122452] = v4 | 0x6000000;                     // 记下旧 flags 并进入"重画"模式
 *     _this[122453] = ((ip - ip_base) >> 2) + 1;          // 重画后要跳回的**下一条**（dword 偏移 + 1）
 *     _this[107678] = frame[+0x50];                       // 记脚本 id（emulator 未建模 ⇒ 略）
 *     frame.ip = base + 4*_this[cur + 122372];            // ★回退
 *   }
 * } else if (_this[cur + 122412] != -1) {                 // 已处于重画模式 ⇒ 用备用游标
 *   _this[30*cur + 95805] = 0;
 *   _this[122452] = (_this[122452] & 0xF9FFFFFF) | 0x2000000;
 *   frame.ip = base + 4*_this[cur + 122412];
 * }
 * ```
 * 语料 **668 处 / 334 个脚本**（此前**根本不在任何表里 ⇒ 命中即硬报错**）。典型序列：
 * `i7b <label> -1`（设回退点）… 若干条 … `i199`（重显示同一段文本）。
 */
const op_redisplay_text: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const cur = e.cur;
  const mode = e.engineValues.get(ENGINE_FIELD.redisplayMode) ?? 0;
  e.engineValues.set(ENGINE_FIELD.inputStateMask, 0);
  if ((mode & 0x4000000) === 0) {
    const target = e.engineValues.get(ENGINE_FIELD.rewindMainBase + cur) ?? -1;
    if (target !== -1) {
      const saved = e.effectFlags;
      e.effectFlags = 0;
      e.engineValues.set(ENGINE_FIELD.redisplayMode, (saved | 0x6000000) | 0);
      // 引擎 `sub_418FC0` raw 24513：`((ip - ip_base) >> 2) + 1` = **当前指令的 dword 偏移 + 1**。
      e.engineValues.set(ENGINE_FIELD.redisplayReturn, (c.frame.script?.instructions[c.frame.ip]?.index ?? 0) + 1);
      // 引擎 raw 24515：`_this[107678] = frame[95796]` = **记下当时的帧脚本身份**（`0x7C` 用它做深度校验）。
      e.engineValues.set(ENGINE_FIELD.redisplayScriptId, c.frame.scriptId);
      jumpToDword(c, target);
    }
    return;
  }
  const alt = e.engineValues.get(ENGINE_FIELD.rewindAltBase + cur) ?? -1;
  if (alt !== -1) {
    e.engineValues.set(ENGINE_FIELD.redisplayMode, ((mode & 0xf9ffffff) | 0x2000000) | 0);
    jumpToDword(c, alt);
  }
};

/**
 * **`0x7C` local-ret**（`sub_41AB80` raw 25778-25824，argc 0）：**结束「重显示调用」并回到 0x199 记下的位置**。
 *
 * 引擎体逐字（`489808` = 字节形式，即 `_this[122452]` = 重显示模式字；`489812` = `_this[122453]`）：
 * ```c
 * if ((mode & 0x2000000) == 0) { arity=1; throw ShowMessage("END.HWL"); }   // ★不在"重显示返回"模式 ⇒ 报错
 * if (frame[95796] != Engine[430712])  throw ShowMessage("Depth が不正です %s != %s");
 * frame.ip = ip_base + 4 * Engine[489812];        // ← 回到 0x199 记下的"下一条"（dword 偏移）
 * frame[arity] = 0;
 * effect_flags = mode & 0xFDFFFFFF;               // ★恢复 0x199 之前保存的 flags（清掉 0x2000000）
 * mode = 0;
 * Engine[81776] = -1; Engine[81768] = 0; Engine[51848] = -1; Engine[51840] = 0;   // 两对"光标/选择"状态清零
 * if (Engine[387940]) { Engine[387940] = 0; if (list.len == 1) sub_40FB60(this); } // 列表只剩 1 项时的收尾
 * ```
 * ★语料 **668 处 / 334 个脚本**（本作使用量第 3 的缺口）。典型成对形态（每脚本 2 处）：
 * `call label_X` → `i1ad` → `i199`（进入重显示、跳到回退游标）→ … → **`local-ret`**（回到 `i199` 之后那条）。
 * ⇒ 与 `0x199`（写端）严格成对：写端记 `redisplayReturn`/`redisplayScriptId`，本指令读回并清理。
 *
 * emulator：`jumpToDword(redisplayReturn)` + 还原 `effect_flags` + 清 `redisplayMode`。
 *
 * ★`tickets/T-0156` 的四格豁免**收窄**（原注释把这四格一律写成"没有对应消费者"，读体后只有三格成立）：
 *  - **`81776 = -1` / `81768 = 0` / `51840 = 0`**：引擎侧只有「写」（`0x7C` raw 25812-25815 与
 *    整块复位 raw 18066-18072 写同一组值），无读者 ⇒ 写进 emulator 会变成死写（`check:dead-writes`）⇒ **跳过**；
 *  - **`51848 = -1`**：★**有真实读者** —— 主循环 raw 20005/20013（`if (_this[51828] && (v11 = _this[51848]) >= 0
 *    && _this[23008] > v11)`）把它当**索引**用（越界门 = `< _this[23008]`），是「选择/列表框的当前项」。
 *    emulator 的选择/列表框模型未建 ⇒ 这是一条**有读者但消费者缺席**的缺口（不是"只写不读"），
 *    已登记在 `tickets/T-0156` 的处置表（P3 行 302）。
 *  - **`387940`**（raw 25816-25822）：置位时清 0，并在**队列恰剩 1 项**（`497380 < 497384 && 497384 - 497380 == 1`）
 *    时调 `sub_40FB60` 放行脚本队列。emulator 既不写 `387940`（无写者 ⇒ 门恒假）也没有该派发点 ⇒
 *    实现它需要先有 `387940` 的写者（属选择/列表框子系统），已**如实登记**为缺口。
 */
const op_redisplay_return: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const mode = e.engineValues.get(ENGINE_FIELD.redisplayMode) ?? 0;
  if ((mode & 0x2000000) === 0) {
    throw new Error(
      'END.HWL: 0x7C（local-ret）要求处于「重显示返回」模式（引擎 raw 25791-25796 打 aEndhwl 并抛 ShowMessage）',
    );
  }
  const want = e.engineValues.get(ENGINE_FIELD.redisplayScriptId) ?? -1;
  // ★`tickets/T-0156`：这条比较在引擎里是**无条件**的（raw 25798-25807），`430712` 的初值/整块复位值都是
  //   **-1**（raw 18155）⇒ 不存在「-1 = 0x199 没记过 ⇒ 跳过校验」这条口径（旧实现的 `want !== -1` 就是它）。
  if (c.frame.scriptId !== want) {
    throw new Error(
      `Depth が不正です ${c.frame.scriptId} != ${want}（0x7C raw 25799：当前帧脚本身份必须等于 0x199 记下的那个）`,
    );
  }
  const ret = e.engineValues.get(ENGINE_FIELD.redisplayReturn) ?? -1;
  if (ret !== -1) jumpToDword(c, ret);
  e.effectFlags = (mode & 0xfdffffff) | 0; // 引擎：effect_flags = mode & 0xFDFFFFFF（清 0x2000000）
  e.engineValues.set(ENGINE_FIELD.redisplayMode, 0);
};

/**
 * `0xAE`（`sub_4192F0` raw 24634-24773）：**存档版本分支** —— 读档时把每帧的 ip 重算到存档记录的位置，
 * 并逐帧把**存档里那批脚本**装载起来，直到走到存档帧才收尾（`tickets/T-0059`）。
 *
 * 引擎形状（三段几乎同构，只有**步长与槽位**不同）：
 * ```c
 * _this[30*cur+95805] = 1;                       // 本指令步长 = 1
 * if (!_this[95780]) return;                     // ★门控：只有读档流程置 1
 * sv1 = GetConfig("set:SaveVersion1"); sv2 = GetConfig("set:SaveVersion2");
 * // sv1==1 && sv2==20 → 263*cur 槽位组；sv1==2 → 261*cur 组；sv1==3 → 261*cur 另一组
 * v = _this[261*cur + 156783];                   // 记录[260] = 「0x3 call-script 表」下标
 * if (v >= 0)     { ip = ipBase + 4*表B[v];  95805 = 3; }   // 表 B = `frames[cur][95800]`
 * else if (w>=0)  { ip = ipBase + 4*表A[w];  95805 = 0; }   // 表 A = `frames[cur][95798]`；w = 记录[259]（0x71 消息表下标）
 * if (cur == _this[151210] = savedCur) { _this[95777] = _this[151211]; _this[95780] = 0; [v2: _this[97054]=1] }
 * else { _this[95777] = cur; _this[95776] = cur + 1; return sub_40F750(_this, 3, sv2); }   // 装载记录[cur+1] 的脚本并切帧
 * ```
 *
 * ★**两个分支的步长差异就是"续到哪里"**（本实现按它决定落点）：
 *  - `95805 = 3`（记录命中 `0x3` 表）：该帧停在一条 **call-script**（长 3 dword）上 ⇒ 续跑从**它的下一条**开始
 *    （调用点本身不重放；被调脚本的返回栈已在装载时恢复）；
 *  - `95805 = 0`（记录命中 `0x71` 表）：该帧停在一条 **显示消息** 上 ⇒ 续跑**重放这条消息**
 *    （不重放的话玩家会跳过存档当时正显示的那句话）。
 *
 * `95780` = 「正在读档」门（`ENGINE_FIELD.loadInProgress`）；`sub_40F750(Engine, 3, sv2)` = 装载记录里的脚本帧。
 * 每帧的 `i0ae` 都出现在**脚本入口**（例：`src/$1$SC0330.txt:1003`、`src/SYSTEM4.txt:143`）⇒ 走栈是
 * "装下一帧 → 它从入口跑 → 入口的 `i0ae` 再落 ip/再走下一帧"这样链式推进的。
 *
 * 语料：`i0ae` **339 处**（此前文档写"0 处"是漏计，见 `tickets/T-0059` 的订正）。
 */
const SAVE_VERSION_BRANCH: Record<number, { mode: number; setLoadFlag?: boolean; sv2?: number }> = {
  // sv1=1 且 sv2=20（引擎槽位：263 步长、savedCur/savedRet = `129624`/`129625`、ip 下标 = `130199`）
  1: { mode: 1, sv2: 20 },
  // sv1=2（261 步长、`140457`/`140458`、`141030`）
  2: { mode: 2, setLoadFlag: true },
  // sv1=3（261 步长、`151210`/`151211`、`156783`）—— 本机真槽（47 个）全是这一支
  3: { mode: 3 },
};

const op_save_version_branch: OpHandler = async (c) => {
  const plan = planFor(c);
  const e = c.e;
  if ((e.engineValues.get(ENGINE_FIELD.loadInProgress) ?? 0) === 0) return; // 非读档流程：引擎在此直接返回
  const resume = e.saveResume;
  // ★`sv1/sv2` 的取值顺序（`tickets/T-0065`）：
  //   ① **续跑记录里那份**（= 被读的那份槽自己在容器头里声明的版本，`loadSlotIntoEngine` 从 +284/+288 带进来）
  //      —— 它决定这份槽的帧记录布局，必须优先；
  //   ② 配置 `set:SaveVersion1/2`；
  //   ③ 配置注册表的**默认值**（`set:SaveVersion1/2` 的 def）—— 玩家数据里 `[set]` 段可能整个不存在
  //      （实测：把真存档复制进来后 INI 没有 `[set]`）⇒ 旧写法 `cfgInt(..., 0)` 会得到 0，
  //      而 0 不在 `SAVE_VERSION_BRANCH` 里 ⇒ **整个走栈不发生**、读档一路跑回 TITLE。
  const sv1 = resume?.sv1 ?? (e.config ? cfgInt(e.config, CFG.setSaveVersion1, registryDefault(CFG.setSaveVersion1)) : 0);
  const sv2 = resume?.sv2 ?? (e.config ? cfgInt(e.config, CFG.setSaveVersion2, registryDefault(CFG.setSaveVersion2)) : 0);
  // ★**走栈期间把读档装好的画面反复装回**（`tickets/T-0069`）：本指令在每个走栈步都会执行一次
  //   （每帧脚本入口），而这一帧里场景入口的初始化可能已经把画面改成"刚进场景"的样子
  //   （`create-mesh` 重建遮罩 + 重播淡入）⇒ 这里当场盖回存档当时那份。
  //   引擎不需要这一步：它的后备缓冲从不清，旧像素一直压着那些一次性绘制。
  if (e.loadHold) applySlotPresentation(e, e.loadHold);
  if (!resume) {
    // 门开着但没有续跑记录：只可能是旧布局（sv1 = 1/2，本模块不解析）或装载失败留下的门。
    // 引擎在这种情况下会去读自己那份帧镜像；emulator 没有那份镜像 ⇒ **清门收场**（免得后续 339 处
    // `i0ae` 一直走"读档中"分支），并如实记一次日志。
    e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    c.log(`0xAE: 门开着但没有续跑记录（sv1=${sv1}/sv2=${sv2}）⇒ 清门（旧布局未解析，见 SLOT_GAPS）`);
    return;
  }
  // ★**版本门（`tickets/T-0156` 订正后的精确口径）** —— 引擎 `sub_4192F0` 的入口分派是
  //   raw 24663 `if (v3 != 1)` … raw 24738 `if (result == 20)`：`sv1 == 1` 时 **只有** `sv2 == 20` 才进这一支，
  //   否则整个 body 直接 `return result`（什么都不做）。它管的是「用哪套**槽位组**」，与「记录里存表下标
  //   还是直接落点（`instr`）」是两件事。旧实现用 `direct`（记录带 `instr`）把版本门整个短路掉 ⇒
  //   「槽头声明 sv1=1 而 sv2≠20」这种槽仍会被直落（引擎整支不进）。
  //   但**不能**把版本门无条件施加到本工程格式上：本工程槽的容器头 `format = 0`（`src/save/saveSlot.ts`
  //   的"本工程槽"）⇒ `sv1 = 0 ∉ {1,2,3}`，而它恰恰是 emulator 自己的记录布局（引擎里没有这种槽，
  //   自然也没有对应的版本号）⇒ 无条件施加会让**本工程槽的续跑整体失效**（实测：
  //   `test/slot-save-resume.test.ts` 的 3 条读档续跑全红）。
  //   ⇒ 三条精确规则（覆盖全部组合）：
  //     ① 槽头**明确声明**了带 `sv2` 约束的引擎版本（`sv1 == 1`）⇒ 无论记录布局，`sv2` 必须匹配；
  //     ② 槽头没声明引擎版本（`sv1 ∉ {1,2,3}`）+ 记录**不带 `instr`**（= 引擎格式的记录，但没有可用的
  //        版本号）⇒ 无法选组 ⇒ 不进（= 旧行为）；
  //     ③ 其余（本工程格式的直接落点记录、sv1=2/3 的引擎记录、sv1=1/sv2=20）⇒ 进。
  const spec = SAVE_VERSION_BRANCH[sv1];
  const direct = resume.frames.every((f) => !f || f.instr !== undefined);
  if (spec !== undefined && spec.sv2 !== undefined && sv2 !== spec.sv2) {
    c.log(`0xAE: sv1=${sv1} 要求 sv2=${spec.sv2}，实际 ${sv2} ⇒ 按引擎整支不进（raw 24738）`);
    return;
  }
  if (spec === undefined && !direct) {
    c.log(`0xAE: sv1=${sv1} 不在分派表里且记录是引擎格式（无 instr 落点）⇒ 整支不进（raw 24663）`);
    return;
  }
  const cur = e.cur;
  const rec = resume.frames[cur];
  const frame = e.frames[cur];
  if (!rec || !frame) {
    e.saveResume = null;
    e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    return;
  }

  // ① 按记录重算**本帧**的 ip（用本帧那份脚本自己的两张表；引擎 raw 24706-24723）。
  let landed: number | null = null;
  if (rec.instr !== undefined) {
    // 本工程槽（`tickets/T-0063`）：记录里直接存了 emulator 的**指令下标** ⇒ 直落、不换算、不前进。
    landed = rec.instr;
    frame.ip = landed;
  } else if (frame.script) {
    const ip = resolveSlotResumeIp(frame.script, rec);
    if (ip) {
      // 引擎：ipB 分支 95805 = 3 ⇒ ip 之后进 3 个 dword（= 调用点的下一条）；ipA 分支 95805 = 0 ⇒ 停在该指令。
      landed = ip.advance ? ip.instr + 1 : ip.instr;
      frame.ip = landed;
    } else {
      c.log(`0xAE: 帧 ${cur} 的落点下标越界（call=${rec.callIdx} msg=${rec.messageIdx}，脚本 ${frame.name}）`);
    }
  }

  // ② 已回到存档帧 ⇒ 收尾（引擎 LABEL_26：`95777 = savedRet; 95780 = 0;`，版本 2 另置 `97054 = 1`）。
  if (cur === resume.savedCur) {
    e.engineValues.set(ENGINE_FIELD.callRet, resume.savedRet);
    e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    // `0x1AD`（`i1ad`）那格跟进到续档后的帧（本工程槽的 `savedCur`）；引擎那边的脚本入口会自己 `i1ad`。
    e.engineValues.set(ENGINE_FIELD.storedCur, cur);
    if (spec?.setLoadFlag) e.engineValues.set(ENGINE_FIELD.loadDoneFlag, 1);
    e.saveResume = null;
    // ★收尾这一刻**松手**（`tickets/T-0069`）：画面已在上面装回（= 存档当时那份），此后脚本自己的绘制
    //   （落点重放那句话、后续演出）要如实可见 ⇒ 不再往回复原。
    e.loadHold = null;
    c.log(`0xAE: 续跑收尾 —— cur=${cur} 落点=${landed ?? '（保持原 ip）'}（${frame.name}），读档门已清`);
    if (landed !== null) c.jump(landed);
    return;
  }

  // ③ 还没到存档帧 ⇒ `sub_40F750(3)`：把记录里**下一帧**的脚本装进 `cur+1`、恢复它的返回栈，然后切过去。
  //    （引擎把 `95776 = cur+1`，下一轮由新帧入口的 `i0ae` 再落 ip —— 所以这里**不设**新帧的 ip。）
  //    ★中间可能有**空帧**（本工程槽允许 `scriptId = -1` 的格子：预装帧/空槽）⇒ 往后找到第一个真帧。
  let next = cur + 1;
  while (next < resume.frames.length && (resume.frames[next]?.scriptId ?? -1) < 0 && resume.frames[next]?.instr === undefined) {
    next++;
  }
  const nextRec = resume.frames[next];
  const nextFrame = e.frames[next];
  if (!nextRec || !nextFrame || next > resume.savedCur) {
    // 走不到存档帧（记录缺失/越界）⇒ 清门收场，避免悬着（不是正常路径，记日志）
    e.saveResume = null;
    e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    c.log(`0xAE: 帧 ${next} 没有可装载的记录（savedCur=${resume.savedCur}）⇒ 中止续跑（读档门已清）`);
    return;
  }
  const src = await e.fileSource?.readScript?.(nextRec.scriptId);
  if (!src) {
    e.saveResume = null;
    e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    c.log(`0xAE: 帧 ${next} 的脚本 0x${nextRec.scriptId.toString(16)} 读不到 ⇒ 中止续跑（读档门已清）`);
    return;
  }
  const nextScript = parseScriptBytes(src.data);
  loadScriptIntoFrame(nextFrame, nextScript, src.name, nextRec.scriptId);
  // 返回栈：本工程槽直接带 emulator 口径的值（`retStack`）；引擎真槽用表 C 下标换算（`retIdx`）。
  if (nextRec.retStack) {
    nextFrame.retStack = [...nextRec.retStack];
  } else {
    const ret = resolveSlotRetStack(nextScript, nextRec);
    if (ret.retStack.length > 0) nextFrame.retStack = ret.retStack;
  }
  nextFrame.caller = nextRec.returnFrame;
  e.markFileUsed(nextRec.scriptId);
  e.cur = next;
  c.log(
    `0xAE: 续跑走栈 ${cur} → ${next}：装载 ${src.name}(id=0x${nextRec.scriptId.toString(16)})` +
      `（返回帧=${nextRec.returnFrame}，返回栈 ${nextFrame.retStack.length} 层）`,
  );
  c.jump(-1); // 控制流已转到新帧（它从入口 ip=0 开始跑）
};

/** 帧计时/时钟 + sleep/等待门 + 文本重显示/存档版本分支（真实现；native.frameTick 转发）。 */
export const FRAME_OPS: OpTable = [
  [0x1f4, op_frame_tick], // 帧计时（+帧计数 / 刷时钟）
  [0x1f5, op_frame_countdown], // 帧倒计 → 清帧计时停靠锁（脚本队列派发未接线，见 T-0057）
  [0x20c, op_frame_present], // 每帧刷时钟 + native.frameTick()
  [0x23c, op_frame_clock], // 帧毫秒时钟（timeGetTime → ENGINE_FIELD.clock/clockPrev）
  [0x7b, op_set_rewind_cursor], // 设本帧「重显示」回退游标（rewindMainBase/rewindAltBase，值为 dword 偏移）
  [0x199, op_redisplay_text], // ★重显示文本（0x7B 的读取端；668 处，原先命中即硬报错）
  [0x7c, op_redisplay_return], // ★local-ret：结束重显示调用、回到 0x199 记下的位置（668 处；B3 补）
  [0xae, op_save_version_branch], // 存档版本分支（门控 loadInProgress；帧 ip 重算=已登记缺口）
];

/** 帧让步 / 等待门（native 转发）。 */
export const FRAME_NATIVE_OPS: OpTable = [
  [0xc8, op_sleep], // → native.sleep + SLEEP_GATE 帧让步
  [0x21c, op_set_wait_flag], // → native.setWaitFlag（0x400 等待门）
];

