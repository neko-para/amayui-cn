/**
 * **眨眼链（L2D 实例 `+16` `EyeBlinkMotion` 与 `+23` 门控）** —— `sub_4783D0` 的
 * `if ( *((_BYTE*)_this + 23) ) sub_4BC550(_this[4], *_this);` 这一支的直译。
 *
 * ## 为什么单独一个模块
 * 这一支与动作队列（`+12` 的 MotionQueueManager）**互相独立**：它在 `if (+21/+22)` 那个块
 * **之外**（raw 92605 与 raw 92586 是同级 `if`）⇒ 没有动作装载时它照样每帧跑。`mtn.ts`
 * 是动作那一半，这里放眨眼那一半，`runtime.ts` 的 `l2dAdvance` 按引擎的次序把两者串起来。
 *
 * ## 逐环 raw（`engine/天结_unpacked.exe_utf8.c`）
 * | 环节 | 事实 | raw |
 * |---|---|---|
 * | 对象 | `sub_478270` 构造实例：`sub_4BC380(104)` → `sub_4BC3E0` ⇒ **`live2d::EyeBlinkMotion`**（vftable 见 `.lst` `.data:0052E30C`），指针落实例 `+16` | 92540-92545 |
 * | 缺省参数 | `+84 = 4000`（眨眼间隔上界）、`+88 = 100`（闭眼时长）、`+92 = 50`（闭合保持）、`+96 = 150`（睁眼时长）、`+32 = 1` | 143008-143013 |
 * | 参数名 | `sub_4BF510(…, aParamEyeLOpen)` / `(…, aParamEyeROpen)` ⇒ `PARAM_EYE_L_OPEN` / `PARAM_EYE_R_OPEN` | 143014-143015 / `.data:0052E2E0`、`.data:0052E2F4` |
 * | 调度 | `+8 = clock() + rand() * dbl_52E310 * (2*+84 - 1)`，`dbl_52E310 = 0.00003051850947599719 = 1/32767`（`.data:0052E310`）⇒ 下次眨眼在 `[now, now+2*4000]` ms；重排走 `sub_4BC500`（用 `+84` 那一格 = 同样 4000） | 143113-143116 / 143031-143037 |
 * | 状态机 | `+16`：`0`（或任何其它值）⇒ `+16 = 1` + 排期；`1` ⇒ 到点 ⇒ `+16 = 2`；`2` ⇒ `w = 1 - elapsed/+88`，`>= 1` ⇒ `+16 = 3`；`3` ⇒ `elapsed/+92 >= 1` ⇒ `+16 = 4`，`w = 0`；`4` ⇒ `w = elapsed/+96`，`>= 1` ⇒ `+16 = 1` + `sub_4BC500` 重排 | 143061-143121 |
 * | 写回 | `sub_4BD490(model, 参数名, w, 1.0)` 与 `(…, `+32` 决定是否取负的 w, 1.0)`；`sub_4BD3E0` 的 `a4 == 1.0` 支是**直接赋值**（`sub_4C43D0`），否则 `(1-a4)*现价 + a4*目标` | 143123-143131 / 143791-143801 |
 * | 时间源 | `sub_4BF8D0` = `clock()`（毫秒 `clock_t`）—— **不是** `$fps` 帧计数，也**不是** `nowMs` 之外的东西 | 145679-145687 |
 *
 * ## ★`+23` 的极性与来源（读体结论；`tickets/T-0166`，见 `tickets/T-0166/changes-c166-blink.md` §2）
 * - **极性 = 非 0 即真**：反汇编 `.lst` `00478429 cmp byte ptr [esi+17h], 0` / `0047842D jz short loc_47843A`
 *   ⇒ **只有等于 0 才跳过**（`_this + 0x17` = 字节 `+23`）。
 * - **来源 = 没有写者，而且构造时被显式清 0**：
 *   ① `.lst` 的 `sub_478270` 结尾逐句是 `mov [esi+14h], bl`（`+20`）、`mov [esi+15h], ebx`（`+21..+24`）、
 *      `mov [esi+19h], bl`（`+25`）、`mov [esi+1Ch], ebx`（`+28/+32`），其中 `ebx = 0`
 *      （`00478297 xor ebx, ebx`）⇒ **`+22`/`+23`/`+24` 被那条 dword 存一并清 0**；
 *      ★这一点 Hex-Rays 的 `_DWORD` 视图**看不出来**（只渲染成 `+21 = 0; +25 = 0; +28 = 0; +32 = 0`，
 *      `+23` 整个消失）—— 只读 `.c` 会误以为它是未初始化堆字节。
 *   ② 此后**没有任何写者**：全 `.c` 的 `*((_BYTE *)_this + 23) = ` ⇒ **0 命中**（仅 `sub_4D7320`
 *      raw 165535 的 `*(_BYTE*)(*a2+23)` 是**别的对象**）；`.lst` 全库 `byte ptr […+13h]` ⇒ **1 处**
 *      （`004D71D5`，同属 `sub_4D7320`）；`0x352` 预置的 `sub_478540`/`sub_478560` 写的是 `+24`/`+25`
 *      （raw 92684/92698），也**不碰** `+23`。
 *   ⇒ 随包二进制里这一支**恒不执行**（门永久为 0），不是"可能碰上垃圾值"。
 *
 * ### 因此本模块的口径（诚实登记）
 * 1. **状态机按体建模**：数值、转移条件、参数名、写回强度都逐句对齐，`+23` 打开时**可独立推进**；
 * 2. **门控缺省关**（`L2dInstance.blinkEnabled = false`）—— 那不是"没做完"，那是**引擎的实际运行行为**
 *    （构造器 `mov [esi+15h], ebx` 把 `+23` 清 0，此后无写者 ⇒ 门恒 0）。把它默认打开才是**编模型**；
 * 3. **近似（登记）**：`sub_4BD3E0` 对 `a4 == 1.0` 走的是"直接赋值 + 参数存在性下发（`sub_4C43D0`）"，
 *    而本仓既有约定（`mtn.ts` 的 `advanceMotion` / `runtime.l2dSetNamedParam`）是"写 `inst.params` 的
 *    Map，渲染侧 `evaluateModel` 再读" ⇒ 这里只**返回强度**，由调用方按既有约定写表。
 *    引擎对**模型里没有该参数**的情形不做检查（`sub_4C4FD0` 返回 -1 后 `sub_4BD3E0` 不判边界），
 *    emulator 侧退化为"写进 Map 但没人读"（不崩、不注入）—— 见本文件 §做不到的 与 changes §5。
 */

