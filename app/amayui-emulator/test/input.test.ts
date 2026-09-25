/** @tier T1 @kind core @subsystem input */

/** 鼠标/输入子系统测试。
 *  1) InputManager 单元（位置/按钮/按下沿/移动/flush/consume/派发目标/get-input-type 节流门）。
 *  2) TITLE 端到端：登记 mouse_callback -> get-input-type（时间节流）派发到鼠标 handler 且不崩。
 *  语义依据 docs-new/03-engine/input-system.md（0x108/0x109/0xCC/0xFB/0xCD/0x12E 等，0xCD 为时间节流/ADV 激活触发）。
 *  ★TITLE **单脚本**运行要先补一条真链路里的前置（`SETL2DMOC` 装 `TITLE.MOC` 进实例槽 0），
 *    否则 `TITLE.txt:554` 的 `i34e` 会按引擎 raw 34728 抛错 —— 见例内「前置」注释。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputManager } from '../src/vm/input.js';
import { StubNative, ShowMessageError } from '../src/vm/native.js';
import { Engine, SLEEP_GATE } from '../src/vm/engine.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { dec } from '../src/vm/bits.js';
import { makeCtx } from '../src/vm/step.js';
import { ENGINE_INTERNAL_OPS, OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { im, instr, loc, mkEngine, scriptDerived } from './harness.js';
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

// ---- 0xCD 的推进门槽（P1，票 T-0158）----
test('★0xCD 的推进门槽：未注册目标 ⇒ 槽 = 1（前进 1 条）；自行定 ip ⇒ 槽 = 0（见 TITLE 端到端）', async () => {
  // 对照面：目标未注册（引擎 raw 25852 `v4 == -1` 支）⇒ 槽**保持 1**、ip 前进 1 条。
  const eng = mkEngine([instr(0xcd, []), instr(0x1a7, [])]);
  eng.input.mouseJump = -1;
  eng.nowMs = 1000; // 节流 = 0 ⇒ 过闸（`tickets/T-0047` 的已知偏差：emulator 不节流）
  const t = await stepOnce(eng);
  assert.equal(t.opcode, 0xcd);
  assert.equal(t.operandCount, 1, '未注册目标 ⇒ 引擎保持槽 = 1（前进 1 条）');
  assert.equal(eng.curScript().ip, 1, 'ip 前进 1 条（emulator 的下标制等价于引擎 +4 字节）');
});

// ---- TITLE 端到端：派发（时间节流 get-input-type + hover 命中）----
test('TITLE: mouse_callback 登记 -> get-input-type 时间节流派发 -> 鼠标 handler 不崩', async () => {
  const src = new NodeFileSource({ resourceDir: RAW_DIR });
  const input = new InputManager();
  const e = new Engine(new StubNative(), input);
  e.fileSource = src;

  // ---- 前置：`SETL2DMOC` 在真链路里为 TITLE 装的那一步（`T-0176`）----
  // 真链路：`INIT2.txt:115` 把 `global 708ab6` 写成脚本 id `0x522d`（SETL2DMOC.BIN），
  // `TITLE.txt:533-554` 再预设 `f8c46 = 0x4f9e`（模型文件 id）/`f8c47 = 0`（实例槽）并逐个
  // `call-script` 那张表里的脚本 ⇒ SETL2DMOC 的 `f8c46 == 0x4f9e` 支（`src/SETL2DMOC.txt:22-28`）
  // 就是下面四条：`i341 4f9e <槽>` + 三条 `i345`（模型内纹理 0/1/2）。
  // ★为什么本测试要手工补：这里**单脚本**跑 TITLE（不跑 INIT2，也不挂扩展包 ⇒ `0x522d` 那条
  //   `call-script` 根本调不动），而 `TITLE.txt:554` 的 `i34e 5274 0 0 1` 要求实例槽 0 里**先有模型**
  //   （引擎 `sub_478640` raw 92817 的 `if (!*_this) return 0` ⇒ `sub_428200` raw 34722-34731 抛
  //   「L2Dモーションファイル %s の読み込みに失敗しました」）。`T-0160` 之前 emulator 把这条**静默吞掉**，
  //   于是"缺模型"这个真实前提被掩盖；同一支路由 `test/live2d-enabled-flag.test.ts` 在真链路上钉住
  //   （`a9d0 = 0` ⇒ `l2dSlots` 有 `0:TITLE.MOC(0x4f9e)`）。
  {
    const prelude = [
      instr(0x341, [im(0x4f9e), im(0)]), // SETL2DMOC：装 TITLE.MOC 进实例槽 0
      instr(0x345, [im(0x4f9f), im(0), im(0)]), // 模型内纹理 0
      instr(0x345, [im(0x4fa0), im(0), im(1)]), // 模型内纹理 1
      instr(0x345, [im(0x4fa1), im(0), im(2)]), // 模型内纹理 2
      instr(0x1a7, []), // ret：这段合成脚本只当前置用
    ];
    loadScriptIntoFrame(
      e.curScript(),
      {
        ...scriptDerived(),
        signature: 'SYS0000',
        isVer5: false,
        headerLen: 0,
        localVars: [0, 0, 0, 0, 0, 0],
        subHeaderLength: 0,
        tables: [],
        instructions: prelude.map((o, i) => ({ ...o, index: i })),
        labelTargets: new Set(),
        raw: new Uint8Array(0),
      },
      'SETL2DMOC-PRELUDE.BIN',
    );
    for (const _ of prelude) await stepOnce(e);
    assert.equal(
      e.l2dSlots.get(0)?.modelId,
      0x4f9e,
      '前置应把 TITLE.MOC(0x4f9e) 装进实例槽 0（SETL2DMOC 的 TITLE 支；缺它 ⇒ TITLE.txt:554 的 i34e 会抛）',
    );
  }

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
  // ★P1 `0xcd`（票 T-0158）：引擎在"自己定 ip"的那条支把推进门槽写成 **0**（raw 25870-25872）；
  //   修前 emulator 恒报静态的 1（控制窗/追踪看到的门值与引擎不同）。
  assert.equal(t.operandCount, 0, '★自行定 ip ⇒ 推进门槽 = 0（引擎 raw 25872）');
  assert.equal(e.curScript().operandCount, 0, '帧字段与 trace 同源');
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
  // ★`tickets/T-0156` 读体后的补充（断言未改）：`src/TITLE.txt:63` 的实参是 **1** ⇒ 引擎 `sub_4218D0`
  //   raw 30304 只在 `v3 >= 10` 时进"帧节流计时器"支，`n < 10` 走 raw 30311 的 `Sleep(v3)`（**同一次派发内的
  //   进程级硬阻塞**、不置 `effect_flags |= 1`）。本仓两支都装 `SLEEP_GATE`+`sleepUntil` 是**架构性等价物**
  //   （帧循环 `maxStepsPerFrame` 默认 `Infinity` ⇒ 不装门的话 TITLE 的 `sleep 1; jmp` 会空转冻结）；
  //   两支的差别改由 `sleepUntil = nowMs + max(0, n)` 与"只 n>=10 才 `effect_flags |= 1`"承载，
  //   守卫见 `test/t0156-control-frame.test.ts`。
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

// ---------------------------------------------------------------------------
// ★`0x10C`（`i10c`，**SetKeyMulti**）：脚本驱动的**键位重映射**（`tickets/T-0163`；审计 §4.1 的
// P1 `stale-ledger` + P2 `missing-consumer` + P3 `missing-branch`）
//
// 引擎 `sub_4220B0`（raw 30616-30634）：`op2` = 键码、`op1` = 掩码位（unsigned > 0x1F 抛
// 「SetKeyMultiの引数が不正です．」**且不写表**）⇒ `Input[1176 + Input[1432+op2]] = op1`。
// 语料 `src/SYSTEM4.txt:87-97` 共 11 处 `i10c`，**全部绑 mask 位 4**；其中
//   `i10c 4 2c` ⇒ 键码 0x2c → VK 90 = 'Z'
//   `i10c 4 1c` ⇒ 键码 0x1c → VK 13 = RETURN（本就在默认表里 ⇒ 修前唯一"碰巧有效"的一条）
// ⇒ 修好后「按 Z 触发确认位（bit4）」才成立（`0x100` 的掩码扫描 / `joy-callback 4`）。
// ---------------------------------------------------------------------------

/** 跑一条**合成** `i10c`（`bit` = 引擎 op1、`keycode` = 引擎 op2）。 */
function runSetKeyMulti(e: Engine, bit: number, keycode: number): void {
  const f = e.curScript();
  const instr10c = instr(0x10c, [im(bit), im(keycode)]);
  OPS.get(0x10c)!(makeCtx(e, f, instr10c, e.native, () => {}));
}

