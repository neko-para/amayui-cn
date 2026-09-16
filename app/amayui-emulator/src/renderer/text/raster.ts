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

/** 一遍字形绘制（引擎 `sub_471180` 的一趟 `sub_46D9F0`）：一个字 + 它的颜色与强度。 */
export interface GlyphPass {
  ch: string;
  /** 逻辑坐标（与 `drawStringGlyphs` 同一坐标系）。 */
  x: number;
  y: number;
  /** 该遍的颜色（`#rrggbb`）。 */
  color: string;
  /** 该遍的强度系数（档位 2 的"同位 1/4 副本" = 0.25，其余 1）。 */
  weight: number;
}

/**
 * ★**引擎的字形单像素写入**（`sub_46D9F0` 32bpp 分支；机器码 0x46DDC0-0x46DE7E 逐条核对）。
 *
 * ```text
 *   if (α == 255)        pixel = C | 0xFF000000          // 满覆盖 ⇒ 纯色不透明
 *   else if (A_dst == 0) pixel = C | (α<<24)             // RGB = C **原样**、A = α
 *   else                 RGB = (C·α + D·(255−α))/255     // D = 表面已有像素（`0x80808081` 魔数除法）
 *                        A   = max(A_dst, α)             // ★取 max，**不是**累加
 * ```
 *
 * ★`A = max` 这一条是"往**透明**表面画字"的关键：`create-texture` 出来的槽表面是空白
 * A8R8G8B8，引擎把覆盖率 α 留在它的 alpha 上，之后 `draw-texture` 按该 alpha 合成 ⇒ 字落在
 * `α·RGB + (1−α)·场景`。canvas 的 `source-over` 会把描边遍与填充遍的 alpha **累加**（≈1），
 * 于是白字会画成不透明纯白 —— 这正是 `tickets/T-0042` 的残留
 * （设置界行标签 255 vs 真机 226-234 暖）。
 *
 * @param d RGBA 字节数组（`ImageData.data`）
 * @param i 该像素在 `d` 里的下标
 * @param alpha 覆盖率对应的 α（0..255）
 */
export function engineGlyphPixel(
  d: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  const da = d[i + 3]!;
  if (alpha >= 255 || da === 0) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  } else {
    const inv = 255 - alpha;
    d[i] = Math.round((r * alpha + d[i]! * inv) / 255);
    d[i + 1] = Math.round((g * alpha + d[i + 1]! * inv) / 255);
    d[i + 2] = Math.round((b * alpha + d[i + 2]! * inv) / 255);
  }
  d[i + 3] = Math.max(da, alpha);
}

/**
 * ★**把字形逐遍写进一张"透明表面"—— 引擎 `sub_46D9F0`（32bpp 分支）的写入语义**（`tickets/T-0042`）。
 *
 * 引擎自己光栅化字形时，**每一遍**（先描边副本、后填充）都按覆盖率 α 写目标表面（raw 84873-85011，
 * 机器码 0x46DDC0-0x46DE7E 逐条核对）：
 *
 * ```text
 *   α = 255·cov/17                     // GGO_GRAY4 覆盖率；满覆盖 = 240，实测平台（cov=15）= 225
 *   if (α == 255)              pixel = C | 0xFF000000
 *   else if (A_dst == 0)       pixel = C | (α<<24)          // RGB = C **原样**、A = α
 *   else                       RGB = (C·α + D·(255−α))/255  // D = 表面已有像素
 *                              A   = max(A_dst, α)
 * ```
 *
 * ★为什么必须逐像素做而不能用 canvas 的 `globalAlpha`：`source-over` 会把多遍的 alpha **累加**
 * （描边 + 填充 ⇒ ≈1 而不是 α），而引擎取的是 `max` —— 于是"往**透明**表面画字"时（`0x204`
 * draw-string 的槽表面就是 `create-texture` 出来的空白 A8R8G8B8），canvas 会把字画成**不透明**、
 * 引擎却把覆盖率 α 留在表面 alpha 上，再由 `draw-texture` 按它合成 ⇒ 字落到
 * `α·RGB + (1−α)·场景`。设置界行标签（白填充 + 白描边 + 档 1）因此真机是 `225 + (30/255)·底板`
 * ≈ **(233,231,230) 暖灰**，而 canvas 直接画是纯白 255（就是 `T-0042` 的残留）。
 *
 * 反过来说，**目标不透明时**（消息窗表面有底色 ⇒ `A_dst = 255`）这条写入退化成"RGB 按 α 混合、
 * A 恒 255"，与 canvas 的直接绘制等价 —— 所以本函数只用在**透明表面**（槽）路径上。
 *
 * @param target 目标画布 ctx（`getImageData`/`putImageData` 用设备像素，不受 ctx 变换影响）
 * @param opts.res        设备像素比（逻辑 → 物理）
 * @param opts.font       `ctx.font` 字串
 * @param opts.passes     按引擎顺序排好的各遍字形（先所有描边副本，后填充）
 * @param opts.alphaMax   满覆盖时的 α（AA 开 = `TEXT_FILL_ALPHA`；关 = 1，此时退化为"不透明写"）
 * @param opts.box        逻辑坐标包围盒（含描边偏移；调用方已按字形位置算好）
 * @returns 被写过的像素数（测试/诊断用）
 */
export function drawGlyphPassesOnSurface(
  target: CanvasRenderingContext2D,
  opts: {
    res: number;
    font: string;
    passes: GlyphPass[];
    alphaMax: number;
    box: { x: number; y: number; w: number; h: number };
  },
): number {
  if (typeof document === 'undefined') return 0; // 非浏览器宿主：不该走到这里
  const { res, box } = opts;
  const px = Math.max(0, Math.round(box.x * res));
  const py = Math.max(0, Math.round(box.y * res));
  const cw = Math.max(1, Math.round(box.w * res));
  const chh = Math.max(1, Math.round(box.h * res));
  if (opts.passes.length === 0) return 0;

  const dst = target.getImageData(px, py, cw, chh);
  const d = dst.data;
  let written = 0;

  for (const pass of opts.passes) {
    // 这一遍的**覆盖率**：单独画一张透明图层取它的 alpha（图层里只有这一个字形/颜色）
    const layer = document.createElement('canvas');
    layer.width = cw;
    layer.height = chh;
    const lc = layer.getContext('2d');
    if (!lc) continue;
    lc.setTransform(res, 0, 0, res, -px, -py); // 用逻辑坐标画
    lc.font = opts.font;
    lc.textAlign = 'left';
    lc.textBaseline = 'top';
    lc.globalAlpha = 1;
    lc.fillStyle = pass.color;
    lc.fillText(pass.ch, pass.x, pass.y);
    const cov = lc.getImageData(0, 0, cw, chh).data;

    const cr = parseInt(pass.color.slice(1, 3), 16);
    const cg = parseInt(pass.color.slice(3, 5), 16);
    const cb = parseInt(pass.color.slice(5, 7), 16);
    for (let i = 0; i < d.length; i += 4) {
      const c = cov[i + 3]!;
      if (c === 0) continue;
      const a = Math.round(opts.alphaMax * c * pass.weight);
      if (a <= 0) continue;
      engineGlyphPixel(d, i, cr, cg, cb, a);
      written++;
    }
  }
  if (written) target.putImageData(dst, px, py);
  return written;
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
