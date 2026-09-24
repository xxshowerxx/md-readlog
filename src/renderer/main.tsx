// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Input } from '@heroui/react'
import type { FolderEntry, OpenedDocument, ReaderBridge } from '../shared/types'
import appIcon from '../../assets/icon.svg?url'
import './style.css'

declare global { interface Window { reader: ReaderBridge } }

interface Section {
  id: string
  start: number
  end: number
  level: number
  title: string
  parents: string[]
  markdown: string
}

interface ReadingAppearance {
  fontSize: number
  lineHeight: number
  columnWidth: number
}

const appearanceKey = 'readlog:appearance'
const defaultAppearance: ReadingAppearance = { fontSize: 17, lineHeight: 1.75, columnWidth: 38 }
const fontSizes = [16, 17, 18, 20, 22]
const lineHeights = [1.6, 1.75, 1.9]
const columnWidths = [34, 38, 44]

function savedAppearance(): ReadingAppearance {
  try {
    const stored = JSON.parse(localStorage.getItem(appearanceKey) ?? '{}') as Partial<ReadingAppearance>
    return {
      fontSize: fontSizes.includes(stored.fontSize ?? 0) ? stored.fontSize! : defaultAppearance.fontSize,
      lineHeight: lineHeights.includes(stored.lineHeight ?? 0) ? stored.lineHeight! : defaultAppearance.lineHeight,
      columnWidth: columnWidths.includes(stored.columnWidth ?? 0) ? stored.columnWidth! : defaultAppearance.columnWidth
    }
  } catch {
    return defaultAppearance
  }
}

