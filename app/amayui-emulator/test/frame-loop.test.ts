/**
 * **共享帧驱动契约测试**（`src/frame/loop.ts`）—— `tickets/T-0001`（B1）。
 *
 * 为什么单独锁它：驱动是"Electron 与 headless 完全一致"的地基（用户 2026-09 定的最优先需求），
 * 而它的正确性**不能**只靠"各家链路测试仍然绿"来保证（那些测试覆盖的是链路，不是驱动的档位语义）。
 * 本文件用**合成脚本**把每个档位钉住：`cap`/`until`/`script-end` 的语义、`0x400` 门 `clear` vs `ignore`、
 * `sleep` 门 `wait` vs `clear`、以及 `frames`/`steps` 的计数口径。
 *
 * 依据：引擎主循环（`docs-new/03-engine/engine-reset-mainloop.md`、raw 20887-20895）；
 * 各档位对应哪个入口的哪种现状，见 `src/frame/loop.ts` 的表格与 `tickets/T-0001/changes.md`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, SLEEP_GATE } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个装了合成脚本的引擎（`instr` 列表 + 自动 index）。 */
function mk(ops: BinInstruction[]): Engine {
  const e = new Engine(new StubNative(() => {}));
  const script: ScriptBinary = {
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
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');
  return e;
}

/** 固定步长虚拟时钟 + 帧末推进（驱动只负责调用 `onFrameEnd`）。 */
function mkHost(): { host: FrameHost; advance: () => void } {
  const box = { clock: 0 };
  return {
    host: { now: () => box.clock },
    advance: () => {
      box.clock += 1000 / 60;
    },
  };
}

const pollInput = (): BinInstruction => instr(0x101);

test('stopReason：跑满上限 = cap（frames=上限、steps 按每帧派发数计）', async () => {
  const e = mk([pollInput(), pollInput(), pollInput(), pollInput(), pollInput()]);
  const { host, advance } = mkHost();
  let stepsSeen = 0;
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    onStep: () => stepsSeen++,
    onFrameEnd: advance,
  });
  assert.equal(r.stopReason, 'cap');
  assert.equal(r.frames, 2, '两帧');
  assert.equal(r.steps, 2, '每帧 1 条 ⇒ 共 2 条');
  assert.equal(stepsSeen, 2, 'onStep 每条一次');
});

/**
 * ★★**逐字期间的点击由「贴完整页」出口消费，不得攒成后续帧的推进**（`tickets/T-0033`）★★
 *
 * 用户实测：ADV 页里快速多次点击 ⇒ emulator 要等第一句逐字显完才播第二句。
 * 修前本驱动把 `textRevealing` 分支排在推进分支之前、且那条分支**完全不消费输入** ⇒
 * 逐字期间的点击留在输入边沿里，等文字自然显完后被等待泵当成"推进"（一次点击干了两件事）。
 * 引擎依据：`sub_409400` 第二半（raw 13931-13946）在逐字期间就把这次点击用掉（贴完整页）。
 */
test('★逐字期间点击：贴完整页、不派发；再点一次才推进（T-0033）', async () => {
  const e = mk([
    instr(0x6e, [im(0), { type: 2, raw: 0, str: 'こんにちは世界' } as unknown as BinArg]),
    instr(0x94), // 面板已显示（等待泵的门控）
    instr(0x72, [im(0)]), // 逐字开始（武装）+ 等待门
    pollInput(),
    pollInput(),
  ]);
  e.engineValues.set(21668, 50); // message:MessageSpeed = 50ms（否则 0 ⇒ 同步排空）
  const { host, advance } = mkHost();
  const opts = {
    gates: { anim: 'wait' as const, sleep: 'wait' as const, advance: 'pump' as const },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 1,
    audio: 'never' as const,
    onFrameEnd: advance,
  };
  // ① 跑到"逐字中"（产品门档：文本段落间的 sleep 让步也照走）
  let guard = 0;
  while (!e.textRevealing && guard++ < 120) await runFrameLoop(e, host, opts);
  assert.equal(e.textRevealing, true, '应在逐字中（0x72 武装后开始）');
  const w = e.msgwin.resolveWin(0);
  const st = e.msgwin.reveal.get(w)!;
  assert.ok(st.total > 3, `文本应有多字（实际 ${st.total}）`);
  assert.ok(st.shown < st.total, `此刻未显完（${st.shown}/${st.total}）`);
  const ipAtGate = e.curScript().ip;

  // ② 逐字期间点一次左键 ⇒ 本帧只"贴完整页"，不派发任何指令
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  const r1 = await runFrameLoop(e, host, opts);
  assert.equal(e.msgwin.reveal.get(w)!.shown, st.total, '★文本立即整页贴完');
  assert.equal(e.textRevealing, false, '不再逐字');
  assert.equal(r1.steps, 0, '★逐字期间的点击不派发任何指令');
  assert.equal(e.curScript().ip, ipAtGate, '★页不推进（ip 不动）');

  // ③ 该次点击已被消费 ⇒ 后续帧不得再被等待泵当成推进
  e.input.releaseMouse(0);
  const r2 = await runFrameLoop(e, host, opts);
  assert.equal(r2.steps, 0, '★那次点击不得在后续帧变成"推进"');
  assert.equal(e.curScript().ip, ipAtGate, '页仍停在门后');

  // ④ 再点一次 ⇒ 才推进（无热点 ⇒ 窗内推进文本 ⇒ 门清掉后尾两条派发到脚本尾）
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  const r3 = await runFrameLoop(e, host, { ...opts, maxFrames: 8 });
  assert.equal(r3.stopReason, 'script-end', '第二次点击后脚本应能跑完');
  assert.equal(r3.steps, 2, '尾两条 0x101 被派发');
});

