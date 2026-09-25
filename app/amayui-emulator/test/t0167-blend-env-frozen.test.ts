/** @tier T0 @kind ratchet @subsystem render */

/**
 * ★**`Scene+46676` 的生产侧接线**（审计 §4.2 #65 `scene-render-freeze-46676` 的 `missing-consumer`；票 `T-0167`）。
 *
 * ## 审计的原话（是这一条要防的东西）
 * > `blend.ts` 的 `sceneFrozen` 只有「声明 + 一个纯函数里的判据 + 一条单测」，生产侧从不置位：
 * > `presenter.ts` 组 `BlendEnv` 时只填 `renderTargetSlot/slotMode`，全仓 `sceneFrozen` 只有 3 处命中
 * > ⇒ 该判据在生产里**恒走** `!sceneFrozen` 分支。
 *
 * 判据本体（raw 123117-123121）：`!Scene+46676 && Scene+46456 < 0 && *(holder+1164) == 1 ⇒ 强制 (ONE,ZERO)`；
 * `Scene+46676` 是**只读帧级门**（全文件 105 处读、0 处写）⇒ 只能由共享模型 `SceneState.frozen` 供值。
 *
 * ## 本文件钉两件事
 *  1. **值真的来自模型**：`blendEnvForScene(scene)` 的 `sceneFrozen` 必须随 `scSetSceneFrozen` 变
 *     （修前那条判据恒 `undefined` ⇒ 这一条会红）；
 *  2. **装配只此一处**：`pixi/presenter.ts` 里不得再出现手写的 `BlendEnv`（两个调用点都必须走
 *     `blendEnvForScene`）—— 否则下次加字段又会漏掉一个调用点（这正是本条缺口的成因）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scSetSceneFrozen } from '../src/renderer/scene/ops.js';
import { blendEnvForScene } from '../src/renderer/scene/blendEnv.js';
import { blendForSelector } from '../src/renderer/scene/blend.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('★① `BlendEnv.sceneFrozen` 来自 `SceneState.frozen`（不是 `undefined`、不是写死的 false）', () => {
  const s = newSceneState();
  assert.equal(blendEnvForScene(s).sceneFrozen, false, '缺省：未冻结 ⇒ false（与引擎缺省一致）');

  scSetSceneFrozen(s, true);
  assert.equal(
    blendEnvForScene(s).sceneFrozen,
    true,
    '★置位后必须为 true —— 修前生产侧恒 undefined，这条就是那条缺口的守卫',
  );

  // 判据的**可观测后果**：冻结 + 画到后台缓冲 + holder+1164==1 ⇒ 追加覆盖不生效（raw 123117-123121）。
  const env = blendEnvForScene(s);
  assert.equal(
    blendForSelector(0, { ...env, holder1164Is1: true }),
    null,
    '★冻结时那条追加覆盖必须**不**生效（`!Scene+46676` 不成立）',
  );
  assert.equal(
    blendForSelector(0, { renderTargetSlot: -1, slotMode: () => undefined, holder1164Is1: true }),
    'none',
    '反面（未冻结、画到后台缓冲、holder+1164==1）⇒ 覆盖生效；证明上面那条不是"恒不生效"',
  );

  scSetSceneFrozen(s, false);
  assert.equal(blendEnvForScene(s).sceneFrozen, false, '清位后回到 false（不会粘住）');
});

test('★② `presenter.ts` 不再手写 `BlendEnv`：两个调用点都走 `blendEnvForScene`', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', 'pixi', 'presenter.ts'), 'utf8');
  const uses = src.match(/blendEnvForScene\(scene\)/g) ?? [];
  assert.ok(
    uses.length >= 2,
    `★两个装配点（present() 与 renderItemSubset()）都必须用它；实得 ${uses.length} 处`,
  );
  assert.ok(
    !/sceneFrozen\s*:/.test(src),
    '★presenter.ts 里不许再出现手写的 `sceneFrozen:`（装配只此一处 ⇒ 加字段不会再漏调用点）',
  );
  assert.ok(
    !/renderTargetSlot\s*:/.test(src),
    '★同上：`renderTargetSlot:` 也不许手写（它同属 `BlendEnv` 装配）',
  );
});
