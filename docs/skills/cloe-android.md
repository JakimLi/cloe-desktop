---
name: cloe-android
description: Cloe Android 原生悬浮窗 App — Kotlin + WebSocket + GIF 动画，通过 Tailscale 跨网络连接 PC bridge。
---

# Cloe Android — 悬浮窗客户端

## 项目位置

`~/work/cloe-android/`
GitHub: `https://github.com/JakimLi/cloe-android`（独立私有仓库，已从 cloe-desktop issue #5 拆出）

## 技术栈

- **Kotlin** + Android SDK 35 (minSdk 26)
- **Glide** — GIF 播放
- **Java-WebSocket** — WS 客户端连 PC bridge
- **Kotlin Coroutines** — idle 循环 + 断线重连
- **Tailscale** — 跨网络组网（PC bridge 100.91.131.48）

## 核心架构

```
PC (Hermes/Bridge, Tailscale IP) ←──WS──→ Android App (悬浮窗)
  bridge: :19850 WS + :19851 HTTP          CloeService: Foreground Service
  launcher.js: 0.0.0.0 监听                悬浮窗: SYSTEM_ALERT_WINDOW
                                            GIF: APK assets 本地加载
```

## 构建

```bash
cd ~/work/cloe-android && ./gradlew assembleDebug --no-daemon
# APK: app/build/outputs/apk/debug/app-debug.apk (~29MB)
```

## 踩坑记录

### ⚠️ GIF 缓存不会随APK更新刷新

CloeService 的 `copyAssetToFile()` 在 `cacheDir` 缓存 GIF，逻辑是 `if (cacheFile.exists()) return`。升级 APK 后旧缓存仍在，新 GIF 不会生效。

**解决方案**：用户必须**卸载重装**或**清除应用数据**（设置→应用→Cloe→存储→清除数据）。

**根本修复**：在缓存文件名中嵌入 `BuildConfig.VERSION_CODE`，或用 `versionCode` 子目录隔离缓存，每次升级自动刷新。

### Gradle Wrapper 生成

**问题**: 从 GitHub raw 下载的 gradle-wrapper.jar 无主清单属性，无法直接运行。

**解决**: 必须用完整 Gradle 发行版生成 wrapper。
```bash
# 从腾讯镜像下载 Gradle（官方源国内太慢）
curl -L -o /tmp/gradle-8.11.1-bin.zip "https://mirrors.cloud.tencent.com/gradle/gradle-8.11.1-bin.zip"
unzip -q /tmp/gradle-8.11.1-bin.zip -d /tmp
# 在空目录生成 wrapper
cd /tmp && mkdir gw-gen && cd gw-gen && touch settings.gradle
/tmp/gradle-8.11.1/bin/gradle wrapper --gradle-version 8.11.1 --no-daemon
# 拷贝到项目
cp gradlew ~/work/cloe-android/
cp -r gradle/ ~/work/cloe-android/
```

**Wrapper properties 用腾讯镜像**:
```properties
distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-8.11.1-bin.zip
validateDistributionUrl=false
```

### 国内 Maven 镜像

`settings.gradle.kts` 阿里云镜像优先：
```kotlin
maven { url = uri("https://maven.aliyun.com/repository/google") }
maven { url = uri("https://maven.aliyun.com/repository/central") }
maven { url = uri("https://maven.aliyun.com/repository/public") }
google()
mavenCentral()
```

### 必需配置文件

1. **`gradle.properties`**: `android.useAndroidX=true` — 否则 Glide 等 AndroidX 依赖报错
2. **`local.properties`**: `sdk.dir=/Users/lijian/Library/Android/sdk`
3. **`app/build.gradle.kts`**: 必须在文件顶部声明 `plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }`，不能只在 root 声明 `apply false`

### Kotlin 编译常见错误

- `Unresolved reference 'Intent'` → 缺 `import android.content.Intent`
- `Unresolved reference 'File'` → 缺 `import java.io.File`
- `'onBind' overrides nothing` → 缺 `import android.os.IBinder`
- 用 `JsonReader` 别写 `android.util.JsonReader`，直接 `import android.util.JsonReader`（已内置）

