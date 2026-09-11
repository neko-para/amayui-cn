/**
 * **遥测三表**：把 `StepTrace` 归成控制窗要显示的三类清单。
 *
 * | 表 | 含义 | 来源 |
 * |---|---|---|
 * | `gaps`     | **闸门 B**：被跳过且收到非平凡实参（"脚本想做点什么而我没做"） | `StepTrace.gap` |
 * | `ignored`  | 引擎内部 no-op，且**没**收到实参（本场景空转） | `handlerKind==='engine-internal'` |
 * | `skipped`  | 用户「作为桩函数跳过」的未知指令，且**没**收到实参 | `handlerKind==='user-stub'` |
 *
 * ★三表是**互斥划分**（一个 opcode 只出现在一处）：`gaps` 是"被跳过"集合里最该看的那一档，
 * 因此凡进过 `gaps` 的 opcode 就不再出现在 `ignored`/`skipped` 里 —— 否则同一条指令会在
 * 控制窗里被列两遍（实测 21 条"真·忽略"里有 16 条同时出现在"能力缺口"）。
 * 判据是"**是否曾经**收到非平凡实参"：绝大多数这类指令的实参由脚本写死，见 `significantOperands`。
 *
 * 这里只做"计数 + 首见留痕"，**不做 I/O**：首见时要写的 trace 行由 `note()` 返回，
 * 由调用方（session）交给 `TraceLog`，避免本模块反过来依赖日志通道。
 */
import type { StepTrace } from '../../vm/interpreter.js';

export interface OpStat {
  name: string;
  count: number;
}

export interface GapStat extends OpStat {
  sample: string[];
  /** 它原本属于哪张表（用于在缺口行上标注来源，避免信息丢失）。 */
  source: 'ignored' | 'skipped';
}

export interface TelemetryOpEntry {
  opcode: number;
  name: string;
}

export interface TelemetrySkippedEntry extends TelemetryOpEntry {
  count: number;
}

export interface TelemetryGapEntry extends TelemetryOpEntry {
  count: number;
  sample: string[];
  source: 'ignored' | 'skipped';
}

export class Telemetry {
  readonly ignored = new Map<number, OpStat>();
  readonly skipped = new Map<number, OpStat>();
  readonly gaps = new Map<number, GapStat>();

  /** 登记用户桩（控制窗点「作为桩函数跳过」）：先建 0 计数条目，之后每次执行累加。 */
  registerStub(opcode: number, name: string): void {
    this.skipped.set(opcode, { name, count: 0 });
  }

  /** 处理一条已执行的指令；返回"首次见到"时应写进 trace 的行。 */
  note(t: StepTrace): string[] {
    const out: string[] = [];
    if (t.handlerKind === 'engine-internal') {
      const g = this.ignored.get(t.opcode);
      if (g) g.count++;
      else {
        this.ignored.set(t.opcode, { name: t.name, count: 1 });
        // name 已是助记符（语义名或 iXXX），无需再补 opcode 数字
        out.push(`[ignored] ${t.name}`);
      }
    } else if (t.handlerKind === 'user-stub') {
      const g = this.skipped.get(t.opcode);
      if (g) g.count++;
    }
    if (t.gap) {
      const g = this.gaps.get(t.opcode);
      if (g) {
        g.count++;
        g.sample = t.gap.operands;
      } else {
        this.gaps.set(t.opcode, {
          name: t.name,
          count: 1,
          sample: t.gap.operands,
          source: t.handlerKind === 'user-stub' ? 'skipped' : 'ignored',
        });
        out.push(`[gap] ${t.name} 被忽略但收到实参：${t.gap.operands.join(' ')}`);
      }
    }
    return out;
  }

  /** 被缺口表收走的 opcode（这些不再出现在另外两张表里）。 */
  #gapOnly(): Set<number> {
    return new Set(this.gaps.keys());
  }

  ignoredList(): TelemetryOpEntry[] {
    const inGaps = this.#gapOnly();
    return [...this.ignored].filter(([op]) => !inGaps.has(op)).map(([opcode, v]) => ({ opcode, name: v.name }));
  }

  skippedList(): TelemetrySkippedEntry[] {
    const inGaps = this.#gapOnly();
    return [...this.skipped]
      .filter(([op]) => !inGaps.has(op))
      .map(([opcode, v]) => ({ opcode, name: v.name, count: v.count }));
  }

  gapsList(): TelemetryGapEntry[] {
    return [...this.gaps].map(([opcode, v]) => ({ opcode, name: v.name, count: v.count, sample: v.sample, source: v.source }));
  }
}
