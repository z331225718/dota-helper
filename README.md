# Personal Dota Helper

一个只服务本人的 Dota 2 桌面助手。它通过 Valve Game State Integration（GSI）在本机读取游戏主动推送的己方状态，提供简体中文仪表盘、置顶悬浮窗、分阶段出装和已验证英雄的加点建议。

## 对局悬浮窗

- 悬浮窗独立于主面板，默认显示在主屏右上角，可拖动并记住位置。
- 顶栏鼠标图标可锁定位置并让鼠标穿透；`Ctrl+Shift+L` 可解除锁定，`Ctrl+Shift+O` 可显示或隐藏悬浮窗。
- Windows 下请使用 Dota 2 的“无边框窗口”显示模式；独占全屏无法保证被普通桌面窗口覆盖。
- 出装读取本机 Dota 2 自带的 Valve 默认方案，并结合时间和已拥有物品过滤；对局期间不会请求第三方服务。
- 中文名称来自构建时缓存的 Valve 简体中文数据。当前人工加点路线覆盖克林克兹和幻影刺客；其他英雄不会用通用猜测冒充可靠建议。

## 边界

- 只监听 `127.0.0.1`，原始 GSI payload 不落盘。
- 只保留 `provider`、`map`、`player`、`hero`、`abilities`、`items` 的白名单字段。
- 不读取游戏内存，不注入进程，不修改启动项，不推断不可见信息。
- 不读取、存储或翻译聊天，不操作剪贴板，不模拟键盘鼠标。
- 不包含账号、云同步、遥测、广告和第三方 API。

## 开发运行

```powershell
npm install
npm test
npm start
```

维护者可运行 `npm run data:update` 从 Valve Dota 2 官方 datafeed 刷新本地简体中文目录。

首次打开后，在「连接」面板选择 Dota 2 目录并安装 GSI 配置。应用只会创建：

`game/dota/cfg/gamestate_integration/gamestate_integration_personal_dota_helper.cfg`

随后在 Steam 的 Dota 2「属性 → 启动选项」中手工加入 `-gamestateintegration`。应用不会编辑 Steam 的 `localconfig.vdf` 或代替你修改启动项。

删除配置时也只会删除带有本项目所有权标记的这一个文件。

## 项目来源

本仓库保留了 [`amefys/web`](https://github.com/amefys/web) 的 fork 关系，用来记录最初的产品调研来源。上游公开仓库只有官网、下载分发和素材，桌面应用源码并未公开。本项目因此采用 clean-room 方式独立实现，没有复制 AMEFYS 客户端源码、品牌素材或界面。

这不是 Valve 或 AMEFYS 的官方产品，也未获得其认可。
