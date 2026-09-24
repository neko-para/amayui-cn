/** @tier T0 @kind ratchet @subsystem frame */

/**
 * **headless 的 `needsRender` 语义**（`tickets/T-0003` 的 B3，第二项）。
 *
 * 为什么要它：pixi 有"该不该合成"的判据（`sceneNeedsRender`），headless 却没有 —— 于是
 * "headless 与 Electron 的每帧行为是否一致"这件事**没法问**：headless 只能每帧无脑推进/输出。
 * 现在两侧共用同一个判据函数，差别只剩"脏"的来源（pixi = 宿主 `sceneDirty`；headless = 共享模型的
 * `scene.dirty`，由每个变更型 `sc*` 置位、由 `snapshot()` 清零 = "取快照即消费"）。
 *
 * ★本文件还带一条**源码棘轮**：`scene/ops.ts` 里"变更型"的 `sc*` 必须置脏，只读的（getter/判据）
 * 必须在白名单里 —— 将来新增一个 op 却忘了置脏 ⇒ 变红（这类漏置的后果是"画面少合成一帧"，很难目视发现）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scAdvance, scClearScenePending } from '../src/renderer/sceneModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = 0x100;
/** 虚拟时钟起点（非 0：`animStart === 0` 是"未锁存"哨兵，见 `T-0002` 的 notes）。 */
const T0 = 16;

function sceneWithItem(): HeadlessScene {
  const s = new HeadlessScene({});
  s.configureDrawItem({ handle: H, layer: 1, tex: 1, srcX: 0, srcY: 0, srcW: 10, srcH: 10, dstX: 0, dstY: 0 });
  return s;
}

test('needsRender：首帧为真（脏初值 = true）；取过快照且无变更、无动画 ⇒ 假', () => {
  const s = sceneWithItem();
  assert.equal(s.needsRender(), true, '刚装配好 ⇒ 必须合成一次');
  s.snapshot();
  assert.equal(s.needsRender(), false, '快照 = 消费 ⇒ 不再需要合成');
});

test('needsRender：任何变更型 op 之后为真；再取快照 ⇒ 假', () => {
  const s = sceneWithItem();
  s.snapshot();
  assert.equal(s.needsRender(), false, '基线');

  s.setDrawPos(H, 5, 6, 0);
  assert.equal(s.needsRender(), true, '位置变了 ⇒ 要重新合成');
  s.snapshot();
  assert.equal(s.needsRender(), false, '消费完又安静了');

  s.setDrawColorAlpha(H, 0x80112233, 0);
  assert.equal(s.needsRender(), true, '颜色变了 ⇒ 要重新合成');

  // 消息窗（"画面"的一部分）：这里用 clear（不依赖排版载荷的形状）；sync 的置脏由下面的源码棘轮钉住
  s.snapshot();
  s.msgWinClear(8);
  assert.equal(s.needsRender(), true, '文本窗被清 ⇒ 要重新合成');
});

test('needsRender：有窗在跑 ⇒ 恒真（即便刚取过快照）；窗结束后取快照即转假', () => {
  const s = sceneWithItem();
  s.setScaleAnim(H, 0, 1000, 2, 2, 2); // delay=0、dur=1000（窗 1）
  s.snapshot();
  assert.equal(s.needsRender(), true, '动画在跑 ⇒ 合成不能停（否则中间帧不上屏）');

  scAdvance(s.scene, T0); // 起点锁存
  s.snapshot();
  assert.equal(s.needsRender(), true, '仍在窗内');

  scAdvance(s.scene, T0 + 1000); // 窗结束（收尾 + 清动画位）
  assert.equal(s.needsRender(), true, '★窗末那一帧必须再合成一次（终态与上一帧的插值不同）');
  s.snapshot();
  assert.equal(s.needsRender(), false, '收尾之后没有动画、也没有新变更 ⇒ 可以不再合成');
});

test('needsRender：只读的 getter / 判据不置脏', () => {
  const s = sceneWithItem();
  s.setDrawPos(H, 1, 2, 0);
  s.snapshot();
  s.getDrawItemPos(H);
  s.getDrawItemPivot(H);
  s.getDrawItemTexSlot(H);
  s.poolPending();
  assert.equal(s.needsRender(), false, '问问题不该让画面变脏');
});

/**
 * ★★**池挂起位 `Scene+46516` 必须进合成判据**（审计 §4.2 #2 的 P1 `missing-consumer`；
 * 引擎 `sub_4B4040` raw 136718-136719）：
 *
 * ```c
 * if ( *(_QWORD *)(_this + 46512) )   // 46512 强制冻结 | 46516 池挂起（8 字节一起判）
 *   *(_DWORD *)(_this + 46508) = 1;   // 46508 = "本遍要重画"
 * ```
 *
 * ⇒ 「上一遍绘制时还有元素在动」这件事**本身**就要把本遍标脏。修前这一项只喂 `0x400` 等待门
 * （`Engine.scenePending` → `Engine.gatePending`），`sceneNeedsRender` 完全不看它
 * ⇒ 「绘制期置了 46516、但窗判据此刻已为假」的组合会漏掉一帧终态（不报错，只是画面少动一下）。
 *
 * 本用例构造的正是那个差集：**场景不脏、没有窗在跑、没有转场、没有 L2D 槽** —— 唯一的输入是 pending。
 */
