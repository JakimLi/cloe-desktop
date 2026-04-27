#!/usr/bin/env python3
"""
cloe-desktop GIF 生成脚本

从绿背景参考图一键生成透明背景 GIF，用于桌面小组件动画。

用法:
  python3 generate_gif.py --action kiss --prompt "她缓缓嘟起嘴唇，做出可爱的飞吻动作" --duration 5
  python3 generate_gif.py --action wave --prompt "她开心地举起右手挥动打招呼" --duration 5
  python3 generate_gif.py --action nod --prompt "她轻轻点了点头，表示赞同"

参数:
  --action     动作名称，同时用作 GIF 文件名（如 kiss -> kiss.gif）
  --prompt     视频动作描述（中文，描述女孩除了眨眼外的动作）
  --duration   视频时长，默认 5 秒
  --reference  绿背景参考图路径，默认用项目根目录的 reference_upperbody_greenbg.png
  --output     GIF 输出路径，默认 public/gifs/{action}.gif
  --no-copy    不自动复制到 public/gifs/（仅生成到 _work 目录）

流程:
  1. wan2.7-i2v 生成视频（异步）
  2. ffmpeg chromakey + palette → GIF
  3. Python 后处理去绿色光晕 → 透明 GIF
  4. 复制到 public/gifs/
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np
import requests
from PIL import Image
from scipy import ndimage


def get_env(key):
    with open(os.path.expanduser("~/.hermes/.env")) as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.strip().split("=", 1)[1]
    raise ValueError(f"{key} not found in ~/.hermes/.env")


PROJECT_DIR = os.path.expanduser("~/work/cloe-desktop")
WORK_DIR = os.path.join(PROJECT_DIR, "public/gifs/_work_idle")


def generate_video(first_frame_path, prompt, duration=5):
    """用 wan2.7-i2v 生成视频，返回本地视频路径。"""
    with open(first_frame_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    api_key = get_env("BAILIAN_API_KEY")

    media = [{"type": "first_frame", "url": f"data:image/png;base64,{img_b64}"}]
    payload = {
        "model": "wan2.7-i2v",
        "input": {"prompt": prompt, "media": media},
        "parameters": {
            "resolution": "720P",
            "duration": duration,
            "prompt_extend": True,
            "watermark": False,
        },
    }

    # 提交异步任务
    resp = requests.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        },
        json=payload,
        timeout=120,
    )

    if resp.status_code != 200:
        print(f"Error submitting task: {resp.text[:300]}")
        sys.exit(1)

    task_id = resp.json()["output"]["task_id"]
    print(f"Task ID: {task_id}")

    # 轮询等待
    for i in range(60):
        time.sleep(10)
        poll = requests.get(
            f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        status = poll.json()["output"]["task_status"]
        print(f"  [{i+1}] {status}")
        if status == "SUCCEEDED":
            video_url = poll.json()["output"]["video_url"]
            video_bytes = requests.get(video_url, timeout=120).content
            video_path = os.path.join(WORK_DIR, f"{args.action}_video.mp4")
            with open(video_path, "wb") as f:
                f.write(video_bytes)
            print(f"Video saved: {video_path} ({len(video_bytes)} bytes)")
            return video_path
        elif status == "FAILED":
            print(f"FAILED: {poll.json()['output'].get('message')}")
            sys.exit(1)

    print("Timeout waiting for video")
    sys.exit(1)


def video_to_transparent_gif(video_path, output_path):
    """ffmpeg chromakey + Python 去绿色光晕 → 透明 GIF。"""
    raw_gif = os.path.join(WORK_DIR, f"{args.action}_raw.gif")
    palette = os.path.join(WORK_DIR, f"palette_{args.action}.png")

    # Step 1: 生成调色板
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_path,
            "-vf", "chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos,palettegen=stats_mode=diff",
            palette,
        ],
        capture_output=True,
        timeout=60,
    )

    # Step 2: 用调色板生成 GIF
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_path, "-i", palette,
            "-lavfi", "[0:v]chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse",
            "-loop", "0", raw_gif,
        ],
        capture_output=True,
        timeout=60,
    )

    # Step 3: Python 后处理去绿色光晕
    img = Image.open(raw_gif)
    frames = []
    durations = []
    try:
        while True:
            frames.append(img.convert("RGBA"))
            durations.append(img.info.get("duration", 100))
            img.seek(img.tell() + 1)
    except EOFError:
        pass

    processed = []
    for frame in frames:
        arr = np.array(frame, dtype=np.float64)
        r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

        # 强绿色 → 完全透明
        green_mask = (g > 80) & (g - r > 30) & (g - b > 30)
        arr[green_mask, 3] = 0

        # 边缘绿色偏色修正
        alpha_u8 = arr[:, :, 3].astype(np.uint8)
        dilated = ndimage.binary_dilation(alpha_u8 < 128, iterations=2)
        edge_mask = (alpha_u8 >= 128) & dilated
        green_tint = edge_mask & (g > r) & (g > b) & (g - np.maximum(r, b) > 3)
        if green_tint.any():
            target_g = np.maximum(r[green_tint], b[green_tint])
            arr[green_tint, 1] = np.clip(
                g[green_tint] * 0.4 + target_g * 0.6, 0, 255
            ).astype(np.uint8)

        # 更大范围轻微绿色修正
        dilated2 = ndimage.binary_dilation(alpha_u8 < 128, iterations=3)
        remaining = (alpha_u8 >= 128) & dilated2 & (g > r + 5) & (g > b + 5)
        if remaining.any():
            arr[remaining, 1] = np.clip(
                np.minimum(r[remaining], b[remaining]) + 5, 0, 255
            ).astype(np.uint8)

        processed.append(Image.fromarray(arr.astype(np.uint8), "RGBA"))

    processed[0].save(
        output_path,
        save_all=True,
        append_images=processed[1:],
        duration=durations[0],
        loop=0,
        disposal=2,
        optimize=False,
    )

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"GIF saved: {output_path} ({len(processed)} frames, {size_mb:.1f}MB)")


# ===== Main =====
parser = argparse.ArgumentParser(description="Generate transparent GIF for cloe-desktop")
parser.add_argument("--action", required=True, help="Action name (e.g. kiss, wave, nod)")
parser.add_argument("--prompt", required=True, help="Video action prompt in Chinese")
parser.add_argument("--duration", type=int, default=5, help="Video duration in seconds (default: 5)")
parser.add_argument("--reference", default=None, help="Green-bg reference image path")
parser.add_argument("--output", default=None, help="Output GIF path")
parser.add_argument("--no-copy", action="store_true", help="Don't copy to public/gifs/")
args = parser.parse_args()

os.makedirs(WORK_DIR, exist_ok=True)

reference_path = args.reference or os.path.join(PROJECT_DIR, "reference_upperbody_greenbg.png")
gif_path = args.output or os.path.join(WORK_DIR, f"{args.action}.gif")

print(f"=== Generating GIF: {args.action} ===")
print(f"Reference: {reference_path}")
print(f"Prompt: {args.prompt}")

# Step 1: Generate video
print("\n[1/3] Generating video...")
video_path = generate_video(reference_path, args.prompt, args.duration)

# Step 2+3: Chromakey + dehalo → transparent GIF
print(f"\n[2/3] Converting to transparent GIF...")
video_to_transparent_gif(video_path, gif_path)

# Step 4: Copy to public/gifs/
if not args.no_copy:
    public_dir = os.path.join(PROJECT_DIR, "public/gifs")
    public_path = os.path.join(public_dir, f"{args.action}.gif")
    shutil.copy(gif_path, public_path)
    print(f"\n[3/3] Copied to {public_path}")

print(f"\n=== Done! ===")
print(f"Next: add '{args.action}' to GIF_ANIMATIONS in src/renderer.js")
print(f'  1. Add line: {args.action}: \'/gifs/{args.action}.gif\',')
print(f'  2. Add case \'{args.action}\' in handleAction switch')
print(f'  3. curl -s http://localhost:19851/action -d \'{{"action":"{args.action}"}}\' to test')
