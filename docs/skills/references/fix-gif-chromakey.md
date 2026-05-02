# fix_gif_chromakey.py — 绿幕GIF两阶段分区抠图（v5）+ 边缘精修

从原始视频帧HSV抠图 + 全局统一调色板，彻底消除帧间闪烁和头发透明缝隙。
经过5轮Opus 4.7迭代 + 手动调参，最终方案。

## 用法

```bash
# 先用 generate_gif.py 生成视频（会在 _work_idle/ 留下 _video.mp4）
python3 scripts/generate_gif.py --action laugh --prompt "..." --duration 5

# 视频生成后，用修复脚本替代 chromakey GIF：
python3 scripts/fix_gif_chromakey.py \
  --video public/gifs/_work_idle/laugh_video.mp4 \
  --output public/gifs/laugh.gif \
  --dilate-top 15 --dilate-bot 9 --cluster-thresh 3 --min-blob 500

# 如果 dilate-top>=15，必须做边缘精修（去掉黑色光晕）：
python3 /tmp/erode_laugh.py public/gifs/laugh.gif 5
```

## 参数（fix_gif_chromakey.py）

| 参数 | 默认 | 说明 |
|------|------|------|
| --video | 必填 | 原始视频路径（未做chromakey的） |
| --output | 必填 | 输出GIF路径 |
| --width | 400 | 目标宽度 |
| --fps | 10 | 帧率 |
| --top-ratio | 0.5 | 上半部分（头发区域）占比 |
| --dilate-top | 9 | 上半部分膨胀kernel（头发区域需大值填缝） |
| --dilate-bot | 9 | 下半部分膨胀kernel（身体区域标准值） |
| --erode | 1 | 腐蚀kernel（1=不腐蚀） |
| --cluster-thresh | 4 | 暗色簇保护：3x3邻域内暗色像素数阈值 |
| --min-blob | 1000 | 最小连通域面积（丢弃孤立噪点） |

## 推荐参数

| 场景 | dilate-top | dilate-bot | cluster-thresh | min-blob | 需要边缘精修? |
|------|-----------|-----------|---------------|----------|-------------|
| **标准（smile/blink等）** | 9 | 9 | 4 | 1000 | 否 |
| **头发浓密/缝隙多（laugh等）** | **15** | 9 | **3** | **500** | **是，erode=5** |

**调参原则**：头发有透明缝隙 -> 加大 dilate-top（11->13->15）；仍有噪点 -> 加大 min-blob 或 cluster-thresh。

## 边缘精修（大 dilate 后的必做步骤）

大 dilate（如15）会把头发缝隙填死，但也会让边缘膨胀出一圈黑色光晕。**必须在 fix_gif_chromakey.py 输出后做一步 erode 收缩边缘**。

脚本：`/tmp/erode_laugh.py`（接受 GIF路径 + erode_size 参数）

核心逻辑：
1. 逐帧读取 GIF 的 alpha 通道
2. MinFilter(size=erode_size) 腐蚀收缩边缘（erode=5 收缩约2px）
3. GaussianBlur(radius=1.0) 轻羽化
4. 二值化（<100→0, >=100→255）让边缘过渡自然
5. 用全局调色板重建 GIF（同 fix_gif_chromakey.py 的 palette + transparency 逻辑）

**完整流程：chromakey(dilate-top=15) → 输出 GIF → erode(5) + gaussian(1.0) → 最终 GIF**

## 核心流程（v5 两阶段分区）

1. **ffmpeg提取RGB帧**（不做chromakey）
2. **逐帧两阶段分区抠图**：

### 阶段一：上半部分（y < H*top_ratio，头发+头部区域）
- 背景判定**激进**：hue[30,120] + s>35 + greenness>=2 + 非暗色(v<120) + 非暗色簇
- 前景种子**保守**：greenness<=8 + v>10，暗色中性/暗色簇强制前景
- 暗色簇保护：RGB<80 像素若 3x3 邻域内深色像素数>=cluster_thresh，强制为前景
- **不做 erode**
- dilate-top 吸收边缘 + 把头发缝隙连成封闭区
- **binary_fill_holes** 填充封闭空洞

### 阶段二：下半部分（身体/衣服区域）
- 标准 HSV 抠图：hue[35,110] + s>60 + greenness>5 + 非暗色(v<80)
- dilate-bot=9 标准膨胀

### 合成
- 上下拼接 -> 整体 fill_holes -> 小连通域过滤 -> 去溢色 -> alpha二值化

3. **全局调色板**：所有帧拼长条 -> MEDIANCUT量化255色+1透明 -> 每帧用同一调色板
4. **保存GIF**：disposal=2, duration=100, transparency=255

## 验证方法

```bash
# 抽查多帧，用 zai-vision 检查头发区域和边缘
cd ~/work/cloe-desktop/public/gifs
for n in 0 10 25 35 49; do
  ffmpeg -y -loglevel error -i laugh.gif -vf "select=eq(n\\,$n)" -frames:v 1 /tmp/laugh_frame${n}.png
done
# 然后对每张图用 mcp_zai_vision_analyze_image 检查头发缝隙和边缘光晕
```

## 迭代优化历史

| 版本 | 问题 | 修改 |
|------|------|------|
| v1 | ffmpeg chromakey帧间闪烁 | 跳过ffmpeg，HSV自己抠 |
| v2 | 头发透明缝隙(erode=3杀深色点) | erode->1, dilate->7, dark protection + fill_holes |
| v3 | 头发仍有空白(v在50-80) | dark protection v->80, RGB->80, 分区处理, dilate->9 |
| v4 | 两阶段分区(closing糊化轮廓) | 激进背景+保守种子+dilate+fill_holes, 去掉closing |
| v5 | 头发仍有细缝(fill_holes只填封闭洞) | 去掉closing, dilate_top=9, fill_holes兜底 |
| **v5+调参** | 头发仍有开口缝隙(非封闭洞fill不了) | **dilate_top=15, cluster_thresh=3, min_blob=500 -> 缝隙消除** |
| **+边缘精修** | dilate=15导致边缘黑色光晕 | **erode=5 + gaussian(1.0) 后处理 -> 完美** |

## 关键经验

- **fill_holes 只能填封闭空洞**：如果头发缝隙是开口的（连通到背景），fill_holes 无效。必须靠足够大的 dilate 把缝隙封口
- **dilate-top 要舍得给大**：9不够就用11、13、15。宁可多扣一点边缘细节，也不能留头发缝隙
- **closing 会糊化轮廓**：v4 用 15x15 closing 反而让头发轮廓变糊，不如 dilate + fill_holes 组合
- **cluster-thresh 降低保护更多暗色**：从4降到3，让更多暗色像素被保护为前景
- **大 dilate 必须跟 erode**：dilate>=15 会产生黑色边缘光晕，必须后处理 erode(5)+gaussian(1.0) 收缩回自然边缘