test('★★needsRender：池挂起位（`Scene+46516`）本身就要强制合成（审计 §4.2 #2；raw 136718-136719）', () => {
  const s = sceneWithItem();
  s.snapshot();
  assert.equal(s.needsRender(), false, '基线：不脏、无窗、无转场 ⇒ 不必合成');

  s.scene.pending = true;
  assert.equal(s.needsRender(), true, '★上一遍绘制还有元素在动 ⇒ 本遍必须再合成一次（修前这里为 false）');

  // 取一次快照 = 消费掉它（引擎每遍绘制开头 `46516 = 0`，raw 130427-130428）
  s.snapshot();
  assert.equal(s.needsRender(), false, '消费之后回落（否则会变成"永久为真"）');

  s.scene.pending = true;
  scClearScenePending(s.scene);
  assert.equal(s.needsRender(), false, '显式清位也回落（宿主缝）');
});

/**
 * **源码棘轮**：变更型 `sc*` 必须置 `s.dirty = true`；只读的必须在下面的白名单里（白名单 = 契约）。
 * 用"按 `export function` 切片"的文本扫描（够用且不引入 AST 依赖）。
 */
test('源码棘轮：`scene/ops.ts` 里变更型 sc* 都要置脏，只读的白名单钉住（T-0003）', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', 'scene', 'ops.ts'), 'utf8');
  const chunks = src.split(/\nexport function /).slice(1);
  const setsDirty: string[] = [];
  const readOnly: string[] = [];
  for (const c of chunks) {
    const name = /^(sc[A-Z][A-Za-z0-9_]*)\(/.exec(c)?.[1]; // `sc` + 大写字母（排除 `sceneNeedsRender`）
    if (!name) continue;
    (c.includes('s.dirty = true') ? setsDirty : readOnly).push(name);
  }
  const READ_ONLY = [
    'scAnimationsPending', // 判据
    'scPoolPending', // 判据（池挂起位 Scene+46516；T-0024）
    'scL2dSlotProbe', // 判据（L2D 10 槽任一非空；引擎 `sub_4A1AF0` raw 121777-121790，`tickets/T-0054` M3）
    'scGetDrawItemPos', // getter
    'scGetDrawItemPivot', // getter
    'scGetDrawItemTexSlot', // getter
    'scGetDrawItemTranslation', // getter（0x228：绘制项当前平移，`+0x16C` work 矩阵；响应 audit P0 op-4-01）
    'scTransitionDefaultRecord', // 纯工厂：返回 24 格默认记录，不碰 SceneState（0x24F/0x250/0x251，`sub_49A640` raw 117059-117077）
    // ★审计 §4.2 #2 / #24：这一族是**帧驱动/门**的入口，不是"场景内容变更" ⇒ 不进置脏名单。
    'scSetScenePending', // 锁存池挂起位 `Scene+46516`（它**本身**就是"要不要再合成"的输入；置脏无意义）
    'scClearScenePending', // 消费掉本位（= 引擎每遍绘制开头的 `46516 = 0`）
    'scSetSceneFrozen', // 写 `Scene+46676`（判据是"frozen ⇒ 恒假"，置脏没有任何后果）
    'scBeginRenderPass', // 每遍绘制开头：**清** dirty/pending（与"变更型 op 置 dirty"正好相反）
    'scEnsureEffect3DSlots', // 惰性补齐 3D 效果槽（引擎也是绘制期判空后建；不改变可见内容）
    // ★审计 §4.2 #18/#21：气象/效果推进与阈值写入（推进本身由 `scWeatherAdvance` 置脏，其余两条是参数面）
    'scWeatherSetClock', // 注入本帧时钟（引擎 `Scene+46500` 的等价物；不改变模型内容）
    'scWeatherNodeKey', // `sub_4535F0` 的销毁判据半边（只在**命中阈值**时改槽；由调用方按需置脏）
    'scWeatherSetDestroyThresholds', // `0x325` 的两个阈值（引擎也不置脏）
  ];
  assert.deepEqual(
    readOnly.sort(),
    [...READ_ONLY].sort(),
    '不置脏的 sc* 变了：要么新 op 忘了置脏（会造成少合成一帧），要么新增了只读 op（请加进白名单）',
  );
  assert.ok(setsDirty.length > 30, `置脏的 op 数量看起来不对：${setsDirty.length}`);
  assert.ok(setsDirty.includes('scAdvance'), '推进也要在"真的推进了窗"时置脏');
  assert.ok(setsDirty.includes('scMsgWinSync'), '文本窗同步要置脏');
});
