/** @tier T0 @kind core @subsystem frame */

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
import {
  FRAME_HOLD_COVER_RATIO,
  itemCoversView,
  meshCoversViewport,
  meshFillsViewport,
  meshesCoverViewInRange,
} from '../src/renderer/drawItem.js';
import { VIEW_H, VIEW_W } from '../src/renderer/viewport.js';
import type { Item, MeshObj } from '../src/renderer/drawItem.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 造一个"已建项"（只填本判据读的字段：flags/srcW/srcH）。 */
const item = (srcW: number, srcH: number, flags = 1): Item => ({ flags, srcW, srcH }) as unknown as Item;

/**
 * 造一块 mesh（只填本判据读的字段：flags/verts/state0/state1）。
 * 缺省 `state0 = 0xff000000`（不透明黑）= "**真的盖着屏幕**"的那一档。
 */
const mesh = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  flags = 1,
  state0 = 0xff000000,
  state1 = 0,
): MeshObj =>
  ({
    flags,
    state0,
    state1,
    verts: [
      { x: x0, y: y0, z: 0, u: 0, v: 0 },
      { x: x1, y: y0, z: 0, u: 1, v: 0 },
      { x: x0, y: y1, z: 0, u: 0, v: 1 },
      { x: x1, y: y1, z: 0, u: 1, v: 1 },
    ],
  }) as unknown as MeshObj;

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

/**
 * ## `tickets/T-0182`：**武装**判据（`meshFillsViewport` / `meshCoversViewport` / `meshesCoverViewInRange`）
 *
 * 症状（用户实测 2026-09-26）：TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 时，
 * GAMESTART 渐黑之后、SN0000 渐入之前闪出一帧旧画面（TITLE 全屏背景 0xa + TITLE 立绘节点 key 0x14
 * + GAMESTART 配置界面 28 项）；预期是「黑 → 从黑渐入 SN0000」。
 *
 * 机制：`0x1F7 detach-texture` 撤掉**盖着屏幕的幕**时要武装留帧（`#holdFrameAfterCurtainDrop`），
 * 而武装判据当时手写在 `#coversViewportMeshInRange` 里、口径是"顶点外接矩形要 >= 1280×720"。
 * `tickets/T-0155` 给 `0x320` 的顶点加上引擎的半像素偏移（`x/y -= 0.5`）之后，语料里每一块
 * 满屏幕布都是 `(-0.5,-0.5)..(1279.5,719.5)` ⇒ `Math.max(xs) = 1279.5 < 1280` ⇒ **判据恒假**
 * ⇒ 留帧从未武装（真跑日志里 `detachTexture h=0x30d40 count=1 REMOVE` 之后再没有
 * `[frame-hold] 满屏幕布 … 被撤` 行）。
 *
 * ⇒ 判据口径固定为：**几何** = "与视口的交集面积 ≥ `FRAME_HOLD_COVER_RATIO`"（对半像素、
 * 对略大/略小的幕都成立）**且** 当前端色 α>0（撤一块全透明的幕在画面上什么都没改变 ⇒ 不该武装；
 * 反例站点 = TITLE 的入场渐显，撤幕那一刻 `state0` 已被窗末烘焙成 0）。
 * 并且**只留共享层这一份**（宿主侧不再手写几何）。
 */
test('★T-0182：`meshFillsViewport` —— 语料满屏四边形（半像素偏移 -0.5..1279.5）必须算"铺满"', () => {
  // ★判决用例：这一条在修前**必然失败**（旧判据要求 `max(xs) >= 1280`，而真值是 1279.5）
  assert.equal(
    meshFillsViewport(mesh(-0.5, -0.5, 1279.5, 719.5), VIEW_W, VIEW_H),
    true,
    '★T-0155 之后的真语料几何必须算铺满（T-0182 的元凶就是这里判假）',
  );
  assert.equal(meshFillsViewport(mesh(0, 0, 1280, 720), VIEW_W, VIEW_H), true, '半像素订正前的旧几何同样算铺满（口径对两侧都成立）');
  assert.equal(meshFillsViewport(mesh(-10, -10, 1290, 730), VIEW_W, VIEW_H), true, '比视口略大的幕也算铺满');
  assert.equal(meshFillsViewport(mesh(-0.5, -0.5, 1215.5, 719.5), VIEW_W, VIEW_H), true, '≥90% 面积 ⇒ 算铺满（与 itemCoversView 同一比例口径）');
  assert.equal(meshFillsViewport(mesh(-0.5, -0.5, 1150, 719.5), VIEW_W, VIEW_H), false, '略低于 90% ⇒ 不算');
  assert.equal(meshFillsViewport(mesh(0, 0, 640, 360), VIEW_W, VIEW_H), false, '半屏 mesh 不算（别把局部贴片当幕）');
  assert.equal(meshFillsViewport(mesh(0, 0, 1280, 100), VIEW_W, VIEW_H), false, '整宽但很薄的条不算');
  assert.equal(meshFillsViewport(mesh(0, 0, 1280, 720, 0), VIEW_W, VIEW_H), false, 'flags bit0 = 0（无几何）不算');
  assert.equal(meshFillsViewport({ flags: 1, verts: [] } as unknown as MeshObj, VIEW_W, VIEW_H), false, '无顶点不算');
  assert.equal(
    meshFillsViewport(
      {
        flags: 1,
        verts: [
          { x: 0, y: 0, z: 0, u: 0, v: 0 },
          { x: 1280, y: 720, z: 0, u: 1, v: 1 },
        ],
      } as unknown as MeshObj,
      VIEW_W,
      VIEW_H,
    ),
    false,
    '顶点 <3（引擎 vcount 下限是 1，别假设 4）不算',
  );
  assert.equal(meshFillsViewport(mesh(-0.5, -0.5, 1279.5, 719.5), 0, 0), false, '视口未就绪 ⇒ 不算（宁可不武装）');
  // 几何口径**不**看颜色（那半边在 meshCoversViewport 里）
  assert.equal(meshFillsViewport(mesh(0, 0, 1280, 720, 1, 0, 0), VIEW_W, VIEW_H), true, '几何口径不掺 α（两块判据各管一半）');
});

