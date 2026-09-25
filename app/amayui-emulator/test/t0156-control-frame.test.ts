/** @tier T0 @kind core @subsystem ops */

/**
 * **T-0156 守卫：控制流 / 帧管理 / 脚本装载的缺口修复批（P2 七条）**。
 *
 * 逐条对应 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 `## T-0156` 节与
 * `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` 的 §4.1 行。raw 行号 =
 * `engine/天结_unpacked.exe_utf8.c`（只读权威）。每条断言的**依据**都写在断言旁（体逐字）。
 *
 * | 本文件覆盖 | 文件 | 体 |
 * |---|---|---|
 * | `0x7c` 深度校验**无条件** | `handlers/frame.ts` | raw 25798-25807 |
 * | `0xc8` 两支分离（硬阻塞 / 帧节流） | `handlers/frame.ts` | raw 30301-30312 + 66161-66179 |
 * | `0xae` 版本门不被"本工程槽"短路 | `handlers/frame.ts` | raw 24663 / 24738 |
 * | `0x3` 两异常分型（ShowMessage / ExitScript） | `handlers/control.ts` | raw 26776-26798 |
 * | `0x9` 整体复位重建 `Queue_int` 族 | `handlers/control.ts` | raw 18080-18137 |
 * | `0x9` 队容器 = **10** 槽、`0xA` 越到 `Stack_int` 族 | `engine.ts` / `handlers/control.ts` | raw 18080-18137 / 22655-22674 |
 * | `0x5` 返回点 `-1` ⇒ 不跳 | `handlers/control.ts` | raw 25710-25717 |
 * | `0x6` 深度门同文案 + 装载后写 `caller` | `handlers/control.ts` | raw 26845-26855 / 18635-18637 |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, SLEEP_GATE } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative, ShowMessageError } from '../src/vm/native.js';
import { ExitScript, loadScriptIntoFrame, OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { sleepPath } from '../src/vm/handlers/frame.js';
import { dec } from '../src/vm/bits.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { scriptDerived, instr, mkEngine } from './harness.js';
import { buildScriptBin } from './engineSlotFixtures.js';
import { parseScriptBytes } from '../src/script/bin.js';

/** 立即数 int 操作数。 */
const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
/** 本地 int 槽操作数（可作出参）。 */
const loc = (i: number): BinArg => ({ type: 0x9, raw: i }) as unknown as BinArg;

interface Fixture {
  e: Engine;
  /** 当前帧的脚本二进制。 */
  bin: ScriptBinary;
}

/**
 * 造一个装着 `calls` 的合成脚本引擎。
 *
 * ★**不新造 mk 变体**（`tickets/T-0020` 的棘轮 `test/harness-convergence.test.ts`）：脚本构造整份交给
 * `test/harness.ts` 的 `mkEngine`（`tickets/T-0126` 的派生字段补全器也含在里面），这里只做"取出当前帧的
 * ScriptBinary 供断言改写 `dwordToInstr`"这一件事。
 */
function fixture(calls: BinInstruction[]): Fixture {
  const e = mkEngine(calls, 'T0156.BIN');
  return { e, bin: e.curScript().script! };
}

/** 本地 int 槽的脚本可见值（DEC 后按 i32）。 */
const slotOf = (e: Engine, i: number): number => dec(e.key, e.curScript().locals.int.get(i) ?? 0) | 0;

/** 只提供"读脚本"的内存 FileSource。 */
function fakeFileSource(scripts: Map<number, { name: string; data: Uint8Array }>): Engine['fileSource'] {
  return {
    readScript: async (id: number) => scripts.get(id) ?? null,
  } as unknown as Engine['fileSource'];
}

// ---------------------------------------------------------------------------
// P2 ①：0x7C 深度校验**无条件**（raw 25798-25807）
// ---------------------------------------------------------------------------

