#!/usr/bin/env python3
"""UI 元素地图生成器（工具 A）。

扫描一张 PNG 的全部连通块（按 alpha 阈值），输出一个**自包含** HTML 查看器：
图片与块数据内嵌在一个文件里，浏览器打开即可交互 —— 替代「猜坐标 →
cc_scan 单点查询」的人工定位循环。

用法:
  python scan_blocks.py <png> [--alpha N] [--min-px N] [--out out.html] [--json-only out.json]

参数:
  --alpha    前景 alpha 阈值（默认 128，即「实体范围」；要含羽化用 1）
  --min-px   过滤像素数小于该值的连通块（默认 300）
  --out      输出 HTML 路径（默认 <png 同目录>/<名>_blocks.html）
  --json-only 只输出块数据 JSON（调试用），不生成 HTML

输出 HTML 功能:
  - 原图上所有连通块画框，按面积分级配色
  - 悬停显示块详情（编号/坐标/尺寸/像素数），点击选中/取消
  - 右侧列表按像素数排序，支持过滤、定位
  - 「导出选中 JSON」下载选中块清单（供后续清理工作台使用）

依赖: Pillow（已有）。
"""

import argparse
import base64
import json
import os
import sys
from collections import deque

from PIL import Image


def build_mask(img, x0, y0, x1, y1, alpha_th):
    """范围内 alpha 掩码（1 = 前景），返回 (mask, rw, rh)。"""
    W, H = img.size
    rw = x1 - x0 + 1
    rh = y1 - y0 + 1
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    data = img.tobytes()
    mask = bytearray(rw * rh)
    idx = 0
    for y in range(y0, y1 + 1):
        base = (y * W + x0) * 4
        for x in range(rw):
            if data[base + x * 4 + 3] >= alpha_th:
                mask[idx] = 1
            idx += 1
    return mask, rw, rh


def scan_all(img, alpha_th, min_px):
    """全图连通块扫描（4 邻接），返回块列表，每项
    (index, x0, x1, y0, y1, px)。index 从 1 开始，按 (y, x) 排序。"""
    W, H = img.size
    mask, rw, rh = build_mask(img, 0, 0, W - 1, H - 1, alpha_th)
    nbrs = ((1, 0), (-1, 0), (0, 1), (0, -1))

    seen = bytearray(rw * rh)
    comps = []
    for sy in range(rh):
        row_base = sy * rw
        for sx in range(rw):
            if not mask[row_base + sx] or seen[row_base + sx]:
                continue
            q = deque([(sx, sy)])
            seen[row_base + sx] = 1
            minx = maxx = sx
            miny = maxy = sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
                for dx, dy in nbrs:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < rw and 0 <= ny < rh:
                        ni = ny * rw + nx
                        if mask[ni] and not seen[ni]:
                            seen[ni] = 1
                            q.append((nx, ny))
            if n >= min_px:
                comps.append((minx, maxx, miny, maxy, n))
    comps.sort(key=lambda c: (c[2], c[0]))
    return [
        {"index": i, "x0": c[0], "x1": c[1], "y0": c[2], "y1": c[3],
         "px": c[4], "w": c[1] - c[0] + 1, "h": c[3] - c[2] + 1}
        for i, c in enumerate(comps, 1)
    ]


def intervals_overlap_or_near(a0, a1, b0, b1, gap):
    """一维区间 [a0,a1] 与 [b0,b1]：重叠（相交）或间隔 ≤ gap（gap>=0）。"""
    return max(a0, b0) - min(a1, b1) <= gap


def intervals_intersect(a0, a1, b0, b1):
    """一维区间相交（有共同像素）。"""
    return max(a0, b0) <= min(a1, b1)


def rects_mergeable(a, b, gap_x, gap_y):
    """两个矩形是否可合并（横纵阈值独立）：
    - 横向：x 轴重叠或间隔 ≤ gap_x 且 y 轴相交；
    - 纵向：y 轴重叠或间隔 ≤ gap_y 且 x 轴相交。
    """
    x_near = intervals_overlap_or_near(a["x0"], a["x1"], b["x0"], b["x1"], gap_x)
    y_near = intervals_overlap_or_near(a["y0"], a["y1"], b["y0"], b["y1"], gap_y)
    x_int = intervals_intersect(a["x0"], a["x1"], b["x0"], b["x1"])
    y_int = intervals_intersect(a["y0"], a["y1"], b["y0"], b["y1"])
    return (x_near and y_int) or (y_near and x_int)


def count_foreground(img, mask, x0, y0, x1, y1):
    """统计矩形区域内 alpha≥阈值 的前景像素数（mask 为全图掩码）。"""
    W, H = img.size
    rw = x1 - x0 + 1
    n = 0
    for y in range(y0, y1 + 1):
        base = y * W + x0
        row = mask[base:base + rw]
        n += sum(row)
    return n


