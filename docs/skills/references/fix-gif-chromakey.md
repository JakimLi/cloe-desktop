# fix_gif_chromakey.py — Green-screen GIF Two-stage Regional Chromakey (v5) + Edge Refinement

From raw video frame HSV chromakey + global unified palette, thoroughly eliminating inter-frame flicker and hair transparency gaps.
After 5 rounds of Opus 4.7 iteration + manual parameter tuning, the final solution.

## Usage

```bash
# First use generate_gif.py to generate video (will leave _video.mp4 in _work_idle/)
python3 scripts/generate_gif.py --action laugh --prompt "..." --duration 5

# After video is generated, use the fix script to replace chromakey GIF:
python3 scripts/fix_gif_chromakey.py \
  --video public/gifs/_work_idle/laugh_video.mp4 \
  --output public/gifs/laugh.gif \
  --dilate-top 15 --dilate-bot 9 --cluster-thresh 3 --min-blob 500

# If dilate-top>=15, you must do edge refinement (remove black halo):
python3 /tmp/erode_laugh.py public/gifs/laugh.gif 5
```

## Parameters (fix_gif_chromakey.py)

| Parameter | Default | Description |
|------|------|------|
| --video | Required | Raw video path (without chromakey) |
| --output | Required | Output GIF path |
| --width | 400 | Target width |
| --fps | 10 | Frame rate |
| --top-ratio | 0.5 | Upper portion (hair area) ratio |
| --dilate-top | 9 | Upper portion dilation kernel (hair area needs larger value to fill gaps) |
| --dilate-bot | 9 | Lower portion dilation kernel (body area standard value) |
| --erode | 1 | Erosion kernel (1=no erosion) |
| --cluster-thresh | 4 | Dark cluster protection: threshold for dark pixel count in 3x3 neighborhood |
| --min-blob | 1000 | Minimum connected component area (discard isolated noise) |

## Recommended Parameters

| Scenario | dilate-top | dilate-bot | cluster-thresh | min-blob | Needs edge refinement? |
|------|-----------|-----------|---------------|----------|-------------|
| **Standard (smile/blink etc.)** | 9 | 9 | 4 | 1000 | No |
| **Dense hair / many gaps (laugh etc.)** | **15** | 9 | **3** | **500** | **Yes, erode=5** |

**Tuning principle**: Hair has transparency gaps → increase dilate-top (11->13->15); still has noise → increase min-blob or cluster-thresh.

## Edge Refinement (Required step after large dilate)

Large dilate (e.g. 15) will seal hair gaps, but will also expand a black halo around the edges. **You must do an erode step to shrink edges after fix_gif_chromakey.py output**.

Script: `/tmp/erode_laugh.py` (accepts GIF path + erode_size parameter)

Core logic:
1. Read GIF alpha channel frame by frame
2. MinFilter(size=erode_size) erode-shrink edges (erode=5 shrinks ~2px)
3. GaussianBlur(radius=1.0) slight feathering
4. Binarize (<100→0, >=100→255) for natural edge transition
5. Rebuild GIF with global palette (same palette + transparency logic as fix_gif_chromakey.py)

**Complete flow: chromakey(dilate-top=15) → output GIF → erode(5) + gaussian(1.0) → final GIF**

## Core Flow (v5 Two-stage Regional)

1. **ffmpeg extracts RGB frames** (no chromakey)
2. **Frame-by-frame two-stage regional chromakey**:

### Stage 1: Upper portion (y < H*top_ratio, hair + head area)
- Background detection **aggressive**: hue[30,120] + s>35 + greenness>=2 + not dark(v<120) + not dark cluster
- Foreground seed **conservative**: greenness<=8 + v>10, dark neutral/dark cluster forced foreground
- Dark cluster protection: RGB<80 pixels if dark pixel count in 3x3 neighborhood >=cluster_thresh, forced as foreground
- **No erode**
- dilate-top absorbs edges + seals hair gaps into closed regions
- **binary_fill_holes** fills closed holes

### Stage 2: Lower portion (body/clothing area)
- Standard HSV chromakey: hue[35,110] + s>60 + greenness>5 + not dark(v<80)
- dilate-bot=9 standard dilation

### Compositing
- Top-bottom splice → global fill_holes → small connected component filtering → despill → alpha binarization

3. **Global palette**: All frames stitched into a strip → MEDIANCUT quantize 255 colors + 1 transparency → same palette for every frame
4. **Save GIF**: disposal=2, duration=100, transparency=255

## Verification Method

```bash
# Spot-check multiple frames, use zai-vision to inspect hair area and edges
cd ~/work/cloe-desktop/public/gifs
for n in 0 10 25 35 49; do
  ffmpeg -y -loglevel error -i laugh.gif -vf "select=eq(n\\,$n)" -frames:v 1 /tmp/laugh_frame${n}.png
done
# Then use mcp_zai_vision_analyze_image on each image to check hair gaps and edge halo
```

## Iterative Optimization History

| Version | Problem | Change |
|------|------|------|
| v1 | ffmpeg chromakey inter-frame flicker | Skip ffmpeg, do HSV chromakey ourselves |
| v2 | Hair transparency gaps (erode=3 killed dark points) | erode->1, dilate->7, dark protection + fill_holes |
| v3 | Hair still has blank spots (v at 50-80) | dark protection v->80, RGB->80, regional processing, dilate->9 |
| v4 | Two-stage regional (closing blurred contours) | Aggressive background + conservative seed + dilate + fill_holes, removed closing |
| v5 | Hair still has fine gaps (fill_holes only fills closed holes) | Removed closing, dilate_top=9, fill_holes as safety net |
| **v5+tuning** | Hair still has open gaps (not closed holes, fill_holes can't fill) | **dilate_top=15, cluster_thresh=3, min_blob=500 → gaps eliminated** |
| **+Edge refinement** | dilate=15 caused edge black halo | **erode=5 + gaussian(1.0) post-processing → perfect** |

## Key Takeaways

- **fill_holes can only fill closed holes**: If hair gaps are open (connected to background), fill_holes is ineffective. Must rely on sufficiently large dilate to seal the gaps shut
- **Don't be afraid to use large dilate-top**: If 9 isn't enough, try 11, 13, 15. Better to lose some edge detail than leave hair gaps
- **Closing blurs contours**: v4 used 15x15 closing which actually made hair contours blurry; dilate + fill_holes combination is better
- **Lowering cluster-thresh protects more dark pixels**: Dropping from 4 to 3 lets more dark pixels be protected as foreground
- **Large dilate must be followed by erode**: dilate>=15 produces black edge halos; must post-process with erode(5)+gaussian(1.0) to shrink back to natural edges