/**
 * 引擎 `sub_41AB80` raw 25798-25807：
 * ```c
 * v3 = (_DWORD *)(_this + 8 * v2);            // = frames[cur]
 * if ( v3[95796] != *(_DWORD *)(_this + 430712) )   // ★**没有**任何"哨兵"前置条件
 *   { … "Depth が不正です %s != %s" … _CxxThrowException(…); }
 * ```
 * `430712`（= `ENGINE_FIELD.redisplayScriptId`）的初值就是 **-1**（`sub_40DF10` raw 18155 也复位成 -1）
 * ⇒ 「`-1` = 0x199 没记过 ⇒ 跳过校验」这条口径**不存在**：引擎照抛。
 */
test('★T-0156 P2(0x7c)：深度校验无条件 —— redisplayScriptId 仍是初值 -1 也必须抛「Depth が不正です」（raw 25798-25807）', async () => {
  const { e } = fixture([instr(0x7c, [])]);
  e.engineValues.set(ENGINE_FIELD.redisplayMode, 0x2000000); // 已处于"重显示返回"模式
  e.engineValues.set(ENGINE_FIELD.redisplayScriptId, -1); // 0x199 从没记过（引擎构造/整块复位值）
  e.curScript().scriptId = 0; // 当前帧脚本身份 ≠ -1
  await assert.rejects(
    async () => {
      await stepOnce(e);
    },
    /Depth が不正です/,
    '★旧口径 `want !== -1` 才比较 = 把哨兵语义塞进引擎没有的分支',
  );
});

test('★T-0156 P2(0x7c)：身份相等则正常返回（不回归既有正确路径）', async () => {
  const { e, bin } = fixture([instr(0x7c, [])]);
  bin.dwordToInstr[11] = 0;
  e.engineValues.set(ENGINE_FIELD.redisplayMode, 0x2000000);
  e.engineValues.set(ENGINE_FIELD.redisplayScriptId, 7);
  e.engineValues.set(ENGINE_FIELD.redisplayReturn, 11);
  e.curScript().scriptId = 7;
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.redisplayMode), 0, '模式清零');
});

// ---------------------------------------------------------------------------
// P2 ②：0xC8 两支分离（raw 30301-30312；节流侧的摊还见 66161-66179）
// ---------------------------------------------------------------------------

/**
 * 引擎 `sub_4218D0` raw 30301-30312：
 * ```c
 * if ( (_this[174801] & 0x8000000) == 0 ) {          // ADV 未激活
 *   v3 = sub_41BF50(_this, 1);
 *   if ( v3 >= 10 ) { _this[174801] |= 1u; sub_453A60(_this + 107440, v3); }  // 帧节流计时器
 *   else            { Sleep(v3); }                                             // ★进程级硬阻塞
 * }
 * ```
 * ⇒ `n < 10`（语料 51 处：`sleep 1` 38 / `sleep 0` 12 / 1 处其它）走硬阻塞支、**不**武装
 * `effect_flags |= 1`；`sub_453A60`（raw 66101-66112）把 `[6] = n`（n==0 时抬成 1）、`[5] = timeGetTime()`，
 * 随后由 `sub_453AF0`（raw 66161-66179）按 `n*帧数 − 已过` 摊还、单次片 ≤4ms。
 *
 * ★emulator 的两半（`tickets/T-0156`）：
 *  - **能复刻的那一半**：`effect_flags |= 1` 只在 `n >= 10` 支（raw 30306）；`Sleep(0)` 不再被抬成 1ms；
 *  - **架构性近似（已实测反例）**：两支都装 `SLEEP_GATE`+`sleepUntil` —— 引擎的 `Sleep(n)` 阻塞**游戏线程**，
 *    而本仓帧循环的 `maxStepsPerFrame` 默认 `Number.POSITIVE_INFINITY`（`frame/loop.ts:304`）⇒ 若 `n<10`
 *    支不装门，TITLE 的 `sleep 1; jmp`（`src/TITLE.txt:63`）在同一帧内永不 yield，**模拟器空转冻结**
 *    （把该支改成不装门后 T1 批量跑挂死 = 反例证据）。
 */
