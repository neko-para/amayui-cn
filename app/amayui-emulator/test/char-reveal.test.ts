/**
 * **字格逐字显现（逐字渲染）回归** —— 对应台账 `msgwin-char-reveal-grid`。
 *
 * 引擎侧事实（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 *  - `0x73`（`sub_41F250` raw 28601-28639）= 设字格：9 个操作数经 `sub_456430` 拷进窗对象
 *    `win+60..99`（`win+88 = 1` 是**逐字总门**、`win+92 = win+96 = op9` 是字格数/列数），
 *    op10 经 `sub_453AD0(Engine+430600, ms)` 设**逐字节拍**（0 ⇒ 1）；
 *  - `0x72`（`sub_41EEF0` raw 28539-28554）= 每次 `wait-for-input` 都：查询字格数写进
 *    `Engine[107705]` → 置 bit31 等待门 → 若未在逐字模式则置 `0x40000000` + `Engine[107704] = 0`
 *    + `sub_453A90`（重启节拍）；
 *  - 主循环（raw 20887-20895）：bit30 置位时每帧 `sub_453AF0(Engine+430600)`（节拍门）⇒
 *    `sub_45A940(Font, 当前窗, Engine[107704], 0)`（贴出第 k 个字格）⇒ `k = (k+1) % Engine[107705]`；
 *  - 点击推进（raw 20025-20030）与 `0x1CE 0`（raw 29344-29349）：`sub_45A940(...,-2,0)` 收尾 + 清 bit30；
 *  - `0x20A`（`sub_423620` raw 31546-31566）= 重排 + 按当前游标重贴；`0x304`/`0x305`（raw 24610/25096）
 *    = 文本块括号（保存/取回行游标 + 把余下的行贴出）。
 *
 * 脚本侧只有 27 处 `i073`（`NOVEL.txt:11/265`、`SN0000.txt` 各页、`SYSTEM4.txt:41`）——
 * 也就是**序章 / NOVEL / SYSTEM4 才走引擎的逐字**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { Engine, Frame, CHAR_REVEAL_ACTIVE } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const str = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;

function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}

function mk(native: StubNative | HeadlessScene = new StubNative(() => {})): {
  e: Engine;
  step: (op: number, args?: BinArg[]) => void;
} {
  const e = new Engine(native);
  const f = new Frame();
  return {
    e,
    step: (op, args = []) => {
      const h = OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应在 OPS 里（真实现）`);
      h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
    },
  };
}

/** SN0000 序章页的字格：`i073 8 0 <op3> c 0 <op6> 38 38 8 64`（格 56×56、8 格、100ms）。 */
function grid(win: number, op3: number, op6: number): BinArg[] {
  return [im(win), im(0), im(op3), im(0xc), im(0), im(op6), im(0x38), im(0x38), im(8), im(100)];
}

test('★0x73 设字格：写入字格块（含 win+88 总门）与逐字节拍（op10）', () => {
  const { e, step } = mk();
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  const g = e.msgwin.gridOf(8);
  assert.ok(g, '字格应写进窗 8');
  assert.deepEqual(
    { textX: g!.textX, textY: g!.textY, originX: g!.originX, originY: g!.originY, cellW: g!.cellW, cellH: g!.cellH, cells: g!.cells, gate: g!.gate, tickMs: g!.tickMs },
    { textX: 0, textY: -5, originX: 0, originY: -280, cellW: 0x38, cellH: 0x38, cells: 8, gate: true, tickMs: 100 },
  );
  assert.equal(e.msgwin.gridTickMs(8), 100, '节拍 = op10（引擎 sub_453AD0）');
  // 节拍 0 时引擎取 1（raw 66142-66143）
  step(0x73, [...grid(8, -5, -280).slice(0, 9), im(0)]);
  assert.equal(e.msgwin.gridTickMs(8), 1, 'op10 = 0 ⇒ 节拍 1ms');
  // 无字格的窗 ⇒ 无覆盖节拍（走 message:MessageSpeed）
  assert.equal(e.msgwin.gridTickMs(3), undefined);
});

