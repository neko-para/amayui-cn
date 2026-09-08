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
import { Engine } from '../src/vm/engine.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { dec } from '../src/vm/bits.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RAW_DIR = path.join(ROOT, 'raw');

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

  const m = im.flush();
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

// ---- TITLE 端到端：派发（时间节流 get-input-type + hover 命中）----
test('TITLE: mouse_callback 登记 -> get-input-type 时间节流派发 -> 鼠标 handler 不崩', async () => {
  const src = new NodeFileSource({ rawDir: RAW_DIR });
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
  // 引擎 0xCD：`now - lastAdvance >= advanceThrottle(200) || advActive` 才推进。headless 无渲染时钟，注入 nowMs 过闸。
  e.nowMs = 200; // now(200) - lastAdvance(0) >= throttle(200) → 推进
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

  await src.dispose?.();
});
