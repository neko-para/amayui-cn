/**
 * 回归测试：**绘制项 → 纹理 的槽号解析**。
 *
 * 背景（两个真实 bug，2025 由引擎侧分析纠正）：
 *  1. `draw-texture`(0x1FB) 的 **op1 是图元 handle（= Scene map key = 层序）**、**op2 才是纹理槽**；
 *     旧实现把两者写反（把 op1 当槽）→ 存进 Item 的槽号是错的；
 *  2. `present()` 又用 `it.layer` 去查纹理槽表 → 全部落空 → 退化成占位色块
 *     （表现 = 背景消失、只剩零星方块）。
 * 本测试锁死正确行为：**按 `Item.tex`（= 槽号）解析**，绝不按 handle/layer。
 *
 * 依赖注入方式：`PixiBackend` 的实例字段可直接写入（测试内 `as any`），避免需要 DOM/WebGL。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixiBackend } from '../src/renderer/pixiBackend.js';

/** 取一个未初始化的 PixiBackend 实例（只测纯解析方法，不使用 Pixi/DOM）。 */
function bareBackend(): PixiBackend {
  const b = Object.create(PixiBackend.prototype) as PixiBackend & {
    slotImgid: Map<number, number>;
    slotTex: Map<number, unknown>;
  };
  b.slotImgid = new Map();
  b.slotTex = new Map();
  return b;
}

/** 构造一个绘制项：handle/layer = 图元 key（层序），tex = 纹理槽号。 */
const item = (handle: number, layer: number, tex: number): never =>
  ({ handle, layer, tex, srcX: 0, srcY: 0, srcW: 16, srcH: 16, dstX: 0, dstY: 0, flags: 1, from: 0xffffffff, to: 0xffffffff }) as never;

test('resolveItemTexture：按 Item.tex（=纹理槽）解析，而不是按 handle/layer', () => {
  const b = bareBackend();
  const anyB = b as unknown as { slotImgid: Map<number, number>; slotTex: Map<number, unknown> };
  // set-texture 42 ← imgid 0x5245；并已载入纹理
  anyB.slotImgid.set(42, 0x5245);
  const fakeTex = { __tex: 'slot42' };
  anyB.slotTex.set(42, fakeTex);
  // 干扰：槽 4 也绑定了
  anyB.slotImgid.set(4, 0x5272);
  anyB.slotTex.set(4, { __tex: 'slot4' });

  // draw-texture 300 42 …：handle=300(层序)、tex=42(槽) → 必须取到 slot42
  const r1 = b.resolveItemTexture(item(300, 300, 42));
  assert.equal(r1.tex, fakeTex, 'tex=42 应解析到 slot 42 的纹理');
  assert.equal(r1.imgid, 0x5245);

  // ★关键回归：tex=100（未绑定），handle=4（存在同名槽 4）→ 不得误取 slot 4
  const r2 = b.resolveItemTexture(item(4, 4, 100));
  assert.equal(r2.tex, undefined, 'tex=100 未绑定 → 必须是 undefined（旧实现会误取 handle/layer 的槽）');
  assert.equal(r2.imgid, undefined, '未绑定槽的 imgid 也应为 undefined');

  // 已绑定但纹理尚未载入 → 返回 imgid、tex 为空（调用方退化占位块）
  anyB.slotImgid.set(7, 0x1234);
  const r3 = b.resolveItemTexture(item(1, 1, 7));
  assert.equal(r3.tex, undefined);
  assert.equal(r3.imgid, 0x1234, '应报出 imgid 以便诊断"绑定但未载入"');
});

test('resolveItemTexture：槽号与 handle 相同也不混淆（都走 tex 语义）', () => {
  const b = bareBackend();
  const anyB = b as unknown as { slotImgid: Map<number, number>; slotTex: Map<number, unknown> };
  const fakeTex = { __tex: 's9' };
  anyB.slotImgid.set(9, 0x99);
  anyB.slotTex.set(9, fakeTex);
  const r = b.resolveItemTexture(item(9, 9, 9));
  assert.equal(r.tex, fakeTex);
  assert.equal(r.imgid, 0x99);
});