test('★0x72 启动逐字：字格页的节拍 = 0x73 op10（不是 message:MessageSpeed）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 5); // message:MessageSpeed = 5ms
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('一二三四五')]); // 5 字
  step(0x72, [im(8)]);
  const st = e.msgwin.reveal.get(8);
  assert.ok(st, '0x72 应启动显现');
  assert.equal(st!.intervalMs, 100, '字格页节拍 = 100ms（引擎 sub_453AF0 用 Engine+430600）');
  assert.equal(st!.nextAt, 100, '首个字也要等满一个节拍');
  assert.equal(e.msgwin.charMode, true, 'effect_flags bit30 应置位');
  assert.equal(e.msgwin.charTotal, 8, 'Engine[107705] = win+92 = op9（引擎的循环模数）');
  assert.equal(e.engineValues.get(107705), 8);
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, CHAR_REVEAL_ACTIVE);

  // 一帧（16.7ms）不该推进；100ms 才走 1 个字（不跨节拍补齐）
  e.serviceTextReveal(16.7);
  assert.equal(e.msgwin.revealedOf(8), 0, '未到 100ms 节拍 ⇒ 不动');
  e.serviceTextReveal(100);
  assert.equal(e.msgwin.revealedOf(8), 1, '到点走一个字');
  assert.equal(e.engineValues.get(107704), 1, '字格游标 Engine[107704] +1');
  e.serviceTextReveal(250);
  assert.equal(e.msgwin.revealedOf(8), 2, '过了下一个节拍点 ⇒ 只走一步（不补齐）');
  e.serviceTextReveal(260);
  assert.equal(e.msgwin.revealedOf(8), 2, '下一次节拍（350ms）未到 ⇒ 原地');
});

test('无字格页仍按 message:MessageSpeed（引擎逐字只走 i073 那条路）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 25);
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('あいう')]);
  step(0x72, [im(9)]);
  const st = e.msgwin.reveal.get(9);
  assert.equal(st!.intervalMs, undefined, '无字格 ⇒ 不覆盖节拍');
  assert.equal(st!.nextAt, 25, '节拍 = max(MessageSpeed, 一帧) = 25ms');
});

test('★0x1CE：v≠0 置逐字模式并清零游标；v=0 收尾（整段贴出）+ 清位', () => {
  const { e, step } = mk();
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('あいうえお')]);
  e.msgwin.reveal.set(8, { shown: 2, total: 5, active: true, nextAt: 0 });
  step(0x1ce, [im(1)]);
  assert.equal(e.msgwin.charModeArg, 1);
  assert.equal(e.engineValues.get(107706), 1);
  assert.equal(e.engineValues.get(107704), 0, '游标归零（raw 29338）');
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, CHAR_REVEAL_ACTIVE);
  step(0x1ce, [im(0)]);
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, 0, 'v=0 ⇒ 清 bit30');
  assert.equal(e.msgwin.revealedOf(8), 5, '收尾 = 整段贴出（sub_45A940 k=-2）');
});

test('★点击推进：先把逐字收尾（整段显示）再放行（引擎 raw 20025-20030）', () => {
  const { e, step } = mk();
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('一二三四五')]);
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 0);
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  assert.equal(e.serviceAdvanceWait(), true, '点击应放行等待门');
  assert.equal(e.msgwin.revealedOf(8), 5, '放行前先补完整段');
  assert.equal(e.msgwin.charMode, false, '逐字模式应退出');
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, 0);
});

test('★0x20A（过去未注册 ⇒ 命中即硬报错）：重排重画但不动游标', () => {
  const { e, step } = mk();
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x72, [im(8)]);
  e.serviceTextReveal(100);
  assert.equal(e.msgwin.revealedOf(8), 1);
  step(0x20a, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 1, '重画不改变已显示字数（引擎用当前游标重贴同一格）');
  assert.ok(OPS.has(0x20a), '0x20A 必须已注册');
});

