/**
 * `T-0054`（M3 的 `live2d-slot-probe`）守卫：**Live2D 节点的动画窗必须进合成判据**。
 *
 * ## 为什么
 * 引擎的合成判据 `sub_40BE10`（raw 16022 一带）不只看绘制项/网格，还读 `Scene+55812` 的 **10 个实例槽**
 * —— 节点的窗还在跑就必须继续合成。emulator 的产品帧档是 `present: 'needsRender'`，
 * 少了这一项，**立绘的动作只画一帧就冻住**（不报错、日志也正常，只是不动了）。
 * 这类"缺了不报错、只是表现不对"的缺口正是 `T-0054` 判据 #4 登记的 `live2d-slot-probe` 未接。
 *
 * ## 判据的形状（与引擎同一口径）
 *  - 没有窗配置（`flags & 2 == 0`）⇒ 不算 pending；
 *  - 窗指令刚写过、合成器还没锁存起点 ⇒ **算 pending**（引擎那一路是 `waiting`，`v107 = 1`）；
 *  - 某个窗 `dur > 0` 且 `nowMs < startedAtMs + delay + dur` ⇒ 算 pending（`waiting`/`inside`）；
 *  - 到点或 `dur <= 0` ⇒ 不算（`absorb`，引擎的吸附分支不置 `v107`）；
 *  - **冻结**（`Scene+46512`）⇒ 引擎把 `winSkip` 传给合成器、全窗当帧吸附 ⇒ 不算 pending。
 *
 * ★探针必须是**纯读**：合成器会就地吸收跑完的窗（`dur = 0`、`from ← to`），拿它当探针就等于
 *   把这一帧的推进提前吃掉（本测试第 3 条专门钉这一点）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scAnimationsPending, scL2dSlotProbe, scL2dTick, sceneNeedsRender } from '../src/renderer/scene/ops.js';
import { l2dCreateNode, l2dDestroySlot, l2dLoadModel, l2dNodeScaleWin } from '../src/live2d/runtime.js';
import { l2dNodeWindowsPending } from '../src/live2d/nodeMatrix.js';
import type { MocModel } from '../src/live2d/moc.js';

const KEY = 0x14;
const SLOT = 0;

/** 最小宿主 + 一个**可画**的节点（`flags&1` 由 `l2dCreateNode` 置、槽里得有模型）。 */
function mkScene(withModel = true, withWindow = true) {
  const e = new Engine(new StubNative(() => {}));
  const s = newSceneState();
  s.l2dHost = e;
  l2dCreateNode(e, KEY, SLOT);
  if (withModel)
    l2dLoadModel(e, SLOT, 0x1234, {
      canvasWidth: 1280,
      canvasHeight: 720,
      params: [],
      parts: [],
    } as unknown as MocModel);
  if (withWindow) l2dNodeScaleWin(e, KEY, 0, 100, 2, 2, 2); // delay 0 / dur 100ms
  return { e, s, node: e.l2dNodes.get(KEY)! };
}

test('★T-0054 M3：没有 L2D 宿主 / 没有窗 ⇒ 合成判据不受影响（守卫不误报）', () => {
  const bare = newSceneState();
  assert.equal(scAnimationsPending(bare, 0), false, '没有 l2dHost 时不得因为这一项为真');

  const { s } = mkScene(true, false);
  assert.equal(scAnimationsPending(s, 0), false, '节点没有窗 ⇒ 不需要额外合成');
});

test('★T-0054 M3：窗未跑完 ⇒ `scAnimationsPending` 为真；跑完 ⇒ 为假（立绘动作不会只画一帧就冻住）', () => {
  const { s, node } = mkScene();
  // 窗指令刚写过、还没锁存 ⇒ 引擎那一路是 waiting ⇒ 算 pending
  assert.equal(l2dNodeWindowsPending(node, 0), true, '未锁存起点的窗算 pending（引擎 waiting ⇒ v107=1）');
  assert.equal(scAnimationsPending(s, 0), true, '★窗在跑 ⇒ 必须继续合成');

  scL2dTick(s, 0); // 首帧合成：锁存起点（startedAtMs = 0）
  assert.equal(scAnimationsPending(s, 50), true, '窗内（0..100ms）⇒ 仍要合成');
  assert.equal(scAnimationsPending(s, 100), false, '到点 ⇒ 不算 pending（absorb 分支不置 v107）');
  assert.equal(scAnimationsPending(s, 500), false, '之后也不再算');
});

