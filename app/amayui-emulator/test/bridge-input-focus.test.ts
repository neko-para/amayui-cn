/** @tier T0 @kind core @subsystem input */

/**
 * **输入桥 + focus 手动控制**（`tickets/T-0134` 的 WS-1）—— 冻结接口的行为守卫。
 *
 * 为什么单独锁它（`tickets/T-0133` §0.10/§0.11/§B.4.3/§B.4.5）：
 *  - 调试观察宿主把"输入 / 截图 / 焦点"三件事全部落到**共享层**（`InputManager` 是唯一缝）。
 *  - 输入注入只用 `applyScenarioEvent` 直写（不合成 DOM 事件），而它**走的正是引擎自己的命中测试路径**
 *    （`setCursor` 位置变化 → `onCursorMove` → `routes.hitTest` = 引擎 WM_MOUSEMOVE 的 `sub_403C50`）
 *    ⇒ **hover 能被调试器注入**（§0.11 的订正）。
 *  - 焦点由调试器显式控制（`focus auto|on|off`）：`off` 执行与 DOM blur **完全相同**的释放，
 *    并让宿主噪声（DSH 抢焦点 / iframe 失焦 / offscreen 无焦点）不再随机清输入。
 *
 * ★本文件**只跑 Node**（无 DOM/WebGL/Electron）：`inputAttach` 的焦点判定已抽成 DOM-free 导出函数
 * （`handleHostBlur`/`handleHostHide`），这正是 WS-1 验收 3/4 能在默认档断言的前提。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import type { BinArg } from '../src/script/bin.js';
import { applyScenarioEvent } from '../src/frame/scenario.js';
import { handleHostBlur, handleHostHide } from '../src/renderer/pixi/inputAttach.js';
import { DEBUG_COMMAND_HELP, parseDebugCommand } from '../src/vm/debugCommand.js';
import { im, instr, mkEngine } from './harness.js';

// ---------------------------------------------------------------------------
// 验收①：`{kind:'cursor', valid:false}` = 光标出窗（等价 `inputAttach` 的 mouseleave）
// ---------------------------------------------------------------------------

test('★cursor.valid=false：与 setCursor(-100000,-100000,false) 同 InputSnapshot（都在移动之后）', () => {
  // 两侧都**先真的移动过**：这样"出窗"是一次"从有效位置到无效位置"的转移，与 mouseleave 同形。
  const viaScenario = new InputManager();
  viaScenario.setCursor(640, 360, true);
  applyScenarioEvent(viaScenario, { kind: 'cursor', valid: false });

  const viaLeave = new InputManager();
  viaLeave.setCursor(640, 360, true);
  viaLeave.setCursor(-100000, -100000, false); // inputAttach 的 mouseleave 原样

  assert.deepEqual(viaScenario.snapshot(), viaLeave.snapshot(), '★两条路径的输入快照逐字段相等');
  // 契约要求的显式字段（失败时不必去读快照 diff）
  assert.equal(viaScenario.hasCursor, false, '出窗 ⇒ hasCursor=false');
  assert.equal(viaScenario.readX(), -100000, '读 X = -100000');
  assert.equal(viaScenario.readY(), -100000, '读 Y = -100000');
  assert.equal(viaScenario.touchId, 0, '出窗 ⇒ 触点消失（0x2FC op5）');

  // 缺省 valid = true（原行为不破）：不给出窗字段时照旧"有效移动"。
  const viaDefault = new InputManager();
  applyScenarioEvent(viaDefault, { kind: 'cursor', x: 12, y: 34 });
  assert.equal(viaDefault.hasCursor, true);
  assert.equal(viaDefault.readX(), 12);
  assert.equal(viaDefault.readY(), 34);

  // ★设计决定：hostFocus 是宿主/调试状态，**故意不进快照**（否则污染 record/replay 的逐帧比对）。
  assert.equal(
    Object.prototype.hasOwnProperty.call(viaDefault.snapshot(), 'hostFocus'),
    false,
    'hostFocus 不得出现在 InputSnapshot 里',
  );
});

// ---------------------------------------------------------------------------
// 验收②：hover 真的发生（`routes.cursor` 命中 + 等待泵消费 `hitTestPending`）
// ---------------------------------------------------------------------------

/** 造一个"面板已显示 + 有一项热点 (0,0)-(500,720)"的真 Engine（合成脚本，不带任何真资产）。 */
function mkPanelEngine(): Engine {
  // 指令：0 = i090（登记热点）→ 1 = i094（面板已显示）；其余只是 label 目标占位。
  const e = mkEngine([
    instr(0x90, [im(0), im(0), im(500), im(720), im(0xaa), im(0xbb), im(0xcc)]),
    instr(0x94, []),
    instr(0x5, []),
    instr(0x5, []),
    instr(0x5, []),
    instr(0x5, []),
  ]);
  const f = e.curScript();
  f.labelMap.set(0xaa, 2); // labelA（进入）
  f.labelMap.set(0xbb, 3); // labelB（离开）
  f.labelMap.set(0xcc, 4); // labelC（点击）
  const run = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
  };
  run(0x90, [im(0), im(0), im(500), im(720), im(0xaa), im(0xbb), im(0xcc)]);
  run(0x94, []);
  assert.equal(e.routes.shown, 1, '面板已显示（i094 = sub_419230）');
  assert.equal(e.routes.count, 1, '热点表 1 项');
  return e;
}