/** 眨眼写入的参数名（raw 143014-143015 的 `aParamEyeLOpen`/`aParamEyeROpen`）。 */
export const BLINK_PARAM_L = 'PARAM_EYE_L_OPEN';
export const BLINK_PARAM_R = 'PARAM_EYE_R_OPEN';

/** 可配置参数的名字（字段名 → 引擎实例偏移），只为可读性与守卫用。 */
export const BLINK_FIELDS = {
  /** `+16` 状态机当前值（0/未初始化 ⇒ 落到 idle）。 */
  state: '+16',
  /** `+84`：眨眼间隔（= 随机上界 `2*+84`）。 */
  intervalMs: '+84',
  /** `+88`：闭眼时长（ms）。 */
  closingMs: '+88',
  /** `+92`：闭合保持时长（ms）。 */
  holdingMs: '+92',
  /** `+96`：睁眼时长（ms）。 */
  openingMs: '+96',
  /** `+32`：右眼是否取负（构造为 1）。 */
  randomize: '+32',
  /** `+8`：下次眨眼时刻（`sub_4BF8D0()` 的 clock 值 + 抖动）。 */
  nextBlinkAtMs: '+8',
} as const;

/**
 * **随包引擎的缺省参数**（`sub_4BC3E0` raw 143009-143013）。
 *
 * ★这四个数不是"我们挑的"：`4000/100/50/150` 逐字来自构造器，`randomize: 1` 也是。
 * 也**没有**任何 `0x34x` 指令能改它们（实例表里没有到 `+16` 子对象的通道）。
 */
export const BLINK_DEFAULTS = {
  intervalMs: 4000, // `+84`（raw 143009）
  closingMs: 100, // `+88`（raw 143010）
  holdingMs: 50, // `+92`（raw 143011）
  openingMs: 150, // `+96`（raw 143012）
  randomize: true, // `+32 = 1`（raw 143013）
} as const;

