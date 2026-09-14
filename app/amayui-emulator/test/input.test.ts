/** 鼠标/输入子系统测试。
 *  1) InputManager 单元（位置/按钮/按下沿/移动/flush/consume/派发目标/get-input-type 节流门）。
 *  2) TITLE 端到端：登记 mouse_callback -> get-input-type（时间节流）派发到鼠标 handler 且不崩。
 *  语义依据 docs-new/03-engine/input-system.md（0x108/0x109/0xCC/0xFB/0xCD/0x12E 等，0xCD 为时间节流/ADV 激活触发）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { Engine, SLEEP_GATE } from '../src/vm/engine.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { dec } from '../src/vm/bits.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
// 资源根 = install/（汉化版），与产品一致；AMAYUI_RESOURCE_DIR 可覆盖（见 src/arch/resourceDir.ts）
const RAW_DIR = resolveResourceDir(ROOT);

// ---- InputManager 单元 ----
test('InputManager: 光标位置 / 按钮 / 按下沿 / 移动 / flush / 派发目标', () => {
  const im = new InputManager();

  assert.equal(im.readX(), -100000);
  assert.equal(im.readY(), -100000);
  assert.equal(im.hasPending(), false);

  im.setCursor(640, 360, true);
  assert.equal(im.readX(), 640);
  assert.equal(im.readY(), 360);
  assert.equal(im.mouseMoved, true, '位置变化应置 mouseMoved');
  im.consumeEdges();
  assert.equal(im.mouseMoved, false);

  im.setCursor(-100000, -100000, false);
  assert.equal(im.readX(), -100000);
  assert.equal(im.hasPending(), false);

  im.pressMouse(0); // 左
  assert.equal(im.readButtons() & 1, 1);
  assert.equal(im.hasPending(), true);
  im.releaseMouse(0);
  assert.equal(im.readButtons() & 1, 0);
  assert.equal(im.hasPending(), true);

  im.pressJoy(3);
  assert.equal(im.hasPending(), true);

  const m = im.flushPending();
  assert.equal((m >> 4) & 1, 1);
  assert.equal((m >> 7) & 1, 1);
  assert.equal(m & ~((1 << 4) | (1 << 7)), 0);

  assert.equal(im.pickMouseTarget(), null);
  im.mouseJump = 0x123;
  assert.equal(im.pickMouseTarget(), 0x123);
  im.consumeEdges();
  assert.equal(im.pickMouseTarget(), null);
  assert.equal(im.hasPending(), false);
});

/**
 * ★★**两把刷子**（`tickets/T-0027`）★★
 *
 * 引擎 `sub_478090`（消费刷）与 `sub_4780D0`（实时刷）生命周期不同：
 *  - 消费刷只吃「挂起事件」（鼠标按下沿 / 手柄按下沿），**不含按住态** ⇒ 一次按下只能被消费一次；
 *  - 实时刷含「此刻仍按着的」⇒ 按住期间一直为真。
 * 等待推进泵（`serviceAdvanceWait`）必须用消费刷，否则按住左键会**每帧**翻一页。
 */
test('★两把刷子：flushPending 不含按住态（一次按下只有一次寿命），flushHeld 含按住态', () => {
  const im = new InputManager();
  im.pressMouse(0); // 左键按下（不松）
  assert.equal(im.flushHeld() & 0x10, 0x10, '实时刷：按住 ⇒ bit4');
  assert.equal(im.flushPending() & 0x10, 0x10, '消费刷：还没被消费过的新按下沿 ⇒ bit4');

  im.consumeEdges(); // 泵消费掉这次按下（引擎：`*v2 &= ~0x10` / `_this[174802]=0`）
  assert.equal(im.flushPending() & 0x10, 0, '★消费过之后，按住不放**不得**再出现在消费刷');
  assert.equal(im.flushHeld() & 0x10, 0x10, '实时刷仍反映"此刻仍按着"（ADV 分支/取消键三态机要用它）');

  im.releaseMouse(0);
  assert.equal(im.flushHeld() & 0x10, 0, '松开后实时刷也清');
  assert.equal(im.flushPending() & 0x10, 0, '松开本身不产生新的按下沿');
});

test('★按住态自愈：syncButtons 按宿主真值重建，releaseAllMouse 清全部（丢 mouseup 的兜底）', () => {
  const im = new InputManager();
  im.pressMouse(0); // 按下后假设 mouseup 丢失（指针移出窗口/失焦）
  assert.equal(im.buttons, 1);
  im.syncButtons(0); // 之后任意一次 mousemove 携带真值 e.buttons=0
  assert.equal(im.buttons, 0, '★丢一次 mouseup 后，任意事件都能把按住态拉回真值');
  im.pressMouse(1);
  assert.equal(im.buttons, 2);
  im.releaseAllMouse();
  assert.equal(im.buttons, 0, '失焦/隐藏 ⇒ 全部释放');
  im.syncButtons(3);
  assert.equal(im.buttons, 3, '回到窗口后按真值重建（左+右）');
});