test('★hover 真的发生：{kind:cursor} → setCursor → onCursorMove → routes.hitTest，等待泵消费 hitTestPending', () => {
  const e = mkPanelEngine();
  const input = e.input;
  input.setCursor(-100000, -100000, false); // 出窗：不命中任何热点
  assert.equal(e.routes.cursor, -1, '出窗后游标未命中');

  // ★在**等待态**注入（§0.11 的用法说明：hover 靠"位置变化"触发，建议在等待态发 move）。
  e.awaitingAdvance = true;
  applyScenarioEvent(input, { kind: 'cursor', x: 100, y: 100 });

  // ① 命中测试当场就跑了（`onCursorMove` = 引擎 WM_MOUSEMOVE 里的 `sub_403C50`）
  assert.equal(e.routes.cursor, 0, '★光标命中第 0 项（hover 真的发生，不是"根本不经过命中测试"）');
  assert.equal(input.hitTestPending, true, '位置变化 ⇒ 标了"待命中测试"（由等待泵消费）');

  // ② 等待泵真的消费了那一格（引擎 `sub_4B8D50` 之外，泵只按 pending 补一次）
  assert.equal(e.serviceAdvanceWait(), true, '泵处理了这次悬停（走悬停分支）');
  assert.equal(input.hitTestPending, false, '★泵消费了 hitTestPending（不再挂到后续帧）');
  assert.equal(e.lastDispatch?.kind, 'hover-enter', '悬停"进入"被派发（labelA）');
  assert.equal(e.routes.cursor, 0, '悬停派发不清游标（与点击的 LABEL_68 不同）');

  // ③ 位置没变 ⇒ 不再重算（引擎语义：`sub_403C50` 只在鼠标移动/面板首次显示时调）
  e.routes.cursor = -1; // 人为复位，验证"没有移动就不重算"
  e.awaitingAdvance = true;
  e.serviceAdvanceWait();
  assert.equal(e.routes.cursor, -1, '没有新的移动 ⇒ 泵不重做命中测试（`hitTestPending` 已消费）');
});

// ---------------------------------------------------------------------------
// 验收③：`focus off` = DOM blur 的释放（逐字段相等）
// ---------------------------------------------------------------------------

