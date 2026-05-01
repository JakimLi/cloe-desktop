#!/usr/bin/env python3
"""
绿幕视频转透明GIF — 两阶段分区抠图方案 (v5)

针对"头发下方仍有透明缝隙"的进一步精简：v4 用 closing 反而会把头发轮廓糊掉，
不如直接靠"激进背景判定 + 极保守前景种子 + dilate + fill_holes"来封闭缝隙。

阶段一：上半部分（y < H * top_ratio，头发 + 头部区域）
  - 背景判定激进：稍带绿就算背景，把绿幕清干净
  - 前景种子极其保守：可疑的全部保留
  - 暗色簇保护（核心）：暗色像素 (R<80,G<80,B<80) 若 3x3 邻域内
    暗色像素数 >= cluster_thresh，则强制为前景；保护头发整体不被零星抠掉
  - **不做 erode**
  - **dilate=9** 吸收边缘 + 把头发缝隙连成封闭区
  - **binary_fill_holes** 填充所有封闭空洞（缝隙变实心 → 透明缝消失）

阶段二：下半部分（y >= H * top_ratio，身体/衣服区域）
  - 沿用标准 HSV 检测 + 中等 dilate（默认 9）
  - 该区域无头发，无缝隙问题

合成：上下两段 mask 拼接 → 整体 fill_holes → 小连通域过滤
     → 去溢色 → 全局调色板量化 → 输出 GIF（抗帧间闪烁）

用法:
  python3 scripts/fix_gif_chromakey.py \
      --video public/gifs/_work_idle/laugh_video.mp4 \
      --output public/gifs/laugh.gif

参数:
  --video         原始视频路径（RGB，未做 chromakey）
  --output        输出 GIF 路径
  --width         目标宽度（默认 400）
  --fps           帧率（默认 10）
  --top-ratio     上半部分比例（默认 0.5）
  --dilate-top    上半部分 dilate kernel（默认 9）
  --dilate-bot    下半部分 dilate kernel（默认 9）
  --erode         erode kernel（默认 1，即不腐蚀）
  --cluster-thresh 暗色簇保护阈值（3x3 邻域内暗色像素数，默认 4）
  --min-blob      最小前景连通域像素数（默认 1000）
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
from scipy import ndimage


def build_dark_cluster_mask(
    R: np.ndarray,
    G: np.ndarray,
    B: np.ndarray,
    rgb_thresh: int = 80,
    kernel: int = 3,
    cluster_thresh: int = 4,
) -> tuple[np.ndarray, np.ndarray]:
    """
    返回 (is_dark_neutral, is_dark_cluster)：
      - is_dark_neutral: 单像素的中性深色（RGB 三通道都 < rgb_thresh）
      - is_dark_cluster: 该深色像素 kernel x kernel 邻域内深色像素数 >= cluster_thresh
        用来保护头发的"成簇深色像素"不被零星抠掉
    """
    is_dark_neutral = (R < rgb_thresh) & (G < rgb_thresh) & (B < rgb_thresh)
    # uniform_filter 求邻域均值，乘以 kernel^2 得到邻域内 True 的总数
    cnt = ndimage.uniform_filter(
        is_dark_neutral.astype(np.float32), size=kernel, mode="reflect"
    ) * (kernel * kernel)
    is_dark_cluster = is_dark_neutral & (cnt >= cluster_thresh)
    return is_dark_neutral, is_dark_cluster


def process_frame(
    rgb: np.ndarray,
    dilate_top: int,
    dilate_bot: int,
    erode_size: int,
    top_ratio: float,
    cluster_thresh: int,
    min_blob: int,
) -> np.ndarray:
    """单帧 RGB → RGBA：上下分区抠图 + 暗色簇保护 + 形态学 + 空洞填充 + 去溢色。"""
    H, W = rgb.shape[:2]
    R = rgb[..., 0].astype(np.int16)
    G = rgb[..., 1].astype(np.int16)
    B = rgb[..., 2].astype(np.int16)
    greenness = G - np.maximum(R, B)

    hsv = np.array(Image.fromarray(rgb).convert("HSV"))
    h = hsv[..., 0].astype(np.int16)
    s = hsv[..., 1].astype(np.int16)
    v = hsv[..., 2].astype(np.int16)

    # 上下分区
    yy = np.arange(H)[:, None]  # (H, 1) → 广播到 (H, W)
    is_top = yy < int(H * top_ratio)

    # 暗色保护（簇）
    is_dark_neutral, is_dark_cluster = build_dark_cluster_mask(
        R, G, B, rgb_thresh=80, kernel=3, cluster_thresh=cluster_thresh
    )

    # ====== 阶段一：上半部分（头发/头部）======
    # 上半部分的"暗色"放宽到 v < 120：头发边缘绿色反光像素 v 普遍 50–110，
    # 都不能轻易判为背景
    is_dark_top = v < 120

    # 上半部分背景判定（宽松激进）：
    #   hue 30–120（宽）, s > 35（饱和度阈值低）, greenness >= 2（轻微绿色就算）
    # 但有强保护：is_dark_top / is_dark_cluster 的像素绝不算背景
    is_bg_top = (
        (h >= 30) & (h <= 120) &
        (s > 35) &
        (greenness >= 2) &
        (~is_dark_top) &
        (~is_dark_cluster)
    )

    # 上半部分前景种子（保守宽松）：
    #   - greenness <= 8 都算前景候选（容忍较多绿色反光发丝）
    #   - 暗色中性 / 暗色簇 强制前景
    fg_seed_top = ((greenness <= 8) & (v > 10)) | is_dark_neutral | is_dark_cluster
    fg_seed_top = fg_seed_top & (~is_bg_top)

    # ====== 阶段二：下半部分（身体/衣服）======
    is_dark_bot = v < 80
    is_bg_bot = (
        (h >= 35) & (h <= 110) &
        (s > 60) &
        (greenness > 5) &
        (~is_dark_bot)
    )
    fg_seed_bot = (greenness <= 2) & (v > 25)
    fg_seed_bot = (fg_seed_bot | is_dark_neutral) & (~is_bg_bot)

    # ====== 合并初始 mask ======
    is_fg_seed = np.where(is_top, fg_seed_top, fg_seed_bot)

    # 形态学：可选 erode（一般不开）
    fg_pil = Image.fromarray((is_fg_seed * 255).astype(np.uint8), "L")
    if erode_size >= 3 and erode_size % 2 == 1:
        fg_pil = fg_pil.filter(ImageFilter.MinFilter(size=erode_size))
    seed_arr = np.array(fg_pil) > 128

    # 上半部分：dilate（吸收边缘 + 把头发缝隙连成封闭区）→ fill_holes
    if dilate_top >= 3 and dilate_top % 2 == 1:
        top_arr = np.array(
            Image.fromarray((seed_arr * 255).astype(np.uint8), "L")
            .filter(ImageFilter.MaxFilter(size=dilate_top))
        ) > 128
    else:
        top_arr = seed_arr.copy()
    top_arr = ndimage.binary_fill_holes(top_arr)

    # 下半部分：标准 dilate
    if dilate_bot >= 3 and dilate_bot % 2 == 1:
        bot_arr = np.array(
            Image.fromarray((seed_arr * 255).astype(np.uint8), "L")
            .filter(ImageFilter.MaxFilter(size=dilate_bot))
        ) > 128
    else:
        bot_arr = seed_arr.copy()

    # 拼接上下两段
    final_mask = np.where(is_top, top_arr, bot_arr)

    # 整体再 fill_holes（兜底闭合两段交界处可能形成的封闭空洞）
    final_mask = ndimage.binary_fill_holes(final_mask)

    # 小连通域过滤（角标 / 水印 / 噪点）
    if min_blob > 0:
        labeled, n_comp = ndimage.label(final_mask)
        if n_comp > 1:
            sizes = ndimage.sum(final_mask, labeled, range(1, n_comp + 1))
            keep = np.zeros(n_comp + 1, dtype=bool)
            keep[1:] = sizes >= min_blob
            final_mask = keep[labeled]

    # 去溢色：前景内 G 偏高（绿幕反光）时钳制到 (R+B)/2
    rgb_clean = rgb.copy()
    avg_rb = ((R + B) // 2).clip(0, 255).astype(np.int16)
    needs_despill = final_mask & (greenness > 0)
    rgb_clean[..., 1] = np.where(needs_despill, np.minimum(G, avg_rb), G).astype(np.uint8)

    # Alpha：mask 内 255 / 外 0 → 轻羽化 → 二值化（GIF 只支持二值透明）
    alpha = np.where(final_mask, 255, 0).astype(np.uint8)
    alpha_pil = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(radius=0.7))
    alpha = np.array(alpha_pil)
    alpha[alpha < 80] = 0
    alpha[alpha >= 80] = 255

    rgba = np.dstack([rgb_clean, alpha]).astype(np.uint8)
    return rgba


def main():
    parser = argparse.ArgumentParser(
        description="绿幕视频转透明 GIF（两阶段分区 + 暗色簇保护 + 抗闪烁）"
    )
    parser.add_argument("--video", required=True, help="原始视频路径")
    parser.add_argument("--output", required=True, help="输出 GIF 路径")
    parser.add_argument("--width", type=int, default=400, help="目标宽度（默认 400）")
    parser.add_argument("--fps", type=int, default=10, help="帧率（默认 10）")
    parser.add_argument("--top-ratio", type=float, default=0.5,
                        help="上半部分比例（默认 0.5）")
    parser.add_argument("--dilate-top", type=int, default=9,
                        help="上半部分 dilate kernel（默认 9）")
    parser.add_argument("--dilate-bot", type=int, default=9,
                        help="下半部分 dilate kernel（默认 9）")
    parser.add_argument("--erode", type=int, default=1,
                        help="erode kernel（默认 1=不腐蚀）")
    parser.add_argument("--cluster-thresh", type=int, default=4,
                        help="暗色簇保护阈值：3x3 邻域内暗色像素数（默认 4）")
    parser.add_argument("--min-blob", type=int, default=1000,
                        help="最小前景连通域像素数（默认 1000）")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        print(f"Error: video not found: {args.video}", file=sys.stderr)
        sys.exit(1)

    tmp = tempfile.mkdtemp(prefix="gif_fix_")
    print(f"[tmp] {tmp}")

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

    print("[process] running per-frame two-stage chromakey...")
    processed = []
    for i, fp in enumerate(frame_files):
        if i % 10 == 0:
            print(f"  frame {i}/{len(frame_files)}")
        img = Image.open(fp).convert("RGB")
        rgba = process_frame(
            np.array(img),
            args.dilate_top,
            args.dilate_bot,
            args.erode,
            args.top_ratio,
            args.cluster_thresh,
            args.min_blob,
        )
        processed.append(Image.fromarray(rgba, "RGBA"))

    # 全局调色板（消除帧间调色板抖动）
    print("[palette] building global palette across all frames...")
    W, H = processed[0].size
    strip = Image.new("RGB", (W, H * len(processed)), (0, 0, 0))
    for i, rgba in enumerate(processed):
        strip.paste(rgba.convert("RGB"), (0, i * H))

    master = strip.quantize(
        colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    )
    master_palette = master.getpalette()[: 255 * 3]
    # index 255 = 透明专用槽。颜色用一个"前景里不会出现的"奇异色（亮品红），
    # 避免黑头发等深色前景被量化器映射到 index 255 而被误透明。
    # 渲染时该槽被 transparency 跳过，所以颜色只是占位。
    master_palette += [255, 0, 255]

    pal_template = Image.new("P", (1, 1))
    pal_template.putpalette(master_palette)

    print("[quantize] mapping frames to global palette...")
    p_frames = []
    for rgba in processed:
        q = rgba.convert("RGB").quantize(
            palette=pal_template, dither=Image.Dither.NONE
        )
        arr = np.array(q)
        alpha = np.array(rgba)[..., 3]
        # 兜底：任何前景像素若被量化器误映射到 index 255（透明槽），
        # 重新映射到 254（调色板里最后一个真实颜色，肉眼几乎不可见）
        fg_mask = alpha >= 128
        misrouted = fg_mask & (arr == 255)
        if misrouted.any():
            arr[misrouted] = 254
        # 透明区域统一映射到 index 255
        arr[~fg_mask] = 255
        p_img = Image.fromarray(arr, "P")
        p_img.putpalette(master_palette)
        p_frames.append(p_img)

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