test('★0x10C ①：`i10c 4 2c` ⇒ 键码 0x2c(Z) 绑到掩码位 4 ⇒ 按 VK 90 产生 bit4（修前：写入无消费者）', () => {
  // 默认表：`0x2c → VK 90`（sub_476AA0 raw 91367 的 `_this[1476] = 90`）
  assert.equal(new InputManager().keycodeToVk.get(0x2c), 90, '默认键码表：0x2c 必须 → VK 90（=Z）');

  const e = mkEngine([instr(0x1a7, [])]);
  // ① 未重映射时：Z 不在默认 VK→位表里 ⇒ 不产生任何位 ← **这就是修前的行为**（本用例是红的那一半）
  assert.equal(e.input.pressKey(90), false, '★修前：Z 未绑定 ⇒ 不产生掩码位（默认表只有 7 个 VK）');
  assert.equal(e.input.keyEdge, 0, '★修前：按下 Z 后 keyEdge 仍为 0 ⇒ 确认位（bit4）永远不会触发');
  e.input.releaseKey(90);

  // ② 脚本改键位：`i10c 4 2c`
  runSetKeyMulti(e, 4, 0x2c);
  assert.equal(e.input.vkToBit.get(90), 4, '写入生效：VK 90 → 掩码位 4（引擎 Input[1176+90]=4）');

  // ③ 现在按 Z ⇒ bit4（= 鼠标左键位/确认位）进掩码
  e.input.consumeEdges();
  assert.equal(e.input.pressKey(90), true, '重映射后 Z 命中映射表');
  assert.equal(e.input.flushPending() & (1 << 4), 1 << 4, '★按 Z 必须产生 mask 位 4（`joy-callback 4` 的派发前提）');
  assert.equal(e.input.flushHeld() & (1 << 4), 1 << 4, '实时刷同样带 bit4');
  assert.equal(e.input.keyEdge & ~(1 << 4), 0, '按下沿只有 bit4（键码 0x2c 只映射到这一个位）');

  // ④ 松开 ⇒ 清该位（不再污染 bit4）
  e.input.releaseKey(90);
  e.input.consumeEdges();
  assert.equal(e.input.flushHeld() & (1 << 4), 0, '松开 Z ⇒ bit4 清（不会把"确认"永久按住）');
});

