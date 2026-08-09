"""清理图片指定区域（像素置透明）。

用法:
  python clean_text_area.py <PNG> <OUT> --x0 X --y0 Y --x1 X --y1 Y [--expand 5]
"""
import argparse
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("out")
    ap.add_argument("--x0", type=int, required=True)
    ap.add_argument("--y0", type=int, required=True)
    ap.add_argument("--x1", type=int, required=True)
    ap.add_argument("--y1", type=int, required=True)
    ap.add_argument("--expand", type=int, default=5)
    args = ap.parse_args()

    img = Image.open(args.png).convert("RGBA")
    px = img.load()
    W, H = img.size
    x0 = max(0, args.x0 - args.expand)
    y0 = max(0, args.y0 - args.expand)
    x1 = min(W, args.x1 + args.expand)
    y1 = min(H, args.y1 + args.expand)

    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 0)

    img.save(args.out)
    print(f"saved {args.out} 清理区域 x {x0}-{x1} / y {y0}-{y1}（含 {args.expand}px 扩边）")


if __name__ == "__main__":
    main()
