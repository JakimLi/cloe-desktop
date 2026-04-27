#!/usr/bin/env python3
"""Record cloe-desktop demo: screen capture + action triggers"""

import json, os, re, subprocess, sys, time, urllib.request

# Get screen resolution
result = subprocess.run(["system_profiler", "SPDisplaysDataType"],
                       capture_output=True, text=True, timeout=10)
sw, sh = 2560, 1600  # fallback
for line in result.stdout.split('\n'):
    if 'Resolution' in line:
        m = re.search(r'(\d+)\s*x\s*(\d+)', line)
        if m:
            sw, sh = int(m.group(1)), int(m.group(2))

# Cloe window: x=sw-400, y=sh-540
pad = 30
cx, cy = max(0, sw - 400 - pad), max(0, sh - 540 - pad)
cw, ch = 400 + pad * 2, 540 + pad * 2
print(f"Screen: {sw}x{sh}, Capture: {cx},{cy} {cw}x{ch}")

output = "/tmp/cloe-desktop-demo.mp4"
duration = 35

# Start ffmpeg
proc = subprocess.Popen([
    "ffmpeg", "-f", "avfoundation", "-framerate", "15",
    "-i", "1:0",
    "-filter:v", f"crop={cw}:{ch}:{cx}:{cy}",
    "-t", str(duration),
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    output
], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

time.sleep(2)

# Trigger actions in sequence
actions = [
    (0,  {"action": "smile"}),
    (4,  {"action": "nod"}),
    (8,  {"action": "wave"}),
    (12, {"action": "think"}),
    (16, {"action": "tease"}),
    (20, {"action": "speak", "audio": "doing"}),
    (26, {"action": "speak", "audio": "done"}),
    (30, {"action": "kiss"}),
]

t0 = time.time()
for delay, action in actions:
    elapsed = time.time() - t0
    if elapsed < delay:
        time.sleep(delay - elapsed)
    data = json.dumps(action).encode()
    req = urllib.request.Request("http://localhost:19851/action", data=data,
                                  headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5)
        print(f"[{time.time()-t0:.0f}s] → {action}")
    except Exception as e:
        print(f"[{time.time()-t0:.0f}s] ERROR: {e}")

print(f"\nWaiting for ffmpeg...")
proc.wait()
size_mb = os.path.getsize(output) / 1024 / 1024
print(f"Done: {output} ({size_mb:.1f} MB)")