test('★0x10C ①补：语料实参各条都按 mask 位 4 生效（含 `i10c 4 1c` 与 ≥7 的位不被截断）', () => {
  const e = mkEngine([instr(0x1a7, [])]);
  // `i10c 4 1c`：键码 0x1c → VK 13 = RETURN（默认已在表里；本条是"修复不破坏既有行为"的对照）
  assert.equal(e.input.vkToBit.get(13), 4, '默认：Enter 本来就在 bit4');
  runSetKeyMulti(e, 4, 0x1c);
  assert.equal(e.input.vkToBit.get(13), 4, '重写同一个绑定 ⇒ 仍是 bit4');
  e.input.consumeEdges();
  assert.equal(e.input.pressKey(13), true);
  assert.equal(e.input.flushPending() & (1 << 4), 1 << 4, 'Enter 仍是 bit4（既有行为不变）');

  // ★位号 > 6 不被截断（`tickets/T-0163` 修的第二个地方）：旧键盘掩码 `& 0x7f` 会把 bit11 吃掉。
  //   用**默认表里也有**的键码 0x0e（→ VK 8 = BackSpace）绑 bit11，确保测的是"位号不截断"而不是"键码能不能查"。
  runSetKeyMulti(e, 0x0b, 0x0e);
  e.input.consumeEdges();
  assert.equal(e.input.vkToBit.get(8), 0x0b, '键码 0x0e → VK 8，写入 bit11');
  assert.equal(e.input.pressKey(8), true);
  assert.equal(e.input.flushPending() & (1 << 11), 1 << 11, '★bit11 必须进掩码（旧实现 `& 0x7f` 会静默截掉）');
  assert.equal(e.input.flushHeld() & (1 << 11), 1 << 11, '实时刷同样带 bit11');
  e.input.releaseKey(8);
  e.input.consumeEdges();
  assert.equal(e.input.flushHeld() & (1 << 11), 0, '松开 + 消费沿 ⇒ bit11 全清');
});

