/** @tier T0 @kind ratchet @subsystem adv */

/**
 * ★`tickets/T-0102`「ADV 窗口背景是白色」的**渲染侧判据**（2026-09，E4 日志归因到的那一条）。
 *
 * ## 症状与根因（都可复算）
 *
 * 用户实测：从 SN0000 进 SC 场景后 ADV 窗口区域是**白色**，开合侧边栏刷新一次才变正确。
 * 产品日志（`.tmp/amayui-emulator.log`）里的形状是：
 *
 * ```text
 * [call-script] 0x5258 -> LOADCONFIG.BIN (41 instr)
 * [present] item h=0x19a28 layer=105000 未绑定纹理槽 → 占位块
 * [present] item h=0x19a29 layer=105001 未绑定纹理槽 → 占位块      ← …共 28 条（12+ 行）
 * ```
 *
 * `0x19a28` = **105000** = `SYSTEM4.txt:69` 的 `i213 8 19a28 1f4` 给 win8 登记的正文行 id 起点
 * （区间 `[105000,105500)`）。引擎里那一批 id **就是文本行**（GDI 把字排进窗表面后按 id 贴出来），
 * 而 emulator 的文本另有载体（`textLayer` + `msgWins`）⇒ 这些 DrawItem 没有纹理槽，
 * 被 `presenter.#placeholder` 画成**纯白矩形** ⇒ 盖住整个 ADV 窗口。
 *
 * ## 本测试钉什么
 *
 *  1. 区间判据本身（`inMsgTextRange`）：命中/边界（左闭右开）/跨窗/`count<=0` 视为未登记；
 *  2. **行为守卫**（`T-0125` 起从"源码文本正则"改成真调 `presenter.itemSprite`）：正文区间内 +
 *     无纹理槽 ⇒ `return null`；同一槽状态、handle 移出区间 ⇒ 照画（互为对照，见下面那条用例）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture } from 'pixi.js';
import { inMsgTextRange } from '../src/renderer/drawitem/msgTextRange.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scConfigureDrawItem } from '../src/renderer/scene/ops.js';
import type { Item } from '../src/renderer/drawItem.js';

/** 本作真实登记（`SYSTEM4.txt:57/58/69` 经 `0x213`/`0x25D`）：win1 正文 `[105000,105500)`、win1 注音 `[104300,104303)`。 */
const REAL = new Map<number, { base: number; count: number }[]>([
  [1, [{ base: 105000, count: 500 }, { base: 104300, count: 3 }]],
  [8, [{ base: 105000, count: 500 }]],
]);

test('★T-0102：消息窗正文区间判据（左闭右开、跨窗、count<=0 视为未登记）', () => {
  // ★每次传**新**迭代器：`Map.values()` 是一次性的（测试第一版就踩了这个 ⇒ 第二条断言起全落空）
  const hit = (h: number): boolean => inMsgTextRange(REAL.values(), h);
  assert.equal(hit(0x19a28), true, '行 0（= 用户日志里那个 handle）必须命中');
  assert.equal(hit(0x19a28 + 11), true, '第 11 行必须命中');
  assert.equal(hit(105000 + 499), true, '区间内最后一个 id 命中（左闭右开）');
  assert.equal(hit(105000 + 500), false, '区间右端**不在**内');
  assert.equal(hit(104300), true, '注音区间（win1 的 `i25d 1 1976c 3`）也要命中');
  assert.equal(hit(104303), false, '注音区间右端不在内');
  assert.equal(hit(0x19258), false, '普通图元（序章暗幕）不命中');
  assert.equal(
    inMsgTextRange([[{ base: 105000, count: 0 }]], 105000),
    false,
    '`count <= 0` = 未登记（引擎口径：`+108 <= 0` 视为没登记过）',
  );
});

test('★T-0102 行为守卫：正文区间内 + 无纹理槽 ⇒ `itemSprite` 跳过；同一槽状态、handle 移出区间 ⇒ 照画', () => {
  // ★2026-09-23 重写（`tickets/T-0125`）：原版是对 `presenter.ts` **源码文本**的正则棘轮
  //   （认 `imgid === undefined && inMsgTextRange(scene.msgRanges.values(), it.handle)` 这个字面表达式）
  //   —— 改名/重构即假红，而"把判据从 `imgid` 换到别的条件上"却可能假绿。现在断**行为**。
  //
  // ★自带**反面控制**（这是这条守卫的判别力来源）：两个 DrawItem 的槽状态**完全相同**
  //   （`tex` 槽绑了图、但 `imgid` 未绑定 ⇒ `resolve()` 给 `imgid === undefined`），
  //   只有 `handle` 一个在正文区间内、一个在区间外。若判据被删/被改坏：
  //     · 区间内那个会画出来（旧症状 = ADV 窗口上的纯白块）⇒ 第 ① 条红；
  //     · 或区间外那个被误吞 ⇒ 第 ② 条红。
  //   ⇒ 两条互为对照，"返回 null" 不可能是恒真。
  const root = new Container();
  const cache = new TextureCache(() => {});
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, 1280, 720);
  const scene = newSceneState();
  // `SYSTEM4.txt:69` 的 `i213 8 19a28 1f4` ⇒ win8 正文行 id 区间 `[105000,105500)`
  scene.msgRanges.set(8, [{ base: 105000, count: 500 }]);
  // ★不许为这条用例新抄一个 `mk()` 变体（守卫 `test/harness-convergence.test.ts`，T-0020）：
  //   这里本来就是"两个不同 handle 的绘制项"，逐项显式写出来比抽一个只被调两次的工厂更清楚。
  const drawItem = (handle: number): Item => {
    scConfigureDrawItem(scene, {
      handle, layer: handle, tex: 3, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 0, dstY: 0,
    });
    const it = scene.drawItems.get(handle);
    assert.ok(it, `应建出 handle=0x${handle.toString(16)} 的绘制项`);
    return it;
  };
  const inRange = drawItem(105000); // 正文第 0 行（用户日志里的 `h=0x19a28`）
  const outOfRange = drawItem(0x19258); // 普通图元（序章暗幕）
  // 槽 3：绑了宿主纹理但**没有 imgid**（= 引擎那条路径上"槽里有表面、不是文件图像"的形状）
  cache.slotTex.set(3, Texture.WHITE);

  assert.equal(
    presenter.itemSprite(scene, inRange, 0, 'normal'),
    null,
    '★正文区间内 + 没有纹理槽 ⇒ 整项跳过（文本由 textLayer 画；引擎里那批 id 就是文本行）',
  );
  assert.ok(
    presenter.itemSprite(scene, outOfRange, 0, 'normal'),
    '★同一槽状态、handle 在区间外 ⇒ 必须照画（否则说明判据误吞了普通图元）',
  );
});
