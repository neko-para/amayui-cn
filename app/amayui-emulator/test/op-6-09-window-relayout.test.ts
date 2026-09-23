/** @tier T0 @kind core @subsystem adv */

/**
 * 审计 `op-6-09`：`0x20A` 的引擎体有**两条**效果，emulator 折进一次 `emitWin`。
 *
 * 引擎 `sub_423620`（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 * ```c
 * 31553  _this[30 * _this[95776] + 95805] = 3;      // 步长槽
 * 31554  v2 = sub_41BF50(_this, 1);                 // op1（窗）
 * 31555  sub_45AD30((int)(_this + 21324), v2);      // ★效果①：重排该窗文本（raw 71481-…）
 * 31556  if ( _this[124350] ) v3 = _this[95779]; else v3 = _this[174801];
 * 31560  if ( (v3 & 0x40000000) != 0 ) {            // ★bit30 = 逐字显现中
 * 31562      v5 = _this[107704];                    //    字格游标（**当前**值）
 * 31564      sub_45A940(_this + 21324, v4, v5, 0);  // ★效果②：重贴第 v5 格（不改游标）
 * ```
 * `sub_45A940` 的 `a3 >= 0` 分支（raw 71380-71413）按 `k % cols` / `k / cols` 算字格坐标 ⇒ 确实
 * 是"贴第 k 格"；`-1`/`-2` 才是查询/收尾哨兵。
 *
 * 本文件把**等价性**钉住（选②：不显式调重排，而是断言 emit 通道必定重排、载荷带活 segments）：
 *  - 重排的对应物 = `renderer/scene/ops.ts` 的 `scMsgWinSync`（**两个宿主共用**：
 *    `HeadlessScene.msgWinSync` 与 `PixiBackend.msgWinSync` 都调它）里那次 `layoutWindow`；
 *  - 重贴的对应物 = `emitWin` 载荷里的 `cell`（门正好是 `effectFlags & CHAR_REVEAL_ACTIVE`，
 *    `k` 正好是当前 `msgwin.cellK % cells`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAR_REVEAL_ACTIVE, Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { layoutWindow, type MsgWinInput, type TextFrame } from '../src/text/layout.js';
import { styleOfWin } from '../src/vm/handlers/msgwin.js';
import { im, instr } from './harness.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

/** 造一个装在**指定宿主**上的合成脚本引擎（`harness.mkEngine` 固定用 StubNative，这里要 HeadlessScene）。 */
function mk(ops: BinInstruction[], native: HeadlessScene): Engine {
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
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');
  return e;
}

/** 排版的可比投影（`TextFrame` 里的 `style` 含 Map 之类，逐项比会脆；只比几何/字形/游标）。 */
function proj(f: TextFrame): unknown {
  return {
    win: f.win,
    glyphCount: f.glyphCount,
    revealed: f.revealed,
    lines: f.lines.map((l) => ({ x: l.x, y: l.y, width: l.width, glyphs: l.glyphs.map((g) => [g.ch, g.x, g.y]) })),
  };
}

/** 预置一个"已有文本 + 字格 + 逐字显现位 + 当前游标 = 2"的窗（`0x6E`/`0x73`/`0x1CE` 的等价物）。 */
function fixture(): { e: Engine; scene: HeadlessScene; seen: MsgWinInput[] } {
  const scene = new HeadlessScene();
  const e = mk([instr(0x20a, [im(1)])], scene);
  e.msgwin.addRuby(1, '天結', 'あまゆ');
  e.msgwin.appendText(1, 'テスト');
  e.msgwin.setCharGrid(1, {
    textX: 10,
    textY: 20,
    srcSurface: 5,
    originX: 0,
    originY: 0,
    cellW: 35,
    cellH: 35,
    cells: 10,
    gate: true,
    tickMs: 60,
  });
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  e.msgwin.cellK = 2;
  const laid = layoutWindow(1, { style: styleOfWin(e, 1), segments: e.msgwin.slot(1).segments });
  e.msgwin.beginReveal(1, laid.glyphCount, 0, 0); // 立即显示完 ⇒ 无 active 显现态
  e.msgwin.reveal.get(1)!.shown = 2; // 当前逐字游标 = 2（没显完，但泵不在跑）
  const seen: MsgWinInput[] = [];
  const orig = scene.msgWinSync.bind(scene);
  scene.msgWinSync = (win, input) => {
    seen.push(input);
    orig(win, input);
  };
  return { e, scene, seen };
}

test('op-6-09：`0x20A` = 重排（emit 通道 `layoutWindow`）+ 按当前字格重贴（`cell.k`），两者都不动游标', async () => {
  const { e, scene, seen } = fixture();
  assert.equal(e.msgwin.isRevealing(1), false, '前提：不是"正在显现"（否则 `cell` 会被那条例外挡住）');

  await stepOnce(e); // 0x20A

  assert.equal(seen.length, 1, '恰好发布一次（引擎 raw 31555 + 31564 的两次调用折成一次发布）');
  // ★效果①的等价性判据：载荷带的是**活** segments（引用同一数组）⇒ 宿主那次 `layoutWindow`
  //   看到的就是"重排前的最终内容" ⇒ 与 `sub_45AD30(Font, win)` 的结果一致。
  assert.equal(seen[0]!.segments, e.msgwin.slot(1).segments, '★载荷的 segments 是活引用（scMsgWinSync 会据此重排）');
  // ★效果②：按**当前**字格游标重贴，游标不动（`sub_45A940(..., k, 0)` 只贴不推进）。
  assert.equal(seen[0]!.cell?.k, 2, 'cell 门 = bit30（raw 31560）、k = 当前 `Engine[107704]` = 2');
  assert.equal(e.msgwin.cellK, 2, '字格游标不动');
  assert.equal(seen[0]!.revealed, 2, '文字游标同样不动（重贴用的是当前值）');
  // 宿主确实**重排**了：存下来的帧 == 对载荷做一次 `layoutWindow`
  const stored = scene.scene.msgWins.get(1)!;
  assert.deepEqual(proj(stored), proj(layoutWindow(1, seen[0]!)), '★宿主通道的重排结果 = 载荷的 layoutWindow（= sub_45AD30）');
  assert.equal(stored.revealed, 2, '宿主拿到的逐字游标 = 2（不是 0、也不是全部）');
});

test('op-6-09：bit30 未置时载荷不带 `cell`（raw 31556-31560 那个条件）—— 效果②的门', async () => {
  const { e, seen } = fixture();
  e.effectFlags &= ~CHAR_REVEAL_ACTIVE; // 退出逐字显现
  await stepOnce(e);
  assert.equal(seen.length, 1, '效果①（重排/发布）与 bit30 无关，照旧发生');
  assert.equal(seen[0]!.cell, undefined, '★bit30 未置 ⇒ 引擎不调 `sub_45A940`（raw 31560）⇒ 无 cell');
});

test('op-6-09：`0x20A` 不改该窗文本内容（重排 ≠ 改内容）', async () => {
  const { e, seen } = fixture();
  const before = e.msgwin.slot(1).segments.map((s) => [s.text, s.ruby.length]);
  await stepOnce(e);
  assert.deepEqual(
    e.msgwin.slot(1).segments.map((s) => [s.text, s.ruby.length]),
    before,
    '`sub_45AD30` 只重排行/字形，不增删文本记录（emulator 侧 segments 是脚本真源）',
  );
  assert.equal(seen[0]!.segments.length, before.length);
});
