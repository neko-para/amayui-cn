/** @tier T0 @kind core @subsystem input */

/**
 * **「滚轮当按键」模式**（引擎 WndProc `WM_MOUSEWHEEL`/`WM_MOUSEHWHEEL` 的两条路；`tickets/T-0167`）。
 *
 * 用户实测症状：**ADV 里滚动滚轮无法进入回看/历史界面**。根因 = 修前 emulator 的滚轮事件
 * **只喂增量累加器**（`addWheel` → `wheelDelta`），而引擎的 WndProc 在
 * `Engine[699204] & 0x90100000 != 0` 时**另外**把 `1 << Conf(set:WheelKeyUp/Down)` 或进输入掩码：
 *
 * ```c
 * // raw 141572-141583（WM_MOUSEWHEEL）
 * if ( wParam < 0 ) v19 = GetConfig(aSetWheelkeydow);
 * …
 * LABEL_147:
 *   if ( v19 >= 0 ) *(_DWORD *)(dword_55E1BC + 699208) |= 1 << v19;   // ★进掩码
 * else *(_DWORD *)(dword_55E1BC + 7796) += SHIWORD(wParam);           //   否则进累加器
 * ```
 *
 * 而 ADV 的回看判据**全部读掩码位**（`sub_411BC0` raw 20345/20355、`sub_411590` raw 20047-20055）
 * ⇒ 缺这一位 = 滚轮在 ADV 里"什么都不做"（不是"回看不完整"，是**完全没有反应**）。
 *
 * 本文件钉三件事：
 *  1. 两条路的**分岔判据**（模式位 = `effect_flags & 0x90100000`）；
 *  2. 位号来自四个配置键、方向选上/下滚；位号 `-1`/越界 ⇒ 退回累加器；
 *  3. **端到端**：一次 `addWheel(+120)` 就能让等待泵走到回看分支（游标后退 + `489816 = -1` + 置 `0x100000`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ADVANCE_GATE, CHAR_REVEAL_ACTIVE, Engine } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseIni } from '../src/engineConfig.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { im, instr, mkEngine } from './harness.js';

/** `set:WheelKeyUp=3 / WheelKeyDown=1`（随包默认；raw 141576/141596 的位号就是这两个键的值）。 */
const DEFAULT_WHEEL_INI = '[set]\nWheelKeyUp=3\nWheelKeyDown=1\n';

function withWheelConfig(e: Engine, ini = DEFAULT_WHEEL_INI): void {
  e.config = parseIni(ini) as never;
}

test('① 模式关（`effect_flags & 0x90100000 == 0`）⇒ 滚轮只进增量累加器、不动掩码', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  withWheelConfig(e);
  e.input.addWheel(120);
  e.input.addWheel(-120);
  assert.equal(e.input.wheelDelta, 0, '上滚 +120 又下滚 −120 ⇒ 累加为 0');
  assert.equal(e.input.wheelKeyBits, 0, '模式关 ⇒ 一个掩码位都不置');
  assert.equal(e.input.flushPending(), 0, '掩码里没有滚轮位');
});

test('② 模式开（等待门 0x80000000）⇒ 上滚置 `1 << set:WheelKeyUp`（默认位 3 = 0x8）、**不进累加器**', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  withWheelConfig(e);
  e.effectFlags |= ADVANCE_GATE; // 0x90100000 里的 0x80000000
  e.input.addWheel(120);
  assert.equal(e.input.wheelKeyBits, 0x8, '★raw 141605-141606：`|= 1 << Conf(set:WheelKeyUp)`（默认 3）');
  assert.equal(e.input.wheelDelta, 0, '★引擎：模式开时**不**累加增量（else 支）');
  assert.ok((e.input.flushPending() & 0x8) !== 0, '消费刷把这一位并进掩码（`sub_478090` 的 `*a2` 就是同一张掩码）');
  assert.ok((e.input.flushHeld() & 0x8) !== 0, '实时刷同样带上（ADV 分支 `sub_411900` 用实时刷）');
});

test('③ 方向：下滚置 `1 << set:WheelKeyDown`（默认位 1 = 0x2）；两个方向可同时攒起来', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  withWheelConfig(e);
  e.effectFlags |= ADVANCE_GATE;
  e.input.addWheel(-120);
  assert.equal(e.input.wheelKeyBits, 0x2, '下滚 ⇒ `set:WheelKeyDown`（默认 1）');
  e.input.addWheel(120);
  assert.equal(e.input.wheelKeyBits, 0xa, '再上滚 ⇒ 0x2 | 0x8（引擎也是 `|=`）');
});

