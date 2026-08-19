#!/usr/bin/env python3
"""UI 文字区域清理执行器（工具 B 的最终清理引擎）。

把「列填充法」与「跨图贴底图」做成可复现命令，供清理工作台导出的方案 JSON 直接衔接，
也兼容现有 `clean_text_area.py` 的透明清理。

用法（一个命令 = 一种清理操作，可多次调用合成一张图）:
  python clean_fill.py <png> <out> --x0 X --y0 Y --x1 X --y1 Y [选项]

选项:
  --keep-l N        列填充：左侧保留 N px（不动的干净带），默认 15
  --fill-col N      列填充：复制的列（绝对 x 坐标），默认 x0+keep-l（即第 keep-l+1 列）
  --transparent     置透明模式（兼容 clean_text_area.py，替代 --keep-l）
  --paste-src SRC --paste-x0 X --paste-y0 Y --paste-x1 X --paste-y1 Y
                    从另一张图 SRC 的 (paste-x0..paste-x1, paste-y0..paste-y1) 区域
                    整块粘贴到本图 (x0..x1, y0..y1)（跨图/跨块贴底图，SO020 关闭菜单模式）
  --restore-x0 --restore-y0 --restore-x1 --restore-y1
                    从 <png> 自身恢复该区域（覆盖粘贴/填充的结果，用于复杂拼接的局部还原）
  --alpha-th N      前景判定阈值（仅统计用），默认 128

列填充语义（与 docs 中已确认规则一致）:
  - 区域左边缘保留 x0..x0+keep-l-1 不变；
  - 区域右边缘保留 x1-keep-l+1..x1 不变（keep-l 也作为右保留宽度）；
  - 中间每一行复制 fill-col 那一列的像素（纯色底/渐变底均适用：渐变底逐行复制保留每行渐变值）。

示例:
  # 纯色底按钮（SO020 上半，142×20）: 保留左右 15px，复制第 16px 列
  python clean_fill.py res/SO020.png out.png --x0 1006 --y0 6 --x1 1147 --y1 25 --keep-l 15
  # 渐变底按钮（SO020 下半，150×28）: 保留左右 20px，复制第 21px 列
  python clean_fill.py res/SO020.png out.png --x0 1002 --y0 240 --x1 1151 --y1 267 --keep-l 20
  # 跨图贴底图（SO020 关闭菜单）：从 SO021 干净块贴到 (1113,602)
  python clean_fill.py res/SO020.png out.png --x0 1113 --y0 602 --x1 1266 --y1 649 \
      --paste-src res/SO021.png --paste-x0 660 --paste-y0 749 --paste-x1 813 --paste-y1 796
"""
import argparse
from PIL import Image


def load_rgba(path):
    img = Image.open(path)
    return img.convert("RGBA"), img.size


def fill_columns(img, x0, y0, x1, y1, keep_l, fill_col):
    """列填充：中间区域每行复制 fill_col 列的像素。"""
    px = img.load()
    W, H = img.size
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(W - 1, x1); y1 = min(H - 1, y1)
    keep_l = max(0, min(keep_l, (x1 - x0 + 1) // 2))
    for y in range(y0, y1 + 1):
        src = px[fill_col, y]
        for x in range(x0 + keep_l, x1 - keep_l + 1):
            px[x, y] = src
    return img


def make_transparent(img, x0, y0, x1, y1):
    px = img.load()
    W, H = img.size
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(W - 1, x1); y1 = min(H - 1, y1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 0)
    return img


def paste_region(img, src_img, x0, y0, x1, y1, sx0, sy0, sx1, sy1):
    """从 src_img 的 (sx0..sx1, sy0..sy1) 区域缩放/直接拷贝到目标区域。"""
    region = src_img.crop((sx0, sy0, sx1 + 1, sy1 + 1))
    region = region.resize((x1 - x0 + 1, y1 - y0 + 1), Image.LANCZOS)
    img.paste(region, (x0, y0))
    return img


def restore_region(img, orig, x0, y0, x1, y1):
    px = img.load()
    opx = orig.load()
    W, H = img.size
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(W - 1, x1); y1 = min(H - 1, y1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px[x, y] = opx[x, y]
    return img


def main():
    ap = argparse.ArgumentParser(description="UI 文字区域清理执行器（列填充/透明/跨图贴底图）")
    ap.add_argument("png", help="输入 PNG 路径")
    ap.add_argument("out", help="输出 PNG 路径")
    ap.add_argument("--x0", type=int, required=True)
    ap.add_argument("--y0", type=int, required=True)
    ap.add_argument("--x1", type=int, required=True)
    ap.add_argument("--y1", type=int, required=True)
    ap.add_argument("--keep-l", type=int, default=15, help="列填充：左/右保留宽度（默认 15）")
    ap.add_argument("--fill-col", type=int, default=None, help="列填充：复制列（绝对 x；默认 x0+keep-l）")
    ap.add_argument("--transparent", action="store_true", help="置透明模式（兼容 clean_text_area.py）")
    ap.add_argument("--paste-src", default=None, help="跨图贴底图：来源图路径")
    ap.add_argument("--paste-x0", type=int, default=None)
    ap.add_argument("--paste-y0", type=int, default=None)
    ap.add_argument("--paste-x1", type=int, default=None)
    ap.add_argument("--paste-y1", type=int, default=None)
    ap.add_argument("--restore-x0", type=int, default=None)
    ap.add_argument("--restore-y0", type=int, default=None)
    ap.add_argument("--restore-x1", type=int, default=None)
    ap.add_argument("--restore-y1", type=int, default=None)
    args = ap.parse_args()

    img, _ = load_rgba(args.png)
    orig, _ = load_rgba(args.png)  # 供 restore 使用

    if args.transparent:
        make_transparent(img, args.x0, args.y0, args.x1, args.y1)
    elif args.paste_src:
        if args.paste_x0 is None:
            raise SystemExit("--paste-src 需要 --paste-x0 --paste-y0 --paste-x1 --paste-y1")
        src_img, _ = load_rgba(args.paste_src)
        paste_region(img, src_img, args.x0, args.y0, args.x1, args.y1,
                     args.paste_x0, args.paste_y0, args.paste_x1, args.paste_y1)
    else:
        fill_col = args.fill_col if args.fill_col is not None else args.x0 + args.keep_l
        fill_columns(img, args.x0, args.y0, args.x1, args.y1, args.keep_l, fill_col)

    if args.restore_x0 is not None:
        restore_region(img, orig, args.restore_x0, args.restore_y0, args.restore_x1, args.restore_y1)

    img.save(args.out)
    ops = []
    if args.transparent:
        ops.append("置透明")
    elif args.paste_src:
        ops.append(f"贴底图 {args.paste_src}")
    else:
        ops.append(f"列填充 keep_l={args.keep_l} fill_col={args.fill_col if args.fill_col is not None else args.x0 + args.keep_l}")
    if args.restore_x0 is not None:
        ops.append(f"恢复 ({args.restore_x0},{args.restore_y0})-({args.restore_x1},{args.restore_y1})")
    print(f"saved {args.out}  区域 x {args.x0}-{args.x1} / y {args.y0}-{args.y1}  「{' + '.join(ops)}」")


if __name__ == "__main__":
    main()
