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
import type { OpHandler } from '../step.js';
import { readIntOperand } from '../operand.js';
import { SLEEP_GATE } from '../engine.js';
import type { OpTable } from './shared.js';

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
  if (!e.engineValues.get(107438)) {
    e.engineValues.set(107438, 1);
    e.engineValues.set(92334, e.engineValues.get(92333) ?? 0);
    e.engineValues.set(92333, e.nowMs | 0);
  } else {
    e.engineValues.set(107439, (e.engineValues.get(107439) ?? 0) + 1);
  }
};

/** `0x1F5`（sub_41A0E0）：帧倒计到 0 → 清停靠标志（`_this[429752]=0`）；派发脚本队列（未建模 → no-op）。 */
const op_frame_countdown: OpHandler = (c) => {
  const e = c.e;
  const left = e.engineValues.get(429756) ?? 0;
  if (left > 0) {
    e.engineValues.set(429756, left - 1);
  } else {
    e.engineValues.set(429752, 0);
  }
};

/** `0x20C`（sub_41A1A0, raw 25259）：每帧刷时钟 + `sub_4B4040(_this+80708)`（帧刷新）。 */
const op_frame_present: OpHandler = (c) => {
  const e = c.e;
  if (!e.engineValues.get(107438)) {
    e.engineValues.set(92334, e.engineValues.get(92333) ?? 0);
    e.engineValues.set(92333, e.nowMs | 0);
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
  e.engineValues.set(92334, e.engineValues.get(92333) ?? 0);
  e.engineValues.set(92333, e.nowMs | 0);
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

/** 帧计时/时钟 + sleep/等待门（真实现；native.frameTick 转发）。 */
export const FRAME_OPS: OpTable = [
  [0x1f4, op_frame_tick], // 帧计时（+帧计数 / 刷时钟）
  [0x1f5, op_frame_countdown], // 帧倒计 → 清停靠标志（脚本队列派发未建模）
  [0x20c, op_frame_present], // 每帧刷时钟 + native.frameTick()
  [0x23c, op_frame_clock], // 帧毫秒时钟（timeGetTime → _this[92333]/[92334]）
];

/** 帧让步 / 等待门（native 转发）。 */
export const FRAME_NATIVE_OPS: OpTable = [
  [0xc8, op_sleep], // → native.sleep + SLEEP_GATE 帧让步
  [0x21c, op_set_wait_flag], // → native.setWaitFlag（0x400 等待门）
];