test('★focus off 的 InputSnapshot 与"按下若干鼠标键+键盘后走 DOM blur"逐字段相等', () => {
  /** 两侧共同的"按下若干键 + 鼠标"起点（含滚轮残量，证明释放不动别的字段）。 */
  const seed = (im0: InputManager): void => {
    im0.setCursor(300, 200, true);
    im0.pressMouse(0);
    im0.pressMouse(1);
    im0.pressKey(38); // ↑（虚拟位 0）
    im0.pressKey(13); // Enter（虚拟位 4）
    im0.addWheel(120);
    im0.addHWheel(-120);
  };

  const viaBlur = new InputManager();
  seed(viaBlur);
  assert.equal(viaBlur.buttons, 3, '前置：左+右都按着');
  assert.equal(viaBlur.keysHeld, 0x11, '前置：↑ 与 Enter 都按着');
  const blurTrace: string[] = [];
  assert.equal(handleHostBlur(viaBlur, (l) => blurTrace.push(l)), true, 'DOM blur（auto）真的释放');

  const viaFocus = new InputManager();
  seed(viaFocus);
  viaFocus.setHostFocus('off'); // 调试器宣布失焦 ⇒ 立刻执行同一个释放

  assert.deepEqual(viaFocus.snapshot(), viaBlur.snapshot(), '★两条路径的释放逐字段相等');
  assert.equal(viaFocus.buttons, 0, 'focus off ⇒ 全部鼠标键释放');
  assert.equal(viaFocus.keysHeld, 0, 'focus off ⇒ 全部键盘按住态释放');
  assert.deepEqual(blurTrace, ['[input] blur -> release'], 'auto 模式仍留原有的一行 trace');

  // ★释放是"一次事件"，不是"持续状态"：`focus off` 之后调试器仍可注入新的按住态。
  viaFocus.pressMouse(0);
  assert.equal(viaFocus.buttons, 1, '调试器可在 off 模式下重新注入输入（off ≠ 屏蔽输入）');
});

// ---------------------------------------------------------------------------
// 验收④：手动模式下宿主焦点噪声被忽略
// ---------------------------------------------------------------------------

test('★hostFocus=off/on 时 blur/hide 处理器返回 false 且不动 snapshot；默认 auto 才释放', () => {
  /**
   * 造一个"按住态已建立"的输入状态。
   * ★**走 harness 的 `mkEngine`**（`T-0020` 的棘轮：测试里不许自造 `mk()`/`ctx` 变体）——
   *   Engine 自带 `input`，我们只是再置几个初值；不另起一条装配路径。
   */
  const inputWithHeldState = (): InputManager => {
    const im0 = mkEngine([]).input;
    im0.setCursor(10, 10, true);
    im0.pressMouse(0);
    im0.pressKey(38);
    return im0;
  };

  // ---- off：调试器接管，宿主噪声一律忽略 ----
  const off = inputWithHeldState();
  off.setHostFocus('off'); // 先执行一次"宣布失焦"的释放
  off.pressMouse(1); // 之后由调试器注入（证明后面的"不变"是因为被忽略，不是因为本来就没东西可清）
  off.pressKey(40); // ↓
  const before = off.snapshot();
  const offTrace: string[] = [];
  assert.equal(handleHostBlur(off, (l) => offTrace.push(l)), false, 'off ⇒ blur 被忽略（返回 false）');
  assert.equal(handleHostHide(off, (l) => offTrace.push(l)), false, 'off ⇒ hide 被忽略（返回 false）');
  assert.deepEqual(off.snapshot(), before, '★被忽略 ⇒ 逐字段不变');
  assert.equal(off.buttons, 2, '按住态保持（宿主噪声不再清输入）');
  assert.equal(off.keysHeld, 1 << 2, '键盘按住态保持');
  assert.equal(offTrace.length, 2, '忽略时各写一行 trace');
  assert.match(offTrace[0]!, /手动焦点模式忽略（mode=off）/, 'trace 里写明是手动模式忽略的');
  assert.match(offTrace[1]!, /手动焦点模式忽略（mode=off）/);

  // ---- on：同样是手动模式 ⇒ 同样忽略 ----
  const on = inputWithHeldState();
  on.setHostFocus('on');
  const beforeOn = on.snapshot();
  assert.equal(handleHostBlur(on, () => {}), false, 'on ⇒ blur 被忽略');
  assert.equal(handleHostHide(on, () => {}), false, 'on ⇒ hide 被忽略');
  assert.deepEqual(on.snapshot(), beforeOn, 'on 模式 ⇒ snapshot 不变');

  // ---- auto（默认）：这就是现状，必须释放 ----
  const auto = inputWithHeldState();
  assert.equal(auto.hostFocus, 'auto', '默认 = auto（跟随真实 DOM 焦点）');
  assert.equal(handleHostBlur(auto, () => {}), true, 'auto ⇒ blur 真的释放');
  assert.equal(auto.buttons, 0);
  assert.equal(auto.keysHeld, 0);

  const autoHide = inputWithHeldState();
  assert.equal(handleHostHide(autoHide, () => {}), true, 'auto ⇒ visibilitychange(hidden) 真的释放');
  assert.equal(autoHide.buttons, 0);
  assert.equal(autoHide.keysHeld, 0, '隐藏同样释放键盘按住态（与修前两个监听器合起来的效果一致）');
});

