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
import type { AudioIntent } from '../src/audio/audioEngine.js';
import type { NativeBridge } from '../src/vm/native.js';
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
 * `noUncheckedIndexedAccess` 下的显式解包（`tickets/T-0126`）。
 *
 * 为什么不用 `!` / `?? 0`：`!` 把"我确信"写成了编译器无法复核的谎话，`?? 0` 则会在
 * **元素真的缺失**时继续跑出一个看似正常的断言结果（例如 `undefined >= 1` = false
 * 被当成"确实没有已核验能力"）。两者都让"数组短了"这条信息丢失。这里越界即抛，
 * 失败信息里直接给出**下标与长度**。
 *
 * `what` 用调用点的业务名（如 `'行'`、`'注音'`），别用默认值——失败时那一行才是给人看的。
 */
export function at<T>(xs: readonly T[], i: number, what = '元素'): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`缺少 ${what}[${i}]（共 ${xs.length} 个）`);
  return v;
}

/** 单个值版本：`Map.get` / `Record` 取值后立刻要参与算术或断言时用。 */
export function must<T>(v: T | undefined, what = '值'): T {
  if (v === undefined) throw new Error(`${what} 未定义/未设置`);
  return v;
}

/**
 * **操作数触碰观测器**（`tickets/T-0129` 上收；原先 4 个文件各写一遍同样的 Proxy）。
 *
 * 用途：断"某条 handler 真的读了操作数的哪几格"（漏读 op3 这类审计缺陷只有这个办法能机械证明）。
 * ★口径**必须是唯一的**：读数组的数字属性即记 `下标 + 1`（操作数号是 1-based，op1 = `args[0]`）。
 * 四处各写一遍时，任何一处把 `+1` 改成 `+0`、或改判 `p in t`，同一批断言就在不同文件里跑出
 * 不同的口径 —— 这正是抽取它的理由（不是"少写几行"）。
 *
 * ```ts
 * const { args, hits } = trackArgs([im(1), im(2), im(3)]);
 * await run(op, args);
 * assert.deepEqual(hits(), [1, 2, 3]);
 * ```
 */
export function trackArgs(args: BinArg[]): { args: BinArg[]; hits: () => number[] } {
  const touched = new Set<number>();
  const proxied = new Proxy(args, {
    get(t, p, r) {
      if (typeof p === 'string' && /^\d+$/.test(p)) touched.add(Number(p) + 1);
      return Reflect.get(t, p, r);
    },
  });
  return { args: proxied, hits: () => [...touched].sort((a, b) => a - b) };
}

/** 合成脚本的槽夹具（`SYS4450 ` + 3 张空表 + `i0x1a7`）—— `save-slot`/`save-thumb` 两处逐字相同。 */
export function synthSlotScript(instructions: BinInstruction[] = [instr(0x1a7, [])]): ScriptBinary {
  return {
    ...scriptDerived(),
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions,
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0x3c + 12),
  };
}

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
 * **录制型音频宿主**（`tickets/T-0129` 上收；原先 `audio-opcodes` 与 `gallery-bgm-list` 各抄一份逐字相同的）。
 *
 * 只做一件事：把 `audio(intent)` 逐条记下来，供断言"脚本想发什么音频意图"。
 * `last` 在**没有记录**时直接抛（而不是返回 undefined）—— 否则调用点的断言会退化成
 * `undefined.foo` 的 TypeError，失败信息里看不到"其实一条都没记到"。
 */
export class RecordingAudioNative extends StubNative {
  readonly intents: AudioIntent[] = [];
  constructor() {
    super(() => {});
  }
  override audio(intent: AudioIntent): void {
    this.intents.push(intent);
  }
  get last(): AudioIntent {
    const v = this.intents.at(-1);
    if (!v) throw new Error('没有记录到任何音频意图');
    return v;
  }
}

/**
 * 合成脚本 fixture 的**派生字段**补全器（`tickets/T-0126`）。
 *
 * `ScriptBinary.ipTables` / `dwordToInstr` 是 `parseScript()` 从 `raw` 反推出的索引
 * （dword → 指令序号、跳转表 `bin.ts:236-265`）：**真实脚本永远有**，但 `test/` 里的合成
 * 脚本 `raw` 是空数组，手搓时最容易被漏掉。漏掉的代价不是立刻报错而是**静默**——产品路径
 * 多半写成 `script?.dwordToInstr?.[i]`（`engine.ts:1109`、`frame.ts:38`、`control.ts:115`），
 * 只有 `engineSlot.ts:577/586/614` 直接索引，所以要等到那条路径被走到才崩。
 *
 * ⇒ 类型层必须要求这两个字段存在（**不许**改成可选来图省事：`engineSlot.ts:577` 直接
 * `script.ipTables[2]`）。用法：在合成 `ScriptBinary` 字面量**开头**展开本函数，
 * 后面显式写的字段自然覆盖它：
 *
 * ```ts
 * const s: ScriptBinary = { ...scriptDerived(), signature: 'SYS0000', instructions: [...] };
 * ```
 *
 * 空表 = 与"之前根本没有这两个字段"在语义上等价（`ipTables[2] ?? []`、`?.` 都落到同一结果），
 * ⇒ 是**行为保持**的补全，不是把断言放松。
 */
export function scriptDerived(): { ipTables: number[][]; dwordToInstr: number[] } {
  return { ipTables: [[], [], []], dwordToInstr: [] };
}

/**
 * 造一个装了**合成脚本**的引擎（`StubNative` 宿主；脚本只装在根帧上）。
 *
 * 用途：驱动层/入口层的守卫（`test/scene-report.test.ts`、`test/run-cli-loop.test.ts`、
 * `test/frame-loop.test.ts`）——它们要的是"某个入口的配置在合成脚本上表现如何"，
 * 不需要真实语料。★`test/` 里还有 17 处各自的 `mk()` 变体（差异是真实需求，见
 * `tickets/T-0020`）⇒ 这个函数只服务**新增**的守卫，不强行统一既有那些。
 *
 * `native` 可选：默认静默 `StubNative`；要断言"宿主**收到了**这次忽略"（ADR-010 的记录义务）
 * 的守卫传入自己的宿主（见 `test/op-0104-gdi-repaint-stub.test.ts`）。加了它就不用为了
 * 收日志再抄一遍下面的 `ScriptBinary` 构造。
 */
export function mkEngine(ops: BinInstruction[], name = 'FAKE.BIN', native?: NativeBridge): Engine {
  const e = new Engine(native ?? new StubNative(() => {}));
  const script: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
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