### Bridge 改 0.0.0.0

`~/work/cloe-desktop/launcher.js` 中 WS server 和 HTTP server 的 host 从 `127.0.0.1` 改为 `0.0.0.0`，否则 Tailscale 虚拟网卡无法访问。Probe 检测（`waitForBridge`）保持 `127.0.0.1` 不变。

### ⚠️ Idle 循环会打断 Hermes 主动发的 reaction 动作

**问题**：`playAction()` 有 `if (action == lastAction) return` 逻辑——如果 idle 恰好随机播了 kiss，紧接着 Hermes/curl 主动发 kiss，安卓端直接跳过。即使不重复，reaction 3秒后就恢复 idle，GIF 还没播完就被覆盖。

**修复（2026-05-04 已提交）**：给 `playAction` 加 `isReaction` 参数：
- `isReaction=true`（默认）：Hermes/curl 触发的动作，**强制播放不跳过**，cooldown 4秒
- `isReaction=false`：idle 自动脉发，重复的仍跳过，cooldown 3秒
- `scheduleNextIdle()` 中 idle 播完后手动 cancel+delay+再调度，不再直接递归调用

```kotlin
private fun playAction(action: String, isReaction: Boolean = true) {
    if (!pathByAction.containsKey(action)) return
    if (action == lastAction && !isReaction) return  // idle 去重，reaction 不去重
    lastAction = action
    loadGif(action)
    if (action != "working") {
        idleJob?.cancel()
        idleJob = scope.launch {
            delay(if (isReaction) 4000L else 3000L)
            if (!isWorking) scheduleNextIdle()
        }
    }
}
```

### GIF 资源策略

**打包进 APK assets**（推荐）而非网络拉取：
- 每个 GIF ~2.5-2.9MB，10 个共 27MB
- `copyAssetToFile()` 在 `onCreate` 时拷贝到 `cacheDir`，Glide 通过 `file://` 加载
- 优点：秒开、断网仍可用、不占网络
- APK 总大小 ~29MB（含 GIF + 依赖）
- **新动作通过"从 PC 拉取"同步，无需重新打包**（除非想内置到 assets）

### Tailscale 启动（Intel Mac, brew 安装）

⚠️ **必须用 brew 版 userspace-networking，不能用 Tailscale 桌面版！**
Tailscale 桌面版（内核态 tun）在 macOS 上与 Node.js 不兼容：TCP 端口通但 HTTP/WS 请求会被 RST，安卓连上也是假连接。brew 版走用户态网络栈没有这个问题。

如果误装了桌面版，先停掉：
```bash
sudo tailscale down
sudo launchctl unload /Library/LaunchDaemons/io.tailscale.ipn.macsys.tailscaled.plist
```

然后启动 brew 版：
```bash
# brew 安装的 tailscaled 不走 launchd，手动启动
tailscaled --tun=userspace-networking --socket=/tmp/tailscaled.sock --state=/tmp/tailscaled.state &
TAILSCALE_USE_WIP_STATE=1 tailscale --socket=/tmp/tailscaled.sock up
# 授权 URL 会输出到终端，手机浏览器打开登录即可
# IP: tailscale --socket=/tmp/tailscaled.sock ip -4
```

Tailscale 是 split tunnel，只路由 `100.x.x.x` 网段，不影响其他流量。

### 排查安卓连接假状态

安卓显示"已连接"但收不到事件时：
1. `curl -s http://127.0.0.1:19851/status` 看 `clients` 数（Electron renderer 自占 1 个，安卓连上应 ≥2）
2. `curl -s http://127.0.0.1:19851/action -d '{"action":"working"}'` 看 `sent_to` 数量
3. 如果 clients=1 但安卓显示已连接 → IP 不对或 Tailscale 版本有问题
4. 也可以从 Tailscale IP 测试：`curl -s http://100.91.131.48:19851/status`（brew 版应返回 JSON，桌面版会 empty reply）

## 文件结构