test('④ 横滚：`set:HWheelKeyUp/Down` 各自成路（缺省 -1 = 不映射 ⇒ 退回累加器）', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  // 只配竖直滚轮 ⇒ 横滚没有键位 ⇒ 仍然进 hwheelDelta（与修前一致）
  withWheelConfig(e);
  e.effectFlags |= ADVANCE_GATE;
  e.input.addHWheel(120);
  assert.equal(e.input.hwheelDelta, 120, '缺 `set:HWheelKeyUp` ⇒ 走累加器');
  assert.equal(e.input.wheelKeyBits, 0);

  // 配上横滚键位 ⇒ 走掩码位（raw 141594-141606）
  withWheelConfig(e, '[set]\nWheelKeyUp=3\nWheelKeyDown=1\nHWheelKeyUp=5\nHWheelKeyDown=6\n');
  e.input.hwheelDelta = 0;
  e.input.addHWheel(120);
  assert.equal(e.input.wheelKeyBits, 1 << 5, '右滚 ⇒ `set:HWheelKeyUp = 5`');
  assert.equal(e.input.hwheelDelta, 0, '模式开 ⇒ 不进横滚累加器');
  e.input.addHWheel(-120);
  assert.equal(e.input.wheelKeyBits, (1 << 5) | (1 << 6), '左滚 ⇒ `set:HWheelKeyDown = 6`');
});

test('⑤ 位号越界/`-1` ⇒ 不进掩码也不弄坏累加器（引擎 `if (v19 >= 0)` 的守卫）', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  withWheelConfig(e, '[set]\nWheelKeyUp=-1\nWheelKeyDown=99\n');
  e.effectFlags |= ADVANCE_GATE;
  e.input.addWheel(120);
  e.input.addWheel(-120);
  assert.equal(e.input.wheelKeyBits, 0, '位号非法 ⇒ 一个位都不置（负数/≥32）');
  assert.equal(e.input.wheelDelta, 0, '也**不**回流到累加器：引擎那条 else 只在模式关时走');
});

test('⑥ `consumeEdges()` 消费这一位（引擎每轮处理的收尾是 `*v9 = 0` 清整张掩码）', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  withWheelConfig(e);
  e.effectFlags |= ADVANCE_GATE;
  e.input.addWheel(120);
  assert.equal(e.input.flushPending(), 0x8);
  e.input.consumeEdges();
  assert.equal(e.input.wheelKeyBits, 0, '被消费 ⇒ 不会每帧重复触发回看');
  assert.equal(e.input.flushPending(), 0, '下一次刷掩码读不到它');
});

test('⑦ 快照/回放带上这一位（宿主事件必须在回放同一帧时逐次相同）', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  withWheelConfig(e);
  e.effectFlags |= ADVANCE_GATE;
  e.input.addWheel(120);
  const snap = e.input.snapshot();
  assert.equal(snap.wheelKeyBits, 0x8);
  e.input.consumeEdges();
  assert.equal(e.input.wheelKeyBits, 0);
  e.input.restore(snap);
  assert.equal(e.input.wheelKeyBits, 0x8, '回放恢复后这一位回来');
  assert.equal(e.input.flushPending(), 0x8);
});

test('⑧ 深拷/回放兼容：旧轨迹没有这一格 ⇒ 按 0 降级（不炸）', () => {
  const e = mkEngine([instr(0x72, [im(0)])]);
  const snap = e.input.snapshot() as unknown as Record<string, unknown>;
  delete snap.wheelKeyBits;
  e.input.restore(snap as never);
  assert.equal(e.input.wheelKeyBits, 0);
});

test('★★⑨ 端到端：一次真实滚轮事件就够走完"滚轮 → 掩码 → 等待泵回看"（用户症状的回归门）', () => {
  // ADV 现场：面板已显示 + 等待门已置 + 一页回看记录（`0x94`/`0x70`/`0x1d2` 与
  // `test/msgwin-backlog-wheel.test.ts` 同一套造法，但**不**手按键盘：只有一次滚轮事件）。
  const e = mkEngine([instr(0x72, [im(0)]), instr(0x72, [im(0)])], 'ADV.BIN');
  withWheelConfig(e);
  const step = (op: number, args = [] as ReturnType<typeof im>[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
  };
  step(0x94); // 面板已显示（泵的 `panel.shown` 门）
  step(0x70, [im(0), im(640), im(120), im(0), im(500)]); // 页 0
  step(0x1d2, [im(1), im(10)]);
  step(0x1d2, [im(2), im(20)]);
  step(0x70, [im(0), im(640), im(120), im(0), im(500)]); // 页 1（起点 2）
  step(0x1d2, [im(3), im(30)]);
  step(0x72, [im(0)]); // 等待门 bit31
  e.effectFlags |= CHAR_REVEAL_ACTIVE; // raw 20341 的内层门（逐字中）
  assert.equal(e.awaitingAdvance, true, '前置：等待门已置');
  assert.equal(e.textItems.cursor, 1, '前置：游标在末页');

  // ★三步用户动作链：滚轮事件（**只此一次**）→ 刷掩码 → 等待泵
  e.input.addWheel(120);
  assert.equal(e.serviceAdvanceWait(), true, '泵把这次滚轮当成"回看事件"消费掉');
  assert.equal(e.textItems.cursor, 0, '★游标真的后退了一页（`sub_459770(v8, -1, 2)`，raw 20347）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.textRewind), -1, '★`Engine[489816] = -1`（raw 20348）');
  assert.equal(e.effectFlags & 0x100000, 0x100000, '★`effect_flags |= 0x100000`（跳读/回看位，raw 20350）');
  assert.equal(e.input.wheelKeyBits, 0, '这一位已被消费 ⇒ 下一帧不会重复回看');
});
