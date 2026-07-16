# Plan: Terminal Multi-Tab Switcher

## 现状分析

| 层 | 现状 |
|---|---|
| `launcher.js` | 单个 `ptyProc`，一个 PTY 进程 |
| `preload.js` | `ptySpawn/ptyWrite/ptyResize/onPtyData` 无 tabId |
| `TerminalMode.jsx` | 单个 xterm.js → `window.xtermInstance` |

## 目标

1. 支持创建多个终端 tab（每个 tab 独立 PTY + xterm）
2. **无常驻 tab bar**，不占任何空间
3. 快捷键按住弹出浮动切换器（类似 macOS Cmd+Tab），松开消失
4. 每按一次循环切换到下一个 tab
5. `Cmd+T` 新建 tab，`Cmd+W` 关闭当前 tab
6. 切换快捷键用户可自定义
7. 关闭 overlay 时所有 PTY 不销毁

## 交互设计

```
                 ┌──────────────────────┐
                 │  ✦ zsh               │  ← 当前 tab 高亮
                 │    node server       │
                 │    vim               │
                 └──────────────────────┘
                        ↑
             居中浮在 terminal 内容之上
             深色半透明毛玻璃背景
             圆角 + 微光边框

操作：
  按住快捷键 → 弹出
  每按一次 → 高亮切到下一个 tab
  松开 → 面板消失，切到高亮的那个
```

- 面板尺寸：自适应内容，max-width 240px
- 位置：overlay 垂直+水平居中
- 每个 tab 条目：左侧小圆点（颜色标识）+ title
- 当前活跃 tab 有高亮背景
- 面板出现/消失有 fade + 微缩放动画（50ms in / 100ms out）

## 架构设计

### 数据流

```
TabManager (React state in App.jsx)
    ├─ tabs: [{id, title}]
    ├─ activeTabId: string
    ├─ switcherVisible: boolean
    ├─ pendingTabId: string (面板中高亮的，松手时生效)
    │
    ├─ TerminalMode
    │   └─ xtermPool: Map<tabId, { terminal, fitAddon }>
    │       └─ display:none/block 切换
    │
    └─ TabSwitcher (浮动面板，条件渲染)
        └─ 传递 tabs / pendingTabId / onSelect

launcher.js (主进程)
    └─ ptyMap: Map<ptyId, ptyProcess>
        ├─ spawnPty(ptyId, cols, rows)
        ├─ ptyWrite(ptyId, data)
        ├─ ptyResize(ptyId, cols, rows)
        └─ killPty(ptyId)
```

### 快捷键行为（关键）

```
keydown(shortcut)          → 显示面板，pendingTabId = activeTabId
keydown(shortcut, repeat)  → pendingTabId = tabs中pendingTabId的下一个（循环）
keyup(shortcut)            → activeTabId = pendingTabId，隐藏面板

keydown(Cmd+T)             → 新建 tab
keydown(Cmd+W)             → 关闭当前 tab（阻止默认关闭窗口）
```

## 实现步骤

### Step 1: launcher.js — 多 PTY 管理

- 删除 `let ptyProc = null; let ptyReady = false;`
- 新增 `const ptyMap = new Map();`
- `spawnPty(ptyId, cols, rows)`: `ptyMap.has(ptyId)` 检查，`onData` 发送时带 `ptyId`
- `pty-write/pty-resize`: 从 event 取 `ptyId` 查 map
- 新增 `pty-kill`: `ptyMap.get(ptyId)?.kill()` + delete

### Step 2: preload.js — IPC 加 ptyId

```js
ptySpawn: (ptyId, cols, rows) => ipcRenderer.send('pty-spawn', { ptyId, cols, rows }),
ptyWrite: (ptyId, data) => ipcRenderer.send('pty-write', { ptyId, data }),
ptyResize: (ptyId, cols, rows) => ipcRenderer.send('pty-resize', { ptyId, cols, rows }),
ptyKill: (ptyId) => ipcRenderer.send('pty-kill', { ptyId }),
onPtyData: (cb) => ipcRenderer.on('pty-data', (_e, { ptyId, data }) => cb(ptyId, data)),
```

### Step 3: App.jsx — Tab 状态 + 快捷键

```jsx
const [tabs, setTabs] = useState([{ id: 'default', title: 'zsh' }]);
const [activeTabId, setActiveTabId] = useState('default');
const [switcherVisible, setSwitcherVisible] = useState(false);
const [pendingTabId, setPendingTabId] = useState('default');

// 切换器快捷键（可自定义，localStorage: 'cloe-tab-switch-shortcut'）
useEffect(() => {
  const handler = (e) => {
    if (!matchesShortcut(e, stored)) return;
    if (e.repeat) {
      // 循环到下一个 tab
      e.preventDefault();
      setPendingTabId(prev => nextTab(tabs, prev));
    } else {
      // 首次按下：显示面板
      e.preventDefault();
      setPendingTabId(activeTabId);
      setSwitcherVisible(true);
    }
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}, [tabs, activeTabId]);

// keyup：隐藏面板 + 切换
useEffect(() => {
  const handler = (e) => {
    if (matchesShortcut(e, stored) && switcherVisible) {
      e.preventDefault();
      setActiveTabId(pendingTabId);
      setSwitcherVisible(false);
    }
  };
  document.addEventListener('keyup', handler, true);
  return () => document.removeEventListener('keyup', handler, true);
}, [switcherVisible, pendingTabId, stored]);
```

