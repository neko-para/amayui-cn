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
import { SLEEP_GATE } from '../engine.js';
import { cfgInt } from '../../engineConfig.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import { CFG } from '../../configRegistry.js';
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
 * - `0x1F5`（sub_41A0E0, raw 25214）：**帧倒计**。`v1=_this[429756]; if (v1<=0) { if (_this[429752]) { park=0; if(!dispatch_in_progress) sub_40FB60(); } } else _this[429756]=v1-1;`
 *   —— 计到 0 时清"停靠"标志，并在非派发中时派发排队脚本（`sub_40FB60` = emulator 未建模的脚本队列 → no-op）。
 * - `0x261`/`0x2DB`… 同族见 `ENGINE_FIELD_STORE`；`0x20C`（sub_41A1A0, raw 25259）**每帧**刷时钟 +
 *   调绘制容器的 `sub_4B4040`（帧刷新）——emulator 的渲染帧循环已自行 present，故 `sub_4B4040` 无需复刻。
 */
const op_frame_tick: OpHandler = (c) => {
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
 * `0x1F5`（sub_41A0E0）：帧倒计到 0 → 清**帧计时停靠锁**（`_this[107438]`）。
 *
 * ★T-0057 R3 修正：raw 的 `*(_DWORD *)(_this + 429756)` 是**字节**偏移 ⇒ dword 下标 = `429756/4 = 107439`，
 * 与 `0x1F4`（`sub_41A090` 的 `_this[107439]/[107438]`）**是同一对字段**。此前把字节偏移当
 * `engineValues` 的键，结果是"帧计数只增不减 + 停靠锁永不释放 + 0x1F4 再不刷新时钟"（静默）。
 */
const op_frame_countdown: OpHandler = (c) => {
  const e = c.e;
  const left = e.engineValues.get(ENGINE_FIELD.frameCount) ?? 0;
  if (left > 0) {
    e.engineValues.set(ENGINE_FIELD.frameCount, left - 1);
  } else {
    e.engineValues.set(ENGINE_FIELD.frameTickLock, 0);
    // 引擎此处还会 `sub_40FB60(_this)` 派发脚本队列（`dispatch_in_progress` 为 0 时）——
    // emulator 的队列派发走 `dispatchNextRequest`（control.ts，`0x143` 的路径），本条尚未接线（T-0057 记录）。
  }
};

/** `0x20C`（sub_41A1A0, raw 25259）：每帧刷时钟 + `sub_4B4040(_this+80708)`（帧刷新）。 */
const op_frame_present: OpHandler = (c) => {
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
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.clockPrev, e.engineValues.get(ENGINE_FIELD.clock) ?? 0);
  e.engineValues.set(ENGINE_FIELD.clock, e.nowMs | 0);
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
  const e = c.e;
  e.engineValues.set(ENGINE_FIELD.rewindMainBase + e.cur, readIntOperand(e, c.frame, c.instr, 1));
  e.engineValues.set(ENGINE_FIELD.rewindAltBase + e.cur, readIntOperand(e, c.frame, c.instr, 2));
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
 * `0xAE`（`sub_4192F0` raw 24634-24773）：**存档版本分支** —— 读档时把当前帧的 ip 重算到
 * 存档记录的位置，然后切帧/装载。
 *
 * 引擎形状（三段几乎同构，只有**步长与槽位**不同）：
 * ```c
 * if (!_this[95780]) return;                    // ★门控：只有读档流程置 1
 * sv1 = GetConfig("set:SaveVersion1"); sv2 = GetConfig("set:SaveVersion2");
 * // sv1==1 && sv2==20 → 263*cur 槽位组；sv1==2 → 261*cur 组；sv1==3 → 261*cur 另一组
 * v = _this[stride*cur + A];                    // A = 130199 / 141030 / 156783（"存档侧下标"）
 * if (v >= 0)     ip = *(base + 4*_this[30*cur+95800] + 4*v)   // 正下标 → 用 95800 那张表
 * else if (w>=0)  ip = *(base + 4*_this[30*cur+95798] + 4*w)   // 负下标 → 用 95798 那张表（w = A-1 槽）
 * _this[30*cur+95782] = _this[30*cur+95781] + 4*ip;            // 帧 ip
 * _this[30*cur+95803/95804] = 已执行指令记数（版本 2/3 才有）
 * if (cur == _this[savedCurSlot]) { _this[95776] = savedCur; _this[95777] = savedRet; _this[95780] = 0; [v2: _this[97054]=1] }
 * else { _this[95777] = cur; _this[95776] = cur + 1; return sub_40F750(_this, mode, sv2); }
 * ```
 * `95780` = 帧 0 的 `+0x10`（"正在读档"标志）；`sub_40F750(Engine, mode, ver)` = 装载/初始化目标帧的脚本。
 *
 * **emulator 的取舍（明确记录，不假装实现）**：
 *  - **门控路径（`95780 == 0`）与引擎完全一致** —— 这也是唯一在真机上可达的路径
 *    （语料 `iae` **0 处**；只有读档流程才会把门置 1）；
 *  - 置位后的分支需要**存档侧的两张 ip 指针表**（`[30*cur+95798]/[95800]` 指向的数组）与
 *    `sub_40F750` 的帧装载，而 emulator **尚无读档装载**（不读存档里的帧 ip 表）⇒ 这里只做
 *    「按版本选组 → 判定是否已回到存档帧 → 清门」这一层，**帧 ip 重算与帧装载记为缺口并写日志**。
 *    一旦将来实现读档装载，补上的是这两处（槽位常量已在下面列出）。
 */
const SAVE_VERSION_BRANCH: Record<number, { stride: number; idxSlot: number; savedCur: number; savedRet: number; mode: number; setLoadFlag?: boolean; sv2?: number }> = {
  // sv1=1 且 sv2=20
  1: { stride: 263, idxSlot: 130199, savedCur: 129624, savedRet: 129625, mode: 1, sv2: 20 },
  // sv1=2
  2: { stride: 261, idxSlot: 141030, savedCur: 140457, savedRet: 140458, mode: 2, setLoadFlag: true },
  // sv1=3
  3: { stride: 261, idxSlot: 156783, savedCur: 151210, savedRet: 151211, mode: 3 },
};

const op_save_version_branch: OpHandler = (c) => {
  const e = c.e;
  if ((e.engineValues.get(ENGINE_FIELD.loadInProgress) ?? 0) === 0) return; // 非读档流程：引擎在此直接返回
  const sv1 = e.config ? cfgInt(e.config, CFG.setSaveVersion1, 0) : 0;
  const sv2 = e.config ? cfgInt(e.config, CFG.setSaveVersion2, 0) : 0;
  const spec = SAVE_VERSION_BRANCH[sv1];
  if (!spec || (spec.sv2 !== undefined && sv2 !== spec.sv2)) return;
  const cur = e.cur;
  const savedCur = e.engineValues.get(spec.savedCur) ?? -1;
  if (savedCur === cur) {
    // 引擎：已回到存档记录的帧 ⇒ 收尾（清读档门；版本 2 还会置 97054=1）
    e.engineValues.set(ENGINE_FIELD.callRet, e.engineValues.get(spec.savedRet) ?? 0);
    e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
    if (spec.setLoadFlag) e.engineValues.set(ENGINE_FIELD.loadDoneFlag, 1);
    return;
  }
  c.log(
    `0xAE: 读档版本分支 sv1=${sv1}/sv2=${sv2}（slot ${spec.stride}*${cur}+${spec.idxSlot}）—— ` +
      `存档 ip 指针表与帧装载未建模，帧 ip 重算/切帧跳过（缺口已登记）`,
  );
};

/** 帧计时/时钟 + sleep/等待门 + 文本重显示/存档版本分支（真实现；native.frameTick 转发）。 */
export const FRAME_OPS: OpTable = [
  [0x1f4, op_frame_tick], // 帧计时（+帧计数 / 刷时钟）
  [0x1f5, op_frame_countdown], // 帧倒计 → 清帧计时停靠锁（脚本队列派发未接线，见 T-0057）
  [0x20c, op_frame_present], // 每帧刷时钟 + native.frameTick()
  [0x23c, op_frame_clock], // 帧毫秒时钟（timeGetTime → ENGINE_FIELD.clock/clockPrev）
  [0x7b, op_set_rewind_cursor], // 设本帧「重显示」回退游标（rewindMainBase/rewindAltBase，值为 dword 偏移）
  [0x199, op_redisplay_text], // ★重显示文本（0x7B 的读取端；668 处，原先命中即硬报错）
  [0xae, op_save_version_branch], // 存档版本分支（门控 loadInProgress；帧 ip 重算=已登记缺口）
];

/** 帧让步 / 等待门（native 转发）。 */
export const FRAME_NATIVE_OPS: OpTable = [
  [0xc8, op_sleep], // → native.sleep + SLEEP_GATE 帧让步
  [0x21c, op_set_wait_flag], // → native.setWaitFlag（0x400 等待门）
];

