// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
export interface OpenedDocument {
  path: string
  name: string
  content: string
  size: number
  folder: string
}

export interface FolderEntry {
  path: string
  name: string
}

export interface FolderResult {
  folder: string
  entries: FolderEntry[]
}

export interface ReaderBridge {
  openFile(): Promise<OpenedDocument | null>
  openFolder(): Promise<FolderResult | null>
  readFile(path: string): Promise<OpenedDocument>
  listFolder(folder: string): Promise<FolderEntry[]>
  imageUrl(documentPath: string, source: string): string
  pathForFile(file: File): string
  openExternal(url: string): Promise<void>
  onOpenFile(handler: (file: OpenedDocument) => void): () => void
  onOpenFolder(handler: (folder: FolderResult) => void): () => void
}
