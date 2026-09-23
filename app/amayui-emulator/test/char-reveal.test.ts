/** @tier T0 @kind core @subsystem text */

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
import { im, instr, str } from './harness.js';



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

/**
 * **注册消息面面板**（引擎 `i094` → `sub_419230`）。
 *
 * ★等待推进泵（`sub_411BC0` raw 20239）整个被 `Engine[51828]`（= `panelA[7463]`「面板已显示」）
 * 门控 —— 真实 ADV 脚本的 UI 例程末尾就是 `i094`（`src/SN0000.txt:117`），随后才 `wait-for-input`。
 * 所以凡是"点击推进"的断言都必须先跑它。
 */
function showPanel(step: (op: number, args?: BinArg[]) => void): void {
  step(0x94);
}

/**
 * 注入一次鼠标移动 + 左键按下（引擎：WM_MOUSEMOVE 里的 `sub_403C50` 命中测试 → WM_LBUTTONDOWN）。
 * ★必须先移动再按下：命中测试只在鼠标移动/面板首次显示时做，泵里不做。
 */
function moveAndClick(e: Engine, x: number, y: number): void {
  e.input.setCursor(x, y);
  e.input.pressMouse(0);
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

test('★0x72 武装逐字：节拍 = max(MessageSpeed, 一帧)、一次一个字（0x73 只管 ▼ 图标）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 5); // message:MessageSpeed = 5ms（低于一帧 ⇒ 取一帧）
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('一二三四五')]); // 5 字
  step(0x72, [im(8)]);
  const st = e.msgwin.reveal.get(8);
  assert.ok(st, '0x72 应启动显现');
  assert.ok(
    Math.abs(st!.intervalMs - 1000 / 60) < 0.01,
    '★逐字节拍 = max(MessageSpeed, 一帧) = 16.67ms（`0x73` 的 op10=100ms 是 **▼ 图标**的换格节拍，不是文字的）',
  );
  assert.equal(e.msgwin.charMode, true, 'effect_flags bit30 应置位');
  assert.equal(e.msgwin.charTotal, 8, 'Engine[107705] = win+92 = op9（▼ 精灵表的格数）');
  assert.equal(e.engineValues.get(107705), 8);
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, CHAR_REVEAL_ACTIVE);

  // 一次一个字、不补拍
  e.serviceTextReveal(10);
  assert.equal(e.msgwin.revealedOf(8), 0, '未到节拍 ⇒ 不动');
  e.serviceTextReveal(1000 / 60);
  assert.equal(e.msgwin.revealedOf(8), 1, '第一拍 ⇒ 1 字');
  for (let k = 2; k <= 5; k++) e.serviceTextReveal((1000 / 60) * k);
  assert.equal(e.msgwin.revealedOf(8), 5, '5 拍显完（整段 = 5 × 16.67ms）');
  assert.equal(st!.active, false);
});

/**
 * ★2026-09 用户实测（三轮反馈 ⇒ 定出这条模型）：
 *  ① "SN0000 的逐字比设置界面慢了很多"：旧实现把 `0x73` 的 op10（100ms）当成文字的节拍
 *     ⇒ 58 字 × 100ms = 5.8s。**真相**：`0x73` 配的是 ▼ 图标精灵表（ADV = SO000.AGF 10 帧 35×35、
 *     序章 = SO026.AGF 8 帧 56×56），主循环 raw 20887-20895 每 100ms 换的是**格号**（图标帧），
 *     文字走的是 `sub_45BE20` 那个泵 ⇒ 文字节拍 = `message:MessageSpeed`（与设置界面同一口径）。
 *  ② "几个字几个字一起出，看着卡顿"：旧实现按"整段预算追赶"（卡一帧就把欠的字一次补出来，
 *     首次加载字体那种长帧会一次冒出十几个字）。**真相**：引擎是"推一个字 → `Sleep(MessageSpeed)`"
 *     ⇒ **一帧一次、不补拍**。
 */
