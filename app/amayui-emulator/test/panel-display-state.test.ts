/** @tier T0 @kind core @subsystem ops */

/**
 * **`0x91`/`0x92` 的"面板显示态"整条链**（`tickets/T-0158` 的 P2 ×3 + P3 `0x94` ×2）。
 *
 * 修前的三处缺口（审计 `impl-audit-2026-09.md` 行 214-217 / 416-417）：
 * | # | 症状 | 引擎依据 |
 * |---|---|---|
 * | ① | `effect_flags \|= 0x800000` **无人读**（`sub_4098E0` 未实现）⇒ 面板点击/回退派发永不发生 | raw 14055-14105 + 主循环 raw 21205-21208 |
 * | ② | 显示分支末尾长度槽写 0 ⇒ ip 停在本条；emulator 正常返回、`stepOnce` 默认 +1 | raw 29540（0x91）/ 29565（0x92） |
 * | ③ | `RoutePanel.fallbackLabel`（`[12961]`/`[7467]`）只有写点 ⇒ **死写** | raw 14084-14092 |
 *
 * 本文件把整条链按**主循环的形状**驱动：`stepOnce` 反复跑（引擎主循环每轮一条指令/一次泵），
 * 直到 ip 真的移走。★三条出口（左键 → labelC + 清表；回退 label；悬停 enter/leave）都在这里钉住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, mkEngine } from './harness.js';

test('★P2 0x91：显示分支把长度槽写 0 ⇒ ip **停在本条**（引擎 raw 29528 → 29540）', async () => {
  const e = mkEngine([instr(0x91, [im(10000)]), instr(0x5, [im(1)])]);
  const st = await stepOnce(e);
  assert.equal(e.curScript().ip, 0, '★ip 必须停在本条（长度槽 0 ⇒ 派发器 raw 20165 的 `ip += 4*0`）');
  assert.equal(st.operandCount, 0, '长度槽镜像 = 0（入口是 3 = raw 29528，显示分支末尾改写成 0 = raw 29540）');
  assert.equal(e.effectFlags & 0x800000, 0x800000, '`effect_flags |= 0x800000`（raw 29536）');
  assert.equal(e.routes.pageStep, 10000, '`sub_404020(panelA, op1)` 的步长落 `[960]`');
  assert.equal(e.routes.fillPending, 1, '`[7464] = 1`');
});

test('★P2 0x92：同 0x91，且回退 label 先落 `[7467]`（长度槽 5 → 0 = raw 29552 → 29565）', async () => {
  const e = mkEngine([instr(0x92, [im(10000), im(0x888)]), instr(0x5, [im(1)]), instr(0x5, [im(2)])]);
  const st = await stepOnce(e);
  assert.equal(e.curScript().ip, 0, '★ip 停在本条');
  assert.equal(st.operandCount, 0, '长度槽 = 0');
  assert.equal(e.routes.fallbackLabel, 0x888, '`_this[12961] = op2`（raw 29561）');
});

test('★P2 0x92 missing-consumer：`fallbackLabel` 现在有**真读者** ⇒ 无点击/无悬停时派发回退 label + 压本指令返回点', async () => {
  const e = mkEngine([instr(0x92, [im(1), im(0x888)]), instr(0x5, [im(1)]), instr(0x5, [im(2)])]);
  const f = e.curScript();
  f.labelMap.set(0x888, 2);
  await stepOnce(e); // ① 显示分支（置位 + 写回退 + 停在本条）
  assert.equal(f.ip, 0);
  await stepOnce(e); // ② 显示态重入 ⇒ 跑 sub_4098E0 那一轮（无输入 ⇒ 走回退支）
  assert.equal(f.ip, 2, '★回退 label 0x888 被派发（引擎 raw 14084-14090）');
  assert.equal(f.retStack.pop(), 0, '`sub_405360(_this, 0)` 压的返回点 = 本指令的 dword 偏移');
  assert.equal(e.effectFlags & 0x800000, 0, '★三条出口都清 `0x800000`（raw 14091）');
});

test('★P2 0x91 missing-consumer：左键 ⇒ `sub_404120` 取游标项 labelC **并把整表清空**', async () => {
  const e = mkEngine([instr(0x91, [im(1)]), instr(0x5, [im(1)]), instr(0x5, [im(2)])]);
  const f = e.curScript();
  const p = e.routes;
  p.push(0, 0, 100, 100, -1, -1, 0x777, f.scriptId); // labelC = 0x777
  f.labelMap.set(0x777, 2);
  e.input.setCursor(50, 50, true); // 光标在矩形内 ⇒ showPanel 的首次命中测试（raw 10024-10026）落第 0 项
  await stepOnce(e); // ① 显示分支（showPanel 的首次命中测试 ⇒ cursor = 0）
  assert.equal(p.cursor, 0, '前提：showPanel 已按当前光标把游标落在第 0 项');
  e.input.pressMouse(0); // 左键挂起位（= 掩码 bit4；`sub_478090` 的消费刷）
  await stepOnce(e); // ② 泵
  assert.equal(f.ip, 2, '★左键 ⇒ 派发 labelC（raw 14073-14078；**不压返回点**）');
  assert.equal(p.count, 0, '★`sub_404120` 把整张路由表清空（`[258] = 0`）');
  assert.equal(e.effectFlags & 0x800000, 0, '清 `0x800000`');
  assert.equal(f.retStack.length, 0, '★这条出口**不**压返回点（引擎 raw 14076-14078 是直接改 ip）');
});

test('★P2 0x91 missing-consumer：悬停变化 ⇒ 派发 enter/leave 并压本指令返回点（raw 14095-14103）', async () => {
  const e = mkEngine([instr(0x91, [im(1)]), instr(0x5, [im(1)]), instr(0x5, [im(2)])]);
  const f = e.curScript();
  const p = e.routes;
  // 矩形放在屏幕外 ⇒ 首次命中测试必然 miss ⇒ cursor = -1；随后手工把游标移到第 0 项。
  p.push(5000, 5000, 10, 10, 0x999, 0xaaa, 0xbbb, f.scriptId);
  f.labelMap.set(0x999, 2);
  await stepOnce(e);
  assert.equal(p.cursor, -1, '屏幕外 ⇒ 游标 -1');
  p.cursor = 0; // = 引擎 WM_MOUSEMOVE 的 sub_403C50 把游标移进该项
  await stepOnce(e); // 泵 ⇒ sub_403E70 的两段式：hover −1 → 0 ⇒ 先发 labelEnter
  assert.equal(f.ip, 2, '★游标进入该项 ⇒ 派发 labelEnter（raw 14098-14101）');
  assert.equal(f.retStack.pop(), 0, '悬停分支压 `(ip-ip_base)>>2` = 本指令偏移（raw 14098）');
  assert.equal(e.effectFlags & 0x800000, 0, '清 `0x800000`');
});

test('★P3 0x94：面板**首次显示**的命中测试是**无条件**的（无光标也做 ⇒ 游标落 -1）', async () => {
  const e = mkEngine([instr(0x94, []), instr(0x5, [im(1)])]);
  const p = e.routes;
  p.push(0, 0, 100, 100, -1, -1, 0x777, e.curScript().scriptId);
  p.cursor = 0; // 旧游标（模拟"上一次移动留下的"）
  e.input.setCursor(-100000, -100000, false); // 鼠标出窗/未初始化
  await stepOnce(e);
  assert.equal(e.input.hasCursor, false, '前提：无光标');
  assert.equal(p.cursor, -1, '★修前 `if (hasCursor)` 会跳过命中测试、游标停在旧的 0；引擎 raw 10023-10026 无条件');
  assert.equal(p.hitDone, 1, '`[7465] = 1`（raw 10023）');
  assert.equal(p.pageStep, 10000, '`[960] = a2`（raw 10027）');
});
