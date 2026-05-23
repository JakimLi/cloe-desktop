# 终端特效

在 xterm.js 终端上叠加动画效果，让角色和终端产生物理互动感。

## 特效触发

```bash
curl -s http://localhost:19851/action -d '{"action":"smash_screen"}'
```

特效在 `handleAction` 中注册，放在 `isSpeaking` 检查之前（TTS 播放期间也能触发）。

## 现有效果

### smash_screen（字符掉落）

文字像受重力影响自然下坠，散乱堆积在终端底部：

- 顶部行先动，底部行后动（波浪式传播）
- 从静止开始下落，极轻微水平漂移和旋转
- 高度图堆积系统：每个粒子查询落地位置，自动堆叠
- 落地后散乱倾斜，停留 1.2-2.2 秒后淡出
- 总时长约 10 秒

## 扩展新特效

```javascript
function effectNewEffect() {
  if (!xtermInstance || !terminalMode || effectRunning) return;

  const xtermScreen = document.querySelector('.xterm-screen');
  const xtermRows = document.querySelector('.xterm-rows');
  const container = document.getElementById('terminal-container');
  if (!xtermScreen || !xtermRows || !container) return;

  // 1. 克隆行元素
  const rows = document.querySelectorAll('.xterm-rows > div');
  const particles = [];
  for (const row of rows) {
    if (!row.textContent?.trim()) continue;
    const rect = row.getBoundingClientRect();
    const clone = row.cloneNode(true);
    clone.style.cssText = `position:absolute; left:${rect.left - container.getBoundingClientRect().left}px; top:${rect.top - container.getBoundingClientRect().top}px; width:${rect.width}px; height:${rect.height}px; margin:0; z-index:10; pointer-events:none; will-change:transform,opacity; background:transparent;`;
    // 关键：append 到 xtermScreen 内部（不是 overlay），继承 CSS
    xtermScreen.appendChild(clone);
    particles.push({ el: clone, ... });
  }

  if (!particles.length) return;

  // 2. 隐藏原始行（不是 xterm-screen）
  effectRunning = true;
  xtermRows.style.visibility = 'hidden';

  // 3. requestAnimationFrame 动画循环（CSS transform 驱动，GPU 加速）
  // ...

  // 4. 清理
  xtermRows.style.visibility = '';
  for (const p of particles) { if (p.el.parentNode) p.el.remove(); }
  particles.length = 0;
  effectRunning = false;
}
```

每个新特效必须：
1. 检查 `!xtermInstance || !terminalMode || effectRunning`
2. 克隆行元素，append 到 `.xterm-screen` 内部
3. 隐藏 `.xterm-rows`（不是 `.xterm-screen`）
4. 用 CSS transform 做动画
5. 动画结束后清理克隆、恢复 xterm-rows、设置 `effectRunning = false`
6. 在 `handleAction` 中注册

## DOM 结构

```
#terminal-overlay (position: fixed, z-index: 5)
  ├─ #terminal-titlebar (z-index: 1)
  ├─ #terminal-container (xterm renders here)
  └─ #effect-canvas (z-index: 2, pointer-events: none)
```

- 动画层（克隆元素）在 `.xterm-screen` 内部，z-index: 10
- `pointer-events: none` 确保不拦截终端输入
- 同一时间只能有一个特效运行（`effectRunning` 互斥）
