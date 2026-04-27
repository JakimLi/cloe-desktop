#!/usr/bin/env python3
"""批量生成 cloe-desktop GIF：并行提交视频任务，串行处理"""

import base64, json, os, sys, time, subprocess
import numpy as np
import requests
from PIL import Image
from scipy import ndimage
from concurrent.futures import ThreadPoolExecutor, as_completed

def get_env(key):
    with open(os.path.expanduser("~/.hermes/.env")) as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.strip().split("=", 1)[1]
    raise ValueError(f"{key} not found")

PROJECT_DIR = os.path.expanduser("~/work/cloe-desktop")
WORK_DIR = os.path.join(PROJECT_DIR, "public/gifs/_work_actions")
REFERENCE = os.path.join(PROJECT_DIR, "reference_upperbody_greenbg.png")

ACTIONS = {
    "nod": "一个美丽的亚洲女孩面对镜头，她轻轻地点了两下头，表示赞同和认可。女孩身体其他部分保持不动，只有头部微微上下晃动。纯绿色背景。电影质感，高清。",
    "wave": "一个美丽的亚洲女孩面对镜头，她开心地举起右手向镜头挥动打招呼，手臂自然摆动两三次。身体其他部分保持不动。纯绿色背景。电影质感，高清。",
    "think": "一个美丽的亚洲女孩面对镜头，她微微歪头看向右上方，眼神若有所思，嘴唇轻轻抿起，像在认真思考问题。身体保持不动。纯绿色背景。电影质感，高清。",
    "tease": "一个美丽的亚洲女孩面对镜头，她调皮地眨了眨一只眼，嘴角微微上翘露出坏笑，歪了歪头，表情俏皮可爱。身体保持不动。纯绿色背景。电影质感，高清。",
}

API_KEY = get_env("BAILIAN_API_KEY")

with open(REFERENCE, "rb") as f:
    REF_B64 = base64.b64encode(f.read()).decode()

def submit_task(action, prompt):
    payload = {
        "model": "wan2.7-i2v",
        "input": {
            "prompt": prompt,
            "media": [{"type": "first_frame", "url": f"data:image/png;base64,{REF_B64}"}],
        },
        "parameters": {"resolution": "720P", "duration": 5, "prompt_extend": True, "watermark": False},
    }
    resp = requests.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json", "X-DashScope-Async": "enable"},
        json=payload, timeout=120,
    )
    task_id = resp.json()["output"]["task_id"]
    print(f"[{action}] 提交成功: {task_id}")
    return action, task_id

def poll_task(action, task_id, max_wait=300):
    for i in range(max_wait // 10):
        time.sleep(10)
        poll = requests.get(
            f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}",
            headers={"Authorization": f"Bearer {API_KEY}"}, timeout=30,
        )
        status = poll.json()["output"]["task_status"]
        if status == "SUCCEEDED":
            video_url = poll.json()["output"]["video_url"]
            video_bytes = requests.get(video_url, timeout=120).content
            video_path = os.path.join(WORK_DIR, f"{action}_video.mp4")
            with open(video_path, "wb") as f:
                f.write(video_bytes)
            print(f"[{action}] 视频下载完成: {video_path} ({len(video_bytes)} bytes)")
            return action, video_path
        elif status == "FAILED":
            msg = poll.json()["output"].get("message", "unknown")
            print(f"[{action}] 失败: {msg}")
            return action, None
        if i % 3 == 0:
            print(f"[{action}] 等待中... {status} ({(i+1)*10}s)")
    return action, None

def video_to_gif(action, video_path, gif_path):
    raw_gif = os.path.join(WORK_DIR, f"{action}_raw.gif")
    palette = os.path.join(WORK_DIR, f"palette_{action}.png")

    subprocess.run(["ffmpeg", "-y", "-i", video_path,
        "-vf", "chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos,palettegen=stats_mode=diff",
        palette], capture_output=True, timeout=60)

    subprocess.run(["ffmpeg", "-y", "-i", video_path, "-i", palette,
        "-lavfi", "[0:v]chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse",
        "-loop", "0", raw_gif], capture_output=True, timeout=60)

    # 后处理去绿色光晕
    img = Image.open(raw_gif)
    frames, durations = [], []
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
        r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
        green_mask = (g > 80) & (g - r > 30) & (g - b > 30)
        arr[green_mask, 3] = 0
        alpha_u8 = arr[:,:,3].astype(np.uint8)
        dilated = ndimage.binary_dilation(alpha_u8 < 128, iterations=2)
        edge_mask = (alpha_u8 >= 128) & dilated
        green_tint = edge_mask & (g > r) & (g > b) & (g - np.maximum(r, b) > 3)
        if green_tint.any():
            tg = np.maximum(r[green_tint], b[green_tint])
            arr[green_tint, 1] = np.clip(g[green_tint]*0.4 + tg*0.6, 0, 255).astype(np.uint8)
        dilated2 = ndimage.binary_dilation(alpha_u8 < 128, iterations=3)
        remaining = (alpha_u8 >= 128) & dilated2 & (g > r + 5) & (g > b + 5)
        if remaining.any():
            arr[remaining, 1] = np.clip(np.minimum(r[remaining], b[remaining]) + 5, 0, 255).astype(np.uint8)
        processed.append(Image.fromarray(arr.astype(np.uint8), "RGBA"))

    processed[0].save(gif_path, save_all=True, append_images=processed[1:],
        duration=durations[0], loop=0, disposal=2, optimize=False)
    size_mb = os.path.getsize(gif_path) / 1024 / 1024
    print(f"[{action}] GIF 完成: {gif_path} ({len(processed)} frames, {size_mb:.1f}MB)")

# === Main ===
os.makedirs(WORK_DIR, exist_ok=True)

print("=== Step 1: 并行提交视频生成任务 ===")
with ThreadPoolExecutor(max_workers=4) as executor:
    futures = {executor.submit(submit_task, a, p): a for a, p in ACTIONS.items()}
    tasks = {}
    for f in as_completed(futures):
        action, task_id = f.result()
        tasks[action] = task_id

print(f"\n=== Step 2: 轮询等待 {len(tasks)} 个任务 ===")
with ThreadPoolExecutor(max_workers=4) as executor:
    futures = {executor.submit(poll_task, a, tid): a for a, tid in tasks.items()}
    results = {}
    for f in as_completed(futures):
        action, video_path = f.result()
        results[action] = video_path

print(f"\n=== Step 3: 转换 GIF ===")
success = []
for action in ACTIONS:
    vp = results.get(action)
    if vp:
        gif_path = os.path.join(WORK_DIR, f"{action}.gif")
        video_to_gif(action, vp, gif_path)
        # 复制到 public/gifs/
        public = os.path.join(PROJECT_DIR, "public/gifs", f"{action}.gif")
        import shutil
        shutil.copy(gif_path, public)
        success.append(action)
    else:
        print(f"[{action}] 跳过（视频生成失败）")

print(f"\n=== 完成！成功: {success} ===")