test('★0x10C ②：未重映射时 Z **不产生**该位（机械证明修前是坏的）', () => {
  const im = new InputManager();
  // ★`flushPending()` 会消费 `mouseMoved`（它只并"事件"，不并"移动"）⇒ 先显式清一次边沿，
  //   让下面的断言只看键盘这一条通路（否则 `setCursor` 留下的移动标记会污染第二次调用）。
  im.consumeEdges();
  assert.equal(im.vkToBit.get(90), undefined, '默认 VK→位表里没有 VK 90（Z）');
  assert.equal(im.pressKey(90), false, '★按 Z 什么位都不动 ⇒ 修前 `i10c 4 2c` 是纯 no-op');
  assert.equal(im.keyEdge, 0);
  assert.equal(im.keysHeld, 0);
  assert.equal(im.flushHeld(), 0, '掩码里没有确认位');
  assert.equal(im.flushPending(), 0, '消费刷同样空（键盘按下沿=0）');
  // 而且在**本条不注册**的前提下，`0x100` 的掩码里永远不会出现 bit4
  //   ⇒ Z 想触发的那个 `joy-callback 4` 处理器**不可能被派发**（这条才是"Z 键无效"的机械形态）。
  const e = mkEngine([instr(0x100, []), instr(0x5, []), instr(0x5, [])]);
  e.input.pressKey(90);
  e.engineValues.set(517, 12);
  e.input.joyJump[4] = 2; // `joy-callback 4` 登记的确认处理器
  const ctx = makeCtx(e, e.curScript(), instr(0x100, []), e.native, () => {});
  OPS.get(0x100)!(ctx);
  assert.equal(ctx._nextIp, null, '★掩码为空、默认键槽 12 未登记 ⇒ 不派发（确认处理器永不运行 = Z 键无效）');
  // 对照：同一次按下，只要把 Z 重映射到 bit4，`0x100` 立刻派发到该处理器（证明差别就是本指令）
  runSetKeyMulti(e, 4, 0x2c);
  e.input.consumeEdges();
  e.input.pressKey(90);
  const ctx2 = makeCtx(e, e.curScript(), instr(0x100, []), e.native, () => {});
  OPS.get(0x100)!(ctx2);
  assert.equal(ctx2._nextIp, 2, '★重映射后 ⇒ 派发 joy-callback 4 的处理器（这正是修复带来的能力）');
});

