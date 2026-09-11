/**
 * **文本光栅化**（canvas2D → 离屏 canvas）—— 宿主里唯一依赖浏览器的地方。
 *
 * 为什么自己画而不是用 `pixi.Text`：引擎的文本是「等宽网格 + 竖排 + 注音 + 逐字显现」，
 * `pixi.Text` 内建的行布局用不上（它也不支持注音/竖排），而它内部同样是 canvas2D
 * `fillText`/`strokeText`（`pixi.js/lib/scene/text/canvas/CanvasTextGenerator.mjs`）。
 * 因此直接用 canvas2D 逐字画：**排版完全由 `layout.ts` 决定，光栅化只负责把字形画出来**。
 *
 * 描边档位（`MsgWinStyle.outlineMode`，引擎 `Font+1372`）**按引擎的机制**实现
 * —— 即"用描边色把同一串再画若干遍"，而不是 canvas 的 `strokeText`：
 *
 * | 档 | 引擎（raw） | 这里 |
 * |---|---|---|
 * | 0 | 只画居中一遍（68128） | `fillText` |
 * | 1 | 额外一遍 `(x+dx, y+dy)`（68091-68100） | `fillText` 偏移一次 + 居中一次 |
 * | 2 | 同位置叠一遍 **1/4 强度**字形副本（87657-87662） | 同位置 `globalAlpha=0.25` 再画一遍 |
 * | 3 | **四次对角偏移** `(+dx,+dy) (-dx,-dy) (+dx,-dy) (-dx,+dy)`（68101-68121） | 四次偏移副本 + 居中一次 |
 *
 * ★不用 `strokeText` 的原因：canvas 的描边是**沿轮廓居中**的（内外各半），
 * 视觉上比引擎的"偏移副本"更粗、且会把字面吃掉一半 —— 那正是"字重看着过重"的来源。
 */
import { visibleInLine, type FontSpec, type MsgWinStyle, type TextFrame } from '../../text/layout.js';

/** 逐档描边（引擎 `Font+1372` → `sub_455ED0` 的 `a8`）。 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  spec: FontSpec,
  st: MsgWinStyle,
): void {
  ctx.font = `${spec.weight} ${spec.size}px "${spec.family}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 1;

  switch (st.outlineMode) {
    case 0:
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      return;
    case 1: {
      // 单向投影：引擎在同一位置先用描边色画一遍偏移副本（raw 68091-68100）
      ctx.fillStyle = spec.outline;
      ctx.fillText(ch, x + st.outlineDx, y + st.outlineDy);
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      return;
    }
    case 2: {
      // 同位置叠一遍 1/4 强度副本（raw 87657-87662）
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = spec.outline;
      ctx.fillText(ch, x, y);
      ctx.globalAlpha = 1;
      return;
    }
    case 3: {
      // 四次对角偏移副本（引擎 raw 68101-68121 的四次 TextOutA），再居中画填充
      const { outlineDx: dx, outlineDy: dy } = st;
      if (dx !== 0 || dy !== 0) {
        ctx.fillStyle = spec.outline;
        ctx.fillText(ch, x + dx, y + dy);
        ctx.fillText(ch, x - dx, y - dy);
        ctx.fillText(ch, x + dx, y - dy);
        ctx.fillText(ch, x - dx, y + dy);
      }
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      return;
    }
  }
}

/**
 * 把一个消息窗的排版结果光栅化到**新建的 canvas**（尺寸 = 窗口尺寸 × `res`）。
 *
 * @param revealed 已显示到的字形总数（跨行累计；`>= frame.glyphCount` 即全部显示）
 * @param res      设备像素比（1 或 `devicePixelRatio`）；canvas 物理尺寸按它放大后再缩放坐标系
 */
export function rasterFrame(frame: TextFrame, revealed: number, res = 1): HTMLCanvasElement {
  const st = frame.style;
  const w = Math.max(1, Math.ceil(st.w));
  const h = Math.max(1, Math.ceil(st.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * res);
  canvas.height = Math.ceil(h * res);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.setTransform(res, 0, 0, res, 0, 0);

  // 窗口底色（引擎 dd 路径 `ddFillSurface(surfaces[20+win], 底色)` raw 74261-74265；
  // D3D 路径由 DrawItem 的颜色字段承担）。null = 透明。
  if (st.background) {
    ctx.fillStyle = st.background;
    ctx.fillRect(0, 0, w, h);
  }

  let start = 0;
  for (const line of frame.lines) {
    const n = visibleInLine(line, start, revealed);
    for (let i = 0; i < n; i++) {
      const g = line.glyphs[i];
      if (g) drawGlyph(ctx, g.ch, g.x, g.y, st.main, st);
    }
    // 注音随本文一起出现（引擎把注音与本文成对处理：24B 记录 +0 种类）
    if (n > 0) for (const rg of line.ruby) drawGlyph(ctx, rg.ch, rg.x, rg.y, st.ruby, st);
    start += line.glyphs.length;
  }
  return canvas;
}
