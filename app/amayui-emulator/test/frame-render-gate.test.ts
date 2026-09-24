/** @tier T0 @kind core @subsystem frame */

/**
 * **帧提交门的守卫**（引擎主循环 raw 20740-20761；`tickets/T-0167` 的 §4.2 #3/#6/#7）。
 *
 * 修前：`src/frame/loop.ts` 每帧无条件 `e.nowMs = host.now()`，而引擎的**帧时钟字段写**
 * （raw 20750-20751：`Engine+369336 ← Engine+369332; Engine+369332 ← v94`）被
 * `Engine+667856 == 1`（`set:DrawMode`）+ `(667860 != 0 || effect_flags & 0x2400)` 门着，
 * 且 `Engine+675968`（外部挂起渲染，写点 raw 11533/11630）非零时整块跳过 —— emulator 一条都没有。
 *
 * 本文件钉三件事：
 *  1. `frameRenderGate()` 的**纯函数**判定（四种门组合 + 内层提交条件）；
 *  2. 门内的帧时钟写**真的**落在 `engineValues` 的 `clockPrev`/`clock` 上（默认 `DrawMode=0` 时不动
 *     ⇒ 与旧行为一致，差异只在 `DrawMode=1` 的配置上）；
 *  3. `renderSuspended` 缝与 `present:'never'` 档都不写时钟。
 *
 * 红→绿证据（修前）：把本文件的第 2 组用例跑在 `git stash` 之前的 `loop.ts` 上 ⇒
 * 「DrawMode=1 + engineBool=1 ⇒ clock=本帧时刻」失败（`clock` 恒为初始的 1000）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseIni } from '../src/engineConfig.js';
import { frameRenderGate, runFrameLoop, type FrameRenderGate } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { im, instr, mkEngine } from './harness.js';

const TICK_MS = 20;

/** 固定步长虚拟时钟的宿主（时钟只由 `onFrameEnd` 推进）。 */
function virtualHost(extra: Partial<FrameHost> = {}): { host: FrameHost; advance: () => void } {
  const box = { clock: 1000 };
  return {
    host: { now: () => box.clock, ...extra },
    advance: () => {
      box.clock += TICK_MS;
    },
  };
}

/** `DrawMode=1` 的配置（引擎 `set:DrawMode`；随包 INI 是 0）。★`parseIni` 的键是 `段:键` ⇒ 必须有段头。 */
const D3D_ON = parseIni('[set]\nDrawMode=1');
/** `DrawMode=0` 的配置。 */
const D3D_OFF = parseIni('[set]\nDrawMode=0');

function gateOf(configText: 'on' | 'off' | 'none', suspend = false): FrameRenderGate {
  const e = mkEngine([instr(0x101, [])]);
  e.config = configText === 'on' ? D3D_ON : configText === 'off' ? D3D_OFF : null;
  return frameRenderGate(e, suspend);
}

test('① 门的第一层：DrawMode != 1 ⇒ 整块不进（不看 667860/effect_flags）', () => {
  const e = mkEngine([instr(0x101, [])]);
  e.config = D3D_OFF;
  e.engineValues.set(ENGINE_FIELD.engineBool, 1); // 即使布尔位与效果位都置
  e.effectFlags = 0x2400;
  const g = frameRenderGate(e);
  assert.equal(g.drawMode, false);
  assert.equal(g.gateOpen, false, '引擎 `if (*(_DWORD *)(_this + 667856) == 1)` 不成立 ⇒ 整块跳过');
  assert.equal(g.clockWrite, false);
  assert.equal(g.d3dCommit, false);

  // 无配置（`e.config = null`）= 缺省 0 ⇒ 同上
  assert.equal(gateOf('none').drawMode, false, 'cfgInt(..., 0) 缺省 0');
  assert.equal(gateOf('none').clockWrite, false);
});

test('② 门的第一层：DrawMode=1 但宿主挂起渲染（`Engine+675968`）⇒ `v92 = 0`', () => {
  const g = gateOf('on', true);
  assert.equal(g.drawMode, true);
  assert.equal(g.suspended, true);
  assert.equal(g.gateOpen, false, 'raw 20742-20745：挂起 ⇒ 整段（含时钟写与提交）跳过');
  assert.equal(g.clockWrite, false);
  assert.equal(g.d3dCommit, false);
});

test('③ 门的第二层：engineBool（667860）或 effect_flags & 0x2400 才开门', () => {
  const e = mkEngine([instr(0x101, [])]);
  e.config = D3D_ON;
  assert.equal(frameRenderGate(e).gateOpen, false, '两者皆 0 ⇒ `else { v92 = 0; }`');

  e.engineValues.set(ENGINE_FIELD.engineBool, 1);
  const byBool = frameRenderGate(e);
  assert.equal(byBool.gateOpen, true);
  assert.equal(byBool.clockWrite, true, '④ 时钟写在同一支里（raw 20750-20751）');
  assert.equal(byBool.d3dCommit, true);
  assert.ok(byBool.unknown.length >= 2, '未定位的两条条件必须显式登记，不许假装完整');

  e.engineValues.set(ENGINE_FIELD.engineBool, 0);
  e.effectFlags = 0x2000; // 只置 0x2400 的高位
  assert.equal(frameRenderGate(e).gateOpen, true, '`(effect_flags & 0x2400) != 0`');
  e.effectFlags = 0x0400;
  assert.equal(frameRenderGate(e).gateOpen, true);
  e.effectFlags = 0x8000; // 不在掩码里
  assert.equal(frameRenderGate(e).gateOpen, false);
});

