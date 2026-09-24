// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ReaderBridge, OpenedDocument, FolderResult } from '../shared/types'

const bridge: ReaderBridge = {
  openFile: () => ipcRenderer.invoke('reader:open-file'),
  openFolder: () => ipcRenderer.invoke('reader:open-folder'),
  readFile: file => ipcRenderer.invoke('reader:read-file', file),
  listFolder: folder => ipcRenderer.invoke('reader:list-folder', folder),
  imageUrl: (documentPath, source) => {
    const normalized = source.replaceAll('\\', '/')
    if (/^[a-z]+:/i.test(normalized) || normalized.startsWith('//')) return source
    const parts = documentPath.replaceAll('\\', '/').split('/')
    parts.pop()
    for (const part of normalized.split('/')) {
      if (part === '..') parts.pop()
      else if (part && part !== '.') parts.push(part)
    }
    return `readlog-asset://local/${encodeURIComponent(parts.join('\\'))}`
  },
  pathForFile: file => webUtils.getPathForFile(file),
  openExternal: url => ipcRenderer.invoke('reader:open-external', url),
  onOpenFile: handler => {
    const listener = (_event: Electron.IpcRendererEvent, file: OpenedDocument) => handler(file)
    ipcRenderer.on('reader:open-file', listener)
    ipcRenderer.send('reader:ready')
    return () => ipcRenderer.removeListener('reader:open-file', listener)
  },
  onOpenFolder: handler => {
    const listener = (_event: Electron.IpcRendererEvent, folder: FolderResult) => handler(folder)
    ipcRenderer.on('reader:open-folder-result', listener)
    return () => ipcRenderer.removeListener('reader:open-folder-result', listener)
  }
}

contextBridge.exposeInMainWorld('reader', bridge)
ipcRenderer.on('reader:focus-search', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })))
