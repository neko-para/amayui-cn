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
import {
  TEXT_FILL_ALPHA,
  visibleInLine,
  visibleRubyInLine,
  type FontSpec,
  type MsgWinStyle,
  type TextFrame,
} from '../../text/layout.js';

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
  // ★**填充用覆盖率 α 画**（引擎 `sub_46D9F0` raw 84996-85011：`dst = (C*α + dst*(255-α))/255`，
  //   α = 255*cov/17 ≤ 225/240）。canvas 的 `globalAlpha` 正是这个 `dst = α*C + (1-α)*dst`
  //   合成 —— 满覆盖像素落在 `225 + (30/255)*描边`，正是真机实测的 `(233,230,228)`。
  //   描边副本照旧**不透明**（引擎先画描边、覆盖率只作用于填充那一遍）。
  //   ★只有覆盖率路径才压 α：1bpp 路径（`v62 = 1`）的合成是 `v18/v31` 恒满 ⇒ 纯色 255。
  const fillAlpha = spec.antiAlias ? TEXT_FILL_ALPHA : 1;
  ctx.globalAlpha = fillAlpha;
  switch (st.outlineMode) {
    case 0:
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      ctx.globalAlpha = 1;
      return;
    case 1: {
      // 单向投影：引擎在同一位置先用描边色画一遍偏移副本（raw 68091-68100）
      ctx.globalAlpha = 1;
      ctx.fillStyle = spec.outline;
      ctx.fillText(ch, x + st.outlineDx, y + st.outlineDy);
      ctx.globalAlpha = fillAlpha;
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      ctx.globalAlpha = 1;
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
        ctx.globalAlpha = 1;
        ctx.fillStyle = spec.outline;
        ctx.fillText(ch, x + dx, y + dy);
        ctx.fillText(ch, x - dx, y - dy);
        ctx.fillText(ch, x + dx, y - dy);
        ctx.fillText(ch, x - dx, y + dy);
      }
      ctx.globalAlpha = fillAlpha;
      ctx.fillStyle = spec.fill;
      ctx.fillText(ch, x, y);
      ctx.globalAlpha = 1;
      return;
    }
  }
}

/**
 * ★**无 AA 字形化（阈值化 alpha）** —— `tickets/T-0035`。
 *
 * 引擎的抗锯齿由 `Font+1352`（= `Engine[21662]`）决定：`set:EnableAntiFont` 门不过（本机两处 INI 都是）
 * ⇒ `Font+1352` 恒 0 ⇒ 引擎走 **GDI/dd 的 `TextOutA` 整串绘制**，字形是**锯齿**的：
 * 每个像素要么是纯填充/描边色、要么完全没有（不存在"半透明边缘"）。
 *
 * canvas 没有"关掉文字 AA"的开关（`imageSmoothingEnabled` 只管图像缩放），所以这里按引擎的**结果**
 * 对齐：画完之后把 alpha 通道阈值化（`>= cut` 记满不透明，否则全透明），颜色不动。
 * 阈值 128 ≈ GDI 在 50% 覆盖率处取整的判据；于是边缘不再产生灰边/白晕
 * —— 那正是"字比引擎粗、白色比引擎亮"的来源。
 *
 * @returns 被改写的像素数（测试与诊断用）。
 */
export function thresholdAlpha(ctx: CanvasRenderingContext2D, w: number, h: number, cut = 128): number {
  const pw = Math.max(1, Math.ceil(w));
  const ph = Math.max(1, Math.ceil(h));
  const img = ctx.getImageData(0, 0, pw, ph);
  const d = img.data;
  let changed = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i]!;
    if (a === 0 || a === 255) continue;
    d[i] = a >= cut ? 255 : 0;
    changed++;
  }
  if (changed) ctx.putImageData(img, 0, 0);
  return changed;
}

/**
 * ★**无 AA 时把字形画进独立图层、阈值化后再合成**（`tickets/T-0035`）。
 *
 * 为什么要独立图层，而不是直接对目标画布阈值化：GDI 的锯齿字形是"**覆盖到的像素写不透明色、
 * 没覆盖到的像素原样不动**"。若直接阈值化目标画布，会连带处理**背景**（窗口底色可能带 alpha，
 * 将来建模后更明显）以及槽里已有的像素（`draw-string` 是"往已有表面上叠字"）——
 * 那些像素的 alpha 不属于"字形覆盖率"，不该被改。
 *
 * 分层之后：图层里只有字形（描边副本 + 填充，彼此覆盖关系与引擎同序），阈值化只作用于字形覆盖率；
 * 合成时 `source-over` ⇒ 覆盖率 ≥ 50% 的像素用纯色**替换**底层，其余保持底层原样（引擎同结果）。
 *
 * @param target 目标画布 ctx（调用方已设好 `res` 变换）
 * @param physW/physH 物理像素尺寸（= 逻辑 × res）
 * @param draw   把字形画进给定 ctx 的回调（该 ctx 已设好与 target 相同的 `res` 变换）
 * @returns 被阈值化改写的像素数（测试/诊断用）
 */
export function drawAliasedLayer(
  target: CanvasRenderingContext2D,
  physW: number,
  physH: number,
  res: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  cut = 128,
): number {
  if (typeof document === 'undefined') return 0; // 非浏览器宿主：不该走到这里
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(physW));
  layer.height = Math.max(1, Math.ceil(physH));
  const lctx = layer.getContext('2d');
  if (!lctx) return 0;
  lctx.setTransform(res, 0, 0, res, 0, 0);
  draw(lctx);
  const changed = thresholdAlpha(lctx, layer.width, layer.height, cut);
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0); // 图层按物理像素 1:1 贴回
  target.drawImage(layer, 0, 0);
  target.restore();
  return changed;
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

  /** 把这一页字形画进给定 ctx（抗锯齿开着时直接画到目标，关着时画进独立图层）。 */
  const drawGlyphs = (c: CanvasRenderingContext2D): void => {
    let start = 0;
    for (const line of frame.lines) {
      const n = visibleInLine(line, start, revealed);
      for (let i = 0; i < n; i++) {
        const g = line.glyphs[i];
        if (g) drawGlyph(c, g.ch, g.x, g.y, st.main, st);
      }
      // 注音与本文**末字**同步出现（引擎：注音记录紧跟本文词末字的 24B 记录、该记录标 [+0]=1，
      // 显现循环 do { 贴 } while (上一记录[+0]) ⇒ 一步 = 本文末字 + 注音）。见 `visibleRubyInLine`。
      for (const rg of visibleRubyInLine(line, n)) drawGlyph(c, rg.ch, rg.x, rg.y, st.ruby, st);
      start += line.glyphs.length;
    }
  };

  // ★抗锯齿（`Font+1352`）：引擎没开 AA ⇒ 字形画进独立图层 + 阈值化再合成（`tickets/T-0035`）。
  //   一次阈值化整页（而不是逐字）⇒ 描边副本与填充的相互覆盖关系与引擎一致（引擎就是同一表面叠加）。
  if (st.main.antiAlias) drawGlyphs(ctx);
  else drawAliasedLayer(ctx, canvas.width, canvas.height, res, drawGlyphs);
  return canvas;
}
