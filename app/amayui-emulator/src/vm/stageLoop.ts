/**
 * **阶梯动画调度器（staged stepper）** —— `0xD3` / `0xD4` / `0xD5` 三个指令的引擎侧状态。
 *
 * ## 它是什么
 *
 * 这三个指令合起来是一段**"按时间表分多次执行同一段代码"**的小语言：脚本先声明一张
 * 「时刻 → 入口 label」表，然后由**主循环**在每次到点时把 `pc` 直接指到表里那个 label 上
 * （脚本体跑完 `ret` 回到 `i0d5` 自身，于是循环继续），全部条目走完脚本才往下走。
 * 引擎用它做**逐帧阶梯动画**：存档列表滚动（`SAVE`）、回想列表缓动（`HISTORY`）、
 * 战斗单位入场与经验条（`BTL` / `ADDEXP`）。
 *
 * ```
 * i0d3                                            ; ① 清空时间表
 * i0d4 <step> <count> <body> <tail>               ; ② 追加 count 个条目，时刻依次 +step（累计）
 * i0d4 ...                                        ;    （可多次，时刻在上一条之后继续累计）
 * i0d5 <exitLabel>                                ; ③ 起表（记 t0 = now）+ 排序 + 置 0x40 门；本指令不前进
 * ...
 * body:  <要做的事>                                ; 由主循环到点派发
 * tail:  <落后于时间表时改走这里（省掉 body 的重活，只做收尾）>
 * ```
 *
 * ## 引擎侧证据（`engine/天结_unpacked.exe_utf8.c`）
 *
 * | 位置 | 作用 |
 * |---|---|
 * | `sub_42AC40` raw 36668（`0xD3`，argc 0） | 清表：`cursor=-1`、`index=0`、`exitLabel=-1`、`begin==end` |
 * | `sub_42E940` raw 38801（`0xD4`，argc 4） | 追加 `op2` 个条目 `{t = 上一条 + op1, 100, op3, op4}`（时刻**累计**） |
 * | `sub_42ACC0` raw 36689（`0xD5`，argc 1） | `index==0` ⇒ 记 `exitLabel=op1`、`sub_453A90` 起计时、`sub_42A180` 排序；`index < cursor` ⇒ 置 `0x40` 门 + **不前进**，否则正常前进 |
 * | **`sub_408F10` raw 13612-13684** | **消费者**（主循环 raw 21154-21156 在 `flags & 0x40` 时每遍调它）：到点 ⇒ 清 `0x40` + `pc = ip_base + 4*条目 label`；未到点 ⇒ 本遍什么都不派发 |
 * | `sub_405360` raw 11031 | 压返回点（`a2 + ((ip-ip_base)>>2)`）—— 调度器压的是 **`i0d5` 自身**的偏移，脚本体 `ret` 回到 `i0d5` |
 * | `sub_453A90` raw 66115 / `sub_453BB0` raw 66215 | 计时器：起点 = `timeGetTime()`，读 = `now - 起点`（**ms**） |
 *
 * ## 两条容易搞错的口径（都按 raw 逐行核对过）
 *
 * 1. **派发次数 = 条目数 − 1**。`i0d5` 的"还要不要等"判据是 `index < cursor`，而 `cursor`
 *    是追加时的**写游标**（= 条目数 − 1）⇒ 当 `index` 走到 `cursor` 时脚本就往下走了。
 *    语料正合此意：`HISTORY` 写 `4 + 1 + 2 = 7` 个条目，实际派发 **6** 次
 *    （`local 492` 从 0 数到 5 再 `div …,5` 做缓动 ⇒ 取样点 0..5 正好 6 个）。
 *    ⇒ 脚本里那个"最后一项"是**收尾哨兵**，它只负责让 `i0d5` 的判据在正确的时刻失效。
 * 2. **"到点" = `now - t0 >= t`**（而不是 `t - now < 50`）。引擎的 `Sleep(v6)` 会把时钟
 *    **精确推到**目标时刻再派发（`v6 >= 50` 只是"一次别睡太久"的分段），所以净效果 =
 *    等到目标时刻才派发。emulator 的帧粒度下无法睡，等价做法就是"帧时钟到点才算到"。
 *    `v6 ∈ (0,50)` 那一档在 emulator 里表现为**至多多等一帧**。
 *
 * ## "落后"入口（`tail`）的选择
 *
 * `sub_408F10` raw 13656-13658：`behind = (还有下一条) && (下一条.t - 已过时间 < 0)`，
 * 命中 ⇒ 走条目的第 4 个操作数（`tail`）而不是第 3 个（`body`）。
 * 语料里的形态正是"重活 + 轻收尾"：`HISTORY` 的 `body` = `call tail; call label_3d0c; ret`，
 * `tail` = 推进计数 + 重排列表 ⇒ 掉帧时跳过 `label_3d0c` 那一遍，只把计数追上。
 */
