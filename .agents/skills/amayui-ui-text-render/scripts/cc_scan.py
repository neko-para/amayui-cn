#!/usr/bin/env python3
"""连通块扫描工具（供 amayui-ui-text-render 技能优化使用）

输入一个 PNG 与矩形范围，输出范围内所有"透明度非 0"（可设阈值）的连通块信息：
编号、x/y 范围、宽高、像素数。默认按 4 邻接，可用 --diag 改用 8 邻接。

用法:
  python cc_scan.py <png> [--x0 N] [--y0 N] [--x1 N] [--y1 N]
                     [--alpha N] [--min-px N] [--diag] [--json 输出.json]
                     [--query-x N --query-y N]

坐标说明:
  --x0/--y0/--x1/--y1 为闭区间（含端点），缺省时扫描整图。
  输出坐标为 PNG 内的绝对像素坐标。

查询模式:
  同时给出 --query-x 与 --query-y 时，只输出该坐标所属连通块的矩形范围
  （坐标需在扫描范围内，且该点 alpha 不低于阈值）。
"""

import argparse
import json
import sys
from collections import deque

from PIL import Image


def scan(img, x0, y0, x1, y1, alpha_th, diag, min_px):
    """返回连通块列表，每项为 (minx, maxx, miny, maxy, px)。"""
    W, H = img.size
    x0 = max(0, min(x0, W - 1))
    x1 = min(W - 1, max(x1, 0))
    y0 = max(0, min(y0, H - 1))
    y1 = min(H - 1, max(y1, 0))
    if x0 > x1 or y0 > y1:
        return []

    rw = x1 - x0 + 1
    rh = y1 - y0 + 1

    # 按 alpha 阈值构建范围掩码（1 = 前景）
    mask, rw, rh = build_mask(img, x0, y0, x1, y1, alpha_th)

    # 邻接方向（4 或 8 邻接）
    if diag:
        nbrs = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
    else:
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
                comps.append((minx + x0, maxx + x0, miny + y0, maxy + y0, n))
    return comps


def build_mask(img, x0, y0, x1, y1, alpha_th):
    """构建范围内 alpha 掩码，返回 (mask, rw, rh)。"""
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


def query_component(img, x0, y0, x1, y1, qx, qy, alpha_th, diag):
    """查询 (qx,qy) 所属连通块的 bbox；若该点非前景返回 None。"""
    mask, rw, rh = build_mask(img, x0, y0, x1, y1, alpha_th)
    lx, ly = qx - x0, qy - y0
    if not (0 <= lx < rw and 0 <= ly < rh) or not mask[ly * rw + lx]:
        return None

    if diag:
        nbrs = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
    else:
        nbrs = ((1, 0), (-1, 0), (0, 1), (0, -1))

    seen = bytearray(rw * rh)
    q = deque([(lx, ly)])
    seen[ly * rw + lx] = 1
    minx = maxx = lx
    miny = maxy = ly
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
    return (minx + x0, maxx + x0, miny + y0, maxy + y0, n)


def main():
    ap = argparse.ArgumentParser(description="PNG 指定范围内连通块扫描")
    ap.add_argument("png", help="PNG 文件路径")
    ap.add_argument("--x0", type=int, default=None)
    ap.add_argument("--y0", type=int, default=None)
    ap.add_argument("--x1", type=int, default=None)
    ap.add_argument("--y1", type=int, default=None)
    ap.add_argument("--alpha", type=int, default=1, help="alpha 阈值（默认 1，即非 0 即算）")
    ap.add_argument("--min-px", type=int, default=0, help="过滤像素数小于该值的连通块")
    ap.add_argument("--diag", action="store_true", help="使用 8 邻接（默认 4 邻接）")
    ap.add_argument("--json", default=None, help="可选：把结果写入 JSON 文件")
    ap.add_argument("--query-x", type=int, default=None, help="查询模式：坐标 x")
    ap.add_argument("--query-y", type=int, default=None, help="查询模式：坐标 y")
    args = ap.parse_args()

    if (args.query_x is None) != (args.query_y is None):
        ap.error("--query-x 与 --query-y 必须同时给出")

    img = Image.open(args.png)
    W, H = img.size
    x0 = args.x0 if args.x0 is not None else 0
    y0 = args.y0 if args.y0 is not None else 0
    x1 = args.x1 if args.x1 is not None else W - 1
    y1 = args.y1 if args.y1 is not None else H - 1

    if args.query_x is not None:
        qx, qy = args.query_x, args.query_y
        if not (x0 <= qx <= x1 and y0 <= qy <= y1):
            print(f"[cc-scan] 查询点 ({qx},{qy}) 不在扫描范围 x=[{x0},{x1}] y=[{y0},{y1}] 内")
            sys.exit(1)
        comp = query_component(img, x0, y0, x1, y1, qx, qy, args.alpha, args.diag)
        if comp is None:
            print(f"[cc-scan] 查询点 ({qx},{qy}) alpha < {args.alpha}，不属于任何连通块")
            sys.exit(1)
        minx, maxx, miny, maxy, n = comp
        print(f"[cc-scan] 查询点 ({qx},{qy}) 属于连通块: "
              f"x=[{minx},{maxx}] y=[{miny},{maxy}] "
              f"w={maxx - minx + 1} h={maxy - miny + 1} px={n}")
        if args.json:
            out = {
                "png": args.png,
                "range": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
                "query": {"x": qx, "y": qy},
                "alpha": args.alpha,
                "diag": args.diag,
                "component": {"x0": minx, "x1": maxx, "y0": miny, "y1": maxy, "px": n},
            }
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, indent=2)
            print(f"[cc-scan] JSON 已写入: {args.json}")
        sys.exit(0)

    comps = scan(img, x0, y0, x1, y1, args.alpha, args.diag, args.min_px)
    comps.sort(key=lambda c: (c[2], c[0]))  # 从上到下、从左到右

    conn = "8 邻接" if args.diag else "4 邻接"
    print(f"[cc-scan] {args.png} 范围 x=[{x0},{x1}] y=[{y0},{y1}] "
          f"alpha>={args.alpha} {conn} 连通块数={len(comps)}")
    for i, (minx, maxx, miny, maxy, n) in enumerate(comps, 1):
        print(f"  {i:2d}: x=[{minx},{maxx}] y=[{miny},{maxy}] "
              f"w={maxx - minx + 1:3d} h={maxy - miny + 1:3d} px={n}")

    if args.json:
        out = {
            "png": args.png,
            "range": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
            "alpha": args.alpha,
            "diag": args.diag,
            "count": len(comps),
            "components": [
                {"index": i, "x0": c[0], "x1": c[1], "y0": c[2], "y1": c[3], "px": c[4]}
                for i, c in enumerate(comps, 1)
            ],
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"[cc-scan] JSON 已写入: {args.json}")


if __name__ == "__main__":
    main()
