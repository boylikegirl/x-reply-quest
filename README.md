# X Reply Quest

一个用于记录 X/Twitter 每日回复情况的 Chrome 插件原型。数据保存在浏览器本地，可授权自动同步到插件文件夹中的 JSON 文件。

## 核心设计

- 每次回复都会记录到当天 UTC 日期下，例如 `2026-10-09`。
- 同一个人当天回复过几次会单独计数；当你在 X 页面看到他时，会在头像上方显示当日次数，没有回复过会显示 `0`。
- 每天以 UTC 00:00 自动切换到新日期，不需要手动清零。
- 回复会获得 XP：当天首次回复某人给更多经验，重复回复也会给少量经验。
- 弹窗展示今日回复数、触达人群、连续天数、等级进度、今日名单和成就。
- X 页面右上角有嵌入式详细悬浮面板，可以直接查看等级、今日名单、最近记录和成就；面板可以最小化，状态会保存在本地；点击插件图标的弹窗也保留。

## 安装

### Chrome

1. 打开 Chrome 扩展管理页：`chrome://extensions/`
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择这个目录：`outputs/x-reply-quest-extension`

### Microsoft Edge

1. 打开 Edge 扩展管理页：`edge://extensions/`
2. 开启左侧或右侧的“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择这个目录：`outputs/x-reply-quest-extension`

## 使用

1. 打开 `https://x.com/` 或 `https://twitter.com/`。
2. 正常回复帖子，插件会尝试自动记录。
3. 插件会在你正常回复时自动记录。
4. 点击浏览器工具栏里的扩展图标，可以查看当天统计。
5. 在插件弹窗里选择日期，可以查询历史记录。

## 同步到 GitHub

如果要把这个插件做成 GitHub 项目，可以在本目录执行：

```bash
git init
git add .
git commit -m "Initial X Reply Quest extension"
git branch -M main
git remote add origin https://github.com/你的用户名/x-reply-quest.git
git push -u origin main
```

后续更新代码后执行：

```bash
git add .
git commit -m "Update extension"
git push
```

## 说明

X 的页面结构经常变化，自动识别是尽力而为。这个版本不读取账号密码、不上传数据，使用 `chrome.storage.local` 本地保存记录，可选授权写入本地 JSON 文件。

## 自动同步到插件文件夹（0.3.0）

1. 在浏览器扩展管理页重新加载插件，并刷新 X 网页。点击网页悬浮面板底部“本地文件同步”，或打开工具栏插件弹窗，点击“选择文件夹 / 设置”。
2. 在打开的设置页点击“选择插件文件夹”，选择浏览器实际加载的 `x-reply-quest-extension` 目录（其中有 `manifest.json`）。
3. 允许读写后，会立即将已有全部历史保存到所选目录下的 `history.json`，并自动开启同步。浏览器如提供持久授权选项，可选择每次访问都允许。
4. 后续记录变化（包括清空今日）时自动覆盖同一文件；无需保持弹窗或设置页打开。浏览器启动或更新插件时也会尝试补同步。
5. 如浏览器重启或权限失效导致同步失败，在设置页点击“重新授权”，或重新选择文件夹。支持立即同步和关闭自动同步，关闭后已有文件保留。

浏览器安全限制要求首次由用户选择并授权目录，无法根据插件安装路径静默获得写入权限。文件夹句柄保存在扩展的 IndexedDB 中；权限不足时会显示错误，不会转存下载目录。0.2.0 的下载同步设置需要重新选择文件夹，原下载文件保留。

例如选择 `C:\Users\boylikegirl\Documents\Codex\2026-07-03\x\outputs\x-reply-quest-extension`，其他程序读取 `C:\Users\boylikegirl\Documents\Codex\2026-07-03\x\outputs\x-reply-quest-extension\history.json`。界面只显示所选文件夹名称，浏览器不会提供其完整绝对路径。

文件为 UTF-8 JSON，与手动导出的结构一致：`days["YYYY-MM-DD"].replies` 是当天回复数组，`days["YYYY-MM-DD"].people` 是按小写 handle 索引的完整名单；另包含 `version`、`totalXp`、`achievements`、`settings`、`lastRecorded` 等现有字段。日期按 UTC 划分，回复正文仅为最多 180 字的摘要。

同步是单向快照，修改 JSON 不会改动插件记录。写入失败不删除浏览器数据，写入成功关闭文件后才显示完成；其他程序遇到文件暂时不可读时应重试。“清空今日”也会同步删除文件中的今日记录。`history.json` 和备份目录已加入 `.gitignore`，避免提交个人回复记录。

开发检查（Node.js 22 或更新版本）：`node --test tests/file-sync.test.cjs`。
