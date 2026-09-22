/**
 * `T-0067` 守卫：**撤幕留帧的解除判据** —— "新内容又铺满一屏"才算建立，而不是"画了任何一项"。
 *
 * ## 症状（用户实测）
 * 「在 ADV 场景里存档时，存档页面会消失一瞬间并露出 ADV 界面」；同族的可见面还有用户报的
 * 章节切换（`SN0000 → SC0000`）里"闪一帧"。
 *
 * ## 机制（真机日志实证）
 * `.tmp/amayui-emulator.log`（2026-09-22）里 `0x73 -> SC0000.BIN` 那一刻的原文顺序：
 * ```
 * clearSlotRecords：丢掉 1 条 槽→imgid 记录
 * [frame-hold] 满屏幕布 0x19258 被撤 → 留帧最多 60 帧（等新内容）
 * detachTexture h=0x19258 count=1 REMOVE (drawItems=0, meshes=1)
 * setDrawPivot h=0x18b00 (640,720,0) [建空项]
 * bindTexture imgid=0x76 slot=44
 * image 76 -> AE910AA.AGF (256x128)
 * [frame-hold] draw-texture → 解除留帧（剩 60 帧）      ← ★元凶：这一笔只有 256×128
 * configureDrawItem h=0x18b00 layer=101120 (0,0,256x128)
 * ...（此后才 createTexture slot=64 + setTransition 1500ms）
 * ```
 * 引擎的 present **从不清后备缓冲**（`ClearTarget` 被恒 0 的 `Scene+46460&1` 守卫）⇒ 幕被撤掉之后
 * 屏上留的还是上一帧；而 emulator 每帧从模型整屏重组 ⇒ 只要在"幕已撤、新一屏还没铺"的窗口里
 * present 一次，就会把中间态如实画出来。旧实现里 `configureDrawItem`（每条 `draw-texture`）
 * **无条件**解除留帧 ⇒ 那一笔 256×128 的转场贴片就把窗口打开了。
 *
 * ## 判据（本文件锁的事）
 *  1. `itemCoversView`：满屏（1280×720）为真；**256×128 为假**（日志里那一笔）；不可画/零尺寸为假；
 *     0.9 的比例口径（1216×720 这类"几乎满屏"仍算铺满）；
 *  2. 它是**无时钟、无副作用**的判据（只读 `flags`/`srcW`/`srcH`）—— 不能去求值 flipbook 窗
 *     （那会锁存窗起点，`tickets/T-0004` 的 G3 实测教训）；
 *  3. **源码棘轮**：`pixiBackend.configureDrawItem` 不许再用无条件的 `#releaseFrameHold('draw-texture')`，
 *     必须走 `#releaseFrameHoldIfCovers`；`HOLD_MAX_FRAMES` 上限保留（防"一直铺不满"永久冻帧）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_HOLD_COVER_RATIO, itemCoversView } from '../src/renderer/drawItem.js';
import { VIEW_H, VIEW_W } from '../src/renderer/viewport.js';
import type { Item } from '../src/renderer/drawItem.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 造一个"已建项"（只填本判据读的字段：flags/srcW/srcH）。 */
const item = (srcW: number, srcH: number, flags = 1): Item => ({ flags, srcW, srcH }) as unknown as Item;

test('★T-0067：`itemCoversView` —— 满屏为真、**转场贴片（256×128）为假**、不可画/零尺寸为假', () => {
  assert.equal(VIEW_W, 1280, '视口宽（口径固定，变了要重核本守卫）');
  assert.equal(VIEW_H, 720, '视口高');
  assert.equal(FRAME_HOLD_COVER_RATIO, 0.9, '覆盖率口径（写死一处，防两边漂移）');

  assert.equal(itemCoversView(item(1280, 720), VIEW_W, VIEW_H), true, '满屏 draw-texture ⇒ 新内容建立');
  assert.equal(
    itemCoversView(item(256, 128), VIEW_W, VIEW_H),
    false,
    '★真机日志里那一笔 256×128 的转场贴片**不算**铺满一屏（旧实现就是被它解除留帧的）',
  );
  assert.equal(itemCoversView(item(640, 360), VIEW_W, VIEW_H), false, '四分之一屏不算');
  assert.equal(itemCoversView(item(1216, 720), VIEW_W, VIEW_H), true, '95% 面积 ⇒ 算铺满（0.9 口径）');
  assert.equal(itemCoversView(item(1152, 720), VIEW_W, VIEW_H), true, '恰好等于 90% 阈值（1152×720）⇒ 取 >= ⇒ 算铺满');
  assert.equal(itemCoversView(item(1151, 720), VIEW_W, VIEW_H), false, '略低于阈值 ⇒ 不算');
  assert.equal(itemCoversView(item(1280, 720, 0), VIEW_W, VIEW_H), false, 'flags bit0 = 0（引擎渲染门）⇒ 不算');
  assert.equal(itemCoversView(item(0, 720), VIEW_W, VIEW_H), false, '零宽不算');
  assert.equal(itemCoversView(item(1280, -1), VIEW_W, VIEW_H), false, '负高不算（防"负数相乘反而变大"）');
  assert.equal(itemCoversView(item(1280, 720), 0, 0), false, '视口未就绪 ⇒ 不算（宁可不解除）');
});

test('★T-0067：判据**无时钟、无副作用** —— 只读建项字段，不碰任何动画窗', () => {
  // 造一个带 flipbook 窗的项：`itemSrcRect(it, clock)` 会求值窗并锁存起点，而 `itemCoversView` 不会。
  const it = {
    flags: 1,
    srcW: 1280,
    srcH: 720,
    wins: [{ from: 0, to: 0, delay: 0, dur: 0, latched: false, startedAtMs: -1, loop: false }],
  } as unknown as Item;
  const before = JSON.stringify((it as unknown as { wins: unknown }).wins);
  assert.equal(itemCoversView(it, VIEW_W, VIEW_H), true);
  assert.equal(
    JSON.stringify((it as unknown as { wins: unknown }).wins),
    before,
    '★判据不得改窗状态（求值 flipbook 会锁存起点 ⇒ 污染共享模型，T-0004 G3）',
  );
});

test('★T-0067（源码棘轮）：`configureDrawItem` 不许再无条件解除留帧，必须按"铺满一屏"解除', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/src/renderer/pixiBackend.ts'), 'utf8');
  const body = /configureDrawItem\(cfg: DrawItemConfig\): void \{[\s\S]*?\n {2}\}/.exec(src);
  assert.ok(body, '找不到 `configureDrawItem` 的实现（守卫结构变了？）');
  assert.equal(
    body![0].includes("#releaseFrameHold('draw-texture')"),
    false,
    '★不许再用无条件的 `#releaseFrameHold(\'draw-texture\')`（T-0067 的元凶就是它）',
  );
  assert.match(
    body![0],
    /#releaseFrameHoldIfCovers\(/,
    '必须走 `#releaseFrameHoldIfCovers`（判据 = itemCoversView）',
  );
  assert.match(
    src,
    /#releaseFrameHoldIfCovers\(what: string, it: Item\): void \{[\s\S]*?itemCoversView\(it, VIEW_W, VIEW_H\)/,
    '解除判据必须是 `itemCoversView(it, VIEW_W, VIEW_H)`',
  );
  assert.match(src, /const HOLD_MAX_FRAMES = 60;/, '★上限必须保留（防"新内容一直铺不满"永久冻帧）');
});