test('★T-0156 P2(0xc8)：两支分离 —— effect_flags|=1 只在 n>=10；Sleep(0) 不抬成 1ms；两支都让出派发（架构性等价）', async () => {
  assert.equal(sleepPath(0), 'block', 'raw 30304：v3 >= 10 才进节流支 ⇒ 0 走 Sleep(0)');
  assert.equal(sleepPath(1), 'block', 'TITLE.txt:63 的真实形态');
  assert.equal(sleepPath(9), 'block');
  assert.equal(sleepPath(10), 'throttle', 'raw 30304：边界值 10');
  assert.equal(sleepPath(500), 'throttle');

  // ① n = 1（TITLE 主循环）：让出派发，但**不**武装节流位
  {
    const { e } = fixture([instr(0xc8, [im(1)]), instr(0x1a8, [])]);
    e.nowMs = 1000;
    await stepOnce(e);
    assert.equal(e.waitFlags & SLEEP_GATE, SLEEP_GATE, '让出本次派发（= Sleep(1) 的架构等价物）');
    assert.equal(e.sleepUntil, 1001, '到期 = now + 1ms');
    assert.equal(e.effectFlags & 1, 0, '★raw 30306 的 `|= 1` 只在 n>=10 支（旧实现两支都不写）');
  }
  // ② n = 0：`Sleep(0)` = 只让出时间片 —— 不得被 `Math.max(1, n)` 抬成 1ms
  {
    const { e } = fixture([instr(0xc8, [im(0)])]);
    e.nowMs = 1000;
    await stepOnce(e);
    assert.equal(e.sleepUntil, 1000, '★到期 = now + 0（旧实现是 now + 1）');
    assert.equal(e.effectFlags & 1, 0);
  }
  // ③ n = 10：节流支（计时器 = now + n；帧间隔槽的等价物就是 sleepUntil）
  {
    const { e } = fixture([instr(0xc8, [im(10)])]);
    e.nowMs = 1000;
    await stepOnce(e);
    assert.equal(e.waitFlags & SLEEP_GATE, SLEEP_GATE, 'raw 30306-30307');
    assert.equal(e.sleepUntil, 1010, '`sub_453A60(obj, n)` ⇒ 到期 = 当前时刻 + n ms');
    assert.equal(e.effectFlags & 1, 1, 'raw 30306：`_this[174801] |= 1u`');
  }
  // ④ n = 500（语料 334 处 `sleep 1f4`）
  {
    const { e } = fixture([instr(0xc8, [im(500)])]);
    e.nowMs = 250;
    await stepOnce(e);
    assert.equal(e.sleepUntil, 750);
    assert.equal(e.effectFlags & 1, 1);
  }
});

// ---------------------------------------------------------------------------
// P2 ③：0xAE 的版本门不被"本工程槽带 instr"短路（raw 24663 / 24738）
// ---------------------------------------------------------------------------

/**
 * 引擎 `sub_4192F0` raw 24663 `if ( v3 != 1 )` … raw 24738 `if ( result == 20 )`：
 * `sv1 == 1` 时**只有** `sv2 == 20` 才进这一支；否则整个 body 什么都不做（`return result`）。
 * 该门是本指令**唯一的入口分派**，与「帧记录里存的是表下标还是直接落点」无关 —— 后者是记录**布局**，
 * 前者是**版本选择**，两件事。旧实现用 `direct`（记录带 `instr`）短路整个版本门。
 */