test('stopReason：until 在帧开头生效 ⇒ frames 记"已跑完的帧数"、本帧一条都不派发', async () => {
  const e = mk([pollInput(), pollInput()]);
  const { host, advance } = mkHost();
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 10,
    until: () => true,
    onFrameEnd: advance,
  });
  assert.equal(r.stopReason, 'until');
  assert.equal(r.frames, 0);
  assert.equal(r.steps, 0);
});

test('stopReason：ip 越界 = script-end（且**不计**该帧为已完成）', async () => {
  const e = mk([pollInput(), pollInput()]);
  const { host, advance } = mkHost();
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 10,
    onFrameEnd: advance,
  });
  assert.equal(r.stopReason, 'script-end');
  assert.equal(r.steps, 2, '两条都派发了');
  assert.equal(r.frames, 0, '原实现也是 `return i`（不把这一帧算完成）');
});

/**
 * ★`0x400` 门的两档（这是"两份 chain 无条件清"与"report 完全不看"的真实差异）。
 * 合成脚本：`0x21C wait`（置 0x400）→ 两条 `0x101`。
 */
test("★0x400 门：'clear' 清位且该帧不派发；'ignore' 不看它（位留着、继续派发到脚本尾）", async () => {
  const script = (): BinInstruction[] => [instr(0x21c), pollInput(), pollInput()];
  const common = {
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 5,
  } satisfies Partial<FrameLoopOptions>;

  // 'clear'：第 1 帧执行 wait 后因门停批；第 2 帧清门、不派发（**清门要花掉一帧**）；第 3 帧一次放行余下两条
  {
    const e = mk(script());
    const { host, advance } = mkHost();
    const r = await runFrameLoop(e, host, { ...common, gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore' }, onFrameEnd: advance });
    assert.equal(r.stopReason, 'script-end');
    assert.equal(r.steps, 3, 'wait + 两条（清门那一帧不派发）');
    assert.equal(r.frames, 2, '第 3 帧才撞到脚本尾 ⇒ 只完整跑完 2 帧');
    assert.equal(e.waitFlags & 0x400, 0, "'clear' 把 0x400 清掉了");
  }
  // 'ignore'：位一直留着 ⇒ **内批的"遇门即停"仍然生效** ⇒ 每帧只放行 1 条 ⇒ 晚一帧到脚本尾
  //   （★`tickets/T-0010` 后已无入口用这一档：`report.ts` 修前是它，现在是 `'wait'` + 门分支记帧。
  //     保留这一档是因为它是驱动契约的一部分：`ignore` = "不看这一位"，与 `clear`/`wait` 语义不同。）
  {
    const e = mk(script());
    const { host, advance } = mkHost();
    const r = await runFrameLoop(e, host, { ...common, gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' }, onFrameEnd: advance });
    assert.equal(r.stopReason, 'script-end');
    assert.equal(r.steps, 3);
    assert.equal(r.frames, 3, "'ignore' 下每帧只放行 1 条 ⇒ 第 4 帧才到脚本尾");
    assert.notEqual(e.waitFlags & 0x400, 0, "'ignore' 不动这一位（不看 = 不清）");
  }
});

/**
 * ★`0x400` 门的第三档 `'wait'`（**产品档**：按引擎语义 = 池挂起位 + `0x238` 计时器）——
 * 宿主报"池还挂着"时门**不得**放行，否则"多窗动画没跑完就继续派发"的老 bug 会在产品链路上复现。
 * ★`T-0024`：判据从"宿主报动画跑完"改成"引擎的 `sub_407E20`"，宿主只交**池挂起位**（`host.poolPending`）。
 */
test("★0x400 门 'wait'：宿主报池挂起 ⇒ 不放行（位留着）；报了空闲才清位放行", async () => {
  const e = mk([instr(0x21c), pollInput(), pollInput()]);
  const box = { clock: 0, done: false };
  const host: FrameHost = { now: () => box.clock, poolPending: () => !box.done };
  const gateKinds: string[] = [];
  const bitAtFrameEnd: number[] = [];
  let ended = 0;
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'wait', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 6,
    onGate: (k) => gateKinds.push(k),
    onFrameEnd: () => {
      bitAtFrameEnd.push(e.waitFlags & 0x400 ? 1 : 0);
      box.clock += 1000 / 60;
      if (++ended === 2) box.done = true; // 第 3 帧起宿主报"池空闲"（下一边绘制才被门看见）
    },
  });
  assert.equal(r.stopReason, 'script-end');
  assert.equal(r.steps, 3, 'wait + 两条（等待的帧、清位的帧都不派发）');
  // ★`T-0024` 起池挂起位是**绘制期锁存量**（引擎 raw 130427-130428 每遍绘制开头清零、绘制期置位）：
  //   宿主在 `onFrameEnd`（= 这一遍绘制之后）把 `done` 翻真 ⇒ 它要到**下一遍**绘制才对门可见
  //   ⇒ 比"门在帧首现问宿主"多一帧。这正是引擎的次序（门读的是**上一遍**绘制的结果）。
  assert.equal(r.frames, 4, '第 5 帧才撞到脚本尾 ⇒ 只完整跑完 4 帧（池挂起位滞后一遍绘制）');
  assert.deepEqual(
    bitAtFrameEnd,
    [1, 1, 1, 0],
    '帧1 置位；帧2/帧3 池还挂着 ⇒ 位留着；帧4 池空闲 ⇒ 清位（第 5 帧不完整、不记）',
  );
  assert.equal(gateKinds.filter((k) => k === 'anim').length, 3, '门被访问三次：两次被挡、一次放行');
});

/** ★`sleep` 门的两档。合成脚本：`0xC8 sleep 1000`（置 SLEEP_GATE、sleepUntil=1000）→ 两条 `0x101`。 */
test("★sleep 门：'wait' 到点前不派发；'clear' 直接放行", async () => {
  const script = (): BinInstruction[] => [instr(0xc8, [im(1000)]), pollInput(), pollInput()];
  const common = {
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 100,
    maxFrames: 3,
  } satisfies Partial<FrameLoopOptions>;

  // 'wait'：虚拟时钟 3 帧才走 50ms < 1000 ⇒ 一直等，位留着
  {
    const e = mk(script());
    const { host, advance } = mkHost();
    const r = await runFrameLoop(e, host, { ...common, gates: { anim: 'ignore', sleep: 'wait', advance: 'ignore' }, onFrameEnd: advance });
    assert.equal(r.stopReason, 'cap');
    assert.equal(r.steps, 1, '只派发了 sleep 那条');
    assert.notEqual(e.waitFlags & SLEEP_GATE, 0, "'wait' 没到点 ⇒ 位留着");
  }
  // 'clear'：第 2 帧直接清位、放行余下两条
  {
    const e = mk(script());
    const { host, advance } = mkHost();
    const r = await runFrameLoop(e, host, { ...common, gates: { anim: 'ignore', sleep: 'clear', advance: 'ignore' }, onFrameEnd: advance });
    assert.equal(r.stopReason, 'script-end');
    assert.equal(r.steps, 3);
    assert.equal(e.waitFlags & SLEEP_GATE, 0);
  }
});

test('每帧服务开关：关掉 winReveal/charGrid 时驱动不碰它们（headless 各家的差异就是靠这个显式表达）', async () => {
  const e = mk([pollInput(), pollInput(), pollInput()]);
  const { host, advance } = mkHost();
  let winReveal = 0;
  let charGrid = 0;
  const eAny = e as unknown as { serviceWinReveal: () => void; serviceCharGrid: () => void };
  const ow = eAny.serviceWinReveal.bind(e);
  const oc = eAny.serviceCharGrid.bind(e);
  eAny.serviceWinReveal = () => {
    winReveal++;
    ow();
  };
  eAny.serviceCharGrid = () => {
    charGrid++;
    oc();
  };
  await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: true },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    onFrameEnd: advance,
  });
  assert.equal(winReveal, 0, 'winReveal 关了');
  assert.equal(charGrid, 2, 'charGrid 开着（每帧一次）');
});