test('★0x10C ③：位号 unsigned > 0x1F ⇒ 抛引擎同文 ShowMessageError，且**两张表一格未动**', () => {
  const e = mkEngine([instr(0x1a7, [])]);
  const before = [...e.input.vkToBit.entries()].sort((a, b) => a[0] - b[0]);
  const beforeCode = [...e.input.keycodeToVk.entries()].sort((a, b) => a[0] - b[0]);

  const cases: [number, string][] = [
    [0x20, '0x20（刚好越界）'],
    [0x100, '0x100'],
    [-1, '负数（引擎是 unsigned 比较 ⇒ 0xFFFFFFFF > 0x1F ⇒ 同样抛）'],
  ];
  for (const [bit, what] of cases) {
    assert.throws(
      () => runSetKeyMulti(e, bit, 0x2c),
      (err: unknown) => {
        assert.ok(err instanceof ShowMessageError, `${what}：应抛 ShowMessageError（走产品错误通路，不静默）`);
        assert.equal(err.engineText, 'SetKeyMultiの引数が不正です．', `${what}：错误串必须与引擎同文`);
        assert.equal(err.opcode, 0x10c);
        return true;
      },
      `${what} 必须抛`,
    );
  }
  // 抛在写之前（引擎 raw 30626-30631 在 30632 之前）⇒ 表必须一格未动
  assert.deepEqual([...e.input.vkToBit.entries()].sort((a, b) => a[0] - b[0]), before, '★越界 ⇒ VK→位表未写');
  assert.deepEqual([...e.input.keycodeToVk.entries()].sort((a, b) => a[0] - b[0]), beforeCode, '★越界 ⇒ 键码表未写');
  assert.equal(e.input.vkToBit.get(90), undefined, '★Z 仍然未绑定（越界实参不是"静默吞掉"）');

  // 边界内侧：0x1F 合法
  runSetKeyMulti(e, 0x1f, 0x2c);
  assert.equal(e.input.vkToBit.get(90), 0x1f, '0x1F 是合法位号（门是 > 0x1F）');
  assert.equal(e.input.pressKey(90), true);
  assert.equal(e.input.flushHeld(), 1 << 31, 'bit31 也在掩码里（int32 负值取值一致；位号上界 = 31）');
  e.input.releaseKey(90);
});

test('★0x10C ④：注册表分类（`OPS`=implemented，不在 no-op 表；不再是旧桩）', () => {
  assert.ok(OPS.has(0x10c), '0x10C 必须在已实现表里');
  assert.ok(!ENGINE_INTERNAL_OPS.has(0x10c), '★不得再留在 `ENGINE_INTERNAL_OPS`（否则旧桩会静默掩盖真实现）');
  assert.equal(new InputManager().keycodeToVk.get(0x1c), 13, '默认键码表：0x1c → VK 13（RETURN）');
  assert.equal(new InputManager().keycodeToVk.get(0x0e), 8, '默认键码表：0x0e → VK 8（BackSpace）');
});


//
// 引擎 `sub_419AF0`（raw 25012-25066）有**两条**分支：
//   掩码非 0 → 从游标起扫最低置位（上界 = `Engine[517]` = SetKeyTotal）→ 跳 `joy-callback` 登记的目标；
//   掩码 == 0 → 取 `v4 = Engine[517]`（**SetKeyTotal 本身当下标**）查同一张表 ⇒ "没有任何键按下时
//              跑「默认键」处理器"。旧 emulator 把它当成"无输入就落回" ⇒ 默认键处理器永不运行。
// 为什么这条静默致命：菜单/界面脚本一律登记 `joy-callback 0..c`（13 个槽）——第 13 个（下标 =
// `SYSTEM4.txt:86` 的 `i0fe c` = 12）就是默认键槽，负责清"有键按住"状态；`CHARMEDIT` 的鼠标右键
// 关闭（`label_00001820` 的 `jcc (local b)`）依赖它 ⇒ 漏掉就表现为"右键无反应"。
// ---------------------------------------------------------------------------

