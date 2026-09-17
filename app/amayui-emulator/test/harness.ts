/**
 * 测试公共 harness（2026-09 抽取）。
 *
 * 为什么需要：`instr()` 曾在 11 个测试文件里逐字重复、`im`/`str` 也在多处逐字重复
 * （见 `docs-new/04-app/emulator-refactor-plan.md` §4）。重复的后果不是"啰嗦"而是**漂移**：
 * 有人改了某个文件里的 `instr`（例如补 `byteOffset`）其余文件不会跟着改，
 * 于是同一批断言在不同文件里跑的是**不同的指令形状**。
 *
 * 只放"与引擎语义无关、纯构造"的东西；任何涉及 opcode 语义的假件都应留在各自测试里显式写出。
 */
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';

/** 立即数 int 操作数（type 0）。 */
export const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;

/** 字符串操作数（type 2，`str` 字段直给）。 */
export const str = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;

/** 本帧 int 槽（type 0x9）—— 只有池操作数能做**写目标**，立即数不行。 */
export const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;

/**
 * 构造一条**二进制指令**（只填测试用得到的字段）。
 *
 * `name` = `i${opcode.toString(16)}`：与 `src/script/opcodes.ts` 的助记符表无关，
 * 仅用于断言失败时的可读输出（引擎日志里也是这个形状）。
 */
export function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}

/**
 * 造一个装了**合成脚本**的引擎（`StubNative` 宿主；脚本只装在根帧上）。
 *
 * 用途：驱动层/入口层的守卫（`test/scene-report.test.ts`、`test/run-cli-loop.test.ts`、
 * `test/frame-loop.test.ts`）——它们要的是"某个入口的配置在合成脚本上表现如何"，
 * 不需要真实语料。★`test/` 里还有 17 处各自的 `mk()` 变体（差异是真实需求，见
 * `tickets/T-0020`）⇒ 这个函数只服务**新增**的守卫，不强行统一既有那些。
 */
export function mkEngine(ops: BinInstruction[], name = 'FAKE.BIN'): Engine {
  const e = new Engine(new StubNative(() => {}));
  const script: ScriptBinary = {
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    ipTables: [[], [], []],
    instructions: ops.map((o, i) => ({ ...o, index: i })),
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), script, name);
  return e;
}

/**
 * **悬停判定的测试门面**（`tickets/T-0014`）：逐字复刻产品路径在 `Engine.serviceAdvanceWait()`
 * 里的那一对调用（`engine.ts`：`if (!this.hoverDispatchAllowed()) …; panel.nextHoverLabel()`）。
 *
 * 为什么在测试侧而不是引擎上：修前 `Engine` 上有一个 `pickHoverLabel()` 方法，`src/` 里**零调用者**
 * （产品路径早已把这两行内联进等待泵），只剩测试在调它 ⇒ 引擎为一个"产品不走"的路径保留了 API。
 * 门面挪到测试侧后，两件事都保住：那 15 条断言仍然覆盖 `hoverDispatchAllowed()` 的门控与
 * `route.ts` 的两段式状态机，而 `src/` 里不再有测试专用方法。
 *
 * 返回 −1 = 本帧没有游标变化（或没有热点、门控拦住）。
 */
export function pickHoverLabel(e: Engine): number {
  if (!e.hoverDispatchAllowed()) return -1;
  const label = e.routes.nextHoverLabel(); // 引擎 sub_403E70
  return label === 0xffffffff ? -1 : label;
}
