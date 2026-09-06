# Personal Dota Helper

一个只服务本人的 Dota 2 桌面助手。它通过 Valve Game State Integration（GSI）在本机读取游戏主动推送的己方状态，提供简体中文仪表盘、置顶悬浮窗、阵容补全、分路出装和加点建议。

## 对局悬浮窗

- 悬浮窗独立于主面板，默认显示在主屏右上角，可拖动并记住位置。
- 顶栏鼠标图标可锁定位置并让鼠标穿透；`Ctrl+Shift+L` 可解除锁定，`Ctrl+Shift+O` 可显示或隐藏悬浮窗。
- Windows 下请使用 Dota 2 的“无边框窗口”显示模式；独占全屏无法保证被普通桌面窗口覆盖。
- 基础出装和前 10 级加点来自构建时缓存的 Dota2ProTracker 近期 7000+ MMR 对局，并按分路、对局时间和已拥有物品过滤，不再读取过期的本地默认出装。
- 对位参考来自构建时缓存的 OpenDota 英雄对局统计，低样本会被过滤并向 50% 收缩；阵容克制装备最多显示两件，并写明触发它的敌方英雄和原因。
- 中文英雄、物品和技能名称来自 Valve 简体中文 datafeed。对局期间完全离线，不向 Dota2ProTracker、OpenDota 或其他服务发送阵容。

## 阵容读取

- GSI 配置会请求 `draft` 数据，并在观战等 Valve 允许的视角下读取完整英雄阵容。
- 普通玩家视角通常只能稳定取得自己的英雄；主面板提供我方/敌方共 10 个可搜索槽位，自动读取不到的部分可以手动补全。
- 推荐只使用已经确认的敌方英雄。切换对局或进入结算阶段后，手动阵容会清空，避免串局。
- 应用不会用 OCR 截屏猜阵容，也不会读取其他玩家姓名、账号或 Steam ID。

## 边界

- 只监听 `127.0.0.1`，原始 GSI payload 不落盘。
- 只保留 `provider`、`map`、己方统计、英雄、技能、物品，以及阵容英雄 ID 的白名单字段。
- 不读取游戏内存，不注入进程，不修改启动项，不推断不可见信息。
- 不读取、存储或翻译聊天，不操作剪贴板，不模拟键盘鼠标。
- 不包含账号、云同步、遥测和广告；第三方统计只在维护数据快照时请求，比赛运行时不联网。

## 开发运行

```powershell
npm install
npm test
npm start
```

维护者可运行 `npm run data:update` 从 Valve Dota 2 官方 datafeed 刷新本地简体中文目录。`npm run meta:update` 会以约每秒一次请求的节奏更新 Dota2ProTracker 构筑和 OpenDota 对位快照，通常需要数分钟；数据归原网站所有，请勿提高请求频率。

首次打开后，在「连接」面板选择 Dota 2 目录并安装 GSI 配置。应用只会创建：

`game/dota/cfg/gamestate_integration/gamestate_integration_personal_dota_helper.cfg`

随后在 Steam 的 Dota 2「属性 → 启动选项」中手工加入 `-gamestateintegration`。应用不会编辑 Steam 的 `localconfig.vdf` 或代替你修改启动项。更新过阵容订阅后需要重启 Dota 2，游戏才会重新读取 GSI 配置。

删除配置时也只会删除带有本项目所有权标记的这一个文件。

## 项目来源

本仓库保留了 [`amefys/web`](https://github.com/amefys/web) 的 fork 关系，用来记录最初的产品调研来源。上游公开仓库只有官网、下载分发和素材，桌面应用源码并未公开。本项目因此采用 clean-room 方式独立实现，没有复制 AMEFYS 客户端源码、品牌素材或界面。

这不是 Valve 或 AMEFYS 的官方产品，也未获得其认可。