/** 合成脚本跑 `0x100`：空掩码 ⇒ 跳 `joyJump[SetKeyTotal]`，并压好返回点。 */
test('★0x100 默认键分支：掩码为空 ⇒ 跳 joyJump[SetKeyTotal]（下标 = Engine[517]）且压返回点', () => {
  // mkEngine 把第 i 条指令的 `index` 设为 i ⇒ label 值 = 数组下标（labelMap 由 loadScriptIntoFrame 建）
  const e = mkEngine([instr(0x100, []), instr(0x5, []), instr(0x5, [])]);
  const f = e.curScript();
  const dispatch = (): number | null => {
    const ctx = makeCtx(e, f, instr(0x100, []), e.native, () => {});
    OPS.get(0x100)!(ctx);
    return ctx._nextIp;
  };

  e.engineValues.set(517, 12); // 真机值（SYSTEM4 `i0fe c`）
  e.input.joyJump[12] = 2;
  e.input.joyJump[7] = 1;
  e.input.consumeEdges(); // 掩码空
  assert.equal(dispatch(), 2, '★空掩码 ⇒ 派发默认键槽 12（不是"无输入就落回"）');
  assert.equal(f.retStack.pop(), 1, '★压了返回点 = 当前指令 index + 1（handler 的 ret 靠它回来）');

  // 上界：下标 ≥ SetKeyTotal 的槽**不参与**掩码扫描（它们只能作为默认键被取到）
  e.engineValues.set(517, 7);
  e.input.consumeEdges();
  e.input.pressJoy(3); // 手柄按钮 3 ⇒ 掩码 bit 7
  assert.equal(e.input.flushHeld() & 0x80, 0x80, '掩码确实是 bit7');
  assert.equal(dispatch(), null, 'bit7 ≥ SetKeyTotal(7) ⇒ 不派发（旧实现会误派发）');
  // 同一次按下，把上界抬到 12（真机值）后就该派发到 joyJump[7]
  e.engineValues.set(517, 12);
  e.input.consumeEdges();
  e.input.pressJoy(3);
  assert.equal(dispatch(), 1, 'SetKeyTotal=12 ⇒ bit7 落在扫描范围内 ⇒ 跳 joyJump[7]');
});

// ---------------------------------------------------------------------------
// ★`0x10A`（`i10a`）：把光标移到虚拟坐标 —— `0x109` 的逆（`tickets/T-0048`）
//
// 引擎 `sub_421EA0`（raw 30530-30598）= `ClientToScreen` + **`SetCursorPos`** ⇒ 移动系统光标。
// emulator 的等价物 = 设 `InputManager` 的（引擎侧）光标；可见后果与引擎一致：之后 `0x109` 读回同一
// 位置、hover/`0x12E` 用新位置（`setCursor` 触发 `onCursorMove` = 引擎 WM_MOUSEMOVE 里的命中测试）。
// 语料 1678 处；最主要的是 ADV 侧边栏的"钉住/放出"：`i10a 4c4 (global-int 13a0)` / `i10a 479 (global-int 13a0)`。
// ---------------------------------------------------------------------------
test('★0x10A：把光标移到 (op1, op2)（0x109 的逆）—— 触发一次 WM_MOUSEMOVE 等价命中测试，且是**真实现**', async () => {
  const e = mkEngine([instr(0x10a, [im(0x4c4), im(0x2d0)]), instr(0x109, [loc(0), loc(1)])]);
  assert.ok(OPS.has(0x10a), '0x10A 必须在已实现表里（此前不在任何表 ⇒ 命中即 NotImplementedOp 硬报错）');
  assert.ok(!ENGINE_INTERNAL_OPS.has(0x10a), '★不得是 engine-internal 的 no-op 桩');

  /** `onCursorMove` 的调用 = 引擎 WM_MOUSEMOVE 里的 `sub_403C50`（命中测试的唯一时机之一）。 */
  const moves: [number, number][] = [];
  e.input.onCursorMove = (x, y) => moves.push([x, y]);

  e.input.setCursor(500, 300, true); // 先模拟"玩家把光标停在栏外"
  moves.length = 0;
  const t1 = await stepOnce(e);
  assert.equal(t1.handlerKind, 'implemented', '0x10A 走真实现');
  assert.deepEqual([e.input.readX(), e.input.readY()], [0x4c4, 0x2d0], '引擎侧光标被移到 (0x4c4, 0x2d0)');
  assert.deepEqual(moves, [[0x4c4, 0x2d0]], '位置变了 ⇒ 触发一次命中测试（SetCursorPos 靠 WM_MOUSEMOVE 让脚本看见）');

  // 位置没变 ⇒ 不再触发（引擎把光标设到同一点都不产生移动消息）
  moves.length = 0;
  await stepOnce(e); // 0x109：把它读回 local 0/1
  assert.deepEqual(moves, [], '没有移动 ⇒ 不重算命中');
  assert.equal(dec(e.key, e.curScript().locals.int.get(0) ?? -1), 0x4c4, '★往返：0x10A 之后 0x109 读回同一 X');
  assert.equal(dec(e.key, e.curScript().locals.int.get(1) ?? -1), 0x2d0, '★往返：…同一 Y');
});