test('★T-0182：`meshCoversViewport` —— 只有"几何铺满 **且** 此刻 α>0"才算盖着屏幕', () => {
  const quad = (flags: number, state0: number, state1: number): MeshObj => mesh(-0.5, -0.5, 1279.5, 719.5, flags, state0, state1);
  assert.equal(meshCoversViewport(quad(1, 0xff000000, 0), VIEW_W, VIEW_H), true, '不透明黑幕（窗已收尾，state0 = 当前色）⇒ 盖着屏幕');
  assert.equal(meshCoversViewport(quad(1, 0x80000000, 0), VIEW_W, VIEW_H), true, '50% 黑幕也算盖着（撤掉它会改变画面亮度）');
  assert.equal(
    meshCoversViewport(quad(1, 0x00000000, 0x00000000), VIEW_W, VIEW_H),
    false,
    '★全透明幕（TITLE 入场渐显撤幕那一刻：state0 已被窗末烘焙成 0）⇒ **不算**（撤了画面不变，武装只会白冻 60 帧）',
  );
  assert.equal(
    meshCoversViewport(quad(3, 0x00000000, 0xff000000), VIEW_W, VIEW_H),
    true,
    '★窗还在跑（bit1 置）且终点 α>0 ⇒ 保守算"可能盖着"（正在淡入的黑幕不能漏判）',
  );
  assert.equal(meshCoversViewport(quad(3, 0x00000000, 0x00000000), VIEW_W, VIEW_H), false, '窗还在跑但两端都全透明 ⇒ 全程透明 ⇒ 不算');
  assert.equal(meshCoversViewport(quad(3, 0xff000000, 0x00000000), VIEW_W, VIEW_H), true, '窗还在跑且起点不透明 ⇒ 算');
  assert.equal(meshCoversViewport(mesh(0, 0, 640, 360, 1, 0xff000000, 0), VIEW_W, VIEW_H), false, '半屏（几何不铺满）⇒ 不算，哪怕它是不透明的');
});

test('★T-0182：`meshesCoverViewInRange` —— 单图元（count<=1）与区间（count>1）的分派口径', () => {
  const curtain = { ...mesh(-0.5, -0.5, 1279.5, 719.5), handle: 0x30d40 } as unknown as MeshObj;
  const small = { ...mesh(0, 0, 200, 100), handle: 0x3e8 } as unknown as MeshObj;
  const meshes = [small, curtain];
  assert.equal(meshesCoverViewInRange(meshes, 0x30d40, 1, VIEW_W, VIEW_H), true, '单图元移除：命中满屏幕 ⇒ 武装');
  assert.equal(meshesCoverViewInRange(meshes, 0x30d40, 0, VIEW_W, VIEW_H), true, 'count=0（脚本偶尔这么写）按单图元处理');
  assert.equal(meshesCoverViewInRange(meshes, 0x3e8, 1, VIEW_W, VIEW_H), false, '单图元移除：只删小贴片 ⇒ 不武装');
  assert.equal(meshesCoverViewInRange(meshes, 0x30000, 0x1000, VIEW_W, VIEW_H), true, '区间移除 [0x30000,0x31000) 含满屏幕 ⇒ 武装');
  assert.equal(meshesCoverViewInRange(meshes, 0x12c, 0x2bc, VIEW_W, VIEW_H), false, '区间不含满屏幕 ⇒ 不武装');
  assert.equal(meshesCoverViewInRange(meshes, 0x30d41, 1, VIEW_W, VIEW_H), false, 'handle 不在区间（右开）⇒ 不武装');
});

test('★T-0182（源码棘轮）：撤幕武装判据必须委托共享层，不许再手写 `max(xs) >= VIEW_W`', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/src/renderer/pixiBackend.ts'), 'utf8');
  assert.match(
    src,
    /#coversViewportMeshInRange\(handle: number, count: number\): boolean \{[\s\S]*?meshesCoverViewInRange\(this\.scene\.meshes\.values\(\), handle, count, VIEW_W, VIEW_H\)/,
    '区间判据必须委托 `meshesCoverViewInRange`（与 itemCoversView 同一份比例口径）',
  );
  assert.equal(
    /Math\.max\(\.\.\.xs\)\s*>=\s*VIEW_W/.test(src),
    false,
    '★不许再出现手写的 `Math.max(...xs) >= VIEW_W` —— 它被 T-0155 的半像素订正打成恒假（T-0182）',
  );
});

