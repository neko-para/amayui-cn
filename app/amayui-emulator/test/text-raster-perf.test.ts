/** @tier T0 @kind core @subsystem render */
/**
 * **文本光栅化的性能守卫**（起因：存档页 80→90 一帧卡 1.5s）。
 *
 * ## 为什么用源码棘轮而不是行为断言
 * 这两个修复点都在**浏览器 canvas** 里（`document.createElement('canvas')` / `getImageData`），
 * Node 测试里 `document` 不存在 ⇒ `scratchCtx()` 直接返回 null，**行为路径整条走不到**。
 * 本工程对这类"接线只在真宿主里存在"的东西有过明确教训（`T-0175` ⑤）：**至少把接线钉在源码上**，
 * 否则下次重构随手把池子删掉、把提示去掉，卡顿会悄悄回来而没有任何东西变红。
 *
 * ## 钉的是哪三件事（每一条都对应一次实测过的卡顿来源）
 *  1. **中间图层复用**：原先 `drawGlyphPassesOnSurface` **每个绘制遍都新建一张画布**
 *     （该屏一帧 190 次直绘、每次 1~4 遍 ⇒ 数百次"建画布 + getContext"）。
 *  2. `willReadFrequently: true`：这些画布每次都要 `getImageData` 取覆盖率，不给提示时
 *     Chromium 把 2D 画布留在 GPU 上、每次回读都要一次 GPU→CPU 同步（实测 ~1.5ms/次）。
 *  3. **两处都要**：中间图层（`raster.ts`）与**槽画布**（`textureCache.ts`）都吃这条提示 ——
 *     只改一处时实测只快一半（0x204 仍 1.78ms/次）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.resolve(HERE, '..');
const RASTER = path.join(EMU, 'src', 'renderer', 'text', 'raster.ts');
const TEXCACHE = path.join(EMU, 'src', 'renderer', 'pixi', 'textureCache.ts');

test('★文本光栅化：中间图层必须**复用**（不许每次绘制/每遍字形新建画布）', () => {
  const src = fs.readFileSync(RASTER, 'utf8');
  assert.match(src, /const scratchCanvases = new Map/, '要有按尺寸缓存的图层池');
  assert.match(src, /function scratchCtx\(/, '要有取"已清空图层"的入口');
  assert.match(src, /MAX_SCRATCH_CANVASES/, '池子要有上限（直绘包围盒尺寸千奇百怪）');
  // ★逐遍新建画布就是那次卡顿的来源：`drawGlyphPassesOnSurface` 的循环体里不许再出现它
  const loopStart = src.indexOf('for (const pass of opts.passes) {');
  assert.ok(loopStart > 0, '找不到绘遍循环');
  const loopBody = src.slice(loopStart, src.indexOf('if (written) target.putImageData', loopStart));
  assert.doesNotMatch(loopBody, /createElement\('canvas'\)/, '绘遍循环里**不许**再建画布（应复用一张 + 每遍 clearRect）');
  assert.match(loopBody, /clearRect\(0, 0, cw, chh\)/, '复用的图层每遍开始前必须清空（= 原先"新画布"的语义）');
});

test('★文本光栅化：要回读的 2D 上下文必须带 `willReadFrequently`（图层与槽画布**两处**）', () => {
  for (const [name, file] of [
    ['raster.ts（中间图层）', RASTER],
    ['textureCache.ts（槽画布）', TEXCACHE],
  ] as const) {
    const src = fs.readFileSync(file, 'utf8');
    const bare = src.match(/getContext\('2d'\)/g) ?? [];
    assert.equal(bare.length, 0, `${name}：还有 ${bare.length} 处 `+"`getContext('2d')` 没给提示（回读会走 GPU 同步）");
    assert.match(src, /getContext\('2d', \{ willReadFrequently: true \}\)/, `${name}：至少要有一处带提示的取上下文`);
  }
});
