/**
 * **遥测四表**：把 `StepTrace` 归成控制窗要显示的四类清单。
 *
 * | 表 | 含义 | 来源 |
 * |---|---|---|
 * | `ignored`  | 真·忽略（纯 no-op 插桩） | `handlerKind==='engine-internal' && noop` |
 * | `internal` | 已按引擎语义处理但无输出 | `handlerKind==='engine-internal' && !noop` |
 * | `skipped`  | 用户「作为桩函数跳过」的未知指令 | `handlerKind==='user-stub'` |
 * | `gaps`     | **闸门 B**：被忽略却收到非平凡实参 | `StepTrace.gap` |
 *
 * 这里只做"计数 + 首见留痕"，**不做 I/O**：首见时要写的 trace 行由 `note()` 返回，
 * 由调用方（session）交给 `TraceLog`，避免本模块反过来依赖日志通道。
 */
import type { StepTrace } from '../../vm/interpreter.js';

export interface OpStat {
  name: string;
  count: number;
}

export interface GapStat {
  name: string;
  count: number;
  sample: string[];
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
}

export class Telemetry {
  readonly ignored = new Map<number, OpStat>();
  readonly internal = new Map<number, OpStat>();
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
      const pureNoop = t.noop;
      const map = pureNoop ? this.ignored : this.internal;
      const g = map.get(t.opcode);
      if (g) g.count++;
      else {
        map.set(t.opcode, { name: t.name, count: 1 });
        // name 已是助记符（语义名或 iXXX），无需再补 opcode 数字
        out.push(`[${pureNoop ? 'ignored' : 'internal'}] ${t.name}`);
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
        this.gaps.set(t.opcode, { name: t.name, count: 1, sample: t.gap.operands });
        out.push(`[gap] ${t.name} 被忽略但收到实参：${t.gap.operands.join(' ')}`);
      }
    }
    return out;
  }

  ignoredList(): TelemetryOpEntry[] {
    return [...this.ignored].map(([opcode, v]) => ({ opcode, name: v.name }));
  }

  internalList(): TelemetryOpEntry[] {
    return [...this.internal].map(([opcode, v]) => ({ opcode, name: v.name }));
  }

  skippedList(): TelemetrySkippedEntry[] {
    return [...this.skipped].map(([opcode, v]) => ({ opcode, name: v.name, count: v.count }));
  }

  gapsList(): TelemetryGapEntry[] {
    return [...this.gaps].map(([opcode, v]) => ({ opcode, name: v.name, count: v.count, sample: v.sample }));
  }
}
