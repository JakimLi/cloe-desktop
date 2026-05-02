# M2 Implementation Plan: 多套动作方案管理

## 概述
M2 实现动作集的完整 CRUD + 动态切换。用户可以在管理界面创建新动作集（名称+参考图），添加/删除动作，切换激活的动作集。

## 架构变更

### 1. renderer.js — 动态配置（核心！）

当前 renderer.js 的 `GIF_ANIMATIONS`、`IDLE_PLAYLIST`、`ACTION_MAP` 是硬编码的，需要改为可动态更新。

在 WS `onmessage` 中新增处理：
```js
if (msg.type === 'set-config') {
  // msg.animations = { blink: './gifs/xxx.gif', ... }
  // msg.idlePlaylist = ['blink', 'blink', ...]
  // msg.actionMap = { smile: 'smile', ... }
  GIF_ANIMATIONS = { ...msg.animations }; // 注意: key 前加 BASE
  IDLE_PLAYLIST = msg.idlePlaylist;
  ACTION_MAP = msg.actionMap;
  // 重新加载当前 GIF（从新 set 里找同名 GIF，找不到就 resetGif）
  // 重启 idle loop
}
```

注意：
- GIF_ANIMATIONS 的值需要保持 `${BASE}gifs/xxx.gif` 格式
- 切换后当前 GIF 如果在新 set 里存在就保持，不存在就回到 idle
- idle loop 需要重启（clearTimeout + startIdleLoop）

### 2. launcher.js — API 扩展

**POST /action-sets** — 创建新动作集
- Body: `{ name, nameEn, description, descriptionEn, chromakey, referenceBase64 }`
- 生成 id（用 name 的小写+时间戳，如 `school_uniform_17144`）
- 保存参考图: `fs.writeFileSync(public/references/{id}.png, Buffer.from(referenceBase64, 'base64'))`
- 新 set 默认 animations/idlePlaylist/actionMap 都是空 `{}`
- 写入 action-sets.json
- 返回新 set 的完整信息

**DELETE /action-sets/:id** — 删除动作集
- 不能删除当前活跃的 set
- 不能删除最后一个 set（至少保留一个）
- 从 action-sets.json 中移除该 set
- 不删除 GIF 文件（可能被其他 set 引用）
- 返回更新后的 sets 列表

**POST /action-sets/:id/activate** — 切换活跃动作集
- 更新 action-sets.json 的 activeSetId
- 广播新配置给所有 WS clients: `{ type: 'set-config', animations, idlePlaylist, actionMap }`
- 返回成功

**POST /action-sets/:id/actions** — 向动作集添加动作
- Body: `{ name, gifBase64, trigger, idleWeight }`
- name 格式: snake_case（如 `blink`, `shake_head`）
- gifBase64: base64 编码的 GIF 文件内容
- trigger: "idle" | "manual"
- idleWeight: 0（idle 时由用户手动调整）
- 保存 GIF: `fs.writeFileSync(public/gifs/{name}.gif, Buffer.from(gifBase64, 'base64'))`
- 更新 set 的 animations: `{ ...set.animations, [name]: "gifs/{name}.gif" }`
- 如果 trigger === "idle"，在 idlePlaylist 中加一条（weight 默认 1）
- 更新 actionMap: `{ ...set.actionMap, [name]: name }`
- 写入 action-sets.json
- 如果是活跃 set，广播 set-config 到 renderer
- 返回更新后的 actions 列表

**DELETE /action-sets/:id/actions/:name** — 从动作集删除动作
- 从 set 的 animations 中移除
- 从 idlePlaylist 中移除该 name 的所有出现
- 从 actionMap 中移除以该 name 为 value 的所有条目
- 写入 action-sets.json
- 如果是活跃 set，广播 set-config 到 renderer
- 不删除 GIF 文件
- 返回更新后的 actions 列表

**辅助函数：**
- `saveActionSets()` — 将 actionSetsData 写回 `public/action-sets.json`
- `broadcastSetConfig(setId)` — 获取指定 set 的配置，通过 WS 广播给所有 clients
- `generateSetId(name)` — 从名称生成 id（小写+下划线+短时间戳）

### 3. 管理界面 UI

**新建动作集：**
- Set tabs 区域末尾加 "+" 按钮
- 点击弹出 modal：
  - 名称（必填，中文）
  - 英文名（可选）
  - 描述（可选）
  - 色幕类型：下拉选择 green/blue
  - 参考图：file input（accept="image/*"），选择后预览缩略图
  - 创建按钮
- 创建成功后自动切换到新 set 并刷新

**删除动作集：**
- 每个 set tab 上 hover 时显示 "×" 删除按钮
- 不能删除活跃 set 和最后一个 set
- 二次确认

**激活动作集：**
- 点击非活跃的 set tab 自动激活（双击? 或加 "激活" 按钮?）
- 用简单的 click 激活就好，因为已经用 click 来查看 set 了
- 方案：set tab 上加一个小的 "激活" 按钮（只有非活跃 set 才显示）
- 或者：双击 tab 激活，单击查看

我推荐：单击 tab 查看，tab 旁边有个激活按钮（非活跃 set 显示）。

**添加动作：**
- 动作网格上方加 "+" 按钮
- 点击弹出 modal：
  - 动作名称（必填，snake_case，如 `laugh`）
  - GIF 文件：file input（accept=".gif,image/gif"），选择后预览
  - 触发类型：idle / manual
  - Idle 权重：number input（仅 trigger=idle 时显示）
  - 添加按钮

**删除动作：**
- 现有的 disabled 删除按钮改为启用
- 点击后二次确认
- 不能删除 working 和 speak 这类特殊动作？（M2 先不做限制，直接删除）

### 4. 文件变更清单

| 文件 | 改动 |
|------|------|
| `src/renderer.js` | 新增 set-config WS 消息处理，动态更新 animations |
| `launcher.js` | 新增 5 个 API + saveActionSets/broadcastSetConfig 辅助函数 |
| `public/manager/index.html` | 新增新建集 modal + 添加动作 modal |
| `public/manager/actions.js` | 新建集/删除集/激活/添加动作/删除动作逻辑 |
| `public/manager/actions.css` | 新按钮样式 |
| `public/manager/manager.css` | modal 表单样式 |
| `public/manager/locales/zh-CN.json` | 新增翻译键 |
| `public/manager/locales/en-US.json` | 新增翻译键 |

### 5. 注意事项

- renderer.js 里 GIF_ANIMATIONS 当前是 `const`，需改为 `let`
- GIF_ANIMATIONS 的值要保持 `${BASE}gifs/xxx.gif` 格式（WS 消息里只传 `gifs/xxx.gif`，renderer 端拼接 BASE）
- base64 上传适合 <10MB 文件（参考图 ~6MB、GIF ~3MB，都在范围内）
- action-sets.json 写入时需要格式化（JSON.stringify(data, null, 2)）
- WS 广播 set-config 时，如果当前 GIF 不在新 set 里，需要 resetGif 并重启 idle loop
