/** @tier T0 @kind core @subsystem host */

/**
 * **贴边开窗的几何**（`src/arch/windowPlacement.ts`）—— `tickets/T-0040` 的守卫。
 *
 * 需求（用户）：跑 E4 截图/录制时，窗口每次都弹到屏幕正中抢焦点、反复打断手头的事 ⇒
 * 测试期把窗口摆到**屏幕下缘**，只留标题栏可见，并且**不抢焦点**。
 * 本文件只测纯几何（Electron 侧只负责把 `workArea` 递进来，见 `electron/windows.ts`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLEBAR_PX, computeEdgePosition, edgeFromEnv } from '../src/arch/windowPlacement.js';

/** 一块 1920×1080、任务栏 40px 的可用区（Windows 常见形态）。 */
const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const GAME = { width: 1280, height: 720 };

test('T-0040 贴下缘：只留标题栏可见（窗口绝大部分在屏幕外），另一个方向居中', () => {
  const p = computeEdgePosition(WA, GAME, 'bottom');
  assert.equal(p.y, WA.y + WA.height - TITLEBAR_PX, '窗口顶边落在可用区下缘往上 TITLEBAR_PX 处');
  assert.ok(p.y > WA.height - 64, '窗口几乎整体在屏幕下方（只有标题栏在屏内）');
  assert.equal(p.x, WA.x + Math.round((WA.width - GAME.width) / 2), '水平居中（用 workArea，不含任务栏）');
});

test('T-0040 其余三条边：同一条规则的另一维', () => {
  assert.equal(computeEdgePosition(WA, GAME, 'top').y, WA.y + TITLEBAR_PX - GAME.height);
  assert.equal(computeEdgePosition(WA, GAME, 'left').x, WA.x + TITLEBAR_PX - GAME.width);
  assert.equal(computeEdgePosition(WA, GAME, 'right').x, WA.x + WA.width - TITLEBAR_PX);
  // 上下边时纵向贴边、横向居中；左右边时反之
  assert.equal(computeEdgePosition(WA, GAME, 'top').x, computeEdgePosition(WA, GAME, 'bottom').x);
  assert.equal(computeEdgePosition(WA, GAME, 'left').y, computeEdgePosition(WA, GAME, 'right').y);
});

test('T-0040 副屏/负坐标可用区（x/y 不为 0）也要正确', () => {
  const wa2 = { x: -1920, y: -200, width: 1920, height: 1000 };
  const p = computeEdgePosition(wa2, GAME, 'bottom');
  assert.equal(p.y, wa2.y + wa2.height - TITLEBAR_PX);
  assert.equal(p.x, wa2.x + Math.round((wa2.width - GAME.width) / 2));
});

test('T-0040 窗口比标题栏还矮时不会算到屏幕外（keep 取 min）', () => {
  const p = computeEdgePosition(WA, { width: 100, height: 20 }, 'bottom');
  assert.equal(p.y, WA.y + WA.height - 20, '高度小于 TITLEBAR_PX 时留整窗可见');
});

test('T-0040 档位解析：空/0/off = 不贴边；1/on/bottom = 下缘；top/left/right 直给', () => {
  assert.equal(edgeFromEnv({}), null);
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: '' }), null);
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: '0' }), null);
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'OFF' }), null, '大小写无关');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'center' }), null);
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: '1' }), 'bottom');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'on' }), 'bottom');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'bottom' }), 'bottom');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'Top' }), 'top');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'left' }), 'left');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: 'right' }), 'right');
  assert.equal(edgeFromEnv({ AMAYUI_WINDOW_EDGE: '啥东西' }), 'bottom', '其它非空值按默认档');
});
