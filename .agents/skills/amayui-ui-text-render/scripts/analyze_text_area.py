"""定位图片中的文字行区域。

用法:
  python analyze_text_area.py <PNG> [--x0 X] [--y0 Y] [--x1 X] [--y1 Y]
                               [--color gold|white|black] [--alpha 160]

输出: 行分段（y 范围/行高）、每行 x 范围、主色 top3、字号建议。
"""
import argparse
from collections import Counter
from PIL import Image


def color_filter(color):
    if color == "gold":
        return lambda r, g, b: r > 180 and g > 120 and b < 230
    if color == "white":
        return lambda r, g, b: r > 190 and g > 190 and b > 190
    if color == "black":
        return lambda r, g, b: r < 60 and g < 60 and b < 60
    raise SystemExit(f"未知 color: {color}")


def segments(proj, min_len, gap):
    segs = []
    start = None
    for i, v in enumerate(proj):
        if v > 0 and start is None:
            start = i
        elif v == 0 and start is not None:
            if i - start >= min_len:
                segs.append([start, i])
            start = None
    if start is not None and len(proj) - start >= min_len:
        segs.append([start, len(proj)])
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] <= gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s[:])
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--x0", type=int, default=0)
    ap.add_argument("--y0", type=int, default=0)
    ap.add_argument("--x1", type=int, default=None)
    ap.add_argument("--y1", type=int, default=None)
    ap.add_argument("--color", default="gold")
    ap.add_argument("--alpha", type=int, default=160)
    args = ap.parse_args()

    img = Image.open(args.png).convert("RGBA")
    W, H = img.size
    px = img.load()
    x1 = args.x1 or W
    y1 = args.y1 or H
    match = color_filter(args.color)

    mask = [[False] * W for _ in range(H)]
    for y in range(args.y0, y1):
        for x in range(args.x0, x1):
            r, g, b, a = px[x, y]
            mask[y][x] = a >= args.alpha and match(r, g, b)

    proj_y = [sum(1 for x in range(args.x0, x1) if mask[y][x]) for y in range(H)]
    rows = segments(proj_y, 2, 5)
    print(f"size={W}x{H} rows={rows}")

    for ri, (y0, y1r) in enumerate(rows):
        proj_x = [sum(1 for y in range(y0, y1r) if mask[y][x]) for x in range(W)]
        cols = segments(proj_x, 2, 4)
        h = y1r - y0
        size = max(round(h / 0.9), 8)  # 行高/字形占 em 比例 → 字号粗估
        c = Counter()
        for y in range(y0, y1r):
            for x in range(args.x0, x1):
                if mask[y][x]:
                    c[(px[x, y][0] // 16 * 16, px[x, y][1] // 16 * 16, px[x, y][2] // 16 * 16)] += 1
        top = [(f"#{r:02X}{g:02X}{b:02X}", n) for (r, g, b), n in c.most_common(3)]
        print(f"row[{ri}] y={y0}-{y1r} h={h} 建议字号≈{size}px x范围={cols} colors={top}")


if __name__ == "__main__":
    main()
