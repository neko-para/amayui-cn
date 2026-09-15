/**
 * **CLI（`run.ts`）的帧驱动口径守卫** —— `tickets/T-0012`。
 *
 * 为什么要有它：`run.ts` 是"最小可跑"入口（`npm run run`），修前它那份自造帧循环有四处漂移
 * （C1 时钟只在逐字分支前进 ⇒ `sleep` 门永不满足 / C3 逐字分支排在 `winReveal` 之前 /
 * C4 缺 `charGrid`·`advActive` 分支 / G3 没有统一的门）。B2 把四处改成"经共享帧驱动跑"，
 * 但**守卫一直没补**——真实卡点不是"CLI 不好测"，而是修前 `run.ts` 结尾是**无条件** `main()`
 * ⇒ 测试连 import 都会把 CLI 跑起来。`T-0012` 加了与 `report.ts` 同形的"直接执行才跑"守卫，
 * 并把驱动口径抽成 `runLoopOptions()`，本文件就能用**合成脚本**驱动**真的那份配置**。
 *
 * ★本文件第一件事就是"能 import 进来"本身：若有人把 `main()` 改回无条件执行，
 * 这里会立刻变成"跑整个 CLI"（输出/耗时/退出码全变），测试会红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runLoopOptions } from '../src/run.js';
import { runFrameLoop } from '../src/frame/loop.js';
import { PRODUCT_FRAME_POLICY } from '../src/renderer/app/session.js';
import { ADV_ACTIVE } from '../src/vm/engine.js';
import { im, instr, mkEngine, str } from './harness.js';
import type { BinInstruction } from '../src/script/bin.js';
import type { Engine } from '../src/vm/engine.js';
import type { FrameBranch } from '../src/frame/loop.js';

const FRAME_MS = 1000 / 60;

/** 用**真的 CLI 配置**驱动一个合成脚本，并把接线处的账都收回来。 */
async function driveCli(
  ops: BinInstruction[],
  opts: { maxSteps?: number; maxFrames?: number; prep?: (e: Engine) => void } = {},
): Promise<{ steps: number; frames: number; clock: number; gates: FrameBranch[]; perFrame: string[][]; stop: string; e: Engine }> {
  const e = mkEngine(ops);
  opts.prep?.(e);
  let steps = 0;
  let frames = 0;
  let clock = 0;
  const gates: FrameBranch[] = [];
  const perFrame: string[][] = [];
  let cur: string[] = [];
  // 服务打点（`frame-loop.test.ts` 同款：引擎实例上覆盖原型方法）
  const eAny = e as unknown as {
    serviceWinReveal: (t: number) => boolean;
    serviceCharGrid: (t: number) => boolean;
    serviceTextReveal: (t: number) => boolean;
    serviceAdv: () => boolean;
  };
  const orig = {
    win: eAny.serviceWinReveal.bind(e),
    grid: eAny.serviceCharGrid.bind(e),
    txt: eAny.serviceTextReveal.bind(e),
    adv: eAny.serviceAdv.bind(e),
  };
  eAny.serviceWinReveal = (t) => {
    cur.push('winReveal');
    return orig.win(t);
  };
  eAny.serviceCharGrid = (t) => {
    cur.push('charGrid');
    return orig.grid(t);
  };
  eAny.serviceTextReveal = (t) => {
    cur.push('textReveal');
    return orig.txt(t);
  };
  eAny.serviceAdv = () => {
    cur.push('adv');
    return orig.adv();
  };
  const r = await runFrameLoop(
    e,
    { now: () => clock },
    {
      ...runLoopOptions({
        maxSteps: opts.maxSteps ?? 0,
        executed: () => steps,
        beforeStep: () => {},
        afterStep: () => steps++,
        onAdvanceGate: () => {},
        onFatal: (m) => {
          throw new Error(`CLI 配置不该走到 onFatal：${m}`);
        },
        advanceClock: () => {
          // ★每帧末恰好一次 ⇒ 这里既是"时钟每帧前进"的计数，也是完整帧数（撞脚本尾那帧不算）。
          clock += FRAME_MS;
          frames++;
        },
      }),
      maxFrames: opts.maxFrames ?? 40,
      // ★按**帧**分桶必须用 `onFrameStart`：驱动在帧首先跑 `winReveal`/`charGrid`，之后才 `onGate`
      //   （用 `onGate` 分桶会把帧首那两个服务算进上一帧 ⇒ 顺序断言假红）。
      onFrameStart: () => {
        perFrame.push((cur = []));
      },
      onGate: (b) => gates.push(b),
    },
  );
  return { steps, frames, clock, gates, perFrame, stop: r.stopReason, e };
}

