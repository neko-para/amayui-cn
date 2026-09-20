/**
 * 用户实测修正（轮 8）：**ADV 逐字必须在屏上逐步出现**（两条独立的坑，都会让它失效）。
 *
 * ## 坑 A：推进了游标但**没发布给宿主**（`T-0100` 的改动 ② 漏了一行）
 * `Engine.serviceTextReveal` 把 `tickReveal`（全窗）收窄成 `tickRevealWin(cur)` 时，
 * **把 `for (const win of dirty) this.#publishReveal(win)` 一起删掉了** ⇒ 游标在 VM 里照常走
 * （`0x6E` 后约 `max(MessageSpeed, 一帧)`/字），但宿主只在 `msgWinSync` 时才重绘 ⇒ 屏上一直停在
 * 第 0 个字，直到别的路径（点击/收尾）发布一次。
 * **用户实测症状**：「必须等待逐字完成后才直接展示出来」。
 * **E4 判据**（`textLayer.ts:104` 只在 `revealed` **变化**时打印 `[reveal] win=N x/总数`）：
 * ADV 的日志只有 `[reveal] win=1 0/22` 与最终 `26/26`，中间态一个都没有；
 * 而同一份日志里 `win=9`（走 `0x300` 闸门泵那条**不经此处**的路）是 `1/10, 2/10, … 10/10` 逐步的。
 *
 * ## 坑 B：节流位置位期间**没跑泵**（`frame/loop.ts` 的 `sleep` 分支）
 * 引擎主循环 raw **21176-21181**：
 * ```c
 * if ( (v35 & 0x20000000) != 0 ) {        // ← 节流位（= SLEEP_GATE）
 *   sub_409400(_this);                   // ★⇒ 调「文本泵」：等节拍 → 推一个字
 *   if ( *(_DWORD *)(_this + 489860) ) goto LABEL_215;   // 只有 0x300 闸门槽活跃才不派发脚本
 * }
 * ```
 * 即**节流位不是「空等」而是「按节拍继续推进并重画」**。修前 `sleep` 分支什么都不做 ⇒ 门内不推进也不
 * 重绘。★`0x6E` 在轮 6 就置了节流位，而**轮 7 的 `T-0094` 把它加到了 `0x196 display-furigana`**
 * （语料 **6341 处**、且是在一句**中间**追加文本）⇒ 门内停顿的频率在轮 7 之后明显上升。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, SLEEP_GATE } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import type { MsgWinInput } from '../src/text/layout.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr, str } from './harness.js';

/** 造引擎 + 记录每次 `msgWinSync` 的 `revealed`（= 宿主真正被要求画出的字形数）。 */
function mk(ops: BinInstruction[]): {
  e: Engine;
  revealed: number[];
  /** ★**门内**（`SLEEP_GATE` 置位时）收到的发布 —— 坑 B 的唯一判据。 */
  revealedUnderGate: number[];
} {
  const native = new StubNative(() => {});
  const revealed: number[] = [];
  const revealedUnderGate: number[] = [];
  const e = new Engine(native); // 先建引擎：下面的探针要读它的 waitFlags
  native.msgWinSync = (_win: number, input: MsgWinInput) => {
    const rev = input.revealed ?? -1;
    revealed.push(rev);
    if ((e.waitFlags & SLEEP_GATE) !== 0) revealedUnderGate.push(rev);
  };
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
  loadScriptIntoFrame(e.curScript(), script, 'ADVREVEAL.BIN');
  return { e, revealed, revealedUnderGate };
}

/** 固定 60fps 虚拟时钟。 */
function mkHost(): { host: FrameHost; advance: () => void } {
  const box = { clock: 0 };
  return {
    host: { now: () => box.clock },
    advance: () => {
      box.clock += 1000 / 60;
    },
  };
}

const OPTS: FrameLoopOptions = {
  gates: { anim: 'ignore', sleep: 'wait', advance: 'ignore' },
  services: { winReveal: false, charGrid: false },
  advFrame: false,
  maxStepsPerFrame: 4,
};

/** `0x6E` 入队 8 字 + `0x72` 武装逐字（★`0x6E` 自己只置节流位并发布一次，扫描由 `0x72` 武装）。 */
const SCRIPT_8 = [instr(0x6e, [im(0), str('ABCDEFGH')]), instr(0x72, [im(0)])];

test('★坑 A：ADV 逐字必须**逐步发布**给宿主（0 < revealed < total 的中间态 ≥2 个）', async () => {
  const { e, revealed } = mk(SCRIPT_8);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 40); // 非 0 ⇒ 真逐字（0 = 同步排空）
  const { host, advance } = mkHost();
  await runFrameLoop(e, host, { ...OPTS, maxFrames: 30, onFrameEnd: advance });

  const uniq = [...new Set(revealed)].sort((a, b) => a - b);
  const middle = uniq.filter((v) => v > 0 && v < 8);
  assert.ok(
    middle.length >= 2,
    `★必须出现中间态（修前只有 ${JSON.stringify(uniq)}）⇒ 用户看到的是"等逐字完成后一次性出现"；` +
      `实测发布序列=${JSON.stringify(revealed)}`,
  );
  assert.equal(uniq[uniq.length - 1], 8, `最终应显完 8 字；实测 unique=${JSON.stringify(uniq)}`);
  for (let i = 1; i < revealed.length; i++) {
    assert.ok(revealed[i] >= revealed[i - 1], `revealed 不得回退：${JSON.stringify(revealed)}`);
  }
});

test('★坑 B：节流位置位期间仍要推进并发布（引擎 raw 21176 ⇒ `sub_409400`）', async () => {
  const { e, revealed, revealedUnderGate } = mk(SCRIPT_8);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 40);
  const { host, advance } = mkHost();
  let injected = false;
  await runFrameLoop(e, host, {
    ...OPTS,
    maxFrames: 40,
    onFrameEnd: advance,
    onFrameStart: () => {
      // 逐字进行到一半时，模拟 `0x196`/`0x6E` 在一句中间重新置节流位（真实语料 6341 处）
      if (!injected && e.textRevealing && (e.msgwin.reveal.get(1)?.shown ?? 0) >= 2) {
        injected = true;
        e.waitFlags |= SLEEP_GATE;
        e.sleepUntil = host.now() + 120; // 覆盖若干帧，保证"门内"确实有一段
      }
    },
  });
  assert.ok(injected, '本用例必须真的注入过"逐字途中的节流门"（否则断言无意义）');
  // ★唯一判据：**门还置着的时候**必须收到过发布 ⇒ 门内泵没停。
  //   （修前 sleep 分支什么都不做 ⇒ 门内 0 次发布；这一条就是"先红后绿"的开关。）
  assert.ok(
    revealedUnderGate.length >= 1,
    `★节流门内置位期间必须继续发布（修前门内泵停摆、0 次发布）；` +
      `实测门内发布=${JSON.stringify(revealedUnderGate)}，全程发布=${JSON.stringify(revealed)}`,
  );
  assert.equal(
    [...new Set(revealed)].sort((a, b) => a - b).pop(),
    8,
    `最终应显完 8 字；实测=${JSON.stringify(revealed)}`,
  );
});