test('★逐字"不补拍"：卡一帧只少走一个字，不会一次补出一批（用户实测的"卡顿感"）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 5); // MessageSpeed 低于一帧 ⇒ 节拍 = 一帧
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, 0)); // SN0000.txt:1081 的真实参数（8 格 × 56px、图标节拍 100ms）
  step(0x6e, [im(0), str('一'.repeat(58))]); // 58 字（首文案那一页的规模）
  step(0x72, [im(8)]);
  const st = e.msgwin.reveal.get(8)!;
  assert.equal(st.intervalMs, 1000 / 60, '文字节拍 = 一帧（MessageSpeed 更低）');

  // ★逐帧推进必须"细"：一帧一个字
  let prev = 0;
  let maxStep = 0;
  for (let t = 0; t <= 2000; t += 1000 / 60) {
    e.serviceTextReveal(t);
    const now = e.msgwin.revealedOf(8);
    maxStep = Math.max(maxStep, now - prev);
    prev = now;
  }
  assert.equal(maxStep, 1, '单帧最多推进 ' + maxStep + ' 个字（旧实现按预算追赶 ⇒ 一次冒出十几个）');
  assert.equal(e.msgwin.revealedOf(8), 58, '逐字节拍下整页显完（58 × 16.67ms ≈ 970ms）');
  assert.equal(st.active, false, '★不补拍：整段 = 字数 × 节拍（不是旧的 字数 × 图标节拍 100ms = 5.8s）');

  // ★卡帧**不补拍**：引擎"推一个字 → Sleep(MessageSpeed)"⇒ 卡一帧只少走一个字、不补出一批
  step(0x71, [im(8)]);
  step(0x6e, [im(0), str('一'.repeat(58))]);
  step(0x72, [im(8)]);
  e.serviceTextReveal(100); // 第一拍
  const afterFirst = e.msgwin.revealedOf(8);
  e.serviceTextReveal(5000); // 模拟一次 5 秒大卡顿
  assert.equal(
    e.msgwin.revealedOf(8),
    afterFirst + 1,
    '★卡帧后只多走一个字（不补拍）——否则一次卡顿就会"唰"地补出一大批字',
  );
});

/**
 * ★2026-09 用户实测（第 3 条）："游戏中文字结尾处会有一个闪烁的图标，目前好像没有渲染出来"。
 *
 * 真相：那是引擎内建的 **`0x73` 图标精灵表动画**（不是 DrawItem / 字形 / flipbook / 鼠标光标）——
 * ADV 用 `SO000.AGF`(id 0x5191，350×35 = 10 帧 35×35 的 ▼) 装进槽 12（`SYSTEM4.txt:40`），
 * `i073 1 37a 6e c 0 0 23 23 a 64`（`SYSTEM4.txt:41`）配网格；主循环 raw 20887-20895 在
 * `effect_flags & 0x40000000` 期间每 100ms `sub_45A940(Font, 当前窗, k, 0)` 贴第 k 格、
 * `k = (k+1) % op9` ⇒ 视觉上就是"闪烁的 ▼"。目标位置（ADV 分支）= `(op2 + 窗框 x, op3 + 窗框 y)`
 * = `(890+190, 110+557) = (1080,667)`（`SYSTEM4.txt:23` 的 win1 框 190..1070 × 557..705）。
 */
test('★0x73 = ▼ 图标精灵表：0x72 武装后每 op10 ms 换一格，点击推进后停', () => {
  const native = new HeadlessScene({});
  const { e, step } = mk(native);
  e.engineValues.set(21668, 5); // 文字节拍（与 ▼ 无关）
  step(0x80, [im(1)]);
  step(0x70, [im(1), im(0x370), im(0x94), im(0xbe), im(0x22d)]); // 窗1 几何 w/h/x/y（SYSTEM4.txt:23）
  step(0x73, [im(1), im(0x37a), im(0x6e), im(0xc), im(0), im(0), im(0x23), im(0x23), im(0xa), im(0x64)]);
  step(0x71, [im(1)]);
  step(0x6e, [im(0), str('あいうえお')]);
  showPanel(step); // ★等待推进泵被 Engine[51828]（= panelA[7463]「面板已显示」）门控
  step(0x72, [im(1)]);
  assert.equal(e.engineValues.get(107705), 10, '模数 = op9 = 精灵表 10 格');
  // ★图标要等**本页逐字显完**才出现（引擎：文字泵自旋，跑完才轮到主循环的图标分支）
  assert.equal(e.serviceCharGrid(50), false, '逐字还在进行 ⇒ 不画图标');
  // ★★ 但"serviceCharGrid 返回 false"**不够**：★2026-09 用户报 #2「图标被提前显示」的真因是
  //    `serviceTextReveal → #publishReveal → emitWin` 也带 `cell` 载荷 —— 即使格子没换，
  //    宿主也会把 ▼ 画出来。所以必须断言**载荷里没有 cell**（`cellFrameOf` 是唯一判决点）。
  assert.equal(native.scene.msgWins.get(1)?.cell, undefined, '逐字还在进行 ⇒ 载荷里不得有 cell（否则宿主立刻画 ▼）');
  e.serviceTextReveal(1010);
  assert.equal(e.msgwin.revealedOf(1) > 0, true, '前置：这一拍确实显了字（发布路径真的跑过）');
  assert.equal(native.scene.msgWins.get(1)?.cell, undefined, '显到一半 ⇒ 载荷里仍不得有 cell');
  // 5 个字按节拍（≥16.67ms/字）逐拍显完
  for (let k = 1; k <= 5; k++) e.serviceTextReveal(1000 + k * 20);
  assert.equal(e.serviceCharGrid(1110), false, '显完后的第一帧只**起算**节拍（引擎 sub_453A90 重启计时）');
  assert.equal(e.serviceCharGrid(1210), true, '再过一拍 ⇒ 贴格 0');
  const c0 = native.scene.msgWins.get(1)?.cell;
  assert.deepEqual(
    c0 && { k: c0.k, src: c0.srcSurface, w: c0.cellW, h: c0.cellH, cols: c0.cols, x: c0.x, y: c0.y },
    { k: 0, src: 12, w: 35, h: 35, cols: 10, x: 1080, y: 667 },
    '★源 = 槽 12 的第 0 格（35×35）、目标 = (890+190, 110+557)（引擎 raw 71368-71377）',
  );
  assert.equal(e.serviceCharGrid(1310), true);
  assert.equal(native.scene.msgWins.get(1)?.cell?.k, 1, '第二拍 ⇒ 第 1 格（▼ 动起来 = 闪烁）');
  assert.equal(e.serviceCharGrid(1350), false, '未到下一拍 ⇒ 不换');
  // 点击推进 ⇒ 停（引擎 raw 20025-20030：收尾 + 清 bit30）
  moveAndClick(e, 10, 10);
  assert.equal(e.serviceAdvanceWait(), true);
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, 0, '点击后不再武装');
  assert.equal(e.serviceCharGrid(5000), false, '停后不再换格');
  assert.equal(native.scene.msgWins.get(1)?.cell, undefined, '停后主机端不再画 ▼（收尾重发布时不带格）');
});