test('★能 import 而不执行 CLI：`runLoopOptions` 是可用的纯函数（T-0012 的守卫前提）', () => {
  const opt = runLoopOptions({
    maxSteps: 0,
    executed: () => 0,
    beforeStep: () => {},
    afterStep: () => {},
    onAdvanceGate: () => {},
    onFatal: () => {},
    advanceClock: () => {},
  });
  assert.equal(typeof opt, 'object');
  assert.equal(typeof opt.onStep, 'function');
});

/**
 * ★**直执行守卫的另一半**：`tsx src/run.ts` 必须真的把 CLI 跑起来。
 *
 * 为什么必须单独钉：`T-0012` 给 `run.ts` 加了"仅直接执行才跑 `main()`"的守卫，而**守卫写错的形态
 * 是静默的**——判断条件永不成立 ⇒ `npm run run` 变成空操作，而上面那些单测**全都照样绿**
 * （它们 import 的是 `runLoopOptions`，不经过 `main()`）。所以这里用子进程真跑一次：
 * `STEPS=1` ⇒ 恰好执行 1 条。★带 `--no-save-config --no-save-data`：测试不许碰玩家的 overlay。
 */
test('★直执行守卫：`tsx src/run.ts` 真的会跑 CLI（`STEPS=1` ⇒ 1 条）', () => {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/run.ts', '--no-save-config', '--no-save-data'],
    {
      cwd: appRoot,
      env: { ...process.env, STEPS: '1' },
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  assert.equal(r.status, 0, `子进程应正常退出（stdout=${r.stdout?.slice(-500)} stderr=${r.stderr?.slice(-500)}）`);
  assert.match(r.stdout ?? '', /共执行 1 条指令/, '★CLI 必须真的跑起来（守卫写错 ⇒ 这里是空的）');
});

/**
 * ★**C1：时钟每帧前进**（修前只在逐字分支里 `+= 16`，其余时间冻结 ⇒ `sleep` 门永不满足）。
 * 判据 = ① 每完整帧恰好 `1000/60`；② `sleep 100` 能被等满（修前会挂死）。
 */
test('★C1：虚拟时钟每帧前进（`sleep` 门因此能满足）（T-0012）', async () => {
  // ★用 `wait-for-input`（0x72）分组：每帧要么被等待门挡（`force` 放行）、要么派发一条 nop，
  //   于是能得到**完整帧**（撞脚本尾的那一帧不算完整帧 ⇒ 不能用"一串 nop"测帧数）。
  const pairs = (n: number): BinInstruction[] =>
    Array.from({ length: n }, () => [instr(0x72, [im(0)]), instr(0x101, [])]).flat();
  const a = await driveCli(pairs(3), { maxFrames: 40 });
  assert.ok(a.frames >= 4, `应当跑出多个完整帧（实际 ${a.frames}）`);
  // 浮点：逐帧累加与乘法在末位可能差 1e-14 ⇒ 用容差
  assert.ok(
    Math.abs(a.clock - a.frames * FRAME_MS) < 1e-9,
    `每完整帧恰好 +${FRAME_MS}ms（frames=${a.frames} clock=${a.clock}）`,
  );

  // `sleep 100`（0xC8）：引擎语义 = 帧让步到 `nowMs >= sleepUntil` ⇒ ~7 帧
  const b = await driveCli([instr(0xc8, [im(100)]), instr(0x101, [])], { maxFrames: 40 });
  assert.notEqual(b.stop, 'cap', 'sleep 门必须能被满足（修前时钟冻结 ⇒ 永不放行）');
  assert.equal(b.steps, 2, 'sleep 之后那条 nop 应当派发');
  assert.ok(b.clock >= 100, `时钟要走满 100ms（实际 ${b.clock}）`);
});

/**
 * ★**C3 + C4：每帧服务的顺序与开关**。
 * 修前 `run.ts` 的逐字分支排在 `serviceWinReveal` **之前**、且没有 `serviceCharGrid`；
 * 现在吃驱动的产品顺序（引擎主循环 raw 20887-20895：帧首 winReveal → charGrid → … → 逐字泵）。
 */
test('★C3/C4：帧首 winReveal → charGrid →（逐字分支）textReveal；ADV 分支开着（T-0012）', async () => {
  const r = await driveCli(
    [
      instr(0x6e, [im(0), str('こんにちは世界')]),
      instr(0x94, []),
      instr(0x72, [im(0)]),
      instr(0x101, []),
      instr(0x101, []),
    ],
    { maxFrames: 60, prep: (e) => e.engineValues.set(21668, 50) }, // message:MessageSpeed = 50ms
  );
  const revealFrame = r.perFrame.find((f) => f.includes('textReveal'));
  assert.ok(revealFrame, `应当出现过逐字帧（实际门序列：${r.gates.join(',')}）`);
  assert.deepEqual(
    revealFrame,
    ['winReveal', 'charGrid', 'textReveal'],
    '★逐字帧里顺序必须是 winReveal → charGrid → textReveal（修前逐字分支排在最前、且没有 charGrid）',
  );
  assert.ok(r.perFrame.every((f) => f.includes('charGrid')), 'charGrid 每帧都要跑（C4）');

  // ADV 分支（`advFrame: true`）：把 ADV 位置上 ⇒ 门应当选 'adv'
  const adv = await driveCli([instr(0x101, []), instr(0x101, [])], {
    maxFrames: 2,
    prep: (e) => {
      e.effectFlags |= ADV_ACTIVE;
    },
  });
  assert.ok(adv.gates.includes('adv'), `ADV 激活时应当走 'adv' 分支（实际 ${adv.gates.join(',')}）`);
});

/** ★**B2：`STEPS=n` 逐条生效**（修前 cap 只在帧边界判 ⇒ `STEPS=300` 会跑成 20000 条）。 */
test('★B2：`until` + `stopAfterStep` 按条数恰好停下（T-0012）', async () => {
  const r = await driveCli(
    Array.from({ length: 50 }, () => instr(0x101, [])),
    { maxSteps: 3, maxFrames: 40 },
  );
  assert.equal(r.steps, 3, '恰好 3 条（不是一整批 20000 条）');
  assert.equal(r.stop, 'step-stop');
});

/**
 * ★**棘轮：CLI 的门档必须与产品一致，唯一允许的差异是 `anim`**。
 *
 * `anim: 'clear'` 的理由是**宿主能力缺口**：本 CLI 的宿主是 `StubNative`（没有场景模型）⇒
 * `host.poolPending` 无从计算（`src/frame/host.ts` 已声明"未实现 ⇒ 只等 `0x238` 计时器"），
 * 归 `tickets/T-0013`。除它之外的任何漂移（`sleep`、`advance`、服务开关、ADV 分支）都不许有。
 */
test('★棘轮：CLI 的门档/服务开关只允许 `anim` 与产品不同（宿主能力缺口 T-0013）', () => {
  const opt = runLoopOptions({
    maxSteps: 0,
    executed: () => 0,
    beforeStep: () => {},
    afterStep: () => {},
    onAdvanceGate: () => {},
    onFatal: () => {},
    advanceClock: () => {},
  });
  assert.equal(opt.gates!.anim, 'clear', '★CLI 的 anim 档是 StubNative 缺 poolPending 的补偿，不是随意选的');
  assert.equal(opt.gates!.advance, 'force', '★CLI 是 headless（无输入源）⇒ 等待门按"玩家立刻点了"放行');
  assert.deepEqual(
    { ...opt.gates!, anim: 'wait', advance: 'pump' },
    PRODUCT_FRAME_POLICY.gates,
    '★除 anim（无池挂起位）与 advance（无输入源）这两条宿主缺口外，CLI 的门档必须等于产品',
  );
  assert.deepEqual(opt.services, { winReveal: true, charGrid: true }, '两个每帧服务都要开（C4）');
  assert.equal(opt.advFrame, true, 'ADV 分支要开（C4）');
});