test('★T-0156 P2(0xae)：sv1=1 且 sv2≠20 ⇒ 整支不进（raw 24663/24738），即便记录带 instr（本工程槽）也不得落点', async () => {
  const { e } = fixture([instr(0xae, []), instr(0x1a7, [])]);
  e.engineValues.set(ENGINE_FIELD.loadInProgress, 1);
  e.cur = 0;
  e.saveResume = {
    savedCur: 0,
    savedRet: 9,
    sv1: 1,
    sv2: 10, // ★≠ 20
    frames: [{ returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: -1, callIdx: -1, instr: 5 }],
  };
  await stepOnce(e);
  assert.ok(e.saveResume, '★引擎不进这一支 ⇒ 续跑记录原样留着（旧实现把它消费掉并按 instr 直落）');
  assert.equal(e.curScript().ip, 1, '★不落点：只是默认推进一条（旧实现落到 instr = 5）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 1, '读档门也不清（引擎此处直接 return）');
});

test('★T-0156 P2(0xae)：sv1=1 且 sv2=20 仍进（正例不回归）', async () => {
  const { e } = fixture([instr(0xae, []), instr(0x1a7, [])]);
  e.engineValues.set(ENGINE_FIELD.loadInProgress, 1);
  e.cur = 0;
  e.saveResume = {
    savedCur: 0,
    savedRet: 9,
    sv1: 1,
    sv2: 20,
    frames: [{ returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: -1, callIdx: -1, instr: 0 }],
  };
  await stepOnce(e);
  assert.equal(e.saveResume, null, '收尾：续跑记录消费掉');
  assert.equal(e.engineValues.get(ENGINE_FIELD.callRet), 9, 'savedRet 装回 call_ret');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, '读档门清');
});

test('★T-0156 P2(0xae)：sv1 不在分派表里（本工程槽 `format=0` ⇒ sv1=0）且记录是直接落点 ⇒ 仍须续跑（不得被版本门误杀）', async () => {
  const { e } = fixture([instr(0xae, []), instr(0x1a7, [])]);
  e.engineValues.set(ENGINE_FIELD.loadInProgress, 1);
  e.cur = 0;
  e.saveResume = {
    savedCur: 0,
    savedRet: 9,
    sv1: 0, // 本工程槽容器头 +284 = format = 0（`src/save/saveSlot.ts`）
    sv2: 0,
    frames: [{ returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: -1, callIdx: -1, instr: 1 }],
  };
  await stepOnce(e);
  assert.equal(e.saveResume, null, '★本工程格式的续跑必须照常（引擎里没有这种槽，也就没有对应版本号）');
  assert.equal(e.curScript().ip, 1, '落在记录的直接落点上');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, '收尾清门');
});

