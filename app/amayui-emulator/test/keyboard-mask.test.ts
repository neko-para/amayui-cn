/** @tier T0 @kind core @subsystem input */

/**
 * `T-0052` 守卫：**键盘 → 虚拟掩码位 0..6**（修前 emulator 实际上只能纯鼠标操作）。
 *
 * ## 引擎依据（逐行）
 * ```
 * sub_4770A0  raw 91551-91570 : for vk in 0..255: if (GetAsyncKeyState(vk) & 0xFF00) *a2 |= 1 << _this[1176+vk];
 * sub_476AA0  raw 91344-91415 : 7 个默认 VK（38 ↑ / 39 → / 40 ↓ / 37 ← / 13 Enter / 32 Space / 8 BS）
 * Input 构造  raw 92394-92400 : _this[_this[1446]+1176] = 6 … ⇒ **虚拟位 0..6**（顺序见 DEFAULT_VK_TO_BIT）
 * ```
 * 修前 `InputManager` 只把键盘记进 `keyEdge`（注释写着"仅登记，不驱动跳转"），
 * `flushPending()`/`flushHeld()` **都不并 0..6** ⇒ 脚本里 `joy-callback 0..4`（菜单最常用的一族）
 * 永远不触发；`0x100` 的掩码扫描也永远扫不到键盘位 ⇒ 后果是**静默的**（不报错，只是键盘没反应）。
 *
 * ## 本守卫锁的事
 *  ① VK→位表就是引擎那 7 条（其余 VK 未映射 ⇒ **不动任何位**，不能"当成位 0"）；
 *  ② 两把刷子的语义各自成立：`flushPending` 只给**按下沿**（一次按下 = 一次推进，`consumeEdges` 后即清）；
 *     `flushHeld` 含**按住态**（按住期间每帧都为真，与引擎 `GetAsyncKeyState` 轮询真值同效）；
 *  ③ `0x100` 真派发：按下 ↑ ⇒ 掩码 bit0 ⇒ 跳 `joy-callback 0` 登记的 label（修前会走"空掩码"的默认键分支）；
 *  ④ 不破坏鼠标路径的形状（鼠标位仍是 bit4/bit5），快照能带上键盘按住态。
 *  ⑤ ★`T-0163` 起：`DEFAULT_VK_TO_BIT` 只是**默认值**，运行期表可被 `0x10C` 改写 ⇒ 见本文件末尾两条。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputManager, DEFAULT_VK_TO_BIT, DEFAULT_KEYCODE_TO_VK } from '../src/vm/input.js';
import { mkEngine, instr } from './harness.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';

const VK = { UP: 38, RIGHT: 39, DOWN: 40, LEFT: 37, RETURN: 13, SPACE: 32, BACK: 8 } as const;

test('★T-0052 ①：VK→虚拟位表 = 引擎那 7 条（其余 VK 未映射）', () => {
  const want: [number, number][] = [
    [VK.UP, 0],
    [VK.RIGHT, 1],
    [VK.DOWN, 2],
    [VK.LEFT, 3],
    [VK.RETURN, 4],
    [VK.SPACE, 5],
    [VK.BACK, 6],
  ];
  assert.equal(DEFAULT_VK_TO_BIT.size, 7, '恰好 7 个默认键（引擎 raw 91344-91415 就是 7 条）');
  for (const [vk, bit] of want) assert.equal(DEFAULT_VK_TO_BIT.get(vk), bit, `VK ${vk} 应为位 ${bit}`);
  assert.equal(DEFAULT_VK_TO_BIT.get(65), undefined, '未映射的键（A）不得有位');
});

test('★T-0052 ②：按下沿 vs 按住态（两把刷子）——消费刷只给沿、实时刷含按住', () => {
  const im = new InputManager();
  assert.equal(im.flushPending(), 0, '没按键 ⇒ 空掩码（0x100 会走"默认键"分支）');

  assert.equal(im.pressKey(VK.UP), true, '↑ 命中映射表');
  const pending = im.flushPending();
  assert.equal(pending & 1, 1, '★消费刷必须带 bit0（修前这里是 0 ⇒ 键盘永远不触发 joy-callback）');
  assert.equal(pending & ~0x7f, 0, '键盘只占 0..6（鼠标位 4/5 也与键盘位共用，见下）');

  const held = im.flushHeld();
  assert.equal(held & 1, 1, '实时刷同样带 bit0');
  assert.equal(im.hasPending(), true, '有按下沿 ⇒ hasPending 为真');

  im.consumeEdges();
  assert.equal(im.flushPending(), 0, '★按下沿被消费 ⇒ 消费刷回到空（一次按下 = 一次推进）');
  assert.equal(im.flushHeld() & 1, 1, '★但**按住态**还在（引擎 GetAsyncKeyState 每帧为真）⇒ 菜单能连续移动');

  im.releaseKey(VK.UP);
  assert.equal(im.flushHeld(), 0, '松开 ⇒ 实时刷也空了');
});

test('★T-0052 ①：未映射的键**不动任何位**（不能"当成位 0" —— 那会污染 ↑）', () => {
  const im = new InputManager();
  assert.equal(im.pressKey(65), false, 'A 键未映射');
  assert.equal(im.keyEdge, 0, '★不得置位（引擎那格没映射时 `1<<0` 会污染 ↑ 位，所以这里必须忽略）');
  assert.equal(im.keysHeld, 0);
  assert.equal(im.flushHeld(), 0);
  im.releaseKey(65); // 不得抛
});

test('★T-0052 ③：`0x100` 真派发 —— 键盘 ↑ ⇒ 掩码 bit0 ⇒ 跳 `joy-callback 0` 登记的 label', () => {
  const e = mkEngine([instr(0x100, []), instr(0x5, []), instr(0x5, [])]);
  const f = e.curScript();
  const dispatch = (): number | null => {
    const ctx = makeCtx(e, f, instr(0x100, []), e.native, () => {});
    OPS.get(0x100)!(ctx);
    return ctx._nextIp;
  };
  e.engineValues.set(517, 12); // SetKeyTotal（SYSTEM4 `i0fe c`）
  e.input.joyJump[0] = 2; // `joy-callback 0` → label_2（TITLE/GAMESTART 的同型登记）
  e.input.joyJump[12] = 1; // 默认键槽（掩码为空时才会用到）
  e.input.consumeEdges();

  // 对照组：什么都没按 ⇒ 走"默认键"分支（这是既有语义，不许被本票改掉）
  assert.equal(dispatch(), 1, '空掩码 ⇒ 默认键槽（对照）');
  e.input.consumeEdges();

  // ★本票：按下 ↑ ⇒ 掩码 bit0 ⇒ 派发 `joy-callback 0`
  assert.equal(e.input.pressKey(VK.UP), true);
  assert.equal(dispatch(), 2, '★键盘 ↑ 必须派发 joy-callback 0（修前掩码是空的 ⇒ 会误走默认键槽）');
  // ★返回点的**不对称**（审计 `op-1/0x100-push-return-point`）：掩码分支压的是 `(ip-ip_base)>>2`
  //   **不加 +1** ⇒ 就是本指令自己的 dword 偏移（合成脚本里 = 0）—— `ret` 回到 `0x100` **继续扫下一个键**；
  //   而默认键分支压 `+1`（对照组那次是 1，见上）。这不是本票改的语义，钉住免得被顺手改平。
  assert.equal(f.retStack.pop(), 0, '掩码分支压"本指令偏移"（不加 1）⇒ ret 回来继续扫下一个键');

  // 同一帧内再问一次：`0x100` 的扫描游标已经前进到 `b+1`（引擎 raw 25029-25048）
  // ⇒ **同一个键不会重复派发**（一次按下 = 一次派发；游标由 `0xFF` 复位）
  assert.equal(dispatch(), null, '扫描游标已前进 ⇒ 同一个键不重复派发');
  // ★但**按住态仍在掩码里**（实时刷的读者——ADV 分支/等待泵——看到的是"键还按着"）
  assert.equal(e.input.flushHeld() & 1, 1, '★按住态仍在掩码里（引擎 GetAsyncKeyState 每帧为真）');
  e.input.releaseKey(VK.UP);
  assert.equal(e.input.keysHeld & 1, 0, '松开 ⇒ **按住态**清');
  assert.equal(
    e.input.flushHeld() & 1,
    1,
    '但**按下沿**还没被消费 ⇒ 实时刷仍带这一位（两把刷子口径：沿与按住态是两个来源）',
  );
  e.input.consumeEdges();
  assert.equal(e.input.flushHeld() & 1, 0, '消费掉沿之后彻底干净');
});

test('★T-0052 ②：鼠标/手柄位不受影响（bit4/bit5/bit(4+i) 仍在），且键盘不占 7..', () => {
  const im = new InputManager();
  im.pressMouse(0);
  im.pressJoy(3);
  im.pressKey(VK.UP);
  const m = im.flushHeld();
  assert.equal((m >> 4) & 1, 1, '鼠标左 = bit4');
  assert.equal((m >> 7) & 1, 1, '手柄按钮 3 = bit7');
  assert.equal(m & 1, 1, '键盘 ↑ = bit0');
  assert.equal((m >> 8) & 1, 0, '不应有 bit8（键盘只有 0..6）');
});

test('★T-0052 ④：快照/还原带上键盘按住态（`--record`/`--replay` 的输入状态面）', () => {
  const im = new InputManager();
  im.pressKey(VK.DOWN);
  const snap = im.snapshot();
  assert.equal(snap.keysHeld, 1 << 2, '快照里必须有 keysHeld');

  const im2 = new InputManager();
  im2.restore(snap);
  assert.equal(im2.flushHeld() & (1 << 2), 1 << 2, '还原后按住态成立');
});

/**
 * ★★`T-0163` ⑤：**运行期表**真的被 `pressKey` 读（不是冻结常量）★★
 *
 * 引擎 `sub_4770A0`（raw 91551-91570）每帧扫 `Input[1176+VK]`（**可改写表**）产生掩码；
 * emulator 修前只查冻结常量 `DEFAULT_VK_TO_BIT` ⇒ `0x10C` 的写入没有消费者。
 * 这里不经过 opcode，直接改写 `InputManager` 的运行期表来钉住"查的是哪张表"。
 */
