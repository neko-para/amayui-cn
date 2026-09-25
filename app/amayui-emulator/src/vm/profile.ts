/**
 * **帧 / 指令计时器** —— 回答「界面上卡了 N 秒，时间到底花在哪」。
 *
 * ## 为什么要有它（起因）
 * 用户实测：存档界面从**第 80 页**（该页无存档）切到**第 90 页**（该页全是存档）时，
 * 有 ~4 s 的**同步阻塞**（界面不刷新）；而真机几乎是瞬时的。
 * 这类问题**读代码读不出来** —— 同一个"读槽头"在文件层实测只要 2 ms/次（见
 * `.tmp/perf/probe-readslot.mts` 的实测），所以 4 s 必然花在**别处**（帧循环/宿主/门控）。
 * ⇒ 需要一个**在真宿主里跑、按帧记账**的计时器，而不是靠推理。
 *
 * ## 两个层次，各自独立开关
 *  1. **帧看门狗**（`watch`，**默认开**）：每帧两次取时钟（代价可忽略），把
 *     "这一帧的**工作耗时**"与"距上一帧的**间隔**"分开记。
 *     ★这个区分是关键：工作耗时 = **主线程被占住**（界面当然不刷新）；间隔大而工作小 =
 *     **宿主没给我们帧**（rAF 被节流/后台标签页）——两者的修法完全不同。
 *     超阈值时打一行 `[perf] …` 到宿主日志（宿主日志本来就是给人看的诊断面）。
 *  2. **指令计时**（`op`，默认**关**）：按 opcode 累计 wall time / 次数 / 最坏一次。
 *     关了就是**零成本**（`beginOp` 只读一个布尔），开了才有 `performance.now()` 的开销。
 *
 * ## 与既有诊断面的关系（**不新开真源**）
 *  - 引擎态/画面/屏障各有自己的只读查询（`global`/`slot`/`barrier`/`capture`）；
 *    本模块补的是**时间**这一维，输出仍是"给人看的行"（与那些查询同形）。
 *  - `e.native.log` 是唯一出口（宿主日志）；**不碰 console、不碰 DOM、不碰 fs** ——
 *    于是 headless 与产品宿主都能用同一份实现（`T-0002`/`T-0057` 那类漂移的教训）。
 *
 * ## 纪律
 *  - **本模块不解释因果**，只报数：谁慢、慢多少、是"工作"还是"等帧"。判据留在票/文档里。
 *  - 慢帧记录**有上限**（`MAX_SLOW_FRAMES`），剩下的只累计条数 ⇒ 长卡顿不会把日志刷爆。
 */