```
cloe-android/
├── app/src/main/
│   ├── java/com/cloe/android/
│   │   ├── MainActivity.kt          # 设置页：IP输入、权限申请、连接/断开
│   │   └── CloeService.kt           # 核心：悬浮窗 + WS + GIF播放 + idle循环
│   ├── assets/
|   │   ├── gifs/*.gif               # 13个动作GIF（从 cloe-desktop 复制）
│   │   └── audio/*.mp3              # 语音文件
│   ├── res/
│   │   ├── layout/activity_main.xml # 设置页UI
│   │   └── values/styles.xml
│   └── AndroidManifest.xml
├── gradle/wrapper/                  # gradle-wrapper.jar + properties
├── local.properties                 # SDK 路径
├── gradle.properties                # android.useAndroidX=true
├── settings.gradle.kts              # 阿里云镜像
├── build.gradle.kts                 # root: AGP + Kotlin 插件声明
└── app/build.gradle.kts             # app: 依赖 + 编译配置
```

## 动作映射（与 Electron 一致）

| Action | GIF | 触发方式 |
|--------|-----|---------|
| smile/kiss/nod/wave/think/tease/speak/shake_head/working/blink/clap/shy/yawn/laugh/pout/sigh | 同名.gif | WS action 消息 |

### Speak 动画 + 音频同步

`speak` 动作同时播放 GIF（嘴巴动）和音频（预录/TTS）。

**消息格式**：
```json
{"action":"speak","audio":"doing"}           // 预录语音（bridge本地音频文件）
{"action":"speak","audio_url":"http://..."}   // TTS 语音（完整URL）
```

**音频源 URL 规则**：
- 预录：`http://<host>:19851/audio/<name>.mp3`
- TTS：消息中的 `audio_url` 原始值（bridge 生成的，可能是 `localhost`）

**⚠️ 跨设备 URL 替换**：安卓通过 Tailscale 连接 PC，`audio_url` 中的 `localhost`/`127.0.0.1` 必须替换为 `host`（安卓连接时配置的 PC IP）。`audioName` 模式直接拼接 `host`，无需替换。

**同步方案**：
1. 收到 speak → 立即加载 speak.gif（不等待音频）
2. 异步下载音频到 `cacheDir/audio/` 缓存（命中缓存跳过下载）
3. 下载完成 → `MediaPlayer.prepareAsync()`，准备好即播放
4. 音频播放期间 → `isSpeaking=true` 锁生效
5. 播放完成 → 解锁，恢复 idle 循环

**状态保护**：
- `isSpeaking` 锁：说话时 idle/wave/working 不打断，只有新的主动动作会 `stopSpeaking()` 后再播
- 下载失败/播放错误 → 3秒后自动恢复 idle，不卡死
- `onDestroy` → `releaseMediaPlayer()`

```kotlin
// 核心字段
private var isSpeaking = false
private var mediaPlayer: MediaPlayer? = null

// dispatchAction 中的 speak 分支
"speak" -> {
    val audioName = full?.optString("audio", "") ?: ""
    val audioUrl = full?.optString("audio_url", "") ?: ""
    if (audioName.isNotEmpty() || audioUrl.isNotEmpty()) {
        playSpeakWithAudio(audioName, audioUrl)
    } else {
        playAction("speak")
    }
}
```

**⚠️ 忘记声明类字段会导致编译错误**：`private var mediaPlayer: MediaPlayer? = null` 必须加在类顶部字段区，否则方法里引用会报 `Unresolved reference`。

## 悬浮窗交互

- **展开**: 显示 GIF 动画，点击或收 action → 缩回圆点
- **缩回**: 粉色圆点 (50dp)，点击 → 展开
- **拖动**: 展开和缩回状态都支持拖动
- **idle 循环**: 8-15秒随机切换，working 模式下暂停

### ⚠️ Gravity.END 拖动方向反转

`WindowManager.LayoutParams` 使用 `Gravity.END` 时，`p.x` 是**距离右边缘**的偏移量，不是绝对坐标。所以拖动时 **dx 要取反**：

```kotlin
// Gravity.TOP | Gravity.END 时：水平拖动 dx 取反，垂直 dy 不变
p.x -= dx; p.y += dy
```

如果写成 `p.x += dx`，拖动方向会和手指相反。

