// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import type { FolderEntry, OpenedDocument } from '../shared/types'

protocol.registerSchemesAsPrivileged([{ scheme: 'readlog-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const extensions = new Set(['.md', '.markdown', '.mdown', '.mkd'])
const allowedFolders = new Set<string>()
let window: BrowserWindow | null = null
let pendingPaths: string[] = []
let rendererReady = false

function isMarkdown(filePath: string): boolean {
  return extensions.has(path.extname(filePath).toLowerCase())
}

async function documentFromPath(filePath: string): Promise<OpenedDocument> {
  const absolute = path.resolve(filePath)
  if (!isMarkdown(absolute)) throw new Error('只能打开 Markdown 原稿')
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error('不是文件')
  const content = await readFile(absolute, 'utf8')
  const folder = path.dirname(absolute)
  allowedFolders.add(folder.toLowerCase())
  return { path: absolute, name: path.basename(absolute), content, size: info.size, folder }
}

async function folderEntries(folder: string): Promise<FolderEntry[]> {
  const absolute = path.resolve(folder)
  const info = await stat(absolute)
  if (!info.isDirectory()) throw new Error('不是文件夹')
  allowedFolders.add(absolute.toLowerCase())
  const entries = await readdir(absolute, { withFileTypes: true })
  return entries.filter(entry => entry.isFile() && isMarkdown(entry.name))
    .map(entry => ({ path: path.join(absolute, entry.name), name: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

function findMarkdownArgument(args: string[]): string | undefined {
  return args.find(arg => isMarkdown(arg) && !arg.startsWith('--'))
}

function sendFile(filePath: string): void {
  if (!window || !rendererReady) {
    pendingPaths.push(filePath)
    return
  }
  documentFromPath(filePath)
    .then(doc => window?.webContents.send('reader:open-file', doc))
    .catch(error => dialog.showErrorBox('无法打开原稿', String(error)))
}

function installAssociation(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const exe = process.execPath
  const commands = [
    ['add', 'HKCU\\Software\\Classes\\MarkdownReadlog.Document', '/ve', '/d', 'Markdown 文档', '/f'],
    ['add', 'HKCU\\Software\\Classes\\MarkdownReadlog.Document\\DefaultIcon', '/ve', '/d', `"${exe}",0`, '/f'],
    ['add', 'HKCU\\Software\\Classes\\MarkdownReadlog.Document\\shell\\open\\command', '/ve', '/d', `"${exe}" "%1"`, '/f'],
    ...['.md', '.markdown', '.mdown', '.mkd'].map(ext => ['add', `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', 'MarkdownReadlog.Document', '/t', 'REG_NONE', '/d', '', '/f'])
  ]
  for (const args of commands) spawn('reg.exe', args, { windowsHide: true })
}

function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false
  const event = process.argv[1]
  if (!event?.startsWith('--squirrel-')) return false
  if (event === '--squirrel-install' || event === '--squirrel-updated') installAssociation()
  app.quit()
  return true
}

if (!handleSquirrelEvent()) {
  const locked = app.requestSingleInstanceLock()
  if (!locked) app.quit()
  else {
    const initial = findMarkdownArgument(process.argv.slice(1))
    if (initial) pendingPaths.push(initial)
    app.on('second-instance', (_event, argv) => {
      window?.show()
      window?.focus()
      const file = findMarkdownArgument(argv.slice(1))
      if (file) sendFile(file)
    })
    app.whenReady().then(() => {
      app.setName('MD-Readlog')
      const chooseFile = async () => {
        const result = await dialog.showOpenDialog({ title: '选择 Markdown 原稿', properties: ['openFile'], filters: [{ name: 'Markdown 原稿', extensions: ['md', 'markdown', 'mdown', 'mkd'] }] })
        return result.canceled ? null : result.filePaths[0]
      }
      const chooseFolder = async () => {
        const result = await dialog.showOpenDialog({ title: '选择原稿文件夹', properties: ['openDirectory'] })
        if (result.canceled) return null
        const folder = result.filePaths[0]
        return { folder, entries: await folderEntries(folder) }
      }
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: '文件', submenu: [
          { label: '打开原稿…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseFile().then(file => { if (file) sendFile(file) }) } },
          { label: '打开文件夹…', click: () => { void chooseFolder().then(result => { if (result) window?.webContents.send('reader:open-folder-result', result) }) } },
          { type: 'separator' },
          { label: '退出', role: 'quit' }
        ] },
        { label: '编辑', submenu: [
          { label: '撤销', role: 'undo' },
          { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          { label: '全选', role: 'selectAll' },
          { type: 'separator' },
          { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => window?.webContents.send('reader:focus-search') }
        ] },
        { label: '视图', submenu: [
          { label: '重新加载', role: 'reload' },
          { label: '放大', role: 'zoomIn' },
          { label: '缩小', role: 'zoomOut' },
          { label: '重置缩放', role: 'resetZoom' },
          { type: 'separator' },
          { label: '切换全屏', role: 'togglefullscreen' }
        ] },
        { label: '帮助', submenu: [
          { label: '关于 MD-Readlog', click: () => { void dialog.showMessageBox({ title: '关于 MD-Readlog', message: 'MD-Readlog', detail: `版本 ${app.getVersion()}\n本地 Markdown 阅读器\n\nCopyright (C) 2026 Markdown Readlog contributors\nGPL-3.0-or-later`, buttons: ['确定'] }) } }
        ] }
      ]))
      protocol.handle('readlog-asset', async request => {
        try {
          const encoded = new URL(request.url).pathname.slice(1)
          const file = path.resolve(decodeURIComponent(encoded))
          const allowed = [...allowedFolders].some(folder => file.toLowerCase().startsWith(folder + path.sep))
          if (!allowed) return new Response('Forbidden', { status: 403 })
          return net.fetch(pathToFileURL(file).toString())
        } catch { return new Response('Not found', { status: 404 }) }
      })

      ipcMain.handle('reader:open-file', async () => {
        const file = await chooseFile()
        return file ? documentFromPath(file) : null
      })
      ipcMain.handle('reader:open-folder', chooseFolder)
      ipcMain.handle('reader:read-file', (_event, filePath: string) => documentFromPath(filePath))
      ipcMain.handle('reader:list-folder', (_event, folder: string) => folderEntries(folder))
      ipcMain.handle('reader:open-external', async (_event, url: string) => {
        if (!/^https?:\/\//i.test(url)) throw new Error('不支持的链接')
        await shell.openExternal(url)
      })
      ipcMain.on('reader:ready', () => {
        rendererReady = true
        for (const file of pendingPaths.splice(0)) sendFile(file)
      })

      window = new BrowserWindow({
        width: 1360, height: 900, minWidth: 780, minHeight: 540,
        icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
        backgroundColor: '#f7f5f0',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.on('did-start-loading', () => { rendererReady = false })
      window.on('closed', () => { window = null })
      window.loadFile(path.join(__dirname, '../../renderer/index.html'))
    })
    app.on('window-all-closed', () => app.quit())
  }
}
