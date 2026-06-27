#!/usr/bin/env python3
"""
cloe-desktop GIF 生成脚本 v2

从参考图一键生成透明背景 GIF，用于桌面小组件动画。
支持绿幕和蓝幕 chromakey，内置 Python 后处理去色晕。

用法:
  # 单个生成（默认绿幕）
  python3 scripts/generate_gif_v2.py --action working \
    --prompt "她双手在键盘上打字" \
    --reference public/gifs/_work_idle/01_green_bg_sitting.png

  # 蓝幕模式
  python3 scripts/generate_gif_v2.py --action wave \
    --prompt "她开心地挥手打招呼" \
    --reference reference_upperbody_bluebg.png \
    --chromakey blue

参数:
  --action       动作名称，同时用作 GIF 文件名（如 working -> working.gif）
  --prompt       视频动作描述（中文）
  --duration     视频时长，默认 5 秒
  --reference    参考图路径（绿幕/蓝幕背景图）
  --output       GIF 输出路径，默认 public/gifs/{action}.gif
  --chromakey    色幕类型: green(默认) 或 blue
  --no-copy      不自动复制到 public/gifs/
  --work-dir     中间文件目录，默认 public/gifs/_work_{action}

流程:
  1. 压缩参考图（如果 > 4MB）以适配 API
  2. wan2.7-i2v 生成视频（异步轮询）
  3. ffmpeg chromakey + palette → GIF
  4. Python 后处理去色晕 → 透明 GIF
  5. 复制到 public/gifs/
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
    val = os.environ.get(key)
    if val:
        return val.strip()
    with open(os.path.expanduser("~/.hermes/.env")) as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.strip().split("=", 1)[1]
    raise ValueError(f"{key} not found in ~/.hermes/.env")


# Chromakey 配置
CHROMAKEY_CONFIG = {
    "green": {
        "hex": "0x00FF00",
        # HSV/hue range for strong key
        "color_high": 80,      # g > 80
        "diff_r": 30,          # g - r > 30
        "diff_b": 30,          # g - b > 30
        # Edge detection thresholds
        "edge_diff": 3,        # g - max(r,b) > 3
    },
    "blue": {
        "hex": "0x0000FF",
        "color_high": 80,
        "diff_r": 30,
        "diff_b": 30,
        "edge_diff": 3,
    },
}

CLOE_DATA_DIR = os.path.expanduser("~/.cloe")


def compress_image(path, max_size_mb=4):
    """如果图片大于 max_size_mb，压缩并缩放长边到1920px（保持角色清晰度），返回(路径, 是否临时文件)。"""
    size_mb = os.path.getsize(path) / 1024 / 1024
    if size_mb <= max_size_mb:
        return path, False

    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp_path = tmp.name
    tmp.close()

    img = Image.open(path)
    # 缩放到长边 1920（pad后图更大，需要更高分辨率保持角色清晰）
    w, h = img.size
    if max(w, h) > 1920:
        ratio = 1920 / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    img.save(tmp_path, "PNG", optimize=True)
    new_size = os.path.getsize(tmp_path) / 1024 / 1024
    print(f"  压缩: {size_mb:.1f}MB → {new_size:.1f}MB ({tmp_path})")
    return tmp_path, True


def convert_chroma_color(img_path, from_chroma="green", to_chroma="blue"):
    """将参考图的背景色幕从一种颜色转换成另一种（如绿幕→蓝幕）。
    解决：参考图是绿幕但需要用蓝幕生成（绿幕触发百炼内容审查）。
    返回转换后的图片路径（临时文件）。
    """
    if from_chroma == to_chroma:
        return img_path, False

    import numpy as np

    img = Image.open(img_path).convert("RGB")
    arr = np.array(img, dtype=np.uint8)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    if from_chroma == "green":
        # 检测绿色背景：g 明显大于 r 和 b
        mask = (g > 80) & (g - r > 30) & (g - b > 30)
        target = np.array([0, 0, 255], dtype=np.uint8)  # 纯蓝
    else:  # blue → green
        mask = (b > 80) & (b - r > 30) & (b - g > 30)
        target = np.array([0, 255, 0], dtype=np.uint8)  # 纯绿

    arr[mask] = target

    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    Image.fromarray(arr).save(tmp.name, "PNG", optimize=True)
    converted = int(mask.sum() / 3)
    print(f"  色幕转换: {from_chroma}→{to_chroma} ({converted}px 替换)")
    return tmp.name, True


def pad_reference_to_wider(img_path, target_ratio=0.75, chroma="green"):
    """将竖屏参考图两侧填充色幕，变成更宽的画面，给角色动作留出空间。
    
    target_ratio: 目标 width/height 比例。0.75 = 3:4（比原图 0.52 宽很多）。
    返回 padded image path（临时文件）。
    """
    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    current_ratio = w / h

    if current_ratio >= target_ratio:
        # 已经够宽，不需要 pad
        return img_path, False

    # 计算目标宽度
    target_w = int(h * target_ratio)
    pad_total = target_w - w
    pad_each = pad_total // 2

    # 色幕颜色
    pad_color = (0, 255, 0) if chroma == "green" else (0, 0, 255)

    # 创建宽幅画布，居中粘贴原图
    canvas = Image.new("RGB", (target_w, h), pad_color)
    canvas.paste(img, (pad_each, 0))

    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    canvas.save(tmp.name, "PNG", optimize=True)

    print(f"  参考图加宽: {w}x{h} → {target_w}x{h} (两侧各填充 {pad_each}px {chroma}幕)")
    return tmp.name, True


def generate_video(first_frame_path, prompt, duration=5, action_name="action", chroma="green"):
    """用 wan2.7-i2v 生成视频，返回本地视频路径。"""
    # 如果用蓝幕，但参考图是绿幕，先转换背景色
    conv_temp = None
    if chroma == "blue":
        conv_path, conv_done = convert_chroma_color(first_frame_path, "green", "blue")
        if conv_done:
            first_frame_path = conv_path
            conv_temp = conv_path

    # 先把参考图加宽，给角色动作留空间
    padded_path, pad_temp = pad_reference_to_wider(first_frame_path, target_ratio=0.75, chroma=chroma)

    compressed_path, is_temp = compress_image(padded_path)

    # Read image into memory first, THEN clean up temp files
    with open(compressed_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    if is_temp:
        os.unlink(compressed_path)
    if pad_temp and os.path.abspath(padded_path) != os.path.abspath(first_frame_path):
        os.unlink(padded_path)
    if conv_temp and os.path.exists(conv_temp):
        os.unlink(conv_temp)

    # 更新 prompt，确保角色完整 + 背景保持纯色（防止模型自由发挥换背景）
    if pad_temp:
        bg_word = "纯蓝色背景" if chroma == "blue" else "纯绿色背景"
        prompt = prompt.rstrip("。") + f"。{bg_word}。确保人物完整在画面内，不要超出边界。"

    # 绿幕 prompt 容易触发百炼审查，提交前检测并自动切换描述
    if chroma == "green" and "绿色" in prompt:
        prompt = prompt.replace("纯绿色背景", "纯色单色背景")

    api_key = get_env("BAILIAN_API_KEY")

    media = [{"type": "first_frame", "url": f"data:image/png;base64,{img_b64}"}]
    payload = {
        "model": "wan2.7-i2v",
        "input": {"prompt": prompt, "media": media},
        "parameters": {
            "resolution": "1080P",
            "duration": duration,
            "prompt_extend": False,
            "watermark": False,
        },
    }

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
        print(f"Error submitting task: {resp.text[:500]}")
        sys.exit(1)

    task_id = resp.json()["output"]["task_id"]
    print(f"  Task ID: {task_id}")

    for i in range(60):
        time.sleep(10)
        poll = requests.get(
            f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        status = poll.json()["output"]["task_status"]
        if i % 3 == 0 or status in ("SUCCEEDED", "FAILED"):
            print(f"  [{i+1}] {status}")
        if status == "SUCCEEDED":
            video_url = poll.json()["output"]["video_url"]
            video_bytes = requests.get(video_url, timeout=120).content
            return video_bytes
        elif status == "FAILED":
            print(f"FAILED: {poll.json()['output'].get('message')}")
            sys.exit(1)

    print("Timeout waiting for video")
    sys.exit(1)


def video_to_transparent_gif(video_bytes, output_path, action_name="action", chroma="green"):
    """ffmpeg chromakey + Python 后处理去色晕 → 透明 GIF。"""
    import tempfile

    cfg = CHROMAKEY_CONFIG[chroma]
    ck_hex = cfg["hex"]

    # 写临时视频文件
    video_tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    video_tmp.write(video_bytes)
    video_tmp.close()

    raw_gif = os.path.join(os.path.dirname(output_path), f"{action_name}_raw.gif")
    palette = os.path.join(os.path.dirname(output_path), f"palette_{action_name}.png")

    # chromakey 参数：保守设置（只去纯色背景），残余背景由 Python 后处理清理
    # 避免高 similarity 误删角色衣服（白衣服被色幕光照污染）
    ck_sim = "0.15" if chroma == "blue" else "0.08"
    ck_blend = "0.05" if chroma == "blue" else "0.02"

    # Step 1: 生成调色板（不做 chromakey，保留全色域）
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_tmp.name,
            "-vf", f"fps=10,scale=400:-1:flags=lanczos,palettegen=stats_mode=diff",
            palette,
        ],
        capture_output=True,
        timeout=60,
    )

    # Step 2: 用调色板生成 GIF（不做 chromakey，留给 Python 处理）
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_tmp.name, "-i", palette,
            "-lavfi", f"[0:v]fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse",
            "-loop", "0", raw_gif,
        ],
        capture_output=True,
        timeout=60,
    )

    os.unlink(video_tmp.name)

    # Step 3: Python 后处理去色晕
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

    # 确定色幕通道索引
    if chroma == "green":
        chroma_idx = 1  # G channel
        other_idx = [0, 2]  # R, B
    else:  # blue
        chroma_idx = 2  # B channel
        other_idx = [0, 1]  # R, G

    processed = []
    for frame in frames:
        arr = np.array(frame, dtype=np.float64)
        r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

        c = arr[:, :, chroma_idx]

        # 强色 → 完全透明
        if chroma == "green":
            chroma_mask = (g > cfg["color_high"]) & (g - r > cfg["diff_r"]) & (g - b > cfg["diff_b"])
        else:
            chroma_mask = (b > cfg["color_high"]) & (b - r > cfg["diff_r"]) & (b - g > cfg["diff_b"])
        arr[chroma_mask, 3] = 0

        # 边缘色偏修正（dilation 2）
        alpha_u8 = arr[:, :, 3].astype(np.uint8)
        dilated = ndimage.binary_dilation(alpha_u8 < 128, iterations=2)
        edge_mask = (alpha_u8 >= 128) & dilated

        if chroma == "green":
            green_tint = edge_mask & (g > r) & (g > b) & (g - np.maximum(r, b) > cfg["edge_diff"])
            if green_tint.any():
                target_g = np.maximum(r[green_tint], b[green_tint])
                arr[green_tint, 1] = np.clip(
                    g[green_tint] * 0.4 + target_g * 0.6, 0, 255
                ).astype(np.uint8)
            # 更大范围轻微修正（dilation 3）
            dilated2 = ndimage.binary_dilation(alpha_u8 < 128, iterations=3)
            remaining = (alpha_u8 >= 128) & dilated2 & (g > r + 5) & (g > b + 5)
            if remaining.any():
                arr[remaining, 1] = np.clip(
                    np.minimum(r[remaining], b[remaining]) + 5, 0, 255
                ).astype(np.uint8)
        else:  # blue
            blue_tint = edge_mask & (b > r) & (b > g) & (b - np.maximum(r, g) > cfg["edge_diff"])
            if blue_tint.any():
                target_b = np.maximum(r[blue_tint], g[blue_tint])
                arr[blue_tint, 2] = np.clip(
                    b[blue_tint] * 0.4 + target_b * 0.6, 0, 255
                ).astype(np.uint8)
            dilated2 = ndimage.binary_dilation(alpha_u8 < 128, iterations=3)
            remaining = (alpha_u8 >= 128) & dilated2 & (b > r + 5) & (b > g + 5)
            if remaining.any():
                arr[remaining, 2] = np.clip(
                    np.minimum(r[remaining], g[remaining]) + 5, 0, 255
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
    print(f"  GIF: {output_path} ({len(processed)} frames, {size_mb:.1f}MB)")


# ===== Main =====
parser = argparse.ArgumentParser(description="Generate transparent GIF for cloe-desktop (v2)")
parser.add_argument("--action", required=True, help="Action name (e.g. working, kiss, wave)")
parser.add_argument("--prompt", required=True, help="Video action prompt in Chinese")
parser.add_argument("--duration", type=int, default=5, help="Video duration in seconds (default: 5)")
parser.add_argument("--reference", default=None, help="Reference image path (green/blue bg)")
parser.add_argument("--output", default=None, help="Output GIF path")
parser.add_argument("--chromakey", choices=["green", "blue"], default="green", help="Chroma key color (default: green)")
parser.add_argument("--no-copy", action="store_true", help="Don't copy to public/gifs/")
parser.add_argument("--work-dir", default=None, help="Working directory for intermediate files")
args = parser.parse_args()

# 默认参考图
if args.reference:
    reference_path = os.path.expanduser(args.reference)
else:
    # Auto-detect from active action set in ~/.cloe/action-sets.json
    _as_path = os.path.join(CLOE_DATA_DIR, "action-sets.json")
    if os.path.exists(_as_path):
        with open(_as_path) as _f:
            _as_data = json.load(_f)
        _active = next(
            (s for s in _as_data.get("sets", []) if s["id"] == _as_data.get("activeSetId", "default")),
            _as_data["sets"][0] if _as_data.get("sets") else None,
        )
        if _active:
            reference_path = os.path.join(CLOE_DATA_DIR, _active.get("reference", "references/default.png"))
        else:
            reference_path = os.path.join(CLOE_DATA_DIR, "references/default.png")
    else:
        reference_path = os.path.join(CLOE_DATA_DIR, "references/default.png")

if not os.path.exists(reference_path):
    print(f"Error: reference image not found: {reference_path}")
    sys.exit(1)

# 工作目录
work_dir = args.work_dir or os.path.join(CLOE_DATA_DIR, f"gifs/_work_{args.action}")
os.makedirs(work_dir, exist_ok=True)

gif_path = args.output or os.path.join(work_dir, f"{args.action}.gif")

print(f"=== 生成 GIF: {args.action} ===")
print(f"  参考图: {reference_path} ({os.path.getsize(reference_path)/1024/1024:.1f}MB)")
print(f"  Prompt: {args.prompt}")
print(f"  色幕: {args.chromakey}")

# Step 1: 生成视频
print(f"\n[1/3] 生成视频 (wan2.7-i2v)...")
video_bytes = generate_video(reference_path, args.prompt, args.duration, args.action, args.chromakey)
print(f"  视频下载完成 ({len(video_bytes)} bytes)")

# 保存视频到工作目录
video_path = os.path.join(work_dir, f"{args.action}_video.mp4")
with open(video_path, "wb") as f:
    f.write(video_bytes)

# Step 2+3: Chromakey + 去色晕 → 透明 GIF
print(f"\n[2/3] 转换为透明 GIF (chromakey={args.chromakey})...")
video_to_transparent_gif(video_bytes, gif_path, args.action, args.chromakey)

# Step 4: 复制到 public/gifs/
if not args.no_copy:
    public_dir = os.path.join(CLOE_DATA_DIR, "gifs")
    public_path = os.path.join(public_dir, f"{args.action}.gif")
    shutil.copy(gif_path, public_path)
    print(f"\n[3/3] 已复制到 {public_path}")

print(f"\n=== 完成! ===")
print(f"  GIF: {gif_path}")
if not args.no_copy:
    print(f"  已部署: ~/.cloe/gifs/{args.action}.gif")
print(f"\n下一步:")
print(f'  curl -s http://localhost:19851/action -d \'{{"action":"{args.action}"}}\' 测试')