function sectionsFor(content: string): Section[] {
  const sections: Section[] = []
  const lines = content.split(/(?<=\n)/)
  let offset = 0
  let inFence = false
  let fenceMark = ''
  const headings: { start: number; level: number; title: string }[] = []
  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const mark = fence[1][0]
      if (!inFence) { inFence = true; fenceMark = mark }
      else if (mark === fenceMark) inFence = false
    }
    if (!inFence) {
      const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line.trimEnd())
      if (heading) headings.push({ start: offset, level: heading[1].length, title: heading[2].replace(/\[([^\]]+)\]\([^)]*\)|[*_`~]/g, '$1').trim() })
    }
    offset += line.length
  }
  const markers = [{ start: 0, level: 0, title: '' }, ...headings.filter(h => h.start !== 0)]
  if (headings[0]?.start === 0) markers[0] = headings[0]
  const hierarchy: { id: string; level: number }[] = []
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]
    while (hierarchy.length && hierarchy[hierarchy.length - 1].level >= marker.level) hierarchy.pop()
    const id = `section-${i}`
    const end = markers[i + 1]?.start ?? content.length
    sections.push({ id, start: marker.start, end, level: marker.level, title: marker.title, parents: hierarchy.map(item => item.id), markdown: content.slice(marker.start, end) })
    if (marker.level) hierarchy.push({ id, level: marker.level })
  }
  return sections
}

function chunksFor(content: string, chunkSize = 32000): Section[] {
  const chunks: Section[] = []
  for (let start = 0, i = 0; start < content.length; i++) {
    let end = Math.min(start + chunkSize, content.length)
    if (end < content.length) {
      const newline = content.indexOf('\n', end)
      if (newline !== -1 && newline - end < 1000) end = newline + 1
    }
    chunks.push({ id: `chunk-${i}`, start, end, level: 0, title: '', parents: [], markdown: content.slice(start, end) })
    start = end
  }
  return chunks
}

function App() {
  const [documents, setDocuments] = useState<OpenedDocument[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [files, setFiles] = useState<FolderEntry[]>([])
  const [leftMode, setLeftMode] = useState<'files' | 'outline'>('outline')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [rightMode, setRightMode] = useState<'search' | 'appearance'>('search')
  const [appearance, setAppearance] = useState<ReadingAppearance>(savedAppearance)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [selectedMatch, setSelectedMatch] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const readerRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const restoringRef = useRef(false)
  const appearanceAnchorRef = useRef<{ element: HTMLElement; fraction: number } | null>(null)
  const doc = documents.find(item => item.path === activePath)
  const plainMode = !!doc && doc.size > 1024 * 1024 && !/(^|\n) {0,3}(#{1,6}[ \t]|[-*+] |\d+\. |```|~~~|> |\|[^\n]*\|)|!?\[[^\]]+\]\(/m.test(doc.content)
  const sections = useMemo(() => doc ? (plainMode ? chunksFor(doc.content) : sectionsFor(doc.content)) : [], [doc, plainMode])
  const matches = useMemo(() => {
    if (!doc || !query.trim()) return [] as number[]
    const result: number[] = []
    const lower = doc.content.toLocaleLowerCase()
    const needle = query.toLocaleLowerCase()
    let at = 0
    while ((at = lower.indexOf(needle, at)) !== -1 && result.length < 1000) { result.push(at); at += Math.max(needle.length, 1) }
    return result
  }, [doc, query])

  const addDocument = useCallback((incoming: OpenedDocument) => {
    setDocuments(previous => [...previous.filter(item => item.path !== incoming.path), incoming])
    setActivePath(incoming.path)
    setFolder(incoming.folder)
    window.reader.listFolder(incoming.folder).then(setFiles).catch(() => setFiles([]))
    setError('')
  }, [])

  useEffect(() => window.reader.onOpenFile(addDocument), [addDocument])
  useEffect(() => window.reader.onOpenFolder(result => {
    setFolder(result.folder)
    setFiles(result.entries)
    setLeftMode('files')
    setLeftOpen(true)
    setError('')
  }), [])
  useEffect(() => {
    const onKeys = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); void openFile() }
      if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setRightOpen(true); setRightMode('search'); requestAnimationFrame(() => searchRef.current?.focus()) }
    }
    window.addEventListener('keydown', onKeys)
    return () => window.removeEventListener('keydown', onKeys)
  }, [])

  useEffect(() => { localStorage.setItem(appearanceKey, JSON.stringify(appearance)) }, [appearance])

  useEffect(() => {
    const closePanelsWhenNarrow = () => {
      if (window.innerWidth <= 900) { setLeftOpen(false); setRightOpen(false) }
    }
    closePanelsWhenNarrow()
    window.addEventListener('resize', closePanelsWhenNarrow)
    return () => window.removeEventListener('resize', closePanelsWhenNarrow)
  }, [])

  useLayoutEffect(() => {
    if (!doc || !readerRef.current) return
    restoringRef.current = true
    const key = `readlog:position:${doc.path}`
    const saved = Number(localStorage.getItem(key) ?? 0)
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (readerRef.current) readerRef.current.scrollTop = saved
      window.setTimeout(() => { restoringRef.current = false }, 150)
    }))
    return () => cancelAnimationFrame(frame)
  }, [doc?.path])

  useLayoutEffect(() => {
    const anchor = appearanceAnchorRef.current
    const reader = readerRef.current
    appearanceAnchorRef.current = null
    if (!anchor || !reader || !anchor.element.isConnected) return
    const viewport = reader.getBoundingClientRect()
    const rect = anchor.element.getBoundingClientRect()
    const previousBehavior = reader.style.scrollBehavior
    reader.style.scrollBehavior = 'auto'
    reader.scrollTop += rect.top + rect.height * anchor.fraction - viewport.top - 80
    reader.style.scrollBehavior = previousBehavior
  }, [appearance])

  function changeAppearance(next: ReadingAppearance) {
    const reader = readerRef.current
    if (reader) {
      const viewport = reader.getBoundingClientRect()
      const y = viewport.top + 80
      const elements = reader.querySelectorAll<HTMLElement>('.document-section p, .document-section li, .document-section pre, .document-section h1, .document-section h2, .document-section h3, .document-section h4, .document-section h5, .document-section h6')
      const element = [...elements].find(item => { const rect = item.getBoundingClientRect(); return rect.top <= y && rect.bottom > y })
        ?? [...elements].find(item => item.getBoundingClientRect().top > y)
      if (element) {
        const rect = element.getBoundingClientRect()
        appearanceAnchorRef.current = { element, fraction: Math.max(0, Math.min(1, (y - rect.top) / rect.height)) }
      }
    }
    setAppearance(next)
  }

  function savePosition() {
    if (!restoringRef.current && doc && readerRef.current) localStorage.setItem(`readlog:position:${doc.path}`, String(readerRef.current.scrollTop))
  }

  async function openFile() {
    try { const result = await window.reader.openFile(); if (result) addDocument(result) }
    catch (cause) { setError(String(cause)) }
  }
  async function openFolder() {
    try {
      const result = await window.reader.openFolder()
      if (result) { setFolder(result.folder); setFiles(result.entries); setLeftMode('files'); setLeftOpen(true); setError('') }
    } catch (cause) { setError(String(cause)) }
  }
  async function openPath(filePath: string) {
    try { addDocument(await window.reader.readFile(filePath)) }
    catch (cause) { setError(String(cause)) }
  }
  function closeTab(filePath: string) {
    savePosition()
    const remaining = documents.filter(item => item.path !== filePath)
    setDocuments(remaining)
    if (activePath === filePath) setActivePath(remaining.at(-1)?.path ?? null)
  }
  function jumpTo(section: Section, force = false) {
    setCollapsed(previous => {
      const next = new Set(previous)
      for (const id of [...section.parents, section.id]) next.delete(id)
      return next
    })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.getElementById(section.id)
      const viewport = readerRef.current
      if (!target || !viewport) return
      const top = target.getBoundingClientRect().top
      const rect = viewport.getBoundingClientRect()
      if (force || top < rect.top || top > rect.bottom - 80) target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }))
  }
  function revealMatch(section: Section, offset: number) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = document.getElementById(section.id)
      const viewport = readerRef.current
      if (!element || !viewport || !query) return
      const range = document.createRange()
      if (plainMode) {
        const textNode = element.querySelector('pre')?.firstChild
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return
        const start = offset - section.start
        range.setStart(textNode, start)
        range.setEnd(textNode, Math.min(start + query.length, textNode.textContent?.length ?? start))
      } else {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let found = false
        while (walker.nextNode()) {
          const node = walker.currentNode
          const at = node.textContent?.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) ?? -1
          if (at < 0) continue
          range.setStart(node, at)
          range.setEnd(node, Math.min(at + query.length, node.textContent?.length ?? at))
          found = true
          break
        }
        if (!found) return
      }
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const rect = range.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      viewport.scrollTop += rect.top - viewportRect.top - 120
    }))
  }
  function goToMatch(index: number) {
    setSelectedMatch(index)
    const offset = matches[index]
    const section = sections.find(item => offset >= item.start && offset < item.end)
    if (section) {
      setCollapsed(previous => {
        const next = new Set(previous)
        for (const id of [...section.parents, section.id]) next.delete(id)
        return next
      })
      revealMatch(section, offset)
    }
  }
  function toggleSection(id: string) {
    setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function handleDrop(event: React.DragEvent) {
    event.preventDefault(); setDragging(false)
    const dropped = [...event.dataTransfer.files].find(file => /\.(md|markdown|mdown|mkd)$/i.test(file.name))
    const droppedPath = dropped && window.reader.pathForFile(dropped)
    if (droppedPath) void openPath(droppedPath)
    else setError('请拖入本地 Markdown 文件')
  }

  const visible = sections.filter(section => section.parents.every(id => !collapsed.has(id)))
  return <div className="app" style={{
    '--reader-font-size': `${appearance.fontSize}px`,
    '--reader-line-height': appearance.lineHeight,
    '--reader-column-width': `${appearance.columnWidth}em`
  } as React.CSSProperties} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={handleDrop}>
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src={appIcon} alt="" /><span className="brand-copy"><strong>MD-Readlog</strong><small>专注阅读，保留原文</small></span></div>
      <div className="top-actions"><Button variant="primary" size="sm" onPress={() => void openFile()}>＋ 打开原稿</Button><Button variant="secondary" size="sm" onPress={() => void openFolder()}>打开文件夹</Button><span className="separator" /><Button className="panel-button" variant={leftOpen ? 'secondary' : 'ghost'} size="sm" aria-label="切换左栏" aria-pressed={leftOpen} onPress={() => { const next = !leftOpen; setLeftOpen(next); if (next && window.innerWidth <= 900) setRightOpen(false) }}>大纲</Button><Button className="panel-button" variant={rightOpen && rightMode === 'search' ? 'secondary' : 'ghost'} size="sm" aria-label="切换右栏" aria-pressed={rightOpen && rightMode === 'search'} onPress={() => { const next = !rightOpen || rightMode !== 'search'; setRightOpen(next); setRightMode('search'); if (next && window.innerWidth <= 900) setLeftOpen(false) }}>搜索</Button><Button variant={rightOpen && rightMode === 'appearance' ? 'secondary' : 'ghost'} size="sm" aria-label="阅读设置" aria-pressed={rightOpen && rightMode === 'appearance'} onPress={() => { setRightOpen(true); setRightMode('appearance'); if (window.innerWidth <= 900) setLeftOpen(false) }}>阅读设置</Button></div>
    </header>
    <nav className="tabs" aria-label="原稿标签">{documents.map(item => <div key={item.path} className={`tab ${item.path === activePath ? 'active' : ''}`}><button title={item.path} onClick={() => { savePosition(); setActivePath(item.path); setFolder(item.folder); void window.reader.listFolder(item.folder).then(setFiles) }}>{item.name}</button><button className="tab-close" aria-label={`关闭 ${item.name}`} onClick={() => closeTab(item.path)}>×</button></div>)}</nav>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    <div className="workspace">
      {leftOpen && <aside className="sidebar left"><div className="sidebar-tabs"><button className={leftMode === 'outline' ? 'selected' : ''} onClick={() => setLeftMode('outline')}>大纲</button><button className={leftMode === 'files' ? 'selected' : ''} onClick={() => setLeftMode('files')}>文件</button></div>
        {leftMode === 'outline' ? <div className="sidebar-content">{doc && !plainMode ? sections.filter(item => item.level > 0).map(item => <div key={item.id} className="outline-row" style={{ paddingLeft: `${8 + (item.level - 1) * 14}px` }}><button className="outline-toggle" aria-label={`${collapsed.has(item.id) ? '展开' : '折叠'}章节 ${item.title}`} onClick={() => toggleSection(item.id)}>{collapsed.has(item.id) ? '▸' : '▾'}</button><button className="outline-link" title={item.title} onClick={() => jumpTo(item)}>{item.title}</button></div>) : <p className="hint">{plainMode ? '大文件使用分块阅读模式' : '打开原稿后显示标题大纲'}</p>}</div>
          : <div className="sidebar-content">{folder && <div className="folder-name" title={folder}>{folder}</div>}{files.map(file => <button key={file.path} className={`file-row ${file.path === activePath ? 'current' : ''}`} onClick={() => void openPath(file.path)}>{file.name}</button>)}{files.length === 0 && <p className="hint">打开文件夹以查看 Markdown 文件</p>}</div>}
      </aside>}
      <main className="reader" ref={readerRef} onScroll={savePosition}>
        {doc ? <article className="paper"><div className="document-header"><div className="document-label"><span className="read-only-dot" />只读原稿<span className="label-divider">/</span><strong>{doc.name}</strong></div><div className="document-path" title={doc.path}>{doc.path}</div></div>{doc.size > 5 * 1024 * 1024 && <div className="size-warning">原稿超过 5 MB，搜索或滚动可能变慢。</div>}
          {visible.map(section => <section className={`document-section ${plainMode ? 'plain-chunk' : ''}${collapsed.has(section.id) ? ' is-collapsed' : ''}`} id={section.id} key={section.id}>
            {plainMode ? <pre>{section.markdown}</pre> : <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
              img: ({ src, alt, ...props }) => <img {...props} src={src ? window.reader.imageUrl(doc.path, src) : undefined} alt={alt ?? ''} loading="lazy" />,
              a: ({ href, children, ...props }) => <a {...props} href={href} onClick={event => { event.preventDefault(); if (!href) return; if (/^https?:\/\//i.test(href)) void window.reader.openExternal(href); else if (/\.(md|markdown|mdown|mkd)(#.*)?$/i.test(href)) { const pathPart = href.split('#')[0]; const base = doc.path.replace(/[^\\/]+$/, ''); void openPath(base + decodeURIComponent(pathPart)) } }}>{children}</a>
            }}>{section.markdown}</ReactMarkdown>}
            {!plainMode && section.level > 0 && <button className="section-collapse" aria-expanded={!collapsed.has(section.id)} aria-label={`${collapsed.has(section.id) ? '展开' : '折叠'}本节 ${section.title}`} onClick={() => toggleSection(section.id)}>{collapsed.has(section.id) ? '展开本节' : '折叠本节'}</button>}
          </section>)}
        </article> : <div className="welcome"><img className="welcome-icon" src={appIcon} alt="" /><div className="welcome-kicker">你的阅读空间</div><h1>从一篇原稿开始</h1><p>打开本地 Markdown，安静地阅读、导航和搜索。原稿始终保持只读。</p><div className="welcome-actions"><Button variant="primary" onPress={() => void openFile()}>打开原稿</Button><Button variant="secondary" onPress={() => void openFolder()}>打开文件夹</Button></div><div className="shortcut">Ctrl + O 打开原稿 <span>·</span> Ctrl + F 文内搜索</div></div>}
      </main>
      {rightOpen && <aside className="sidebar right">{rightMode === 'search' ? <>
        <div className="panel-title">文内搜索</div><Input ref={searchRef} value={query} placeholder="搜索当前原稿…" onChange={event => { setQuery(event.target.value); setSelectedMatch(0) }} aria-label="搜索当前原稿" variant="secondary" fullWidth />{query && <div className="match-count">{matches.length === 1000 ? '前 1000 处' : `${matches.length} 处匹配`}</div>}<div className="search-results">{matches.slice(0, 100).map((offset, index) => <button key={offset} className={selectedMatch === index ? 'selected' : ''} onClick={() => goToMatch(index)}><span className="result-number">{index + 1}</span>{doc?.content.slice(Math.max(0, offset - 42), Math.min(doc.content.length, offset + query.length + 65)).replace(/\s+/g, ' ')}</button>)}</div>{doc && <div className="doc-info"><div>原稿信息</div><p>{(doc.size / 1024).toFixed(1)} KB · {sections.length} {plainMode ? '分块' : '章节'}</p><p>只读模式</p></div>}
      </> : <div className="appearance-panel">
        <h2 className="panel-title">阅读设置</h2>
        <p className="appearance-font">默认字体 <strong>思源黑体</strong></p>
        <label className="appearance-field">正文字号<select aria-label="正文字号" value={appearance.fontSize} onChange={event => changeAppearance({ ...appearance, fontSize: Number(event.target.value) })}>{fontSizes.map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
        <label className="appearance-field">行高<select aria-label="行高" value={appearance.lineHeight} onChange={event => changeAppearance({ ...appearance, lineHeight: Number(event.target.value) })}>{lineHeights.map(height => <option key={height} value={height}>{height}</option>)}</select></label>
        <label className="appearance-field">阅读宽度<select aria-label="阅读宽度" value={appearance.columnWidth} onChange={event => changeAppearance({ ...appearance, columnWidth: Number(event.target.value) })}>{columnWidths.map(width => <option key={width} value={width}>{width === 34 ? '窄' : width === 38 ? '标准' : '宽'} · 约 {width} 汉字</option>)}</select></label>
        <button className="appearance-reset" onClick={() => changeAppearance(defaultAppearance)}>恢复默认排版</button>
        <p className="appearance-hint">设置自动保存，只改变阅读显示，不修改原稿。</p>
      </div>}</aside>}
    </div>{dragging && <div className="drop-overlay">松开以打开 Markdown 原稿</div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
