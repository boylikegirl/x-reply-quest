# X Reply Quest

一个用于记录 X/Twitter 每日回复情况的 Chrome 插件原型。数据只保存在浏览器本地。

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

X 的页面结构经常变化，自动识别是尽力而为。这个版本不读取账号密码、不联网、不上传数据，只使用 `chrome.storage.local` 本地保存记录。
