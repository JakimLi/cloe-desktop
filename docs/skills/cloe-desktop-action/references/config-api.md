# 配置 API

通过 Bridge API 读写应用配置、窗口位置/缩放、以及 plugin 触发规则。配置持久化在 `~/.cloe/config.json`。

> 角色在窗口内的位置和大小用 `/character-layout`，详见 [layout.md](layout.md)。

## 一、应用配置（api-config）

`/api-config` 读写整个 `~/.cloe/config.json`。POST 是**浅合并**（patch），不会覆盖未传的字段。

### 读取全部配置

```bash
curl -s http://localhost:19851/api-config
```

返回完整的 config.json，常见字段包括：

```json
{
  "version": 1,
  "dataDir": "~/.cloe",
  "language": "zh-CN",
  "dashscopeApiKey": "...",
  "videoModel": "wan2.7-i2v",
  "hermesApi": { "host": "127.0.0.1", "port": 8642, "key": "" },
  "weather": { "enabled": false, "provider": "open-meteo", ... },
  "windowScale": 1.0,
  "characterPosition": { "x": 0.5, "y": 1.0 },
  "characterSize": { "scale": 1.0 },
  "chatNickname": "Cloe",
  "terminalShortcut": ""
}
```

### 更新配置（合并）

```bash
# 设置 DashScope API key（GIF 生成用）
curl -s -X POST http://localhost:19851/api-config -H 'Content-Type: application/json' \
  -d '{"dashscopeApiKey":"sk-xxx"}'

# 配置 Hermes API
curl -s -X POST http://localhost:19851/api-config -H 'Content-Type: application/json' \
  -d '{"hermesApi":{"host":"127.0.0.1","port":8642,"key":"your-key"}}'

# 改语言
curl -s -X POST http://localhost:19851/api-config -H 'Content-Type: application/json' \
  -d '{"language":"en-US"}'
```

> 浅合并：传 `{"hermesApi":{...}}` 会**整体替换** hermesApi 对象（不会深合并）。要改 hermesApi 的某个字段，需把整个 hermesApi 对象传全。

## 二、窗口位置

主悬浮窗的位置记忆。坐标是屏幕绝对像素。

### 读取（含当前实际位置）

```bash
curl -s http://localhost:19851/window-position
# {"saved": {"x": 100, "y": 200}, "current": {"x": 105, "y": 210}}
```

- `saved`：持久化保存的位置
- `current`：窗口当前实际位置（可能因用户拖动而与 saved 不同）

### 保存 / 清除

```bash
# 保存当前位置
curl -s -X POST http://localhost:19851/window-position -H 'Content-Type: application/json' \
  -d '{"x":100,"y":200}'

# 清除保存的位置（下次启动用默认位置）
curl -s -X POST http://localhost:19851/window-position -H 'Content-Type: application/json' \
  -d '{"clear":true}'
```

## 三、窗口缩放

整个主窗口的缩放比例（影响 GIF 显示尺寸）。范围 `0.3 ~ 2.0`，默认 `1.0`。

### 读取

```bash
curl -s http://localhost:19851/window-scale
# {"scale": 1.0, "min": 0.3, "max": 2.0}
```

### 设置

```bash
curl -s -X POST http://localhost:19851/window-scale -H 'Content-Type: application/json' \
  -d '{"scale":1.5}'
```

超出 `[0.3, 2.0]` 范围会被自动钳制到边界。

## 四、Plugin 触发规则

`plugin-rules.json` 定义 Hermes plugin 的自动触发规则（什么条件下自动让角色做某个动作）。详见 [plugin.md](plugin.md)。

### 读取

```bash
curl -s http://localhost:19851/plugin-rules
```

### 写入

```bash
curl -s -X POST http://localhost:19851/plugin-rules -H 'Content-Type: application/json' \
  -d '{"rules":[...]}'
```

整个替换（非合并）。文件位于 `<dataDir>/plugin-rules.json`。

## 注意事项

- 所有配置改动都是即时生效并落盘的，应用重启后保留
- `dataDir` 字段决定数据根目录（GIF/音频/config 都在这下面），默认 `~/.cloe`
- 改 `hermesApi`、`dashscopeApiKey` 等敏感字段后，相关的功能（chat、GIF 生成）会立即用新值