import type { Engine } from './engine.js';

/**
 * **`effect_flags`（引擎 `_this[174801]`）里的阶梯动画门**（`0x40`）。
 *
 * 与 `0x400`（动画等待门）是**两个独立的门**：主循环先 `while (flags & 0x400)` 等池子里的窗，
 * 再 `if (flags & 0x40) sub_408F10()` 推进阶梯时间表（raw 21109-21156）。
 */
export const STAGE_GATE = 0x40;

/** 时间表里的一个条目（引擎 16B 记录 `{dword0 = 时刻, dword1 = 100, dword2 = body, dword3 = tail}`）。 */
export interface StageEntry {
  /** 目标时刻（ms，相对 `t0`）。引擎记录的 `dword0`。 */
  t: number;
  /** 到点执行的入口（**label = dword 偏移**，与 `jmp`/`call` 同尺度）。引擎 `dword2` = `0xD4` 的 op3。 */
  body: number;
  /** "已经落后于时间表"时改用的入口。引擎 `dword3` = `0xD4` 的 op4。 */
  tail: number;
}

/** 一次到点派发（`sub_408F10` 选中了哪一条、走哪个入口）。 */
export interface StageStep {
  /** 条目下标（0-based）。 */
  index: number;
  /** 要跳到的 label（dword 偏移）。 */
  label: number;
  /** 是否走了"落后"入口（`tail`）。 */
  behind: boolean;
}

/**
 * 阶梯时间表的**全部状态**（引擎里是散在 `_this` 上的五格 + 一个 `std::vector`）：
 * `430688`（写游标）/ `430692`（当前下标）/ `430668`（打断 label）/ `430672..430684`（向量三指针）
 * / `430704`·`430708`（起表时的脚本身份，用于 `sub_408F10` 的 `Depth が不正です` 校验）。
 */
export class StageLoop {
  /** 条目表（引擎 `std::vector`，按时刻升序）。 */
  entries: StageEntry[] = [];
  /** 写游标 = 条目数 − 1（引擎 `_this[107672]` = byte `430688`）。 */
  cursor = -1;
  /** 当前派发下标（引擎 `_this[107673]` = byte `430692`）。 */
  index = 0;
  /** 计时器起点 ms（引擎 `sub_453A90` 写 `timeGetTime()`）。 */
  t0 = 0;
  /** 输入打断目标（`0xD5` 的 op1；-1 = 不打断）。引擎 byte `430668`。 */
  exitLabel = -1;
  /** 起表时的当前帧号与脚本身份（引擎 `430708` = `frames[cur][95796]`）。 */
  cur = -1;
  scriptId = -1;
  /** `i0d5` 指令**自身**的 dword 偏移 —— 调度器压的返回点，脚本体 `ret` 回到它（引擎 `sub_405360(_this, 0)`）。 */
  resumeDword = -1;

  /** `0xD3`：清表（raw 36673-36677）。**不动** `effectFlags` 的门。 */
  reset(): void {
    this.entries.length = 0;
    this.cursor = -1;
    this.index = 0;
    this.exitLabel = -1;
    this.resumeDword = -1;
  }

  /**
   * `0xD4`：追加 `count` 个条目，时刻从**上一条**继续累计 `step`（raw 38838-38902）。
   *
   * 时刻基：表为空时第一条 = `step`（引擎的 `v2` 初值 0 ⇒ `t = 0 + op1`）。
   * `count <= 0` ⇒ 什么都不加（引擎的 `while` 在 `v20 >= result` 时立刻退出）。
   */
  add(step: number, count: number, body: number, tail: number): void {
    let t = this.entries.length > 0 ? this.entries[this.entries.length - 1]!.t : 0;
    for (let k = 0; k < count; k++) {
      t += step;
      this.entries.push({ t, body, tail });
      this.cursor++;
    }
  }

  /** `0xD5` 的起表段（**只在 `index === 0` 时调**，对齐引擎的 `if (!_this[430692])`）。 */
  begin(nowMs: number, exitLabel: number, cur: number, scriptId: number, resumeDword: number): void {
    this.exitLabel = exitLabel;
    this.t0 = nowMs;
    // 引擎 `sub_42A180`（raw 36711）= introsort，按记录 `dword0`（时刻）升序。
    // 追加本来就按升序发生 ⇒ 稳定排序下是恒等变换，这里保留它作为口径记录。
    this.entries.sort((a, b) => a.t - b.t);
    this.cur = cur;
    this.scriptId = scriptId;
    this.resumeDword = resumeDword;
  }

  /**
   * `0xD5` 的判定段：`true` = 还有条目 ⇒ 引擎置 `0x40` 门并**不让 `pc` 前进**（`95805 = 0`）；
   * `false` = 表已跑完 ⇒ 正常前进（`95805 = 3`），脚本继续往下走。
   */
  shouldWait(): boolean {
    return this.index < this.cursor;
  }