// ---- TITLE 端到端：派发（时间节流 get-input-type + hover 命中）----
test('TITLE: mouse_callback 登记 -> get-input-type 时间节流派发 -> 鼠标 handler 不崩', async () => {
  const src = new NodeFileSource({ resourceDir: RAW_DIR });
  const input = new InputManager();
  const e = new Engine(new StubNative(), input);
  e.fileSource = src;

  const r = await src.readScript(0x5264); // TITLE.BIN
  assert.ok(r, '应读到 TITLE.BIN');
  loadScriptData(e, r.data, r.name);
  const script = e.curScript().script!;

  const stepSafe = async (): Promise<ReturnType<typeof stepOnce>> => {
    const instr = script.instructions[e.curScript().ip];
    assert.ok(instr, '指令流应在范围内');
    const t = await stepOnce(e);
    assert.notEqual(t.handlerKind, 'unimplemented', `未实现 opcode 0x${instr.opcode.toString(16)} (${instr.name})`);
    return t;
  };

  // Phase A：步进直到执行 mouse_callback(0xcc)，记录其跳转目标
  let targetLabel = -1;
  let guard = 0;
  while (guard++ < 20000) {
    const instr = script.instructions[e.curScript().ip];
    assert.ok(instr, 'Phase A 指令流越界');
    await stepSafe();
    if (instr.opcode === 0xcc) {
      targetLabel = e.input.mouseJump;
      assert.equal(e.input.mouseSlot, 0x10, 'mouse_callback op1(slot) 应为 0x10');
      break;
    }
  }
  assert.notEqual(targetLabel, -1, 'TITLE 主流程应执行 mouse_callback 登记');
  const targetPos = e.curScript().labelMap.get(targetLabel);
  assert.notEqual(targetPos, undefined, `label 0x${targetLabel.toString(16)} 应在 labelMap 中`);

  // Phase B：步进直到当前指令是 get-input-type(0xcd)（不步进它）
  guard = 0;
  while (true) {
    const instr = script.instructions[e.curScript().ip];
    assert.ok(instr, 'Phase B 指令流越界');
    if (instr.opcode === 0xcd) break;
    await stepSafe();
    assert.ok(++guard < 20000, '未在 20000 步内遇到 get-input-type');
  }

  // 注入光标位置（供 hover 命中 & 0x12E 判定；0xCD 派发不再依赖鼠标移动/按下，改为时间节流）。
  // 几何完全来自脚本数据（local5/local69/local cd），此处按数据推的点落在第 0 项内。
  input.setCursor(1102 + 0x40, 294 + 0x40, true);
  assert.equal(input.hasPending(), true, '移入应标记待处理输入活动（供 hover/边沿观测）');
  // 引擎 0xCD：`now - lastAdvance >= advanceThrottle || advActive` 才推进。但引擎 `_this[429812]` 从未写入=0，故条件恒真（无节流，始终推进）。
  // headless 无渲染时钟，注入 nowMs 过闸（throttle=0 → 任意 nowMs 都推进）。
  e.nowMs = 200; // now(200) - lastAdvance(0) >= throttle(0) → 推进
  const t = await stepSafe();
  assert.equal(t.opcode, 0xcd, '应步进到 get-input-type');
  assert.equal(e.curScript().ip, targetPos, `get-input-type 时间节流派发应跳到目标 (0x${targetLabel.toString(16)})`);
  // 0xCD 不消费鼠标/手把边沿（引擎：触发由时间节流/ADV 激活决定，与鼠标活动无关）
  assert.equal(input.hasPending(), true, '0xCD 不应消费鼠标/手把边沿（hasPending 保持）');

  // 派发后继续步进一小段：hover handler（读位置+0x12E+重绘）应跑完并回循环，不抛未实现错误，且不离开 TITLE
  const cur0 = e.cur;
  guard = 0;
  while (guard++ < 2000) {
    const instr = script.instructions[e.curScript().ip];
    if (!instr) break;
    await stepSafe();
    if (e.cur !== cur0) break; // 若 call-script 离开 TITLE 则停（不应发生）
    if (instr.opcode === 0xcd) break; // 回到循环起点
  }
  assert.equal(e.cur, cur0, 'hover 后应仍在 TITLE（未误入游戏启动）');

  // hover 索引（local 3f5，0x12E 结果）——几何来自脚本数据，光标落在第 0 项内应为 0
  const hoverIdx = dec(e.key, e.curScript().locals.int.get(0x3f5) ?? 0);
  assert.equal(hoverIdx, 0, `0x12E 悬停命中应给出第 0 项 (got ${hoverIdx})`);

  // sleep(0xC8)：步进到 sleep 指令，验证置 SLEEP_GATE + sleepUntil（引擎帧让步；renderer 到点放行）
  guard = 0;
  let sleptAt = -1;
  while (guard++ < 2000) {
    const instr2 = script.instructions[e.curScript().ip];
    if (!instr2) break;
    if (instr2.opcode === 0xc8) { sleptAt = e.curScript().ip; break; }
    await stepSafe();
    if (e.cur !== cur0) break;
  }
  assert.notEqual(sleptAt, -1, 'TITLE 循环应含 sleep(0xC8) 指令');
  await stepSafe(); // 执行 sleep
  assert.equal(e.waitFlags & SLEEP_GATE, SLEEP_GATE, 'sleep 应置 SLEEP_GATE');
  assert.ok(e.sleepUntil > 0, 'sleep 应设 sleepUntil(ms)');
  // 模拟 renderer 到点放行：nowMs >= sleepUntil 后清 SLEEP_GATE
  e.nowMs = e.sleepUntil + 1;
  assert.ok(e.nowMs >= e.sleepUntil, 'nowMs 越过 sleepUntil');
  e.waitFlags &= ~SLEEP_GATE;
  assert.equal(e.waitFlags & SLEEP_GATE, 0, 'SLEEP_GATE 应被清（放行）');

  await src.dispose?.();
});