test('★0x304/0x305 文本块括号：保存/取回行游标 + 把余下的行贴出', () => {
  const native = new HeadlessScene({});
  const { e, step } = mk(native);
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x72, [im(8)]);
  e.serviceTextReveal(100);
  assert.equal(e.msgwin.revealedOf(8), 1);
  step(0x304, []); // 保存（引擎 win+296 ← win+132）
  assert.equal(e.msgwin.flags, 1, 'Engine[122497] = 1（文本块内的注音/内嵌模式）');
  step(0x305, []); // 取回 + 把余下的行一次性贴出
  assert.equal(e.msgwin.revealedOf(8), 5, '0x305 的 `while(!sub_45BE20())` = 整段贴出');
  assert.equal(e.msgwin.charMode, false);
  assert.ok(native.scene.msgWins.has(8), '文本仍在渲染模型里（只是全部显示完）');
});

test('★真实序章页序列（SN0000：i304 → show-text → i305 → i073 → wait-for-input → 点击 → i071 清场）', () => {
  const { e, step } = mk();
  step(0x80, [im(8)]);
  // 引擎的文本块：i304 保存游标 → 写正文 → i305 取回并贴出
  step(0x304, []);
  step(0x6e, [im(0), str('二つの世界が')]);
  step(0x6f, [im(0)]);
  step(0x6e, [im(0), str('融合して')]);
  step(0x6f, [im(0)]);
  step(0x305, []);
  // 页末：i073 设字格 → wait-for-input 启动逐字
  step(0x73, grid(8, -5, 56));
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.charMode, true);
  assert.equal(e.msgwin.reveal.get(8)!.total, 10, '本页 10 个字（二つの世界が 6 + 融合して 4）');
  // 逐字：100ms 一个字
  let shown = 0;
  for (let t = 100; t <= 1000; t += 100) {
    e.serviceTextReveal(t);
    shown = e.msgwin.revealedOf(8);
  }
  assert.equal(shown, 10, '1000ms 后 10 个字全部显示完');
  assert.equal(e.textRevealing, false);
  assert.equal(e.msgwin.charMode, false, '显完即退出逐字模式');
  // 点击 → 放行 → 页末 i071 清窗（下一页开始前清场）
  e.input.setCursor(10, 10);
  e.input.pressMouse(0);
  assert.equal(e.serviceAdvanceWait(), true);
  step(0x71, [im(8)]);
  assert.deepEqual(e.msgwin.slot(8).segments, [], 'i071 清场（清理上一页）');
});

/**
 * ★2026 反馈回归：「CONFIG1 打开后样例文案似乎只展示了一次，实际会不断循环」。
 *
 * `0x300 <win> <flags> <ms>`（`sub_426990` raw 33743-33754）把该窗的**逐行贴出闸门**（bit0）
 * 与"贴完后停留 ms 再清场"写进 `Engine[122466+win]/[122476+win]`；`sub_409400` 的第一循环
 * （raw 13838-13888）每帧从 `win+132` 贴出一行，整段贴完后记时刻，过 ms 调 `sub_404F80`
 * （清绘制项 + `win+132 = 0`，**闸门位仍为 1**）⇒ 下一帧从头再贴 ⇒ **无限循环**。
 */
test('★0x300 闸门循环：贴出 → 停留 op3 ms → 清场 → 重新贴出（CONFIG 消息预览）', () => {
  const native = new HeadlessScene({});
  const { e, step } = mk(native);
  e.engineValues.set(21668, 10); // message:MessageSpeed = 10ms
  step(0x80, [im(9)]);
  step(0x300, [im(9), im(1), im(100)]); // 开闸 + 停留 100ms（CONFIG 是 3e8）
  const g = e.msgwin.gateOf(9);
  assert.equal(g.enabled, true, 'i300 9 1 … ⇒ 闸门 bit0 = 1');
  assert.equal(g.autoHideMs, 100, '停留时长 = op3');
  step(0x71, [im(9)]);
  step(0x6e, [im(0), str('あいうえお')]); // 5 字
  step(0x6f, [im(0)]);

  // 逐帧推进：节拍 = max(MessageSpeed=10, 一帧=16.7) ⇒ 每帧一个字
  let t = 0;
  const seq: number[] = [];
  const tick = (): number => {
    t += 1000 / 60;
    e.nowMs = t;
    e.serviceWinReveal(t);
    const r = e.msgwin.revealedOf(9);
    seq.push(r < 0 ? 5 : r);
    return r;
  };
  for (let i = 0; i < 40; i++) tick();
  assert.equal(Math.max(...seq), 5, `应整段贴出一次，实际 ${seq.join(',')}`);
  const firstFull = seq.indexOf(5);
  const after = seq.slice(firstFull);
  const zeroAt = after.indexOf(0);
  assert.ok(zeroAt > 0, `整段贴出后应清场（revealed=0），实际 ${seq.join(',')}`);
  assert.ok(Math.max(...after.slice(zeroAt)) > 0, `清场后应重新贴出（循环），实际 ${seq.join(',')}`);
  assert.equal(native.scene.msgWins.has(9), true, '循环期间该窗仍在渲染模型里');
});

