/**
 * `tickets/T-0100` 守卫：**帧泵只许发布「当前窗」**。
 *
 * ## 根因（只读诊断全文见 `tickets/T-0100/design.md`，现场日志见同票 `evidence/`）
 * 引擎每帧泵只把**当前窗**交给 `sub_45BE20`：
 * ```
 * raw 13943-13945:  do
 *                     result = sub_45BE20(_this + 85296, *(_DWORD *)(_this + 489484));
 *                   while ( !result );
 * ```
 * `489484/4 = 122371` = **当前窗**（由 `0x6E` raw 28365/28381、`0x71`/`0x72` raw 28545 写）。
 * 而 emulator 修前有**三处**会发布"所有已知窗"：
 *   ① `Engine.serviceRevealAdvanceInput`（逐字期间点击 ⇒ 整页贴完）遍历 `msgwin.reveal` 的**所有**键；
 *   ② `Engine.serviceTextReveal`（每帧逐字泵）用 `tickReveal` 推进并发布所有窗；
 *   ③ `0x70` 的 handler 调 `emitAllWins`。
 *
 * ## 用户可见后果（E4，用户实测）
 * SN0000（序章，正文在**窗 8**，满屏 1280×720@(0,0) + 居中）→ 章头转场 → `SC0000`（正文在**窗 1**）。
 * 切场景时脚本用 `detach-texture 19a28 1f4`（`src/NOVEL.txt:415`）删掉屏上的正文行区间，emulator
 * **忠实清掉了** `scene.msgWins`（日志 `文本窗清=8`）—— 但窗 8 的 `reveal` 条目仍留在 `reveal` Map 里
 * （引擎同样保留 `win+132` 游标，这是**合法**的），于是 `SC0000` 第一页逐字期间**点一下鼠标**就把
 * 序章的最后一页重新贴回屏中央（日志 8655/8658，此后每次点击复发）。
 *
 * ## 本文件钉住的纪律
 * - 窗的 `reveal` 条目**允许残留**（禁止用"清 `slots[8]`/`reveal[8]`/场景边界 reset"来修）；
 * - 但**不得被发布**（`msgWinSync` 不得收到非当前窗）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, str } from './harness.js';

/** 造一个引擎：`StubNative` + 记录每次 `msgWinSync(win)` 收到的窗号。 */
function mk(ops: BinInstruction[]): { e: Engine; synced: number[] } {
  const native = new StubNative(() => {});
  const synced: number[] = [];
  native.msgWinSync = (win: number) => {
    synced.push(win);
  };
  const e = new Engine(native);
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
  loadScriptIntoFrame(e.curScript(), script, 'T0100.BIN');
  return { e, synced };
}

/**
 * 复现"上一屏残留 + 切到新窗"的形状：
 * 窗 8 入队并武装逐字 → `0x71` 切到窗 1 → 窗 1 入队并武装逐字。
 * ⇒ 此时 `reveal` 里**同时**有 8（残留，active）与 1（当前）。
 */
async function residualThenCurrent(): Promise<{ e: Engine; synced: number[] }> {
  const { e, synced } = mk([
    instr(0x6e, [im(8), str('この物語は')]), // 上一屏：窗 8 入队（6 字）
    instr(0x72, [im(8)]), // 武装窗 8 的逐字
    instr(0x71, [im(1)]), // ★切到窗 1（开始新一段）—— 窗 8 的 reveal 条目**留着**
    instr(0x6e, [im(1), str('すごい')]), // 窗 1 入队（3 字）
    instr(0x72, [im(1)]), // 武装窗 1 的逐字
  ]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 50); // 非 0 ⇒ 真逐字（0 会同步排空、看不见）
  for (let i = 0; i < 5; i++) await stepOnce(e);
  return { e, synced };
}