/**
 * **音频帧泵**（`tickets/T-0003` 的 D5）：泵的所有权归**驱动** —— 每完整帧恰好一次、带本帧时钟与
 * `advActive`、且**先于**合成（引擎 raw 20645-20646 就在 present 段里）。
 *
 * 为什么必须锁"恰好一次"：B4 把 `session.ts` 迁到驱动时，如果忘记删掉 `#present()` 里那一处 tick，
 * 就会出现**每帧双 tick**（BGM 淡变走两倍速、延迟 SE 提前到期）——那种 bug 在画面上很难看出来。
 */
test('★音频帧泵：每完整帧恰好一次 tick，带本帧 nowMs 与 advActive，且先于合成（T-0003/D5）', async () => {
  const e = mk([pollInput(), pollInput(), pollInput()]);
  const box = { clock: 0 };
  const trace: string[] = [];
  const host: FrameHost = {
    now: () => box.clock,
    audio: (intent) => trace.push(`audio:${intent.kind}:${intent.nowMs}:${intent.advActive ? 1 : 0}`),
    advanceModel: (nowMs) => trace.push(`advance:${nowMs}`),
    present: () => trace.push('present'),
  };
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    onFrameEnd: () => (box.clock += 1000 / 60),
  });
  assert.equal(r.frames, 2);
  const t1 = 1000 / 60;
  assert.deepEqual(
    trace,
    ['audio:tick:0:0', 'advance:0', 'present', `audio:tick:${t1}:0`, `advance:${t1}`, 'present'],
    '每帧：tick → 推进模型 → 合成（顺序即产品路径 session.#present 的次序）',
  );
  assert.equal(trace.filter((t) => t.startsWith('audio:')).length, 2, '两帧 ⇒ 恰好两次 tick');
});

