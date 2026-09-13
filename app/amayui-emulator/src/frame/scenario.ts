/**
 * **Scenario（场景脚本）** —— 把"玩家做了什么"表达成**数据**，让两个宿主跑同一份输入编排。
 *
 * 为什么需要它（`tickets/T-0003` 的 B3 验收 3 / `T-0005` 的 B5）：
 * 修前"输入"分两套 —— Electron 由真人（DOM 事件 → `InputManager`），headless 由各链路里手写的
 * `input.setCursor(...)` 序列（且等待门走 `forceAdvance` 旁路，**根本不经过命中测试/悬停**）。
 * 于是 headless 的 `routes.cursor` 恒 −1，"悬停展开/收起侧栏"这条**对外可见行为**在 headless 里从不发生。
 *
 * 本模块只做三件事，且**不依赖任何宿主**：
 *  1. 步骤（`ScenarioStep`）：`when` 到点（帧号）或条件成立（可读 Engine 状态）时执行一次；
 *  2. 执行体拿到 `{ e, input, frame }`，用 `InputManager` 的写入接口表达输入（`setCursor`/`pressMouse`…）；
 *  3. 留下**执行日志**（哪一帧、哪一步、动了什么）—— 它既是诊断，也是 G3 回放比对的输入侧记录。
 *
 * ★与 B5 的关系：B5 会把这里扩成"可录制/可回放"（`--record` 落 JSONL、`--replay` 重放并比 digest）；
 * 本文件先把"事件 → InputManager"这条通路统一，`--record/--replay` 只需序列化 `steps` 与日志。
 */
import type { Engine } from '../vm/engine.js';
import type { InputManager } from '../vm/input.js';

/** 执行一个步骤时能看到/能改的东西。 */
export interface ScenarioCtx {
  e: Engine;
  input: InputManager;
  /** 当前帧号（由驱动/宿主每帧递增）。 */
  frame: number;
}

/** 一个步骤：到点或条件成立 ⇒ **执行一次**。 */
export interface ScenarioStep {
  /** 帧号（`frame >= at` 即到点）或条件（每次 apply 都判一次）。 */
  when: number | ((c: ScenarioCtx) => boolean);
  /** 做什么（只写 `InputManager`；不要碰 VM 状态）。 */
  do: (c: ScenarioCtx) => void;
  /** 日志/诊断用的一句话（会进 `Scenario.log`）。 */
  note: string;
}

/** 一次已执行的步骤记录（诊断 + 回放比对用）。 */
export interface ScenarioLogEntry {
  frame: number;
  note: string;
}

/**
 * 步骤集合。**顺序执行**：前面的步骤没执行完，后面的不会被考虑
 * （避免"同一个帧里既移动又点击"这种物理上不可能的组合被乱序执行）。
 */
export class Scenario {
  readonly steps: ScenarioStep[] = [];
  /** 已执行步骤的记录（帧号 + 说明）。 */
  readonly log: ScenarioLogEntry[] = [];
  /** 下一个待执行步骤的下标。 */
  #next = 0;

  /** 追加一步（链式）。 */
  step(s: ScenarioStep): this {
    this.steps.push(s);
    return this;
  }

  /** 追加一步"到第 n 帧执行"。 */
  at(frame: number, note: string, fn: (c: ScenarioCtx) => void): this {
    return this.step({ when: frame, note, do: fn });
  }

  /** 追加一步"条件成立时执行"（条件每次 apply 判一次）。 */
  when(note: string, cond: (c: ScenarioCtx) => boolean, fn: (c: ScenarioCtx) => void): this {
    return this.step({ when: cond, note, do: fn });
  }

  get done(): boolean {
    return this.#next >= this.steps.length;
  }

  /** 每个宿主帧调一次：把"到点/条件成立"的步骤按序执行掉（每步只执行一次）。 */
  apply(c: ScenarioCtx): void {
    while (this.#next < this.steps.length) {
      const s = this.steps[this.#next]!;
      const due = typeof s.when === 'number' ? c.frame >= s.when : s.when(c);
      if (!due) return;
      s.do(c);
      this.log.push({ frame: c.frame, note: s.note });
      this.#next++;
    }
  }
}

/** 把光标移到 (x,y) 的一句糖（供步骤体用，避免到处写 `c.input.…`）。 */
export function moveTo(c: ScenarioCtx, x: number, y: number): void {
  c.input.setCursor(x, y);
}

/** 在 (x,y) 按一下左键（按下→留下"边沿"，由既有链路在后续帧释放）。 */
export function clickAt(c: ScenarioCtx, x: number, y: number): void {
  c.input.setCursor(x, y);
  c.input.pressMouse(0);
}

/** 抬起左键。 */
export function releaseAt(c: ScenarioCtx, x: number, y: number): void {
  c.input.setCursor(x, y);
  c.input.releaseMouse(0);
}
