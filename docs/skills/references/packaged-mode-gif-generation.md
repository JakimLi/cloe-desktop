# 打包模式（Packaged Cloe.app）GIF 生成修复

## 问题

打包版 Cloe.app 中 AI 生成动作 GIF 永远卡在 "starting"。根因：asar 是只读归档。

## 9 个 asar 陷阱

1. Python 脚本不在 asar → package.json 加 extraResources
2. Python 读不了 asar 内参考图 → resolveReferenceForPython() 复制到 temp
3. Python 写不了 asar 输出目录 → getGifsDataDir() 返回 userData/gifs/
4. spawn cwd 不能是 asar 路径 → 改用 getGifsDataDir()
5. renderer file:// 加载不到 userData GIF → BASE 改为 bridge HTTP
6. 管理界面 ASSET_BASE 也要改 → 用 bridge HTTP
7. action-sets.json 写入 asar 丢失 → 返回 userData/action-sets.json
8. WS 连接时不广播 set-config → connection 时立即发
9. 静态文件路由分三路：GIFs (userData→asar), refs (userData/assets→asar), audio (asar only)

## 路径体系

| 函数 | 打包模式 | 开发模式 |
|------|---------|---------|
| getScriptsDir() | Resources/scripts/ | __dirname/scripts/ |
| getGifsDataDir() | userData/gifs/ | public/gifs/ |
| getActionSetsPath() | userData/action-sets.json | public/action-sets.json |
| getPublicAssetsRoot() | __dirname/dist (只读) | __dirname/public |
| getWritableAssetsRoot() | userData/assets/ | __dirname/public |

## 教训

- 绝对不要删 userData 里的数据来调试
- dev 正常 ≠ 打包后正常
- asar 对子进程不透明，Electron fs patch 只在 Node.js 层面工作
- renderer 硬编码 + WS set-config 双轨要同步