test('★音频帧泵：`audio: "never"` 时一次都不发（report.ts 的 C2 口径 + G2 逐字节不变）', async () => {
  const e = mk([pollInput(), pollInput()]);
  const box = { clock: 0 };
  let ticks = 0;
  const host: FrameHost = { now: () => box.clock, audio: () => ticks++ };
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    audio: 'never',
    onFrameEnd: () => (box.clock += 1000 / 60),
  });
  assert.equal(r.frames, 2);
  assert.equal(ticks, 0, 'never ⇒ 连一帧都不发');
});

test('★音频帧泵：撞脚本尾那一帧不算完整帧 ⇒ 不发 tick（与 session 的 break outer 一致）', async () => {
  const e = mk([pollInput()]);
  const box = { clock: 0 };
  let ticks = 0;
  let presents = 0;
  const host: FrameHost = { now: () => box.clock, audio: () => ticks++, present: () => presents++ };
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 10,
    maxFrames: 5,
    onFrameEnd: () => (box.clock += 1000 / 60),
  });
  assert.equal(r.stopReason, 'script-end');
  assert.equal(r.frames, 0, '第 1 帧就撞尾 ⇒ 没有完整帧');
  assert.equal(ticks, 0, '不完整帧不发 tick');
  assert.equal(presents, 0, '也不合成（与现有一致）');
});

/**
 * **`present: 'needsRender'`**（`tickets/T-0003`）：引擎式"没变就不重画"。
 * ★要点：只跳过**画**这一步，`advanceModel`（窗末收尾在那里）与音频 tick **都不能跳过**。
 */
test("★present: 'needsRender'：宿主说不用画就只推进模型、不 present（advanceModel 与 tick 照旧）", async () => {
  const e = mk([pollInput(), pollInput(), pollInput(), pollInput()]);
  const box = { clock: 0 };
  const trace: string[] = [];
  let want = false;
  const host: FrameHost = {
    now: () => box.clock,
    audio: () => trace.push('audio'),
    advanceModel: () => trace.push('advance'),
    present: () => trace.push('present'),
    needsRender: () => want,
  };
  const opts = {
    gates: { anim: 'ignore' as const, sleep: 'ignore' as const, advance: 'ignore' as const },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    present: 'needsRender' as const,
    onFrameEnd: () => (box.clock += 1000 / 60),
  };
  await runFrameLoop(e, host, opts);
  assert.deepEqual(trace, ['audio', 'advance', 'audio', 'advance'], '两帧都没画（宿主说不需要）');

  trace.length = 0;
  want = true;
  const e2 = mk([pollInput(), pollInput(), pollInput(), pollInput()]);
  await runFrameLoop(e2, host, opts);
  assert.deepEqual(trace, ['audio', 'advance', 'present', 'audio', 'advance', 'present'], '需要时才画（位置在推进模型之后）');
});