test('★T-0156 P2(0xae)：sv1 不在分派表里且记录是**引擎格式**（无 instr）⇒ 无法选组 ⇒ 整支不进（raw 24663）', async () => {
  const { e } = fixture([instr(0xae, []), instr(0x1a7, [])]);
  e.engineValues.set(ENGINE_FIELD.loadInProgress, 1);
  e.cur = 0;
  e.saveResume = {
    savedCur: 0,
    savedRet: 9,
    sv1: 0,
    sv2: 0,
    frames: [{ returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: -1, callIdx: -1 }],
  };
  await stepOnce(e);
  assert.ok(e.saveResume, '记录原样留着（引擎此处直接 return）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 1, '门也不清');
});

// ---------------------------------------------------------------------------
// P2 ④：0x3 的两条异常分型（raw 26776-26798）
// ---------------------------------------------------------------------------

/** 引擎 `sub_41C6A0` raw 26776-26783：`cur >= 39` ⇒ 组 `ファイルの階層が深すぎます．最大は%dです．`(40) + ShowMessage（码 65537）。 */
test('★T-0156 P2(0x3)：深度越界（cur≥39）⇒ 引擎串的 ShowMessage 异常（不是普通 Error）', async () => {
  const { e, bin } = fixture([instr(0x3, [im(0x5264)])]);
  loadScriptIntoFrame(e.frames[39]!, bin, 'DEEP.BIN', 0); // cur = 39 那一帧确实装着脚本（引擎的层深就是帧号）
  e.cur = 39;
  await assert.rejects(
    async () => {
      await stepOnce(e);
    },
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应为 ShowMessageError，实为 ${(err as Error)?.name}`);
      assert.match((err as Error).message, /ファイルの階層が深すぎます．最大は40です．/);
      assert.equal((err as ShowMessageError).opcode, 0x3);
      return true;
    },
  );
});

/** 引擎 `sub_41C6A0` raw 26793-26798：`sub_40ED40` 返回 0（装载失败）⇒ `Command_Exit`（码 2）= **程序退出**。 */
test('★T-0156 P2(0x3)：装载失败 ⇒ Command_Exit（码 2）≙ 抛 ExitScript（程序退出），不是普通 Error', async () => {
  const { e } = fixture([instr(0x3, [im(0x5264)])]);
  e.fileSource = fakeFileSource(new Map()); // 目标脚本读不到
  await assert.rejects(
    async () => {
      await stepOnce(e);
    },
    ExitScript,
    '★旧实现抛普通 Error（宿主只当解释器错误，程序继续/横幅停在那儿），与体的 Command_Exit 相反',
  );
});

/** 状态更新的**次序**：引擎在装载失败前已把调用点 `[95804]` 与 `cur = v6 + 1` 落盘（raw 26787-26792）。 */
test('★T-0156 P2(0x3)：装载失败的抛出点**在**状态更新之后（raw 26787-26793 早于 26794）', async () => {
  const { e } = fixture([instr(0x3, [im(0x5264)])]);
  e.fileSource = fakeFileSource(new Map());
  await assert.rejects(async () => {
    await stepOnce(e);
  }, ExitScript);
  assert.equal(e.cur, 1, 'cur 已切到 caller+1（引擎 `_this[383104] = v6 + 1`，raw 26792）');
  assert.equal(e.frames[0]!.ip, 1, '调用方 ip 已过本条（引擎 `[95804]` 记调用点 + 主循环 3 dword 步长）');
});

// ---------------------------------------------------------------------------
// P2 ⑤⑥：0x9 整体复位重建队族（raw 18080-18137）+ 队容器 = 10 槽
// ---------------------------------------------------------------------------

/**
 * 引擎 `sub_428A60`（`exit-script`）尾部 raw 35270 调 `sub_40DF10`，后者 raw 18080-18109 把
 * `_this + 388252` 起的 **10** 个 `Queue_int` 槽逐个「析构旧 + `new(0x1C)` + `sub_407C50`（空队）」，
 * raw 18110-18137 同一形状重建 **10** 个 `Stack_int`（`_this + 388292`）。
 * ⇒ 脚本经 `0x132` 建过、`0x133` 压过值的队，在 `exit-script` 之后必须**全部回到空队**。
 */
test('★T-0156 P2(0x9)：exit-script 的整体复位重建 Queue_int 族（10 个槽全部回到空队，raw 18080-18109）', async () => {
  const { e } = fixture([instr(0x9, [])]);
  e.dispatchQueues[0]!.push(11);
  e.dispatchQueues[9]!.push(99);
  e.fileSource = fakeFileSource(new Map([[0, { name: 'ROOT.BIN', data: buildScriptBin([{ op: 0x1a8, args: [] }]) }]]));
  await stepOnce(e);
  assert.equal(e.cur, 0, '重载根脚本 0 后 cur = 0');
  assert.equal(e.curScript().name, 'ROOT.BIN', '根脚本已重装');
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(e.dispatchQueues[i], [], `第 ${i} 个 Queue_int 被整体复位重建为空队`);
  }
});

test('★T-0156 P2/P3(0x9)：Queue_int 族 = **10** 个槽（引擎 raw 18081 `v15 = 10` / 18111 `v16 = 10`），不是 11', () => {
  const e = new Engine(new StubNative(() => {}), new InputManager());
  assert.equal(
    e.dispatchQueues.length,
    10,
    '★旧口径 11 的来源是把 `v15 = 10; do{…}while(v15-- == 1)` 数成 11 次；raw 18106 的 `v8 = v15-- == 1` 是先比较后自减 ⇒ 恰好 10 次',
  );
});

/**
 * ★引擎把 `0xA` 放进同一个算式 `_this + 4*op1 + 388252`：`4*10 + 388252 = 388292`，
 * 而那正是 **`Stack_int` 族第一格的地址**（raw 18110 `v18 = (_DWORD *)(_this + 388292)`）——
 * 也就是说 `op1 = 0xA` 落在**另一个族的对象**上（`Stack_int` 布局 = `[1]=cap,[2]=cap,[3]=buf,[4]=-1`，
 * 没有 Queue_int 的 `[2]=rd/[3]=wr`），是一次**类型混淆**访问，不是"本族第 11 个队"。
 */
test('★T-0156 P2(0x9)：op1 = 0xA 越到 Stack_int 族第一格（byte 388292，raw 18110）⇒ 不得写第 11 个槽、不得崩', async () => {
  const { e } = fixture([
    instr(0x132, [im(0xa)]),
    instr(0x133, [im(0xa), im(5)]),
    instr(0x134, [im(0xa), loc(0), loc(1)]),
    instr(0x1a7, []),
  ]);
  for (const op of [0x132, 0x133, 0x134]) {
    assert.ok(OPS.get(op), `0x${op.toString(16)} 应在 OPS 里`);
  }
  const before0 = slotOf(e, 0);
  const before1 = slotOf(e, 1);
  await stepOnce(e); // 0x132 0xA
  await stepOnce(e); // 0x133 0xA 5
  await stepOnce(e); // 0x134 0xA …
  assert.equal(e.dispatchQueues.length, 10, '越界下标不得把容器撑到 11');
  assert.equal(
    (e.dispatchQueues as unknown as Record<number, unknown>)[10],
    undefined,
    '★`dispatchQueues[10]` 不存在（不是第 11 个队）',
  );
  assert.deepEqual(e.dispatchQueues[9], [], '同族的最后一格也没被误写');
  assert.equal(slotOf(e, 0), before0, '0x134 在 0xA 上不得写成功位（类型混淆路径未建模，见 handler 注释）');
  assert.equal(slotOf(e, 1), before1, '也不得写值');
});

// ---------------------------------------------------------------------------
// P3（廉价、体证明确）：0x5 的 -1 返回点 / 0x6 的深度门与 caller
// ---------------------------------------------------------------------------

/**
 * 引擎 `sub_41A9B0`（`ret`）raw 25710-25717：
 * ```c
 * _this[30*cur + 95805] = 1;                       // 步长 = 1 dword（= 前进一条）
 * --_this[_this[95776] + 97153];                   // 弹一层
 * v2 = _this[256*result + 97193 + _this[result + 97153]];
 * if ( v2 != -1 ) { ip = base + 4*v2; 95805 = 0; }  // ★-1 = 空槽 ⇒ **不跳**
 * ```
 * ⇒ `-1` 是**空槽哨兵**，不是"跳到 dword -1"。
 */
test('★T-0156 P3(0x5)：返回栈顶 = -1 ⇒ 不跳、落到下一句（引擎 raw 25714 `if (v2 != -1)`）', async () => {
  const { e } = fixture([instr(0x5, []), instr(0x1a7, [])]);
  e.curScript().retStack.push(-1);
  await stepOnce(e);
  assert.equal(e.curScript().ip, 1, '★不得经 `dwordToInstr[-1]`（旧实现取不到就抛）');
});

test('★T-0156 P3(0x5)：正常返回点仍跳（不回归）', async () => {
  const { e, bin } = fixture([instr(0x5, []), instr(0x1a7, []), instr(0x1a7, [])]);
  bin.dwordToInstr[7] = 2;
  e.curScript().retStack.push(7);
  await stepOnce(e);
  assert.equal(e.curScript().ip, 2, '跳到 dword 7 对应的下标 2');
});

/**
 * 引擎 `sub_41C900`（= **0x8 call-frame**）raw 26886-26904：本体**没有** `op1` 值域校验；
 * 唯一的 ShowMessage 是「目标帧未预装」（`frames[v2][95781] == 0`），文案
 * `"この階層にはファイルが読み込まれていません．Depth=%d"`，异常码 **65541**。
 *
 * ★工作清单把这条体（以及那句「階層が深すぎます」的深度门）记在了 **0x8** 头上，实际 `sub_41C7C0` = **0x6**
 *   —— 这是本票读体时纠正的一处归属错（见 `tickets/T-0156/changes-c156.md`）。
 */
test('★T-0156 P3(0x8)：目标帧未预装 ⇒ 引擎文案「この階層にはファイルが読み込まれていません．Depth=N」的 ShowMessage（raw 26891-26904）', async () => {
  const { e } = fixture([instr(0x8, [im(7)])]);
  await assert.rejects(
    async () => {
      await stepOnce(e);
    },
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应为 ShowMessageError，实为 ${(err as Error)?.name}`);
      assert.match((err as Error).message, /この階層にはファイルが読み込まれていません．Depth=7/);
      assert.equal((err as ShowMessageError).opcode, 0x8);
      return true;
    },
  );
});

