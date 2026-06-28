#!/usr/bin/env python3
"""
Generate cartoon action GIF: white-bg reference → wan2.7-i2v video → smart flood-fill key.
Usage: python3 gen_cartoon_action.py --action wave --prompt "她举起右手开心挥手打招呼..."
"""
import base64, json, os, sys, time, argparse, subprocess
import requests, numpy as np
from PIL import Image
from scipy import ndimage

def get_env(key):
    with open(os.path.expanduser("~/.hermes/.env")) as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.strip().split("=", 1)[1]
    raise ValueError(f"{key} not found")

parser = argparse.ArgumentParser()
parser.add_argument("--action", required=True)
parser.add_argument("--prompt", required=True)
parser.add_argument("--reference", default="/tmp/cloe_cartoon_whitebg_ref.png")
args = parser.parse_args()

REF = args.reference
ACTION = args.action
OUTPUT = f"/tmp/cartoon_{ACTION}_smart.gif"
WORK_DIR = f"/tmp/_work_cartoon_{ACTION}"
os.makedirs(WORK_DIR, exist_ok=True)

# 1. Pad + compress reference
img = Image.open(REF).convert("RGB")
w, h = img.size
target_w = int(h * 0.75)
if target_w > w:
    pad = (target_w - w) // 2
    padded = Image.new("RGB", (target_w, h), (255, 255, 255))
    padded.paste(img, (pad, 0))
else:
    padded = img
pw, ph = padded.size
if pw > 1920:
    padded = padded.resize((1920, int(ph * 1920 / pw)), Image.LANCZOS)
ref_path = os.path.join(WORK_DIR, "ref.png")
padded.save(ref_path)
print(f"Reference: {padded.size[0]}x{padded.size[1]}")

with open(ref_path, "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

# 2. Generate video
PROMPT = args.prompt.rstrip("。") + "。纯白色背景保持不变。黑白漫画线稿风格。电影质感，高清。确保人物完整在画面内。"
api_key = get_env("BAILIAN_API_KEY")

payload = {
    "model": "wan2.7-i2v",
    "input": {"prompt": PROMPT, "media": [{"type": "first_frame", "url": f"data:image/png;base64,{img_b64}"}]},
    "parameters": {"resolution": "1080P", "duration": 5, "prompt_extend": False, "watermark": False},
}
print(f"Generating video for '{ACTION}'...")
resp = requests.post(
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "X-DashScope-Async": "enable"},
    json=payload, timeout=120,
)
if resp.status_code != 200:
    print(f"Error: {resp.text[:500]}"); sys.exit(1)
task_id = resp.json()["output"]["task_id"]
print(f"  Task: {task_id}")

video_path = os.path.join(WORK_DIR, f"{ACTION}_video.mp4")
for i in range(60):
    time.sleep(10)
    poll = requests.get(f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}", headers={"Authorization": f"Bearer {api_key}"}, timeout=30)
    status = poll.json()["output"]["task_status"]
    print(f"  [{i+1}] {status}")
    if status == "SUCCEEDED":
        video_bytes = requests.get(poll.json()["output"]["video_url"], timeout=120).content
        with open(video_path, "wb") as f: f.write(video_bytes)
        print(f"  Video: {len(video_bytes)} bytes"); break
    elif status == "FAILED":
        print(f"FAILED: {poll.json()}"); sys.exit(1)

# 3. Video → raw GIF
raw_gif = os.path.join(WORK_DIR, f"{ACTION}_raw.gif")
palette = os.path.join(WORK_DIR, "palette.png")
subprocess.run(["ffmpeg", "-y", "-i", video_path, "-vf", "fps=10,scale=400:-1:flags=lanczos,palettegen=stats_mode=diff", palette], capture_output=True, timeout=60)
subprocess.run(["ffmpeg", "-y", "-i", video_path, "-i", palette, "-lavfi", "[0:v]fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse", "-loop", "0", raw_gif], capture_output=True, timeout=60)
print("Raw GIF done")

# 4. Smart flood-fill key (top/left/right only, NOT bottom)
g = Image.open(raw_gif)
frames = []
try:
    while True:
        frames.append(g.convert("RGBA"))
        g.seek(g.tell() + 1)
except EOFError:
    pass
print(f"Frames: {len(frames)}, Size: {frames[0].size}")

DARK_THRESHOLD = 100
processed = []
for frame in frames:
    arr = np.array(frame, dtype=np.float64)
    r, g_ch, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    brightness = (r + g_ch + b) / 3.0
    barrier = brightness < DARK_THRESHOLD

    fillable = ~barrier
    labeled, num_features = ndimage.label(fillable)

    border_labels = set()
    border_labels.update(labeled[0, :][labeled[0, :] > 0])      # top
    border_labels.update(labeled[:, 0][labeled[:, 0] > 0])      # left
    border_labels.update(labeled[:, -1][labeled[:, -1] > 0])    # right
    # NOT bottom

    bg_mask = np.isin(labeled, list(border_labels)) if border_labels else np.zeros_like(brightness, dtype=bool)
    arr[bg_mask, 3] = 0
    arr[~bg_mask, 3] = 255

    # Edge feathering
    alpha_u8 = arr[:,:,3].astype(np.uint8)
    opaque_mask = alpha_u8 >= 128
    dist = ndimage.distance_transform_edt(opaque_mask)
    edge_width = 1.5
    smooth_alpha = np.clip(dist / edge_width * 255, 0, 255).astype(np.float64)
    blend = np.clip((edge_width + 1 - dist) / 1.0, 0, 1)
    arr[:,:,3] = np.clip(arr[:,:,3] * (1 - blend) + smooth_alpha * blend, 0, 255)

    processed.append(Image.fromarray(arr.astype(np.uint8), "RGBA"))

processed[0].save(OUTPUT, save_all=True, append_images=processed[1:], duration=100, loop=0, disposal=2, optimize=False)
print(f"Done: {OUTPUT} ({len(processed)} frames)")