def merge_blocks(img, alpha_th, blocks, gap_x, gap_y):
    """迭代合并可合并的矩形对（原图连通块只扫一次，此处只做矩形合并）。

    每次合并两个矩形为外接大矩形，并重新统计区域内前景像素数；
    合并后继续查找新的可合并对，直到无可合并为止（gap=0 时仅重叠/相交可合并）。
    横纵阈值独立：gap_x 控制横向（x 接近且 y 相交）、gap_y 控制纵向（y 接近且 x 相交）。
    """
    if (gap_x < 0 or gap_y < 0) or len(blocks) < 2:
        return blocks
    W, H = img.size
    mask, rw, rh = build_mask(img, 0, 0, W - 1, H - 1, alpha_th)
    work = [dict(b) for b in blocks]
    changed = True
    while changed:
        changed = False
        for i in range(len(work)):
            for j in range(i + 1, len(work)):
                a, b = work[i], work[j]
                if rects_mergeable(a, b, gap_x, gap_y):
                    nx0 = min(a["x0"], b["x0"]); nx1 = max(a["x1"], b["x1"])
                    ny0 = min(a["y0"], b["y0"]); ny1 = max(a["y1"], b["y1"])
                    npx = count_foreground(img, mask, nx0, ny0, nx1, ny1)
                    merged = {
                        "index": a["index"],
                        "x0": nx0, "x1": nx1, "y0": ny0, "y1": ny1,
                        "px": npx, "w": nx1 - nx0 + 1, "h": ny1 - ny0 + 1,
                    }
                    work[i] = merged
                    work.pop(j)
                    changed = True
                    break
            if changed:
                break
    work.sort(key=lambda c: (c["y0"], c["x0"]))
    for k, b in enumerate(work, 1):
        b["index"] = k
    return work


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>UI 元素地图 — __TITLE__</title>
<style>
  :root { --panel:#f6f7f9; --line:#d8dce3; --accent:#c98a00; }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
               background:#eef0f3; color:#222; }
  #toolbar { position:sticky; top:0; z-index:10; display:flex; flex-wrap:wrap; gap:8px 16px;
             align-items:center; padding:8px 14px; background:#fff; border-bottom:1px solid var(--line); }
  #toolbar b { font-size:14px; }
  #toolbar label { display:flex; align-items:center; gap:5px; white-space:nowrap; }
  #toolbar input[type=range] { width:130px; }
  .btn { padding:4px 12px; border:1px solid var(--line); border-radius:4px; background:#fff;
         cursor:pointer; }
  .btn:hover { background:#f0f2f5; }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.primary:hover { filter:brightness(1.08); }
  #stat { color:#666; }
  #main { display:flex; }
  #stage-wrap { flex:1; overflow:auto; padding:12px; }
  #stage { position:relative; display:inline-block; }
  canvas { display:block; border:1px solid var(--line); background:
           repeating-conic-gradient(#fff 0 25%, #f0f0f0 0 50%) 0 0/16px 16px; }
  #tip { position:absolute; pointer-events:none; display:none; background:rgba(20,24,32,.92);
         color:#fff; padding:6px 9px; border-radius:5px; font:12px/1.5 ui-monospace,Menlo,monospace;
         white-space:pre; z-index:20; max-width:340px; }
  #side { width:330px; min-width:330px; border-left:1px solid var(--line); background:#fff;
          display:flex; flex-direction:column; height:calc(100vh - 46px); position:sticky; top:46px; }
  #side-head { padding:8px 12px; border-bottom:1px solid var(--line); font-weight:600; }
  #list { flex:1; overflow:auto; padding:4px 0; }
  .row { display:flex; align-items:center; gap:8px; padding:3px 12px; cursor:default; }
  .row:hover { background:#f2f5f9; }
  .row.hover { background:#e8effa; }
  .row.sel { background:#fff6e0; }
  .row input { margin:0; }
  .row .no { color:#8a94a3; font-family:ui-monospace,Menlo,monospace; width:34px; flex:none; }
  .row .meta { flex:1; font-family:ui-monospace,Menlo,monospace; font-size:12px; color:#333;
               white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .px { color:#98a1b0; font-size:11px; }
  #foot { padding:8px 12px; border-top:1px solid var(--line); font-size:12px; color:#666; }
  .legend { display:inline-flex; align-items:center; gap:4px; margin-right:10px; }
  .sw { display:inline-block; width:10px; height:10px; border:1.5px solid; }
</style>
</head>
<body>
<div id="toolbar">
  <b>UI 元素地图</b>
  <span id="stat"></span>
  <label>最小面积
    <input type="range" id="minpx" min="0" max="20000" step="100" value="__MINPX__">
    <span id="minpxv"></span>
  </label>
  <label><input type="checkbox" id="onlysel"> 只显示选中</label>
  <button class="btn" id="clear">清空选中</button>
  <button class="btn primary" id="export">导出选中 JSON</button>
  <span class="legend"><span class="sw" style="border-color:#e07b00"></span>大块 ≥100k px</span>
  <span class="legend"><span class="sw" style="border-color:#1f7ad6"></span>中块 ≥3k px</span>
  <span class="legend"><span class="sw" style="border-color:#2ba85a"></span>小块 ≥500 px</span>
  <span class="legend"><span class="sw" style="border-color:#9aa2ad"></span>更小</span>
</div>
<div id="main">
  <div id="stage-wrap">
    <div id="stage">
      <canvas id="cv"></canvas>
      <div id="tip"></div>
    </div>
    <img id="srcimg" src="__IMGSRC__" style="display:none" alt="">
  </div>
  <div id="side">
    <div id="side-head">连通块清单 <span id="listcount"></span></div>
    <div id="list"></div>
    <div id="foot">悬停图上块查看详情；点击选中/取消；点击列表行定位。</div>
  </div>
</div>
<script>
const DATA = __DATA__;
const img = document.getElementById('srcimg');

const W = DATA.size.w, H = DATA.size.h;
const blocks = DATA.blocks;               // [{index,x0,x1,y0,y1,px,w,h}]
let minPx = DATA.min_px;
const selected = new Set();               // block index
let hovered = null;                       // block index（列表定位/悬停）

const canvas = document.getElementById('cv');
const ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;

const stage = document.getElementById('stage');
const tip = document.getElementById('tip');

// 原图离屏缓存，重绘时作为底图
const base = document.createElement('canvas');
base.width = W; base.height = H;
const bctx = base.getContext('2d');

img.onload = () => { bctx.drawImage(img, 0, 0); draw(); };

function colorOf(b) {
  if (b.px >= 100000) return { fill:'rgba(224,123,0,.10)', stroke:'#e07b00' };
  if (b.px >= 3000)   return { fill:'rgba(31,122,214,.10)', stroke:'#1f7ad6' };
  if (b.px >= 500)    return { fill:'rgba(43,168,90,.10)',  stroke:'#2ba85a' };
  return { fill:'rgba(154,162,173,.08)', stroke:'#9aa2ad' };
}

function visibleBlocks() {
  return blocks.filter(b =>
    b.px >= minPx && (!document.getElementById('onlysel').checked || selected.has(b.index)));
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (img.complete) ctx.drawImage(base, 0, 0);
  for (const b of visibleBlocks()) {
    const c = colorOf(b);
    ctx.fillStyle = c.fill;
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 1;
    const x = b.x0, y = b.y0, w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    if (b.index === hovered || selected.has(b.index)) {
      ctx.strokeStyle = '#c98a00';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    }
  }
}

function stagePoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * W / r.width,
    y: (e.clientY - r.top) * H / r.height,
  };
}

function blockAt(x, y) {
  for (const b of visibleBlocks()) {
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b;
  }
  return null;
}

canvas.addEventListener('mousemove', e => {
  const p = stagePoint(e);
  const b = blockAt(p.x, p.y);
  if (b) {
    tip.style.display = 'block';
    tip.style.left = (e.clientX - stage.getBoundingClientRect().left + 14) + 'px';
    tip.style.top = (e.clientY - stage.getBoundingClientRect().top + 14) + 'px';
    tip.textContent = `#${b.index}   x=${b.x0}..${b.x1}  y=${b.y0}..${b.y1}\n` +
      `${b.w}×${b.h}   px=${b.px}`;
  } else {
    tip.style.display = 'none';
  }
  const prev = hovered;
  hovered = b ? b.index : null;
  if (prev !== hovered) draw();
});
canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; hovered = null; draw(); });
canvas.addEventListener('click', e => {
  const p = stagePoint(e);
  const b = blockAt(p.x, p.y);
  if (!b) return;
  if (selected.has(b.index)) selected.delete(b.index); else selected.add(b.index);
  draw(); renderList();
});

function renderList() {
  const list = document.getElementById('list');
  const only = document.getElementById('onlysel').checked;
  const items = blocks.filter(b => b.px >= minPx && (!only || selected.has(b.index)))
                      .slice().sort((a, b) => b.px - a.px);
  document.getElementById('listcount').textContent = `（${items.length}）`;
  list.innerHTML = '';
  for (const b of items) {
    const row = document.createElement('div');
    row.className = 'row' + (selected.has(b.index) ? ' sel' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(b.index);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(b.index); else selected.delete(b.index);
      draw(); renderList();
    });
    const no = document.createElement('span'); no.className = 'no'; no.textContent = '#' + b.index;
    const meta = document.createElement('span'); meta.className = 'meta';
    meta.textContent = `${b.w}×${b.h}  x=${b.x0}..${b.x1} y=${b.y0}..${b.y1}`;
    const px = document.createElement('span'); px.className = 'px'; px.textContent = b.px;
    row.append(cb, no, meta, px);
    row.addEventListener('mouseenter', () => { hovered = b.index; draw(); });
    row.addEventListener('mouseleave', () => { hovered = null; draw(); });
    row.addEventListener('click', e => {
      if (e.target === cb) return;
      if (selected.has(b.index)) selected.delete(b.index); else selected.add(b.index);
      draw(); renderList();
    });
    list.appendChild(row);
  }
}

const minpxEl = document.getElementById('minpx');
const minpxv = document.getElementById('minpxv');
function syncMin() { minPx = +minpxEl.value; minpxv.textContent = minPx; draw(); renderList(); }
minpxEl.addEventListener('input', syncMin);

document.getElementById('onlysel').addEventListener('change', () => { draw(); renderList(); });
document.getElementById('clear').addEventListener('click', () => { selected.clear(); draw(); renderList(); });
document.getElementById('export').addEventListener('click', () => {
  const items = blocks.filter(b => selected.has(b.index));
  const out = {
    png: DATA.png, size: DATA.size, alpha: DATA.alpha, min_px: DATA.min_px,
    selected_count: items.length,
    components: items.map(b => ({ index: b.index, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1,
                                  w: b.w, h: b.h, px: b.px })),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (DATA.png.replace(/\.png$/i, '') || 'map') + '_selected.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

syncMin();
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description="连通块全图扫描并生成 UI 元素地图 HTML")
    ap.add_argument("png", help="PNG 文件路径")
    ap.add_argument("--alpha", type=int, default=128, help="alpha 阈值（默认 128）")
    ap.add_argument("--min-px", type=int, default=300, help="最小像素数过滤（默认 300）")
    ap.add_argument("--merge-gap", type=int, default=0,
                    help="自动合并阈值（同时设置横纵）：一个维度重叠或间隔≤该值、另一维度相交的两个块合并"
                         "为大矩形（默认 0 = 仅重叠/相交才合并；原图连通块只扫一次，合并迭代进行）")
    ap.add_argument("--merge-gap-x", type=int, default=None,
                    help="横向合并阈值（x 轴重叠或间隔≤该值且 y 轴相交时合并；缺省用 --merge-gap）")
    ap.add_argument("--merge-gap-y", type=int, default=None,
                    help="纵向合并阈值（y 轴重叠或间隔≤该值且 x 轴相交时合并；缺省用 --merge-gap）")
    ap.add_argument("--out", default=None, help="输出 HTML 路径")
    ap.add_argument("--json-only", default=None, help="只输出块数据 JSON（调试）")
    args = ap.parse_args()

    gap_x = args.merge_gap_x if args.merge_gap_x is not None else args.merge_gap
    gap_y = args.merge_gap_y if args.merge_gap_y is not None else args.merge_gap

    img = Image.open(args.png)
    W, H = img.size
    blocks = scan_all(img, args.alpha, args.min_px)
    if gap_x > 0 or gap_y > 0:
        blocks = merge_blocks(img, args.alpha, blocks, gap_x, gap_y)
    print(f"[uimap] {args.png} {W}×{H} alpha>={args.alpha} 连通块={len(blocks)}"
          + (f" (merge-gap-x={gap_x}, merge-gap-y={gap_y})" if gap_x > 0 or gap_y > 0 else ""))

    data = {
        "png": os.path.basename(args.png),
        "size": {"w": W, "h": H},
        "alpha": args.alpha,
        "min_px": args.min_px,
        "merge_gap_x": gap_x,
        "merge_gap_y": gap_y,
        "blocks": blocks,
    }

    if args.json_only:
        with open(args.json_only, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[uimap] JSON 已写入: {args.json_only}")
        return

    # 内嵌图片
    with open(args.png, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")

    html = (HTML_TEMPLATE
            .replace("__TITLE__", data["png"])
            .replace("__MINPX__", str(args.min_px))
            .replace("__DATA__", json.dumps(data, ensure_ascii=False))
            .replace("__IMGSRC__", "data:image/png;base64," + b64))

    out = args.out
    if not out:
        out = os.path.splitext(args.png)[0] + "_blocks.html"
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"[uimap] 已生成: {out}（{len(html) / 1024:.0f} KB）")
    print(f"[uimap] 浏览器打开该 HTML 即可交互；悬停查看详情，点击选中，导出选中 JSON。")


if __name__ == "__main__":
    main()