## 通过飞书发送 APK

**⚠️ 飞书 `im/v1/files` file_type=stream 上传限制 30MB。** 14个GIF(200px/10fps)打包后约29MB，刚好在限制内。如果GIF是高清版(400px/10fps)则APK约40MB，需要先压缩GIF。

### APK超30MB时的GIF压缩方案

用ffmpeg大幅压缩（200px宽+8fps），14个GIF从37MB→10MB，APK从40MB→29MB：

```bash
# 压缩所有GIF到临时目录
mkdir -p /tmp/gifs_tiny
cd ~/work/cloe-android/app/src/main/assets/gifs/
for f in *.gif; do
  ffmpeg -y -i "$f" -vf "fps=8,scale=200:-1:flags=lanczos" -loop 0 /tmp/gifs_tiny/"$f" 2>/dev/null
done

# 备份原图，替换为压缩版
cp *.gif /tmp/gifs_original/   # 首次备份
cp /tmp/gifs_tiny/*.gif .

# 重新打包
cd ~/work/cloe-android && ./gradlew assembleDebug --no-daemon

# 打包完成后恢复高清原图（源码保留高清版）
cp /tmp/gifs_original/*.gif ~/work/cloe-android/app/src/main/assets/gifs/
```

## 通过飞书发送 APK

**⚠️ 飞书文件上传限制30MB，14个GIF的APK约40MB会超限。**

**解决方案**：打包前用ffmpeg压缩GIF到200px/8fps（37MB→10MB），打包后恢复原图。

```bash
# 1. 压缩GIF到临时目录
for f in app/src/main/assets/gifs/*.gif; do
  ffmpeg -y -i "$f" -vf "fps=8,scale=200:-1:flags=lanczos" -loop 0 /tmp/gifs_tiny/$(basename $f) 2>/dev/null
done

# 2. 备份原图，替换压缩版
cp -r app/src/main/assets/gifs/ /tmp/gifs_original/
cp /tmp/gifs_tiny/*.gif app/src/main/assets/gifs/

# 3. 打包
./gradlew assembleDebug --no-daemon

# 4. 恢复原图（压缩版只在APK里用）
cp /tmp/gifs_original/*.gif app/src/main/assets/gifs/
```

## 通过飞书发送 APK

**⚠️ 飞书 im/v1/files file_type=stream 限制30MB！** 原图APK（14个GIF）约43MB会超限。

### 方案1：压缩GIF（⚠️ 必须保留透明度）

```bash
# 正确方法：palettegen + paletteuse 保留 alpha 通道
for f in public/gifs/*.gif; do
  name=$(basename "$f")
  ffmpeg -y -i "$f" -vf "fps=8,scale=200:-1:flags=lanczos,palettegen=stats_mode=diff" /tmp/pal.png
  ffmpeg -y -i "$f" -i /tmp/pal.png -lavfi "[0:v]fps=8,scale=200:-1:flags=lanczos[x];[x][1:v]paletteuse" /tmp/gifs_tiny/"$name"
done
```

**❌ 错误方法（会丢失透明度，安卓显示白背景）：**
```bash
ffmpeg -y -i input.gif -vf "fps=8,scale=200:-1" output.gif  # 没有 palette → 白背景！
```

压缩后14个GIF从37MB降到17MB，APK约29MB，刚好在限制内。

**⚠️ 压缩只用于打包APK，源码assets里保留原图。打包完记得恢复。**

### 方案2：其他传输方式

飞书云文档上传、AirDrop、ADB安装等。

## Chroma Key 帧间闪烁修复

动作幅度大的GIF（如laugh大笑）chromakey抠图边缘帧间不一致，导致背景闪烁。

**修复方法**：用PIL逐帧处理半透明像素（alpha 30-150）中的绿色残留，做形态学dilation扩展前景边缘。

可委托Claude Code深度处理：`claude -p '修复laugh.gif chromakey闪烁' --effort max --allowedTools 'Read,Edit,Bash'`

**注意**：`file_type` 只支持 `stream/pdf/doc/xls/ppt`，不支持 `apk` 或 `octet-stream`。