test('T-0100 前置：`reveal` 里同时留下「残留窗 8」与「当前窗 1」', async () => {
  const { e } = await residualThenCurrent();
  assert.equal(e.msgwin.reveal.get(8)?.total, 5, '窗 8（`この物語は` = 5 字）的 reveal 条目应当留着（引擎也保留 win+132 游标）');
  assert.equal(e.msgwin.reveal.get(8)?.active, true, '窗 8 仍在逐字中（没被显完）');
  assert.equal(e.msgwin.reveal.get(1)?.total, 3, '窗 1（当前窗）已在逐字');
  assert.equal(e.msgwin.resolveWin(e.msgwin.lastArg), 1, '`lastArg` 指向当前窗 = 1');
  assert.equal(e.textRevealing, true, '本帧处于逐字分支');
  // ★辨别力证明（不依赖"把代码改回旧写法跑一遍"）：`reveal` 的键**确实同时**含 1 与 8
  //   ⇒ 修前那三处"遍历所有 key / emitAllWins"必然把 8 一起发布出去（①②③ 因此不是空断言）。
  assert.deepEqual(
    [...e.msgwin.reveal.keys()].sort((a, b) => a - b),
    [1, 8],
    'reveal 同时含当前窗 1 与残留窗 8 ⇒ 旧的"全窗发布"写法必然发布 8',
  );
});

test('★T-0100 ①：逐字期间的点击只发布**当前窗**（不得把残留的窗 8 贴回屏）', async () => {
  const { e, synced } = await residualThenCurrent();
  synced.length = 0; // 只观察"这次点击"发布了谁（前面的 0x6E 发布会其本窗，合法）
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  assert.equal(e.serviceRevealAdvanceInput(), true, '逐字期间的左键应由「贴完整页」出口消费');
  assert.equal(e.msgwin.reveal.get(1)?.shown, 3, '当前窗被贴满');
  assert.equal(
    synced.includes(8),
    false,
    `★修前这里会把残留的窗 8 一起发布回屏（用户实测：进 SC0000 后点一下 ⇒ 屏中央冒出序章最后一页）。实测发布窗号=${JSON.stringify(synced)}`,
  );
  assert.deepEqual([...new Set(synced)], [1], `只许发布当前窗 1；实测=${JSON.stringify(synced)}`);
  assert.equal(e.msgwin.reveal.get(8)?.active, true, '★不许用"清 reveal[8]"来修（引擎保留游标）');
});

test('★T-0100 ②：每帧逐字泵只推进/发布当前窗（残留窗既不被推进也不被发布）', async () => {
  const { e, synced } = await residualThenCurrent();
  const shown8 = e.msgwin.reveal.get(8)!.shown;
  synced.length = 0;
  const later = e.nowMs + 1000; // 远超 interval（50ms）⇒ 若"全窗推进"会各走一格
  e.serviceTextReveal(later);
  assert.equal(
    e.msgwin.reveal.get(8)!.shown,
    shown8,
    '★残留窗 8 的游标不许被推进（引擎每帧只泵当前窗，raw 13943-13945）',
  );
  assert.equal(synced.includes(8), false, `残留窗 8 不许被发布；实测=${JSON.stringify(synced)}`);
});

test('★T-0100 ③：`0x70` 只发布本指令点名的窗（其余窗的正文记录还在也不许重画）', async () => {
  const { e, synced } = mk([
    instr(0x6e, [im(8), str('この物語は')]), // 窗 8 有正文
    instr(0x72, [im(8)]),
    instr(0x71, [im(1)]),
    instr(0x6e, [im(1), str('すごい')]), // 窗 1 有正文
    instr(0x72, [im(1)]),
    instr(0x70, [im(1), im(880), im(148), im(190), im(557)]), // 几何：只该发布窗 1
  ]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 50);
  for (let i = 0; i < 5; i++) await stepOnce(e); // 前 5 条（到 0x70 之前）
  assert.equal(e.msgwin.slots.has(8), true, '窗 8 的正文记录还在（修前正是它被 `emitAllWins` 重画）');
  synced.length = 0;
  await stepOnce(e); // 第 6 条 = `0x70`
  assert.deepEqual([...new Set(synced)], [1], `0x70 只许发布它点名的窗 1；实测=${JSON.stringify(synced)}`);
  assert.equal(synced.includes(8), false, '★窗 8 不许因为"记录还在"而被重画（`T-0100` 的缺口③）');
});