/** 一条指令的累计统计。 */
export interface OpStat {
  op: number;
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

/** 一次慢帧记录。 */
export interface SlowFrame {
  frame: number;
  /** 本帧**工作**耗时（不含帧末等 rAF 的时间）。 */
  workMs: number;
  /** 距上一帧结束的间隔（≈ 等 rAF + 宿主节流）。 */
  gapMs: number;
  /** 本帧派发的指令数。 */
  steps: number;
  /** 本帧最慢的几条指令（只在指令计时开着时有值）。 */
  top: { op: number; name: string; count: number; ms: number }[];
  /** 本帧**宿主阶段**耗时（`stage()` 记账；降序）——「不在 opcode 里」的那部分就是从这里看。 */
  stages: { name: string; ms: number; n: number }[];
  /** 本帧的**计数器**（`count()`；如 `sprite.new` / `mesh.new` / `tex.upload`）。 */
  counters: { name: string; n: number }[];
}

/** 一个宿主阶段的累计统计（跨帧）。 */
export interface StageStat {
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

/**
 * 一条慢帧前**至少**要占多少工作耗时，才值得把阶段分解打进日志行（毫秒）。
 * 为什么不是"只要慢就印"：帧看门狗连 `gapMs` 超阈值也报（那是等帧，不是我们慢），
 * 而阶段分解只对"占住主线程"有意义 —— 否则每次 sleep 门都会刷一行没用的分解。
 */
const STAGE_LOG_MIN_MS = 50;

/** 最多留几条慢帧明细（其余只计数 —— 长卡顿不许把内存/日志刷爆）。 */
export const MAX_SLOW_FRAMES = 40;

/** 单调墙钟。★**不用** `e.nowMs`：那是宿主时钟，测试/工具里可以是合成时钟（`run.ts` 的 `clock`）。 */
function clockMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export class Profiler {
  #opOn = false;
  #watchOn = true;
  #slowMs = 200;
  #log: ((msg: string) => void) | null = null;
  /**
   * 时钟缝。
   * ★为什么要注入点：本类全部输出都是**时间**，用真时钟就写不出确定性断言
   * （只能写"小于多少"这种弱断言）；而"帧看门狗分不分得出两种慢"恰恰是要钉住的东西。
   * 注入后测试能把时钟捏在手里（与 `T-0175` ⑤ 的 `createTexture` 工厂同一条理由）。
   */
  #clock: () => number = clockMs;

  #stats = new Map<number, OpStat>();
  /** 本帧的指令累计（只在 `#opOn` 时非空）。 */
  #frameOps: Map<number, { name: string; count: number; ms: number }> | null = null;

  #frameStart = 0;
  #lastFrameEnd = 0;
  #stepsAtFrameStart = 0;

  #slow: SlowFrame[] = [];
  #slowSeen = 0;
  /** 日志出口已经抛过错了（只报一次，避免刷屏）。 */
  #logFailed = false;

  /** 跨帧的阶段累计（`stage()`）。 */
  #stageStats = new Map<string, StageStat>();
  /** 本帧的阶段累计（每次 `beginFrame` 清空）。 */
  #frameStages: Map<string, { ms: number; n: number }> | null = new Map();
  /** 本帧的计数器（`count()`；每次 `beginFrame` 清空）。 */
  #frameCounters: Map<string, number> | null = new Map();

  get opEnabled(): boolean {
    return this.#opOn;
  }

  get watchEnabled(): boolean {
    return this.#watchOn;
  }

  get slowThresholdMs(): number {
    return this.#slowMs;
  }

  /** 慢帧总条数（含被截断的）。 */
  get slowCount(): number {
    return this.#slowSeen;
  }

  /** 接宿主日志（帧循环每次 `beginFrame` 顺手带上 `e.native.log`）。 */
  attachLog(fn: ((msg: string) => void) | null): void {
    this.#log = fn;
  }

  /** 注入时钟（**测试/工具用**；缺省是真墙钟）。见 `#clock` 的说明。 */
  setClock(fn: (() => number) | null): void {
    this.#clock = fn ?? clockMs;
  }

  setOpEnabled(on: boolean): void {
    this.#opOn = on;
    if (!on) this.#frameOps = null;
  }

  setWatchEnabled(on: boolean): void {
    this.#watchOn = on;
  }

  setSlowThresholdMs(ms: number): void {
    this.#slowMs = Math.max(1, Math.floor(ms));
  }

  reset(): void {
    this.#stats.clear();
    this.#slow = [];
    this.#slowSeen = 0;
    this.#frameOps = null;
    this.#stageStats.clear();
    this.#frameStages = new Map();
    this.#frameCounters = new Map();
  }

  // -------------------------------------------------------------------------
  // 帧
  // -------------------------------------------------------------------------

  /**
   * 帧开始（`frame/loop.ts` 的帧首调用）。
   * @param steps 当前已派发指令数（用来算"本帧跑了几条"）。
   */
  beginFrame(steps: number): void {
    const t = this.#clock();
    this.#frameStart = t;
    this.#stepsAtFrameStart = steps;
    if (this.#opOn) this.#frameOps = new Map();
    this.#frameStages = new Map();
    this.#frameCounters = new Map();
  }

  /**
   * 帧末**工作结束**处调用（★必须在 `await host.yield()` **之前**：那之后的等待是"等帧"，不是"占住主线程"）。
   * 超阈值 ⇒ 打一行日志；返回本帧的记录（未超阈值返回 null）。
   */
  endFrame(frame: number, steps: number): SlowFrame | null {
    const t = this.#clock();
    const workMs = t - this.#frameStart;
    const gapMs = this.#lastFrameEnd === 0 ? 0 : this.#frameStart - this.#lastFrameEnd;
    this.#lastFrameEnd = t;
    const frameSteps = steps - this.#stepsAtFrameStart;
    const slow = this.#watchOn && (workMs > this.#slowMs || gapMs > this.#slowMs);
    const top = this.#frameOps
      ? [...this.#frameOps.entries()]
          .map(([op, v]) => ({ op, name: v.name, count: v.count, ms: v.ms }))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 5)
      : [];
    if (this.#opOn) this.#frameOps = null;
    const stages = this.#frameStageList();
    const counters = this.#frameCounterList();
    if (!slow) return null;

    const rec: SlowFrame = { frame, workMs, gapMs, steps: frameSteps, top, stages, counters };
    this.#slowSeen++;
    if (this.#slow.length < MAX_SLOW_FRAMES) this.#slow.push(rec);

    // ★措辞刻意把"占住主线程"与"宿主没给帧"分开：两者的修法完全不同。
    const kind =
      workMs > this.#slowMs
        ? `★本帧**占住主线程** ${workMs.toFixed(0)}ms`
        : `★距上一帧隔了 ${gapMs.toFixed(0)}ms 而本帧只干了 ${workMs.toFixed(0)}ms ⇒ **宿主没给帧**（rAF 被节流/后台？）`;
    const tops = top.length ? ` · 最慢指令 ${top.map((o) => `${opName(o.op)}×${o.count} ${o.ms.toFixed(1)}ms`).join(' ')}` : '';
    // ★阶段分解只在"真的占住主线程"时印（`STAGE_LOG_MIN_MS`）：`gapMs` 超阈值那类帧是"等帧"，
    //   印分解只会每次 sleep 门刷一行没用的东西。
    const stg =
      workMs >= STAGE_LOG_MIN_MS && stages.length
        ? ` · 宿主阶段 ${stages.slice(0, 6).map((s) => `${s.name} ${s.ms.toFixed(0)}ms×${s.n}`).join(' ')}` +
          (counters.length ? ` · 计数 ${counters.slice(0, 4).map((c) => `${c.name}=${c.n}`).join(' ')}` : '')
        : '';
    // ★**诊断绝不许把引擎搞坏**：日志出口是宿主给的，它自己可能还没准备好
    //   （实测：headless 链路工具里 `HeadlessScene.logs` 尚未初始化 ⇒ 一次 `push` 就把整条帧循环打断，
    //   28 条 E3/CONFIG1 测试全红）。这里咽掉并把原因说一次 —— 宁可少一行诊断，不可少一帧。
    try {
      this.#log?.(`[perf] 帧 #${frame}：${kind}（steps ${frameSteps}）${tops}${stg}`);
    } catch (err) {
      if (!this.#logFailed) {
        this.#logFailed = true;
        // eslint-disable-next-line no-console
        console.warn(`[perf] 日志出口抛错（已忽略，后续不再重试）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return rec;
  }

  // -------------------------------------------------------------------------
  // 指令
  // -------------------------------------------------------------------------

  /**
   * 指令开始计时。**关了就是零成本**：返回 0，`endOp` 会立刻返回。
   * ★返回值必须原样交给 `endOp`（不要自己算差值）。
   */
  beginOp(): number {
    return this.#opOn || this.#frameOps !== null ? this.#clock() : 0;
  }

  /** 指令结束记账。`t0 === 0`（未计时）⇒ 什么都不做。 */
  endOp(op: number, name: string, t0: number): void {
    if (t0 === 0) return;
    const ms = this.#clock() - t0;
    let s = this.#stats.get(op);
    if (!s) {
      s = { op, name, count: 0, totalMs: 0, maxMs: 0 };
      this.#stats.set(op, s);
    }
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    const f = this.#frameOps;
    if (f) {
      const e = f.get(op);
      if (e) {
        e.count++;
        e.ms += ms;
      } else {
        f.set(op, { name, count: 1, ms });
      }
    }
  }

  /** 按累计耗时降序的指令表。 */
  opStats(): OpStat[] {
    return [...this.#stats.values()].sort((a, b) => b.totalMs - a.totalMs);
  }

  // -------------------------------------------------------------------------
  // 宿主阶段（`tickets/T-0180` §10）
  // -------------------------------------------------------------------------

  /**
   * **给一个宿主阶段计时**（同步；返回回调的返回值）。
   *
   * ★为什么需要它：指令计时只能解释"opcode 里花的时间"。实测里有一整类帧是
   * **`steps` 很少、每条指令 0ms、却工作几百 ms**（`T-0180` 判据 4）—— 那段时间全在宿主阶段
   * （`advanceModel` / `present` / 纹理上传）。不把这段拆开，"慢"就只能靠猜。
   *
   * ★开着才计时（`#watchOn`），但**始终会调用 `fn`** —— 关掉看门狗不许改变行为，只是不记账。
   * 逐次调用（不是打点/收尾对）是为了让它能包住 `await`、能嵌套、且**异常安全**（`finally`）。
   */
  async stage<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    if (!this.#watchOn) return await fn();
    const t0 = this.#clock();
    try {
      return await fn();
    } finally {
      this.#addStage(name, this.#clock() - t0);
    }
  }

  /**
   * **同步版 `stage()`**（pixi 宿主 `advanceModel`/`present` 里那些阶段不能变成 `await`：
   * 它们在同一次同步调用里跑，插进微任务会把合成拆成两帧；见 `PixiBackend.present` 的时序注释）。
   */
  stageSync<T>(name: string, fn: () => T): T {
    if (!this.#watchOn) return fn();
    const t0 = this.#clock();
    try {
      return fn();
    } finally {
      this.#addStage(name, this.#clock() - t0);
    }
  }
  /**
   * ★**不许按单次调用过滤**（本模块第一版就是这么写的，被守卫逮住了）：`presenter.buildItem`
   * 单次只有 **0.10ms**，而一帧要建 **166 项** ⇒ 过滤掉"小于 0.05ms 的单次"看起来无伤，实则把
   * 一个**每帧 17ms** 的开销藏了起来。⇒ 记账一律累加，只在**报告**里按累计值过滤（那时尺度对）。
   */
  #addStage(name: string, ms: number): void {
    const f = this.#frameStages;
    if (f) {
      const e = f.get(name);
      if (e) {
        e.ms += ms;
        e.n++;
      } else f.set(name, { ms, n: 1 });
    }
    let s = this.#stageStats.get(name);
    if (!s) {
      s = { name, count: 0, totalMs: 0, maxMs: 0 };
      this.#stageStats.set(name, s);
    }
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  /**
   * **本帧计数**（同步、零成本的一条 `Map` 自增）—— 与 `stage()` 配对用。
   *
   * 为什么需要：`present` 里"花了 300ms"可能是"项很多"也可能是"某一项特别贵"，光看时间分不出。
   * 计数（新建了几个 Sprite / 画了几个 mesh / 传了几张纹理）才能把时间归到**规模**上。
   */
  count(name: string, n = 1): void {
    const f = this.#frameCounters;
    if (f) f.set(name, (f.get(name) ?? 0) + n);
  }

  stageStats(): StageStat[] {
    return [...this.#stageStats.values()].sort((a, b) => b.totalMs - a.totalMs);
  }

  /** 本帧阶段的降序快照（`endFrame` 记账用；没有则空数组）。
   *  ★这里才做"单次 0.05ms 以下不列"的过滤（记的时候一律累加，见 `#addStage` 的说明）——
   *  一帧里同名的多次会先合并，所以只有**累计**也不值一提的阶段才被滤掉。 */
  #frameStageList(): { name: string; ms: number; n: number }[] {
    const f = this.#frameStages;
    if (!f || f.size === 0) return [];
    return [...f.entries()]
      .map(([name, v]) => ({ name, ms: v.ms, n: v.n }))
      .filter((s) => s.ms >= 0.05)
      .sort((a, b) => b.ms - a.ms);
  }

  #frameCounterList(): { name: string; n: number }[] {
    const f = this.#frameCounters;
    if (!f || f.size === 0) return [];
    return [...f.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  }

  /** 已记录的慢帧（最多 `MAX_SLOW_FRAMES` 条）。 */
  slowFrames(): readonly SlowFrame[] {
    return this.#slow;
  }

  /**
   * 给人看的报告（`profile report` 的回执）。
   * @param minMs 只列累计耗时 ≥ 该值的指令（缺省 1ms；用来滤掉噪声）。
   */
  report(minMs = 1): string[] {
    const lines: string[] = [];
    const totalSlow = this.#slowSeen;
    lines.push(
      `计时器：指令计时=${this.#opOn ? '**开**' : '关'} · 帧看门狗=${this.#watchOn ? '开' : '关'}` +
        `（阈值 ${this.#slowMs}ms）· 慢帧 ${totalSlow} 次（明细留 ${this.#slow.length}/${MAX_SLOW_FRAMES}）`,
    );
    const ops = this.opStats().filter((s) => s.totalMs >= minMs);
    if (!this.#opOn) {
      lines.push('  （指令计时关着 ⇒ 没有按指令的分解；`profile on` 之后再复现一次即可）');
    } else if (ops.length === 0) {
      lines.push(`  （没有累计 ≥ ${minMs}ms 的指令）`);
    } else {
      lines.push('  opcode                 次数     合计ms    最坏ms   均ms');
      for (const s of ops.slice(0, 20)) {
        lines.push(
          `  ${opName(s.op).padEnd(20)} ${String(s.count).padStart(6)} ${s.totalMs.toFixed(1).padStart(10)} ` +
            `${s.maxMs.toFixed(1).padStart(9)} ${(s.totalMs / s.count).toFixed(2).padStart(7)}`,
        );
      }
      if (ops.length > 20) lines.push(`  …另有 ${ops.length - 20} 条（都在 ${minMs}ms 以上）`);
    }
    if (this.#slow.length > 0) {
      lines.push('  慢帧明细（最近几条）：');
      for (const r of this.#slow.slice(-8)) {
        const tops = r.top.length ? ` · 最慢 ${r.top.map((o) => `${opName(o.op)}×${o.count} ${o.ms.toFixed(0)}ms`).join(' ')}` : '';
        lines.push(`    帧 #${r.frame}：工作 ${r.workMs.toFixed(0)}ms · 距上帧 ${r.gapMs.toFixed(0)}ms · steps ${r.steps}${tops}`);
        if (r.stages.length) {
          lines.push(`      ↳ 宿主阶段 ${r.stages.map((s) => `${s.name} ${s.ms.toFixed(0)}ms×${s.n}`).join(' ')}`);
        }
        if (r.counters.length) {
          lines.push(`      ↳ 计数 ${r.counters.map((c) => `${c.name}=${c.n}`).join(' ')}`);
        }
      }
    }
    // ★阶段累计（跨帧）：这是"这个界面整体上把时间花在哪"的答案，比单帧明细更能定位类别。
    const st = this.stageStats().filter((s) => s.totalMs >= minMs);
    if (st.length === 0) {
      lines.push('  （没有累计 ≥ 阈值的宿主阶段）');
    } else {
      lines.push('  宿主阶段                 次数     合计ms    最坏ms   均ms');
      for (const s of st.slice(0, 15)) {
        lines.push(
          `  ${s.name.padEnd(22)} ${String(s.count).padStart(6)} ${s.totalMs.toFixed(1).padStart(10)} ` +
            `${s.maxMs.toFixed(1).padStart(9)} ${(s.totalMs / s.count).toFixed(2).padStart(7)}`,
        );
      }
      if (st.length > 15) lines.push(`  …另有 ${st.length - 15} 个阶段（都在 ${minMs}ms 以上）`);
    }
    if (!this.#watchOn && this.#slowSeen === 0) {
      lines.push('  ★看门狗关着时不会有慢帧记录（`profile watch on` 打开；它默认就是开的）');
    }
    return lines;
  }
}

/** `0x1af` 这样的短名（日志/报告里比十进制好认）。 */
export function opName(op: number): string {
  return `0x${(op >>> 0).toString(16)}`;
}

/**
 * **进程内唯一一份**（与引擎一一对应：一个页面跑一个引擎；headless/工具也各一份）。
 * 为什么用单例而不是挂在 `Engine` 上：`interpreter.ts` 与 `frame/loop.ts` 都够得到它，
 * 而挂 `Engine` 会让"只看一条指令"的测试也得造一个引擎（本模块刻意零依赖）。
 */
export const profiler = new Profiler();
