#!/usr/bin/env python3
"""
Smart key v3: per-frame flood fill + hole filling.
No safety mask. Small leaks through thin outlines get auto-patched.
"""
import numpy as np
from PIL import Image
from scipy import ndimage
import sys, os

RAW_GIF = sys.argv[1] if len(sys.argv) > 1 else "/tmp/_work_cartoon_wave/wave_raw.gif"
OUTPUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/cartoon_wave_v3key.gif"

g = Image.open(RAW_GIF)
frames = []
try:
    while True:
        frames.append(g.convert("RGBA"))
        g.seek(g.tell() + 1)
except EOFError:
    pass
print(f"Frames: {len(frames)}, Size: {frames[0].size}")

DARK_THRESHOLD = 80  # lower = stricter barrier (only clearly dark pixels block flood)

processed = []
for idx, frame in enumerate(frames):
    arr = np.array(frame, dtype=np.float64)
    brightness = (arr[:,:,0] + arr[:,:,1] + arr[:,:,2]) / 3.0
    barrier = brightness < DARK_THRESHOLD
    fillable = ~barrier

    labeled, _ = ndimage.label(fillable)

    # Flood from top/left/right only (NOT bottom)
    border_labels = set()
    border_labels.update(labeled[0, :][labeled[0, :] > 0])
    border_labels.update(labeled[:, 0][labeled[:, 0] > 0])
    border_labels.update(labeled[:, -1][labeled[:, -1] > 0])

    bg_mask = np.isin(labeled, list(border_labels)) if border_labels else np.zeros_like(brightness, dtype=bool)

    # Alpha: bg → 0, everything else → 255
    alpha = np.where(bg_mask, 0, 255).astype(np.float64)

    # === HOLE FILLING ===
    # A "hole" = transparent pixel (alpha=0) fully surrounded by opaque (alpha=255)
    # Use scipy binary_fill_holes on the opaque mask
    opaque = alpha > 127
    filled = ndimage.binary_fill_holes(opaque)
    # Newly filled pixels = were transparent, now filled
    newly_filled = filled & ~opaque
    alpha[newly_filled] = 255

    # === EDGE FEATHERING ===
    opaque_final = alpha >= 128
    dist = ndimage.distance_transform_edt(opaque_final)
    edge_width = 1.5
    smooth_alpha = np.clip(dist / edge_width * 255, 0, 255)
    blend = np.clip((edge_width + 1 - dist) / 1.0, 0, 1)
    alpha = alpha * (1 - blend) + smooth_alpha * blend

    arr[:,:,3] = np.clip(alpha, 0, 255)
    processed.append(Image.fromarray(arr.astype(np.uint8), "RGBA"))

processed[0].save(OUTPUT, save_all=True, append_images=processed[1:],
    duration=100, loop=0, disposal=2, optimize=False)
print(f"Done: {OUTPUT} ({len(processed)} frames)")

for i, name in [(0, "f0"), (15, "f15"), (25, "f25"), (35, "f35")]:
    if i < len(processed):
        preview = Image.new("RGBA", processed[0].size, (255, 255, 255, 255))
        preview = Image.alpha_composite(preview, processed[i])
        preview.save(f"/tmp/cartoon_wave_v3_{name}.png")
print("Previews saved")
