# 天气系统 API

通过 Bridge API 配置和预览天气特效。Cloe Desktop 会定期拉取真实天气数据，在角色背景渲染对应的天气动画（雨、雪、雷暴、雾等）。

## 数据模型

### 配置（`/weather/config`）

```json
{
  "enabled": false,
  "showWeather": true,
  "provider": "open-meteo",
  "apiKey": "",
  "city": "auto",
  "intervalMin": 30
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 是否启用天气拉取（总开关） |
| `showWeather` | bool | 天气画布可见性（独立于 enabled，可单独隐藏） |
| `provider` | string | `'open-meteo'`（免 key）或 `'qweather'`（和风天气，需 apiKey） |
| `apiKey` | string | 和风天气 API key（仅 provider=qweather 时需要） |
| `city` | string | 城市名，`'auto'` 表示按系统时区自动检测 |
| `intervalMin` | number | 拉取间隔（分钟），最小 5 |

### 天气数据（`/weather/now`、`/weather/test`、`/weather/inject` 返回）

```json
{
  "weather": {
    "provider": "open-meteo",
    "city": "上海",
    "weatherCode": 61,
    "weatherType": "rain",
    "text": "雨",
    "temp": 20,
    "feelsLike": 19,
    "humidity": 85,
    "windSpeed": 10,
    "windDir": 90,
    "windGusts": 20,
    "visibility": 5000,
    "cloudCover": 80,
    "precipitation": 5,
    "rain": 5,
    "snowfall": 0,
    "isDay": true
  }
}
```

### weatherType 取值

| weatherType | 含义 |
|-------------|------|
| `clear` | 晴 |
| `cloudy` | 多云 |
| `rain` | 雨 |
| `snow` | 雪 |
| `fog` | 雾 |
| `thunderstorm` | 雷暴 |
| `sandstorm` | 沙尘暴（open-meteo，需低能见度+大风） |
| `icy` | 结冰（低温场景） |

## API 端点

### 读取配置

```bash
curl -s http://localhost:19851/weather/config
```

### 更新配置

更新后自动重启轮询，并广播 `weather-config-changed` 给所有客户端。

```bash
# 启用天气 + 用 open-meteo（免 key）+ 自动城市
curl -s -X POST http://localhost:19851/weather/config -H 'Content-Type: application/json' \
  -d '{"enabled":true,"provider":"open-meteo","city":"auto","intervalMin":30}'

# 切换到和风天气（需自己申请 key）
curl -s -X POST http://localhost:19851/weather/config -H 'Content-Type: application/json' \
  -d '{"provider":"qweather","apiKey":"你的KEY","city":"北京"}'

# 只隐藏天气画布（保持后台拉取）
curl -s -X POST http://localhost:19851/weather/config -H 'Content-Type: application/json' \
  -d '{"showWeather":false}'
```

### 切换开关

快速翻转 `enabled`（等价于 config 里改 enabled）。

```bash
curl -s -X POST http://localhost:19851/weather/toggle
```

### 读取当前天气

返回最近一次缓存的天气数据（不会触发新请求）。

```bash
curl -s http://localhost:19851/weather/now
```

### 强制重新拉取

立即触发一次拉取并返回最新天气（用于配置完 apiKey 后验证是否生效）。

```bash
curl -s -X POST http://localhost:19851/weather/test
```

## 预览天气（开发/调试用）

`/weather/preview` 临时显示某种天气，**不会自动恢复**，需手动调 `/weather/preview-end` 结束。适合在没下雨时预览雨效。

### 预览指定天气

```bash
# 预览下雨
curl -s -X POST http://localhost:19851/weather/preview -H 'Content-Type: application/json' \
  -d '{"weatherType":"rain"}'

# 预览夜晚的雪
curl -s -X POST http://localhost:19851/weather/preview -H 'Content-Type: application/json' \
  -d '{"weatherType":"snow","isNight":true}'

# 预览雷暴 + 特殊效果（如闪电 specialType）
curl -s -X POST http://localhost:19851/weather/preview -H 'Content-Type: application/json' \
  -d '{"weatherType":"thunderstorm","specialType":"lightning","isNight":false}'

# 指定小时（影响光线角度）
curl -s -X POST http://localhost:19851/weather/preview -H 'Content-Type: application/json' \
  -d '{"weatherType":"clear","previewHour":18}'
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `weatherType` | string | 见上方取值表 |
| `specialType` | string\|null | 特殊效果（如闪电），传 null 清除 |
| `isNight` | bool | 是否夜景（影响温度模板和光线） |
| `previewHour` | number\|null | 小时（0-23），影响光照角度 |

### 结束预览

清除特殊效果并恢复真实天气。

```bash
curl -s -X POST http://localhost:19851/weather/preview-end
```

## 注入假天气（测试用）

`/weather/inject` 直接注入一个假天气对象并广播，绕过拉取。支持白天/夜晚变体（`clear`、`clear-night`、`rain-night` 等）。主要用于自动化测试。

```bash
curl -s -X POST http://localhost:19851/weather/inject -H 'Content-Type: application/json' \
  -d '{"weatherType":"snow"}'
```

## 注意事项

- `open-meteo` 完全免费、无需注册；`qweather` 需要在 [dev.qweather.com](https://dev.qweather.com) 申请 key
- `city: 'auto'` 时按系统时区推断城市名（如 `Asia/Shanghai` → 上海），再调 open-meteo 的 geocoding 接口解析坐标
- 天气配置持久化在 `~/.cloe/config.json` 的 `weather` 字段，应用重启后自动恢复并继续轮询
- `intervalMin` 最小值是 5（小于 5 会被强制改成 5），避免过于频繁请求
- 客户端通过 WebSocket 收到 `weather-update`（天气变化）、`weather-config-changed`（配置变化）、`weather-special-preview`（特殊效果）消息