test('④ 内层提交门（raw 20753-20756）：时钟照写，但停靠锁/0x1000000 会挡住提交', () => {
  const e = mkEngine([instr(0x101, [])]);
  e.config = D3D_ON;
  e.engineValues.set(ENGINE_FIELD.engineBool, 1);

  // 停靠锁非 0 且没有 0x400 位 ⇒ 提交被挡，**时钟仍然写**（写在锁判定之前）
  e.engineValues.set(ENGINE_FIELD.frameTickLock, 1);
  e.effectFlags = 0;
  const locked = frameRenderGate(e);
  assert.equal(locked.clockWrite, true, 'raw 20750-20751 在锁判定（20755）之前');
  assert.equal(locked.d3dCommit, false, '`(!429752 || (v16 & 0x400) != 0)` 不成立');

  e.effectFlags = 0x400;
  assert.equal(frameRenderGate(e).d3dCommit, true, '锁在 + effect_flags & 0x400 ⇒ 放行');

  e.engineValues.set(ENGINE_FIELD.frameTickLock, 0);
  e.effectFlags = 0x1000000;
  const skip = frameRenderGate(e);
  assert.equal(skip.clockWrite, true);
  assert.equal(skip.d3dCommit, false, '`(v16 & 0x1000000) == 0` 不成立');
});

test('★⑤ 驱动级：DrawMode=1 + engineBool=1 ⇒ 帧末真的写 `clockPrev`/`clock`（修前不写）', async () => {
  const e = mkEngine([instr(0x101, []), instr(0x101, []), instr(0x101, [])]);
  e.config = D3D_ON;
  e.engineValues.set(ENGINE_FIELD.engineBool, 1);
  e.engineValues.set(ENGINE_FIELD.clock, 777); // 上一帧留下的时钟值
  const { host, advance } = virtualHost();
  const seen: FrameRenderGate[] = [];
  const clocks: [number | undefined, number | undefined][] = [];
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    present: 'needsRender',
    onFrameRenderGate: (g) => {
      seen.push(g);
    },
    onFrameEnd: () => {
      clocks.push([e.engineValues.get(ENGINE_FIELD.clock), e.engineValues.get(ENGINE_FIELD.clockPrev)]);
      advance();
    },
  });
  assert.equal(r.frames, 2);
  assert.equal(seen.length, 2, '每完整帧一次');
  assert.equal(seen[0]!.clockWrite, true);
  assert.deepEqual(clocks[0], [1000, 777], '第一帧：clock = host.now()、clockPrev = 写之前的 clock');
  assert.deepEqual(clocks[1], [1020, 1000], '第二帧：时钟继续前进、clockPrev 跟着搬');
  assert.equal(e.engineValues.get(ENGINE_FIELD.clock), 1020);
  assert.equal(e.engineValues.get(ENGINE_FIELD.clockPrev), 1000);
});

test('★⑥ 驱动级：默认配置（DrawMode=0）与挂起态都不写时钟 ⇒ 与修前行为一致', async () => {
  for (const [what, config, extra] of [
    ['DrawMode=0', D3D_OFF, {}],
    ['宿主挂起', D3D_ON, { renderSuspended: (): boolean => true }],
  ] as const) {
    const e = mkEngine([instr(0x101, [])]);
    e.config = config;
    e.engineValues.set(ENGINE_FIELD.engineBool, 1);
    e.engineValues.set(ENGINE_FIELD.clock, 777);
    const { host } = virtualHost(extra as Partial<FrameHost>);
    await runFrameLoop(e, host, {
      gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
      services: { winReveal: false, charGrid: false },
      advFrame: false,
      maxStepsPerFrame: 1,
      maxFrames: 1,
      present: 'needsRender',
    });
    assert.equal(e.engineValues.get(ENGINE_FIELD.clock), 777, `${what}：时钟不动`);
    assert.equal(e.engineValues.get(ENGINE_FIELD.clockPrev), undefined, `${what}：clockPrev 也不写`);
  }
});

test('⑦ `present: "never"` 的 tracer 档：即使门开着也不写时钟（不假装每帧）', async () => {
  const e = mkEngine([instr(0x101, [])]);
  e.config = D3D_ON;
  e.engineValues.set(ENGINE_FIELD.engineBool, 1);
  e.engineValues.set(ENGINE_FIELD.clock, 777);
  const { host } = virtualHost();
  let hooked = 0;
  await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 1,
    present: 'never',
    onFrameRenderGate: () => {
      hooked++;
    },
  });
  assert.equal(e.engineValues.get(ENGINE_FIELD.clock), 777);
  assert.equal(hooked, 0, 'present:never 不触发门钩子');
});

test('⑧ `im()` 与 0x21B（engineBool 的写入端）配合：0x21B 置位后门才开', async () => {
  const e = mkEngine([instr(0x21b, [im(1)]), instr(0x101, [])]);
  e.config = D3D_ON;
  assert.equal(frameRenderGate(e).gateOpen, false, '脚本执行前 667860 = 0');
  const { host } = virtualHost();
  await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: 2,
    present: 'needsRender',
  });
  assert.equal(e.engineValues.get(ENGINE_FIELD.engineBool), 1, '0x21B 写的就是这一格');
  assert.notEqual(e.engineValues.get(ENGINE_FIELD.clock), undefined, '门开 ⇒ 帧末写时钟');
});