test('★0x300 关闸（i300 win 0 0）：把余下的行排空并清闸门/延时', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 100); // 100ms/行 ⇒ 5 字 1 行的预算 100ms，逐字可见
  step(0x80, [im(9)]);
  step(0x300, [im(9), im(1), im(1000)]);
  step(0x71, [im(9)]);
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x6f, [im(0)]);
  let t = 0;
  for (let i = 0; i < 3; i++) {
    t += 1000 / 60;
    e.serviceWinReveal(t);
  }
  assert.ok(e.msgwin.revealedOf(9) < 5, `关闸前应是逐步贴出状态（实际 ${e.msgwin.revealedOf(9)}）`);
  step(0x300, [im(9), im(0), im(0)]); // 关闸（CONFIG.txt:195）
  e.serviceWinReveal(t);
  const g = e.msgwin.gateOf(9);
  assert.equal(g.enabled, false);
  assert.equal(g.pumping, false);
  assert.equal(g.autoHideMs, 0, '关闸时清延时（raw 13849-13851）');
  assert.equal(e.msgwin.revealedOf(9), 5, '关闸时把余下的行排空（`while(!sub_45BE20())`）');
});

/**
 * ★2026 反馈回归：「第一次从主界面进设置时，ADV 文案直接展示出来，而背景还没切换」。
 *
 * 闸门开着时，引擎的可见性**完全由泵的 `sub_45BE20` 决定**（`win+132` 从 0 开始、`i071` 刚清过场
 * ⇒ 一行都还没贴）。若把"无显现状态"解释成 -1（全部显示），`show-text` 写完就会整段直接出现
 * ⇒ 文案抢在背景之前。故闸门窗在泵贴出前必须是 **0 字**。
 */
test('★闸门窗在泵贴出前不得可见：revealedOf = 0（不是 -1），贴出后才出现', () => {
  const native = new HeadlessScene({});
  const { e, step } = mk(native);
  e.engineValues.set(21668, 100); // 100ms/行 ⇒ 不会一帧出完，便于观察
  step(0x80, [im(9)]);
  step(0x300, [im(9), im(1), im(1000)]); // CONFIG.txt:171 开闸
  step(0x71, [im(9)]); // 开始一段新消息（清窗）
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x6f, [im(0)]);
  assert.equal(e.msgwin.revealedOf(9), 0, '闸门窗：show-text 之后、泵贴出之前 = 0 字（否则文案抢在背景前面）');
  const f0 = native.scene.msgWins.get(9);
  assert.equal(f0?.revealed, 0, '渲染模型里也必须是 0 字');

  // 泵推进后才逐字出现
  let t = 0;
  for (let i = 0; i < 3; i++) {
    t += 1000 / 60;
    e.serviceWinReveal(t);
  }
  assert.ok((e.msgwin.revealedOf(9) ?? 0) > 0, '泵推进后应开始逐字出现');
  assert.ok(native.scene.msgWins.get(9)!.revealed > 0);
});

test('分类契约：0x73/0x1CE 已从 engine-internal 表移除（否则真实现被 no-op 掩盖）', () => {
  assert.ok(OPS.has(0x73) && OPS.has(0x1ce));
  assert.equal(ENGINE_INTERNAL_OPS.has(0x73), false);
  assert.equal(ENGINE_INTERNAL_OPS.has(0x1ce), false);
});