props 传递：
```jsx
<TerminalMode tabs={tabs} activeTabId={activeTabId} />
{switcherVisible && (
  <TabSwitcher tabs={tabs} pendingTabId={pendingTabId} />
)}
```

**不改变 overlay 内部布局**，terminal 内容区 top 保持 32px 不变。

### Step 4: TerminalMode.jsx — xterm 实例池

- `xtermPool: Map<tabId, { terminal, fitAddon, container }>`
- `activeTabId` prop 变化时：旧 xterm `display:none`，新 xterm `display:block` + `fit.fit()` + `focus()`
- `onPtyData(ptyId, data)` → `xtermPool.get(ptyId)?.terminal.write(data)`（懒创建）
- `xterm.onData` → `ptyWrite(activeTabId, data)`
- Code Walk 绑定当前 activeTabId

**懒创建策略**：PTY 在 tab 创建时 spawn，xterm 在首次切换到该 tab 时初始化。

### Step 5: TabSwitcher.jsx — 浮动面板

```jsx
export default function TabSwitcher({ tabs, pendingTabId }) {
  return (
    <div className="tab-switcher-overlay">
      <div className="tab-switcher-panel">
        {tabs.map(tab => (
          <div key={tab.id}
               className={`tab-switcher-item ${tab.id === pendingTabId ? 'active' : ''}`}>
            <span className="tab-switcher-dot" />
            <span className="tab-switcher-title">{tab.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

CSS：
```css
/* 遮罩层（不阻挡交互，纯视觉定位用） */
.tab-switcher-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  pointer-events: none;
  animation: tabSwitcherIn 80ms ease-out;
}

/* 面板本体 */
.tab-switcher-panel {
  background: rgba(20, 20, 30, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  min-width: 160px;
  max-width: 240px;
}

.tab-switcher-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  transition: all 80ms ease;
}

.tab-switcher-item.active {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

/* 小圆点标识 */
.tab-switcher-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--terminal-accent, #26c6da);
  margin-right: 10px;
  flex-shrink: 0;
}

.tab-switcher-item:not(.active) .tab-switcher-dot {
  opacity: 0.3;
}
```

### Step 6: Tab 标题自动更新

在 `onPtyData(ptyId, data)` 中正则提取 OSC title：

```js
// \x1b]0;title\x07 或 \x1b]2;title\x07
const oscMatch = data.match(/\x1b\][012];([^\x07]*)\x07/);
if (oscMatch) {
  updateTabTitle(ptyId, oscMatch[1]);
}
```

### Step 7: 设置面板 — 快捷键自定义

**文件**: `public/manager/shortcuts.js`

新增 shortcut 条目：

```js
{ key: 'tab-switch', section: 'terminal', label: 'Tab 切换器',
  storageKey: 'cloe-tab-switch-shortcut', default: 'CommandOrControl+Tab' }
```

### Step 8: style.css

只加 TabSwitcher 相关样式（Step 5 的 CSS），**不改变任何现有布局**。terminal 内容区 top 保持 32px。

## 文件改动清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `launcher.js` | **修改** | PTY 单实例 → Map，新增 pty-kill |
| `preload.js` | **修改** | PTY IPC 加 ptyId，新增 ptyKill |
| `src/react/TerminalMode.jsx` | **重写** | 单 xterm → 实例池 + display 切换 |
| `src/react/TabSwitcher.jsx` | **新建** | Cmd+Tab 风格浮动面板 |
| `src/react/App.jsx` | **修改** | tabs state + 切换器逻辑 + 快捷键 |
| `src/style.css` | **修改** | TabSwitcher 样式 |
| `public/manager/shortcuts.js` | **修改** | 新增 tab-switch 快捷键项 |
| `OverlayTitlebar.jsx` | **不变** | |

## 快捷键汇总

**所有终端 tab 快捷键仅在 overlay 可见（`visible === true`）时生效。** character 模式下全部忽略，不拦截系统默认行为。

| 快捷键 | 动作 | 可自定义 | 默认值 | 生效条件 |
|--------|------|----------|--------|----------|
| `Cmd+Tab` | 弹出 tab 切换器 | ✅ | `CommandOrControl+Tab` | visible + terminal mode |
| `Cmd+T` | 新建 tab | ❌ | 固定 | visible + terminal mode |
| `Cmd+W` | 关闭当前 tab | ❌ | 固定 | visible + terminal mode |
| `Cmd+Shift+[` | 左切 tab | ❌ | 固定 | visible + terminal mode |
| `Cmd+Shift+]` | 右切 tab | ❌ | 固定 | visible + terminal mode |

## 注意

1. **tab 上限 10 个**，新建时检查
2. **最后一个 tab 不能关**
3. **Code Walk 期间禁用 tab 切换**
4. 保留 `window.xtermInstance` 指向当前活跃 xterm（兼容外部调用）
5. **不占任何常驻 UI 空间**，与现有布局零冲突