/** `0xCC` 的 op1 = `0xCD` 的推进间隔（`tickets/T-0047`）：操作数是十六进制，两档语料 + 槽 0 的 `? : 1`。 */
test('★0xCC → 0xCD 节流：op1 是十六进制（0x10=16ms / 0x32=50ms），槽 0 ⇒ 1ms', () => {
  const e = mkEngine([instr(0xcc, [im(0x10), im(0x2)]), instr(0xcc, [im(0x32), im(0x2)]), instr(0xcc, [im(0), im(0x2)])]);
  const f = e.curScript();
  const reg = (slot: number): void => {
    OPS.get(0xcc)!(makeCtx(e, f, instr(0xcc, [im(slot), im(0x2)]), e.native, () => {}));
  };
  assert.equal(e.input.advanceThrottle, 0, '未注册：0xCD 不节流（引擎 bss 0）');
  reg(0x10); // TITLE/CHARMEDIT/SAVE/CONFIG1…（29 个脚本）
  assert.equal(e.input.advanceThrottle, 0x10, '`mouse-callback 10` = 0x10 ⇒ 16ms（≈一帧）');
  reg(0x32); // GAMESTART/ROOM/MMODE/FIELD…（22 个脚本）
  assert.equal(e.input.advanceThrottle, 0x32, '`mouse-callback 32` = 0x32 ⇒ 50ms（≈20fps）');
  reg(0);
  assert.equal(e.input.advanceThrottle, 1, '★槽 0 ⇒ 1ms（`sub_453A60` 的 `a2 ? a2 : 1`，不是 0）');
});