test('★T-0163 ⑤：`input.vkToBit` 是运行期真源 —— 改写它立刻改变按键产生的位（Z→bit4，修前不可能）', () => {
  const im = new InputManager();
  assert.equal(im.pressKey(90), false, 'VK 90(Z) 默认未绑定');
  assert.equal(im.keyEdge, 0);
  im.vkToBit.set(90, 4); // = `0x10C` 写的同一张表（`Input[1176+VK] = 位`）
  assert.equal(im.pressKey(90), true, '★改写运行期表后立即生效（修前查常量 ⇒ 这里会是 false）');
  assert.equal(im.flushHeld() & (1 << 4), 1 << 4, 'Z ⇒ bit4');
  im.releaseKey(90);
  // ★两把刷子口径：`flushHeld` = **按住态 | 按下沿** ⇒ 松开后还要消费掉按下沿才彻底干净
  //   （见本文件 ② 那条既有断言；这里先消费再断言"清位"）
  im.consumeEdges();
  assert.equal(im.flushHeld() & (1 << 4), 0, '松开 + 消费沿 ⇒ 清位');
  // 两张表**同一真源**：默认 VK→位表 = 从默认键码表派生的那 7 条
  assert.equal(DEFAULT_VK_TO_BIT.size, 7);
  // ★语料/真源锚：`i10c 4 2c` 绑的是键码 0x2c ⇒ VK 90 = 'Z'（`sub_476AA0` 该行 .lst 注释就是 `; 'Z'`）
  assert.equal(DEFAULT_KEYCODE_TO_VK.get(0x2c), 90, '默认键码表：0x2c → VK 90');
  // ★`sub_477DD0` raw 92386-92393 的 `_this[260..266]` = 七条默认绑定的**键码**（顺序 = 位 0..6）
  const bound = [[0xc8, 38], [0xcd, 39], [0xd0, 40], [0xcb, 37], [0x1c, 13], [0x39, 32], [0x0e, 8]] as const;
  bound.forEach(([kc, vk], bit) => {
    assert.equal(DEFAULT_KEYCODE_TO_VK.get(kc), vk, `默认绑定键码 0x${kc.toString(16)} 必须 → VK ${vk}（位 ${bit}）`);
    assert.equal(DEFAULT_VK_TO_BIT.get(vk), bit, `默认位 ${bit} ⟷ 键码 0x${kc.toString(16)}`);
  });
});