/**
 * `dbl_52E310`（`.lst` `.data:0052E310` 的 `dq 0.00003051850947599719`）= **恰好 `1/32767`**
 * （= MSVC `RAND_MAX`），**不是** `2^-15`（两者差 9.3e-10，肉眼与"约等于"都会误判；
 * 这是把 `rand() ∈ [0, 32767]` 归一化成 `[0, 1]` 的那一格）。
 *
 * ⇒ `rand() * dbl_52E310 * (2*interval - 1)` 是 `[0, 2*interval - 1]` 的抖动（raw 143115-143116 / 143035-143036）。
 */
export const BLINK_RAND_SCALE = 1 / 32767;

/** `+16` 的状态（引擎里的 `_DWORD`，取值 0..4；0 = 未初始化，落到 idle 支）。 */
export type BlinkMode = 'idle' | 'closing' | 'holding' | 'opening';

/** 引擎 `+16` 状态值的字面量（守卫/诊断用；`idle` 对应 1）。 */
export const BLINK_MODE_VALUE: Record<BlinkMode, number> = { idle: 1, closing: 2, holding: 3, opening: 4 };

/** 眨眼运动态（引擎 `+16` 的 104 字节对象里对行为有影响的那部分）。 */
export interface BlinkMotion {
  /** `+16` 的状态。 */
  mode: BlinkMode;
  /**
   * `+8`：下次眨眼时刻（clock ms）。
   *
   * ★时钟域 = **`clock()` 毫秒**，由调用方（`l2dAdvance`）用帧 delta 累计后传入；
   * 与 `$fps`（动作曲线的采样间隔）**无关** —— 动作走 `$fps`，眨眼走真实时间。
   */
  nextBlinkAtMs: number;
  /** 进入当前状态时的 clock（引擎每转一次状态就把 `clock` 存进 `+24`）。 */
  enteredAtMs: number;
  /** `+84`。 */
  intervalMs: number;
  /** `+88`。 */
  closingMs: number;
  /** `+92`。 */
  holdingMs: number;
  /** `+96`。 */
  openingMs: number;
  /** `+32`：右眼强度是否取负（构造为 1）。 */
  negateRight: boolean;
}

/** 建一份缺省眨眼态（= `sub_4BC3E0` 的四个数 + `+32`）。 */
export function newBlinkMotion(): BlinkMotion {
  return {
    mode: 'idle', // `+16 = 0` ⇒ 第一次推进走"排期"支（raw 143112-143113）
    // `+8`：构造器**不写**它（引擎里是未初始化堆字节）。这里取 0 ⇒ "第一拍就到点"，
    // 与引擎 `clock()` 从进程启动算起的实际取值同向（第一次推进时 `clock()` 远大于 0）。
    // ★这一格是**近似**：真值在随包二进制里无法静态判定，而且门 `+23` 恒 0 ⇒ 永不参与（见文件头）。
    nextBlinkAtMs: 0,
    enteredAtMs: 0, // `+24`（构造不写 ⇒ 0）
    intervalMs: BLINK_DEFAULTS.intervalMs,
    closingMs: BLINK_DEFAULTS.closingMs,
    holdingMs: BLINK_DEFAULTS.holdingMs,
    openingMs: BLINK_DEFAULTS.openingMs,
    negateRight: BLINK_DEFAULTS.randomize,
  };
}

/** 随机源：返回 `[0,1]`（引擎那份是 `rand() * (1/32767)`）。缺省 `Math.random`。 */
export type BlinkRng = () => number;

/**
 * `rand() * (1/32767) * (2*interval - 1)`（raw 143115-143116 / 143035-143036 的直译）。
 *
 * @returns `[0, 2*interval - 1]` 的毫秒抖动。
 */
export function blinkJitter(intervalMs: number, rng: BlinkRng): number {
  // 引擎：`(double)rand() * dbl_52E310` ⇒ 归一化到 [0,1]（含 1，因为 dbl_52E310 = 1/32767）；
  // `(double)(2*interval - 1)` 是宽度。
  return rng() * BLINK_RAND_SCALE * (2 * intervalMs - 1);
}