/** CHARMEDIT 端到端：右键 = 关闭（`src/CHARMEDIT.txt` 的 `label_00000760` → `label_00001820`）。 */
async function charmeditRightClick(
  setKeyTotal: number,
): Promise<{ closed: boolean; bAtPress: number; exit11: number; sawB1: boolean }> {
  const src = new NodeFileSource({ resourceDir: RAW_DIR });
  const input = new InputManager();
  const e = new Engine(new HeadlessScene(), input);
  e.fileSource = src;
  const r = await src.readScript(0x2d); // 0x2d = CHARMEDIT.BIN（docs-new/02-data/scripts-control.md §2）
  assert.ok(r, '应读到 CHARMEDIT.BIN');
  loadScriptData(e, r.data, r.name);
  // 真机由 `SYSTEM4.txt:86` 的 `i0fe c` 写 `Engine[517] = 12`；本用例直接 boot CHARMEDIT ⇒ 手动摆好
  e.engineValues.set(517, setKeyTotal);
  input.setCursor(640, 360, true);

  const script = e.curScript().script!;
  const local = (i: number): number => dec(e.key, e.curScript().locals.int.get(i) ?? 0);
  /** 主循环头 = 唯一那条 `get-input-type`（`label_0000070c`）。 */
  const mainLoopIp = script.instructions.findIndex((i) => i.opcode === 0xcd);
  assert.notEqual(mainLoopIp, -1, 'CHARMEDIT 应含 get-input-type（主循环头）');
  // ★`0xCD` 是**时间节流门**：间隔 = 最后一次 `mouse-callback` 的 op1（CHARMEDIT 是 0x10 = 16ms，
  //   `tickets/T-0047`）⇒ 时钟不走的测试里鼠标回调一次都不会被派发。这里按"每条指令 1ms"推进
  //   虚拟时间（真机上轮询循环由 `sleep 1` 主导）。
  const step = async (): Promise<void> => {
    e.nowMs += 1;
    await stepOnce(e);
  };

  assert.equal(input.advanceThrottle, 0, '注册前：0xCD 不节流（引擎 bss 0）');

  // ① 跑到**初始化之后的主循环**（初始化含整套绘制，约 6k 步）——`local b`(=0x11) 由
  //    `label_00000f04` 置 1，随后由默认键处理器（`joy-callback c`）清 0（仅当 SetKeyTotal=12）。
  let sawB1 = false;
  let steps = 0;
  for (; steps < 60_000; steps++) {
    if (local(0xb) === 1) sawB1 = true;
    if (e.curScript().ip === mainLoopIp && steps >= 8000) break;
    await step();
  }
  assert.ok(steps < 60_000, '应在步数预算内进入主循环');
  const bAtPress = local(0xb);
  assert.equal(local(0xa), 0, '此时不应有鼠标按下锁存');
  assert.equal(input.advanceThrottle, 0x10, '★初始化末尾的 `mouse-callback 10`（十六进制）= 0xCD 间隔 16ms（tickets/T-0047）');

  // ② 右键按下 → 等脚本把右键记进"按下锁存"（`local a`(=10) bit1）
  input.pressMouse(1);
  let latched = false;
  for (let i = 0; i < 20_000 && e.curScript().name === 'CHARMEDIT.BIN'; i++) {
    await step();
    if ((local(0xa) & 2) !== 0) {
      latched = true;
      break;
    }
  }
  assert.ok(latched, '右键按下应被 CHARMEDIT 记进 local a 的 bit1');
  // ③ 松开右键 → 关闭路径 `label_00001820` 的 `jcc (local b)` 决定是否 `local 11 = 1`（= 退出）；
  //    随后主循环读到 11==1 才真正 `jmp label_00004e14` 离开本脚本 ⇒ 跑到"离开"或预算耗尽。
  input.releaseMouse(1);
  let exit11 = 0;
  for (let i = 0; i < 20_000 && e.curScript().name === 'CHARMEDIT.BIN'; i++) {
    await step();
    if (local(0x11) === 1) exit11 = 1;
  }
  const out = { closed: e.curScript().name !== 'CHARMEDIT.BIN', bAtPress, exit11, sawB1 };
  await src.dispose?.();
  return out;
}

test('★CHARMEDIT：右键关闭 —— 依赖 0x100 的默认键分支（SetKeyTotal=12 ⇒ 关；默认 7 ⇒ 不关）', async () => {
  const ok = await charmeditRightClick(12); // 真机（SYSTEM4 的 `i0fe c`）
  assert.equal(ok.sawB1, true, '初始化应先把"有键按住"标志 local b 置 1');
  assert.equal(ok.bAtPress, 0, '★默认键处理器（joy-callback c）应把它清成 0');
  assert.equal(ok.exit11, 1, '右键松开后脚本应置退出标志 local 11 = 1');
  assert.equal(ok.closed, true, '★右键应关闭 CHARMEDIT（离开 CHARMEDIT.BIN）');

  const ng = await charmeditRightClick(7); // 引擎默认（没有 SYSTEM4 的 `i0fe c`）⇒ 默认键槽 = 7 = 空处理器
  assert.equal(ng.bAtPress, 1, '默认键槽 7 的处理器不碰 local b ⇒ 仍为 1');
  assert.equal(ng.exit11, 0, 'local 11 不应被置 1');
  assert.equal(ng.closed, false, '★默认键槽不对 ⇒ 右键被 `jcc (local b)` 挡回（本单修的就是这条）');
});