/**
 * ★★`T-0054` M3 的**真缺口**（2026-09，本轮修）：引擎的合成判据在 raw 16025 有一串 `||`，
 * 最后一项是 `sub_4A1AF0(_this)` —— **`Scene+55812` 的 10 个实例槽里只要有一个非空就返回 1**
 * （体 raw 121777-121790：`for (i = _this+13953; !*i; ++i) { if (++v1 >= 10) return 0; } return 1;`）。
 *
 * 而 emulator 此前只接了"**节点动画窗还在跑**"（`scAnimationsPending` 里的 L2D 段）——**更窄**：
 * 立绘动作播完后判据为假，而引擎只要槽里有实例就每帧强制重画。差别在
 * `0x34F`（纹理乘色）/`0x351`（命名参数）/`0x346`/`0x34D`（572B 节点 setter）这几笔上会显形 ——
 * **它们都不置任何脏位** ⇒ 没有这一项时改完不重画（不报错、只是画面不对）。
 */
test('★T-0054 M3：L2D 槽非空 ⇒ 合成判据为真（引擎 raw 16025 的 `sub_4A1AF0`），动作播完也不停', () => {
  const bare = newSceneState();
  assert.equal(scL2dSlotProbe(bare), false, '没有 l2dHost ⇒ 探针为假');
  assert.equal(sceneNeedsRender(bare, 0, false), false, '空场景 + 不脏 ⇒ 不合成（守卫不误报）');

  const { e, s } = mkScene(true, true);
  scL2dTick(s, 0);
  const afterWindow = 5000; // 远过窗的 100ms 到点时刻
  assert.equal(scAnimationsPending(s, afterWindow), false, '前提：窗已经跑完（窄判据此刻为假）');
  assert.equal(scL2dSlotProbe(s), true, '★槽里有实例 ⇒ 引擎式探针为真');
  assert.equal(
    sceneNeedsRender(s, afterWindow, false),
    true,
    '★槽非空就必须继续合成 —— 否则「没有窗在跑但 L2D 状态被改过」的那几笔不会重画（`0x34F`/`0x351`/`0x346`/`0x34D` 都不置脏位）',
  );

  // `0x342`（销毁槽）之后探针转假 ⇒ 合成可以停（与体的"槽指针被清空"同口径）
  l2dDestroySlot(e, SLOT);
  assert.equal(scL2dSlotProbe(s), false, '槽销毁后探针为假');
  assert.equal(sceneNeedsRender(s, afterWindow, false), false, '槽销毁 + 窗已停 + 不脏 ⇒ 不合成');

  // ★冻结（`Scene+46512`）不豁免这一项：引擎那串 `||` 在冻结门**之前**（raw 16022-16025）
  const back = mkScene(true, true);
  scL2dTick(back.s, 0);
  assert.equal(scL2dSlotProbe(back.s), true, '冻结与否与槽探针无关');
});

test('★T-0054 M3：探针是纯读 —— 问一次不得把窗吃掉（否则等于提前推进一帧）', () => {
  const { s, node } = mkScene();
  scL2dTick(s, 0);
  const before = { delay: node.wins.scale.delay, dur: node.wins.scale.dur, from: [...node.wins.scale.from] };
  l2dNodeWindowsPending(node, 50);
  scAnimationsPending(s, 50);
  assert.deepEqual(
    { delay: node.wins.scale.delay, dur: node.wins.scale.dur, from: [...node.wins.scale.from] },
    before,
    '★探针不得改窗（合成器才会吸收；探针提前吸收 = 少画一帧动画）',
  );
  assert.equal(node.wins.scale.dur, 100, '窗还是 100ms，没被提前结束');
});

test('★T-0054 M3：冻结（`Scene+46512`）时不算 pending（引擎把 winSkip 传下去，全窗当帧吸附）', () => {
  const { s } = mkScene();
  scL2dTick(s, 0);
  assert.equal(scAnimationsPending(s, 50, true), false, '★冻结帧不得被 L2D 窗钉住（否则强制收尾永远等不到）');
});

test('★T-0054 M3：槽里没有模型（不可画）的节点不算 —— 与 `scL2dTick` 的门控同口径', () => {
  const { s, node } = mkScene(false);
  assert.equal(node.flags & 2, 2, '前提：窗确实配上了');
  assert.equal(scAnimationsPending(s, 0), false, '★不可画的节点不该把合成判据钉住（引擎只在真会画的节点上求值）');
});
