# MD-Readlog

MD-Readlog 是面向 Windows 的本地 Markdown 阅读应用。打开文档后默认只读，阅读、导航和搜索不会修改原文件。当前版本为早期开发版，批注、编辑和导出等功能尚未实现。

## 已实现的功能

- 打开单个 Markdown 文件、文件夹，或拖入文件；可在多个标签间切换。
- 阅读标题、列表、链接、表格、代码块、相对路径图片和常见 GFM 内容。
- 在三栏界面中切换文件列表与标题大纲，折叠章节并搜索原稿。
- 关闭后重新打开时恢复阅读位置；大体积纯文本原稿使用分块阅读，并提示可能的性能影响。
- 内置思源黑体，提供字号、行高和阅读宽度设置；调整排版时保留当前阅读段落。
- 提供中文窗口菜单、HeroUI 界面和应用图标。

## 下载与使用

目前尚未发布公开安装包。发布后可在本仓库的 GitHub Releases 页面下载 `MD-Readlog-Setup.exe` 并安装。

安装后可在应用内打开原稿或文件夹，也可拖入 Markdown 文件。若要双击 `.md` 文件直接打开 MD-Readlog，请在 Windows“打开方式”中将它设为默认应用。使用 `Ctrl+O` 打开原稿，`Ctrl+F` 搜索当前原稿。

## 从源码运行

在 Windows 上安装 Node.js 20.20 或更新的兼容版本，然后运行：

```powershell
npm ci
npm start
```

`npm start` 会构建并启动 Electron 应用。需要边修改边查看效果时，使用下面的 `dev:app` 命令。

## 本地快速预览

完成某个改动后想立刻看到界面效果，不需要打安装包：

```powershell
npm run dev:app
```

该命令会编译主进程、启动 Vite 渲染进程开发服务器，再用 Electron 打开应用。随后：

- 改动 `src/renderer` 下的代码会自动刷新界面；
- 改动 `src/main` 或 `src/shared` 会自动重新编译并重启应用窗口；
- 关闭应用窗口会一并退出开发服务器；按 `Ctrl+C` 同样会收尾退出。

可以直接带上要预览的原稿路径，或加上可选参数：

```powershell
npm run dev:app -- "D:\notes\sample.md" --devtools   # 打开指定原稿并弹出 DevTools
npm run dev:app -- --no-watch                        # 不监听主进程源码变化
```

PowerShell 中需要换端口时运行：`$env:READLOG_DEV_PORT = '5174'; npm run dev:app`。

## 验证

```powershell
npm run typecheck
npm test
```

测试通过 Playwright 启动 Electron。生成安装包使用 `npm run make`，当前尚未发布正式安装包。

## 许可

本项目以 [GNU GPL v3 或更新版本](LICENSE) 发布。修改和分发时请遵守许可条款。

随应用提供的思源黑体按 [SIL Open Font License 1.1](public/fonts/LICENSE.txt) 分发，字体来源与校验值见 [SOURCE.txt](public/fonts/SOURCE.txt)。