test('无字格页同样按 message:MessageSpeed（逐字只有一条路；0x73 只管 ▼ 图标）', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 25);
  step(0x80, [im(9)]);
  step(0x6e, [im(0), str('あいう')]);
  step(0x72, [im(9)]);
  const st = e.msgwin.reveal.get(9);
  assert.equal(st!.intervalMs, 25, '节拍 = max(MessageSpeed, 一帧) = 25ms');
  assert.equal(st!.nextAt, 25, '首个字等满一个节拍');
});

test('★0x1CE：v≠0 置逐字模式并清零游标；v=0 收尾（整段贴出）+ 清位', () => {
  const { e, step } = mk();
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('あいうえお')]);
  e.msgwin.reveal.set(8, { shown: 2, total: 5, active: true, nextAt: 0, intervalMs: 1000 / 60 });
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
  e.engineValues.set(21668, 5); // 逐字节拍 = max(MessageSpeed, 一帧)
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('一二三四五')]);
  showPanel(step); // ★等待推进泵被 Engine[51828]（= panelA[7463]）门控
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 0);
  moveAndClick(e, 10, 10);
  assert.equal(e.serviceAdvanceWait(), true, '点击应放行等待门');
  assert.equal(e.msgwin.revealedOf(8), 5, '放行前先补完整段');
  assert.equal(e.msgwin.charMode, false, '逐字模式应退出');
  assert.equal(e.effectFlags & CHAR_REVEAL_ACTIVE, 0);
});

test('★0x20A（过去未注册 ⇒ 命中即硬报错）：重排重画但不动游标', () => {
  const { e, step } = mk();
  e.engineValues.set(21668, 5); // 逐字节拍 = max(MessageSpeed, 一帧)
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x72, [im(8)]);
  e.serviceTextReveal(160); // 5 字页的逐字节拍 = 160ms（整段 800ms 摊开）
  assert.equal(e.msgwin.revealedOf(8), 1);
  step(0x20a, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 1, '重画不改变已显示字数（引擎用当前游标重贴同一格）');
  assert.ok(OPS.has(0x20a), '0x20A 必须已注册');
});