// ---------------------------------------------------------------------------
// 验收⑤：`focus` 调试命令的解析
// ---------------------------------------------------------------------------

test('parseDebugCommand focus：off/on/auto、无参=auto、非法参数=报错（不崩）', () => {
  assert.deepEqual(parseDebugCommand('focus off'), { a: 'focus', mode: 'off' });
  assert.deepEqual(parseDebugCommand('focus on'), { a: 'focus', mode: 'on' });
  assert.deepEqual(parseDebugCommand('focus auto'), { a: 'focus', mode: 'auto' });
  assert.deepEqual(parseDebugCommand('focus'), { a: 'focus', mode: 'auto' }, '无参 = auto');
  assert.deepEqual(parseDebugCommand('  FOCUS  OFF  '), { a: 'focus', mode: 'off' }, '大小写/空白不敏感');

  // 非法参数：按既有 `b event`/`delete` 的口径回报（`{a:'query'}` ⇒ runQuery 打印失败 + 帮助），绝不抛。
  const bad = parseDebugCommand('focus xx');
  assert.ok(bad && bad.a === 'query', '非法模式不得变成 focus 动作');
  assert.match((bad as { a: 'query'; text: string }).text, /auto \/ on \/ off/);
  assert.match((bad as { a: 'query'; text: string }).text, /xx/);

  // 帮助文本里必须有这一行（面板与 CLI 渲染同一份真源）
  assert.ok(
    DEBUG_COMMAND_HELP.some((l) => l.trimStart().startsWith('focus ')),
    `帮助文本应有一行 focus：${JSON.stringify(DEBUG_COMMAND_HELP)}`,
  );
});

// ---------------------------------------------------------------------------
// 类型缝：`Engine` 装配出来的 InputManager 默认就是 auto（宿主噪声在默认下仍有兜底）
// ---------------------------------------------------------------------------

test('默认装配：Engine.input 初始 hostFocus=auto，setHostFocus 是唯一的模式入口', () => {
  const e = new Engine(new StubNative(() => {}));
  assert.equal(e.input.hostFocus, 'auto');
  e.input.setHostFocus('off');
  assert.equal(e.input.hostFocus, 'off');
  e.input.setHostFocus('on');
  assert.equal(e.input.hostFocus, 'on');
});

// ---------------------------------------------------------------------------
// 验收⑥（T-0135 Phase 2）：agent 的输入命令 → ScenarioEvent → applyScenarioEvent
// ---------------------------------------------------------------------------