test('★T-0156 P3(0x8)：帧号越界（≥40）仍是重写侧的下标边界（引擎**无**此校验，raw 26886-26892）', async () => {
  const { e } = fixture([instr(0x8, [im(40)])]);
  await assert.rejects(
    async () => {
      await stepOnce(e);
    },
    /越界/,
    '★不得当成引擎的深度门（引擎唯一的 0x8 报错文是「階層にはファイルが読み込まれていません」）',
  );
});

/** 引擎 `sub_41C7C0`（**0x6 load-frame**）raw 26847-26853：`op2 >= 40` ⇒ 同一句「階層が深すぎます」+ ShowMessage。 */
test('★T-0156 P3(0x6)：帧号越界（≥40）用引擎同文的 ShowMessage 异常（raw 26847-26853）', async () => {
  const { e } = fixture([instr(0x6, [im(0x5264), im(40)])]);
  e.fileSource = fakeFileSource(new Map());
  await assert.rejects(
    async () => {
      await stepOnce(e);
    },
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应为 ShowMessageError，实为 ${(err as Error)?.name}`);
      assert.match((err as Error).message, /ファイルの階層が深すぎます．最大は40です．/);
      return true;
    },
  );
});

/**
 * 引擎 `sub_40ED40` raw 18635-18637（`0x6` 也走它）：装载前先 `sub_40EA00(frames[cur])`，
 * 装载后 `frames[cur][95795] = _this[383108]` —— 而 `0x6` 的体在 raw 26845 把 `383108` 设成**装载前的 cur**
 * ⇒ **新帧的 caller = 发起装载的那一帧**（不是 -1）。
 */
test('★T-0156 P3(0x6)：装载后目标帧的 caller = 发起装载的 cur（raw 26845 + 18637）', async () => {
  const { e, bin } = fixture([instr(0x6, [im(0x5264), im(3)])]);
  loadScriptIntoFrame(e.frames[1]!, bin, 'CALLER.BIN', 0); // 发起装载的那一帧（cur = 1）
  e.cur = 1;
  e.fileSource = fakeFileSource(new Map([[0x5264, { name: 'SUB.BIN', data: buildScriptBin([{ op: 0x1a8, args: [] }]) }]]));
  await stepOnce(e);
  assert.equal(e.cur, 1, '0x6 不改 cur（体在 raw 26856 把 383104 还原）');
  assert.equal(e.frames[3]!.caller, 1, '★目标帧 caller = 发起帧');
  assert.equal(e.frames[3]!.name, 'SUB.BIN');
});

// ---------------------------------------------------------------------------
// 注册表棘轮：本文件断言到的 opcode 都必须在某张表里（防"改了但没接上"）
// ---------------------------------------------------------------------------

test('★T-0156：涉及的全部 opcode 都已注册（OPS / NATIVE_OPS）', () => {
  for (const op of [0x7c, 0xc8, 0xae, 0x3, 0x9, 0x5, 0x6, 0x132, 0x133, 0x134]) {
    assert.ok(OPS.get(op) ?? NATIVE_OPS.get(op), `0x${op.toString(16)} 未注册`);
  }
  assert.equal(typeof parseScriptBytes, 'function');
});