test('★0x304/0x305 文本块括号：保存/取回行游标 + 把余下的行贴出', () => {
  const native = new HeadlessScene({});
  const { e, step } = mk(native);
  e.engineValues.set(21668, 5); // 逐字节拍 = max(MessageSpeed, 一帧)
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, -280));
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x72, [im(8)]);
  e.serviceTextReveal(160); // 同 ③：逐字节拍 160ms ⇒ 1 字
  assert.equal(e.msgwin.revealedOf(8), 1);
  step(0x304, []); // 保存（引擎 win+296 ← win+132）
  assert.equal(e.msgwin.flags, 1, 'Engine[122497] = 1（文本块内的注音/内嵌模式）');
  step(0x305, []); // 取回 + 把余下的行一次性贴出
  assert.equal(e.msgwin.revealedOf(8), 5, '0x305 的 `while(!sub_45BE20())` = 整段贴出');
  assert.equal(e.msgwin.flags, 0, '★引擎三条出口都清 Engine[122497]（raw 26083/26095/26099）⇒ 文本块结束即退出注音模式');
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
  showPanel(step); // ★等待推进泵被 Engine[51828]（= panelA[7463]）门控（真实脚本在 UI 例程末尾 `i094`）
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
  moveAndClick(e, 10, 10);
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
  e.engineValues.set(21668, 100); // 100ms/**字**（引擎一步 = 一个字，见 msgwin.ts 的 RevealState.budgetMs）
  step(0x80, [im(9)]);
  step(0x300, [im(9), im(1), im(1000)]); // CONFIG.txt:171 开闸
  step(0x71, [im(9)]); // 开始一段新消息（清窗）
  step(0x6e, [im(0), str('あいうえお')]);
  step(0x6f, [im(0)]);
  assert.equal(e.msgwin.revealedOf(9), 0, '闸门窗：show-text 之后、泵贴出之前 = 0 字（否则文案抢在背景前面）');
  const f0 = native.scene.msgWins.get(9);
  assert.equal(f0?.revealed, 0, '渲染模型里也必须是 0 字');

  // 泵推进后才逐字出现：5 字 × 100ms/字 ⇒ 第一个字要等满一个节拍（约 6 帧）
  let t = 0;
  let frames = 0;
  for (; frames < 12 && (e.msgwin.revealedOf(9) ?? 0) === 0; frames++) {
    t += 1000 / 60;
    e.serviceWinReveal(t);
  }
  assert.ok((e.msgwin.revealedOf(9) ?? 0) > 0, `泵推进后应开始逐字出现（泵了 ${frames} 帧）`);
  assert.ok(native.scene.msgWins.get(9)!.revealed > 0);
});

/**
 * ★2026-09 反馈回归：「文字会在逐字出现前**完整出现**一下」（SN0000 首文案）。
 *
 * 字格门窗（`0x73` 置 `win+88` 总门）在引擎里是"整页排版进离屏表面 → 主循环在**逐字模式**
 * 里逐格 `sub_45A940` 拍到屏幕"⇒ `0x72 wait-for-input` 武装之前屏幕上**一个字都没有**。
 *
 * 语料里 `i073` 与文本的顺序不固定（`SN0000.txt:1240` 在本页文本之后、`1081` 在页首），
 * 而总门自序章首屏起恒为 1 ⇒ "文本入队（`0x6E`）→ 页末 `0x73`/`end-text-line`（`emitWin`）
 * → `0x72` 武装"之间存在一帧"无显现状态"的发布窗口。若把"无显现状态"解释成 −1（全部），
 * 那一帧就是整页先亮一次、随后被逐字从头重播（正是用户看到的现象）。
 */
test('★字格门窗在 0x72 武装前不得整页可见：revealedOf = 0（不是 -1）', () => {
  const native = new HeadlessScene({});
  const { e, step } = mk(native);
  e.engineValues.set(21668, 5);
  step(0x80, [im(8)]);
  step(0x73, grid(8, -5, 56)); // 上一页留下的字格（总门 = 1）
  step(0x71, [im(8)]); // 本页开始：清窗
  step(0x6e, [im(0), str('由两个世界融合而生的')]);
  step(0x6f, [im(0)]);
  assert.equal(e.msgwin.gridOf(8)?.gate, true, '字格总门仍在（0x73 之后没有任何东西清它）');
  assert.equal(e.msgwin.revealedOf(8), 0, '★武装前 = 0 字（-1 会让整页先亮一次）');
  assert.equal(native.scene.msgWins.get(8)?.revealed, 0, '渲染模型里也必须是 0 字');
  step(0x73, grid(8, -5, 56)); // 页末再设一次（SN0000 的实际顺序）
  assert.equal(e.msgwin.revealedOf(8), 0, '0x73 自己的 emitWin 也不得把整页放出来');

  // 0x72 武装后逐步显现：8 格 ⇒ 一步 ceil(10/8)=2 字，节拍 100ms（5 拍显完）
  step(0x72, [im(8)]);
  assert.equal(e.msgwin.revealedOf(8), 0, '武装当帧仍是 0 字');
  e.serviceTextReveal(80);
  assert.equal(e.msgwin.revealedOf(8), 1, '80ms ⇒ 1 字（10 字页的节拍 = 800/10，不再一批 7 字）');
  for (let k = 2; k <= 10; k++) e.serviceTextReveal(80 * k);
  assert.equal(e.msgwin.revealedOf(8), 10, '整页显完（8 格 × 100ms = 800ms）');
});

test('分类契约：0x73/0x1CE 已从 engine-internal 表移除（否则真实现被 no-op 掩盖）', () => {
  assert.ok(OPS.has(0x73) && OPS.has(0x1ce));
  assert.equal(ENGINE_INTERNAL_OPS.has(0x73), false);
  assert.equal(ENGINE_INTERNAL_OPS.has(0x1ce), false);
});
