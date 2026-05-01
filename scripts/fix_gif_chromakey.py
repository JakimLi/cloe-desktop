#!/usr/bin/env python3
"""
绿幕视频转透明GIF — 抗闪烁方案（Opus 4.7 方法）

完全跳过ffmpeg chromakey，从原始视频帧用HSV+形态学抠图 + 全局统一调色板。
宁可多扣前景边缘，不留背景残留。

用法:
  python3 scripts/fix_gif_chromakey.py --video <video.mp4> --output <output.gif>
  python3 scripts/fix_gif_chromakey.py --video public/gifs/_work_idle/laugh_video.mp4 --output public/gifs/laugh.gif

参数:
  --video   原始视频路径（RGB，未做chromakey的）
  --output  输出GIF路径
  --width   目标宽度（默认400）
  --fps     帧率（默认10）
  --dilate  膨胀kernel大小（默认9，约4px半径）
  --erode   腐蚀kernel大小（默认3，约1px）
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter


def process_frame(rgb: np.ndarray, dilate_size: int, erode_size: int) -> np.ndarray:
    """单帧RGB → RGBA，HSV检测绿色背景 + 形态学 + 去溢色"""
    R = rgb[..., 0].astype(np.int16)
    G = rgb[..., 1].astype(np.int16)
    B = rgb[..., 2].astype(np.int16)

    greenness = G - np.maximum(R, B)

    hsv = np.array(Image.fromarray(rgb).convert("HSV"))
    h = hsv[..., 0].astype(np.int16)
    s = hsv[..., 1].astype(np.int16)
    v = hsv[..., 2].astype(np.int16)

    # 背景：绿色色相带 + 饱和度够 + 绿色占优
    is_bg = (
        (h >= 35) & (h <= 110) &
        (s > 40) &
        (greenness > 10)
    )

    # 前景种子：不绿色占优 + 足够亮 + 非背景
    not_green = greenness <= 2
    bright_enough = v > 25
    is_fg_seed = not_green & bright_enough & (~is_bg)

    # 形态学：腐蚀去噪 → 膨胀吸收边缘
    fg_pil = Image.fromarray((is_fg_seed * 255).astype(np.uint8), "L")
    fg_clean = fg_pil.filter(ImageFilter.MinFilter(size=erode_size))
    fg_grown = fg_clean.filter(ImageFilter.MaxFilter(size=dilate_size))

    final_mask = np.array(fg_grown) > 128

    # 去溢色：前景内G偏高时钳制
    rgb_clean = rgb.copy()
    avg_rb = ((R + B) // 2).clip(0, 255).astype(np.int16)
    needs_despill = final_mask & (greenness > 0)
    rgb_clean[..., 1] = np.where(needs_despill, np.minimum(G, avg_rb), G).astype(np.uint8)

    # Alpha：mask内255/外0 → 羽化 → 二值化（GIF只支持二值透明）
    alpha = np.where(final_mask, 255, 0).astype(np.uint8)
    alpha_pil = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(radius=0.7))
    alpha = np.array(alpha_pil)
    alpha[alpha < 80] = 0
    alpha[alpha >= 80] = 255

    rgba = np.dstack([rgb_clean, alpha]).astype(np.uint8)
    return rgba


def main():
    parser = argparse.ArgumentParser(description="绿幕视频转透明GIF（抗闪烁）")
    parser.add_argument("--video", required=True, help="原始视频路径")
    parser.add_argument("--output", required=True, help="输出GIF路径")
    parser.add_argument("--width", type=int, default=400, help="目标宽度（默认400）")
    parser.add_argument("--fps", type=int, default=10, help="帧率（默认10）")
    parser.add_argument("--dilate", type=int, default=9, help="膨胀kernel大小（默认9）")
    parser.add_argument("--erode", type=int, default=3, help="腐蚀kernel大小（默认3）")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        print(f"Error: video not found: {args.video}", file=sys.stderr)
        sys.exit(1)

    tmp = tempfile.mkdtemp(prefix="gif_fix_")
    print(f"[tmp] {tmp}")

    # 1. ffmpeg提取RGB帧（不做chromakey）
    print("[ffmpeg] extracting frames...")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", args.video,
            "-vf", f"fps={args.fps},scale={args.width}:-1:flags=lanczos",
            "-pix_fmt", "rgb24",
            os.path.join(tmp, "f_%04d.png"),
        ],
        check=True,
    )

    frame_files = sorted(glob.glob(os.path.join(tmp, "f_*.png")))
    print(f"[frames] {len(frame_files)}")

    if not frame_files:
        print("Error: no frames extracted", file=sys.stderr)
        shutil.rmtree(tmp)
        sys.exit(1)

    # 2. 逐帧处理
    print("[process] running per-frame green removal...")
    processed = []
    for i, fp in enumerate(frame_files):
        if i % 10 == 0:
            print(f"  frame {i}/{len(frame_files)}")
        img = Image.open(fp).convert("RGB")
        rgba = process_frame(np.array(img), args.dilate, args.erode)
        processed.append(Image.fromarray(rgba, "RGBA"))

    # 3. 全局调色板（消除帧间调色板抖动）
    print("[palette] building global palette across all frames...")
    W, H = processed[0].size
    strip = Image.new("RGB", (W, H * len(processed)), (0, 0, 0))
    for i, rgba in enumerate(processed):
        strip.paste(rgba.convert("RGB"), (0, i * H))

    master = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    master_palette = master.getpalette()[: 255 * 3]
    master_palette += [0, 0, 0]  # index 255 = transparent

    pal_template = Image.new("P", (1, 1))
    pal_template.putpalette(master_palette)

    # 4. 每帧用全局调色板量化
    print("[quantize] mapping frames to global palette...")
    p_frames = []
    for rgba in processed:
        q = rgba.convert("RGB").quantize(palette=pal_template, dither=Image.Dither.NONE)
        arr = np.array(q)
        alpha = np.array(rgba)[..., 3]
        arr[alpha < 128] = 255  # 透明区域映射到index 255
        p_img = Image.fromarray(arr, "P")
        p_img.putpalette(master_palette)
        p_frames.append(p_img)

    # 5. 保存GIF
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    print(f"[save] writing {args.output}")
    p_frames[0].save(
        args.output,
        save_all=True,
        append_images=p_frames[1:],
        duration=100,
        loop=0,
        disposal=2,
        transparency=255,
        optimize=False,
    )

    shutil.rmtree(tmp)
    size_mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"[done] {args.output} ({len(p_frames)} frames, {size_mb:.1f}MB)")


if __name__ == "__main__":
    main()