/**
 * **推进眨眼一拍**（= `sub_4BC550(实例 +16, 模型)`；raw 143041-143132）。
 *
 * @param nowMs 引擎时钟（`sub_4BF8D0()` = `clock()` 毫秒）。状态机与排期都用它。
 * @param rng   随机源（`rand() * (1/32767)`）。缺省 `Math.random`。
 * @returns 左眼的写回强度 `w`（**总是数值**：`1.0` 表示"本拍把参数写成它自己的满分"，
 *          即引擎 `LABEL_14` / `default` 支那两格 `v7 = 1.0; v6 = 1.0`，raw 143118-143119）。
 *          右眼强度 = `motion.negateRight ? -w : w`（raw 143123-143131）。
 */
export function blinkStep(motion: BlinkMotion, nowMs: number, rng: BlinkRng = Math.random): number | undefined {
  switch (motion.mode) {
    case 'closing': {
      // `case 2`（raw 143071-143083）：`v5 = (clock - +24)/+88`；`v5 >= 1.0` ⇒ `+16 = 3` + `+24 = clock`
      // 且 `v5 = 1.0`（raw 143076-143079）⇒ **w = 1 - v5 = 0**，与"当拍状态转换"无关，照常返回数值。
      let elapsed = nowMs - motion.enteredAtMs;
      if (elapsed / motion.closingMs >= 1) {
        motion.mode = 'holding';
        motion.enteredAtMs = nowMs;
        elapsed = motion.closingMs; // `v5 = 1.0`（raw 143079）
      }
      return 1 - elapsed / motion.closingMs;
    }
    case 'holding': {
      // `case 3`（raw 143084-143097）：`v8 = elapsed/+92`；`> 1.0 || == 1.0` ⇒ `+16 = 4` + `+24 = clock`，
      // 但 **`v6 = 0.0` 是这一支的唯一输出**（raw 143096）⇒ 转不转都返回 0。
      const elapsed = nowMs - motion.enteredAtMs;
      if (elapsed / motion.holdingMs >= 1) {
        motion.mode = 'opening';
        motion.enteredAtMs = nowMs;
      }
      return 0;
    }
    case 'opening': {
      // `case 4`（raw 143098-143111）：`v11 = elapsed/+96`；`>= 1.0` ⇒ 回 `+16 = 1` 并 `sub_4BC500` 重排，
      // `v11 = 1.0`（raw 143104）⇒ w = 1.0。
      let elapsed = nowMs - motion.enteredAtMs;
      if (elapsed / motion.openingMs >= 1) {
        motion.mode = 'idle';
        motion.enteredAtMs = nowMs;
        motion.nextBlinkAtMs = nowMs + blinkJitter(motion.intervalMs, rng); // sub_4BC500（raw 143035-143036）
        elapsed = motion.openingMs; // `v11 = (float)1.0`（raw 143104）⇒ 夹住
      }
      return elapsed / motion.openingMs;
    }
    default: {
      // `default` / `case 0` / `case 1`（raw 143112-143120 的 fall-through）：这一支**输出 w = 1.0**
      // （`v7 = 1.0; v6 = 1.0`，raw 143118-143119）⇒ 等价于"本拍无覆盖"（把参数写成它自己的满分）。
      // ★引擎把"排下一次"放在 **`+16` 还是 0 的那一支**里，而 `+16 == 1` 走 `LABEL_14`（**不重排**）
      //   ⇒ 这里先按状态分流，再看"到点没有"（顺序陷阱，见 changes §2）。
      if (motion.mode !== 'idle') return 1; // LABEL_14：`v7 = 1.0; v6 = 1.0`（raw 143118-143119）
      if (nowMs >= motion.nextBlinkAtMs) {
        // `+16 = 2` + `+24 = clock()`（raw 143066-143068）；w 仍是 LABEL_14 的 1.0
        motion.mode = 'closing';
        motion.enteredAtMs = nowMs;
        return 1;
      }
      // 首次推进（`+16` 从没被写过）：`+16 = 1`，并排下一次（raw 143113-143116）
      motion.nextBlinkAtMs = nowMs + blinkJitter(motion.intervalMs, rng);
      return 1;
    }
  }
}