  /**
   * `sub_408F10` 的调度判定：**到点**返回该派发的条目（并消费它，引擎在此 `++_this[430692]`），
   * 未到点返回 `null`（引擎 `Sleep(v6)` 后返回，本遍什么都不派发）。
   *
   * @param ignoreTime headless/tracer 档：不做时间判定（恒"到点"），每帧推进一步。
   */
  nextStep(nowMs: number, ignoreTime = false): StageStep | null {
    const idx = this.index;
    const e = this.entries[idx];
    if (!e) return null;
    const elapsed = nowMs - this.t0;
    if (!ignoreTime && e.t - elapsed > 0) return null;
    const next = this.entries[idx + 1];
    const behind = next !== undefined && next.t - elapsed < 0;
    this.index = idx + 1;
    return { index: idx, label: behind ? e.tail : e.body, behind };
  }

  /** `sub_408F10` 的 `Depth が不正です` 校验（raw 13660-13669）：时间表必须还属于起表的那个脚本。 */
  ownedBy(cur: number, scriptId: number): boolean {
    return this.cur === cur && this.scriptId === scriptId;
  }
}

/**
 * **阶梯动画调度服务**（引擎 `sub_408F10`）。
 *
 * 顺序逐行对齐 raw 13612-13684：① 先刷输入（`sub_478090` 消费刷 + `*v2 = 0`；有输入且登记了
 * `exitLabel` 时把 `pc` 指到它并清门）→ ② 再看时间表到没到点（未到点 ⇒ 本遍直接返回，
 * 门保持置位 ⇒ **本帧任何脚本指令都不派发**）。
 *
 * @returns `true` = 本帧可以派发（门已清、`pc` 已就位）；`false` = 本帧什么都不派发。
 */
export function runStageService(e: Engine, nowMs: number, ignoreTime = false): boolean {
  const s = e.stage;
  const frame = e.curScript();

  // ① 输入刷（引擎 raw 13626-13639）。★`exitLabel` 在**全语料 7/7 处都是 -1**（`i0d5 ffffffff`）
  //    ⇒ 这一支是防御性的，正常路径只表现为"阶梯动画期间挂起输入被消费掉"。
  const mask = e.input.flushPending(); // = `sub_478090`（消费刷：只吃挂起事件，读后由 consumeEdges 清）
  e.input.consumeEdges();
  let aborted = false;
  if (mask !== 0 && s.exitLabel !== -1) {
    const p = frame.labelMap.get(s.exitLabel);
    if (p !== undefined) {
      frame.ip = p;
      e.effectFlags &= ~STAGE_GATE;
      aborted = true;
    }
  }

  // ② 时间表（引擎 raw 13641-13683）。
  if (s.resumeDword < 0) {
    // 门被置位却没有起过表（引擎里不可能：`0x40` 只由 `0xD5` 置）⇒ 清门放行，**绝不**让本帧空转到卡死。
    e.native.log('[stage] `0x40` 门置位但时间表未起（无 i0d5）⇒ 清门放行');
    e.effectFlags &= ~STAGE_GATE;
    return aborted;
  }
  const step = s.nextStep(nowMs, ignoreTime);
  if (!step) return aborted; // 未到点：门仍置位 ⇒ 本帧不派发

  // 脚本身份守卫（引擎 raw 13660-13669：`Depth が不正です %s != %s` + 抛 Command_ShowMessage）。
  // 引擎会弹框并中止；emulator 选择"记一行日志 + 放弃这张表"（不把异常抛进会话）。
  if (!s.ownedBy(e.cur, frame.scriptId)) {
    e.native.log(
      `[stage] 脚本已切换（起表 cur=${s.cur}/id=${s.scriptId}，现在 cur=${e.cur}/id=${frame.scriptId}）⇒ 放弃时间表（引擎此处抛 Depth が不正です）`,
    );
    e.effectFlags &= ~STAGE_GATE;
    return aborted;
  }

  const p = step.label === -1 || step.label === 0xffffffff ? null : (frame.labelMap.get(step.label) ?? null);
  if (p === null) {
    // 引擎对 `label == -1` 的条目只 `++index` 而**不清门**（raw 13658 的 `!= -1` 守卫把整段跳过）
    // —— 那会让主循环空转；emulator 改为"消费该条目并放行这一帧"，避免挂死（语料无此形态）。
    e.native.log(`[stage] 条目 ${step.index} 的 label 0x${(step.label >>> 0).toString(16)} 无法解析 ⇒ 跳过`);
    e.effectFlags &= ~STAGE_GATE;
    return aborted;
  }

  // `sub_405360(_this, 0)`：压**当前 ip**（= `i0d5` 自身，因为它没前进）⇒ 脚本体 `ret` 回到 `i0d5`。
  frame.retStack.push(s.resumeDword);
  frame.ip = p;
  e.effectFlags &= ~STAGE_GATE;
  return true;
}