test('★输入命令：move/leave/click/press/release/wheel/key/keyup 解析成 ScenarioEvent', () => {
  assert.deepEqual(parseDebugCommand('move 100 200'), {
    a: 'input',
    events: [{ kind: 'cursor', x: 100, y: 200, valid: true }],
  });
  // ★`leave` 就是"光标出窗"（T-0133 §0.11 的真缺口）
  assert.deepEqual(parseDebugCommand('leave'), {
    a: 'input',
    events: [{ kind: 'cursor', x: 0, y: 0, valid: false }],
  });
  assert.deepEqual(parseDebugCommand('click 5 6'), {
    a: 'input',
    events: [
      { kind: 'cursor', x: 5, y: 6, valid: true },
      { kind: 'press', x: 5, y: 6, button: 0 },
      { kind: 'release', x: 5, y: 6, button: 0 },
    ],
  });
  assert.deepEqual(parseDebugCommand('click 5 6 右'), {
    a: 'input',
    events: [
      { kind: 'cursor', x: 5, y: 6, valid: true },
      { kind: 'press', x: 5, y: 6, button: 1 },
      { kind: 'release', x: 5, y: 6, button: 1 },
    ],
  });
  assert.deepEqual(parseDebugCommand('release'), { a: 'input', events: [{ kind: 'release', button: 0 }] });
  assert.deepEqual(parseDebugCommand('release 右'), { a: 'input', events: [{ kind: 'release', button: 1 }] });
  assert.deepEqual(parseDebugCommand('wheel -120'), { a: 'input', events: [{ kind: 'wheel', delta: -120 }] });
  assert.deepEqual(parseDebugCommand('key 38'), { a: 'input', events: [{ kind: 'keydown', vk: 38 }] });
  assert.deepEqual(parseDebugCommand('keyup 38'), { a: 'input', events: [{ kind: 'keyup', vk: 38 }] });
});

test('★输入命令：非法参数走"当查询回报"（不抛错、不崩），且不在帮助里漏掉', () => {
  for (const bad of ['move', 'move 1', 'move a b', 'click', 'click x y', 'wheel', 'wheel abc', 'key', 'key 0', 'key abc']) {
    const act = parseDebugCommand(bad);
    assert.ok(act && act.a === 'query', `${bad} 应回报成 query（实际 ${JSON.stringify(act)}）`);
    assert.ok(String(act.text).length > 0, `${bad} 的回报不能是空串`);
  }
  const help = DEBUG_COMMAND_HELP.join('\n');
  for (const c of ['move <x> <y>', 'leave', 'click <x> <y>', 'wheel', 'key <vk>']) {
    assert.ok(help.includes(c), `帮助里应写清 ${c}`);
  }
});

test('★输入命令真的被 applyScenarioEvent 执行（hover/按住态都动）', () => {
  const e = mkPanelEngine(); // 复用上面的面板装配（含热点表）
  const apply = (cmd: string): void => {
    const act = parseDebugCommand(cmd);
    assert.ok(act && act.a === 'input', `${cmd} 应解析成 input`);
    for (const ev of act.events) applyScenarioEvent(e.input, ev as never);
  };
  apply('move 10 10'); // 表外
  assert.equal(e.input.hasCursor, true);
  apply('leave');
  assert.equal(e.input.hasCursor, false, 'leave ⇒ 光标出窗');
  apply('move 10 10');
  assert.equal(e.input.hasCursor, true, 'move ⇒ 光标回来');
  apply('press 10 10');
  assert.equal(e.input.readButtons() & 1, 1, 'press ⇒ 左键按住态置位');
  apply('release');
  assert.equal(e.input.readButtons() & 1, 0, 'release ⇒ 清位');
  apply('wheel 120');
  assert.equal(e.input.wheelDelta, 120, 'wheel ⇒ 累加器 +120（引擎单位）');
  apply('key 38');
  assert.ok((e.input.keysHeld & 1) !== 0, 'key 38（↑）⇒ 键盘按住态 bit0');
  apply('keyup 38');
  assert.equal(e.input.keysHeld & 1, 0, 'keyup ⇒ 清位');
});
