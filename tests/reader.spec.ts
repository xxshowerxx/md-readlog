// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'

const electronBinary = require('electron') as string
const packagedBinary = process.env.READLOG_PACKAGED_EXECUTABLE
const launchBinary = packagedBinary ?? electronBinary
const argsFor = (file: string) => packagedBinary ? [file] : ['.', file]

test('opens a Markdown 原稿, navigates collapsed sections, searches, and keeps bytes unchanged', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-reader-'))
  const file = path.join(folder, 'sample.md')
  const nextFile = path.join(folder, 'second.md')
  const image = path.join(folder, 'pixel.png')
  const source = '# 第一章\n\n文本开头。\n\n![相对图片](pixel.png)\n\n| 列 A | 列 B |\n|---|---|\n| 甲 | 乙 |\n\n```ts\nconst ok = true\n```\n\n## 第二节\n\n隐藏的搜索词：松树。\n'
  await writeFile(file, source)
  await writeFile(nextFile, '# 第二篇\n\n新窗口传来的原稿。\n')
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
  const before = createHash('sha256').update(await readFile(file)).digest('hex')
  const app = await electron.launch({ args: argsFor(file), executablePath: launchBinary })
  try {
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map(item => ({
      label: item.label,
      children: item.submenu?.items.map(child => child.label)
    })))
    expect(menu?.map(item => item.label)).toEqual(['文件', '编辑', '视图', '帮助'])
    expect(menu?.[1].children).toContain('撤销')
    expect(menu?.[1].children).toContain('重做')
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '第一章' })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: 'const ok = true' })).toBeVisible()
    await expect(page.getByAltText('相对图片')).toBeVisible()
    await expect.poll(async () => page.getByAltText('相对图片').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    await page.getByRole('button', { name: '折叠章节 第一章' }).click()
    await expect(page.getByRole('heading', { name: '第二节' })).toHaveCount(0)
    await page.getByRole('textbox', { name: '搜索当前原稿' }).fill('松树')
    await expect(page.getByText('1 处匹配')).toBeVisible()
    await page.getByRole('button', { name: /松树/ }).click()
    await expect(page.getByRole('heading', { name: '第二节' })).toBeVisible()

    const child = spawn(launchBinary, argsFor(nextFile), { cwd: process.cwd(), stdio: 'ignore', windowsHide: true })
    child.unref()
    await expect(page.getByRole('button', { name: 'second.md' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'sample.md' }).first().click()
    await expect(page.getByRole('heading', { name: '第一章' })).toBeVisible()
    expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(before)
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('collapses a section body and expands it for search', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-collapse-'))
  const file = path.join(folder, 'collapse.md')
  await writeFile(file, '# 第一章\n\n一级内容。\n\n## 第一节\n\n这一节的正文应当被折叠。\n\n## 第二节\n\n另一节的正文应保持不变。\n')
  const app = await electron.launch({ args: argsFor(file), executablePath: launchBinary })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '折叠本节 第一节' }).click()
    await expect(page.getByRole('heading', { name: '第一节' })).toBeVisible()
    await expect(page.getByText('这一节的正文应当被折叠。')).toBeHidden()
    await expect(page.getByText('另一节的正文应保持不变。')).toBeVisible()
    await page.getByRole('button', { name: '展开本节 第一节' }).click()
    await expect(page.getByText('这一节的正文应当被折叠。')).toBeVisible()
    await page.getByRole('button', { name: '折叠本节 第一章' }).click()
    await expect(page.getByRole('heading', { name: '第一章' })).toBeVisible()
    await expect(page.getByText('一级内容。')).toBeHidden()
    await expect(page.getByRole('heading', { name: '第二节' })).toHaveCount(0)
    await page.getByRole('textbox', { name: '搜索当前原稿' }).fill('一级内容')
    await page.getByRole('button', { name: /一级内容/ }).click()
    await expect(page.getByText('一级内容。', { exact: true })).toBeVisible()
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('uses bundled Source Han Sans for readable Chinese text', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-type-'))
  const file = path.join(folder, 'type.md')
  await writeFile(file, '# 排版样本\n\n思源黑体阅读 Mixed123 中英混排。\n')
  const app = await electron.launch({ args: argsFor(file), executablePath: launchBinary })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('思源黑体阅读 Mixed123 中英混排。')).toBeVisible()
    await page.getByRole('button', { name: '阅读设置' }).click()
    await page.getByRole('button', { name: '恢复默认排版' }).click()
    const typography = await page.evaluate(async () => {
      await document.fonts.ready
      const text = document.querySelector('.document-section p')!
      const paper = document.querySelector('.paper')!
      const style = getComputedStyle(text)
      const paperStyle = getComputedStyle(paper)
      return {
        family: style.fontFamily,
        loaded: [...document.fonts].some(font => font.family === 'MD Source Han Sans' && font.status === 'loaded'),
        size: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        autospace: style.getPropertyValue('text-autospace'),
        columnCharacters: (paper.clientWidth - parseFloat(paperStyle.paddingLeft) - parseFloat(paperStyle.paddingRight)) / parseFloat(style.fontSize)
      }
    })
    expect(typography.family).toContain('MD Source Han Sans')
    expect(typography.family).not.toMatch(/YaHei|微软雅黑/i)
    expect(typography.loaded).toBe(true)
    expect(typography.size).toBeGreaterThanOrEqual(16)
    expect(typography.lineHeight / typography.size).toBeGreaterThanOrEqual(1.7)
    expect(typography.autospace).toBe('normal')
    expect(typography.columnCharacters).toBeGreaterThanOrEqual(30)
    expect(typography.columnCharacters).toBeLessThanOrEqual(40)
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('keeps reading typography choices after reopening without editing the 原稿', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-settings-'))
  const file = path.join(folder, 'settings.md')
  await writeFile(file, '# 排版示例\n\n' + '这一段用于检查阅读位置和排版。\n\n'.repeat(100))
  const before = createHash('sha256').update(await readFile(file)).digest('hex')
  const open = () => electron.launch({ args: argsFor(file), executablePath: launchBinary })
  const app = await open()
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '阅读设置' }).click()
    await page.getByRole('combobox', { name: '正文字号' }).selectOption('20')
    await page.getByRole('combobox', { name: '行高' }).selectOption('1.9')
    await page.getByRole('combobox', { name: '阅读宽度' }).selectOption('44')
    const values = await page.locator('.document-section p').first().evaluate(element => {
      const style = getComputedStyle(element)
      return { size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) }
    })
    expect(values.size).toBe(20)
    expect(values.lineHeight / values.size).toBeCloseTo(1.9, 1)
    await page.locator('.reader').evaluate(element => { element.scrollTop = 500 })
    await expect.poll(() => page.locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(400)
    await app.close()
    const reopened = await open()
    try {
      const nextPage = await reopened.firstWindow()
      await nextPage.getByRole('button', { name: '阅读设置' }).click()
      await expect(nextPage.getByRole('combobox', { name: '正文字号' })).toHaveValue('20')
      await expect(nextPage.getByRole('combobox', { name: '行高' })).toHaveValue('1.9')
      await expect(nextPage.getByRole('combobox', { name: '阅读宽度' })).toHaveValue('44')
      await expect.poll(() => nextPage.locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(400)
      expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(before)
      await nextPage.getByRole('button', { name: '恢复默认排版' }).click()
    } finally { await reopened.close() }
  } finally { await app.close().catch(() => {}); await rm(folder, { recursive: true, force: true }) }
})

test('keeps the current paragraph in view when typography changes', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-anchor-'))
  const file = path.join(folder, 'anchor.md')
  const paragraphs = Array.from({ length: 90 }, (_, index) => `第${index}段：` + '这是一段用于检查重排后阅读位置的中英混排 Markdown 文字。'.repeat(4))
  await writeFile(file, '# 阅读位置\n\n' + paragraphs.join('\n\n'))
  const app = await electron.launch({ args: argsFor(file), executablePath: launchBinary })
  try {
    const page = await app.firstWindow()
    const target = page.getByText(/^第65段：/)
    await target.scrollIntoViewIfNeeded()
    await target.evaluate(element => {
      const reader = document.querySelector('.reader')!
      reader.scrollTop += element.getBoundingClientRect().top - reader.getBoundingClientRect().top - 70
    })
    await page.getByRole('button', { name: '阅读设置' }).click()
    await page.getByRole('combobox', { name: '正文字号' }).selectOption('22')
    await page.getByRole('combobox', { name: '行高' }).selectOption('1.9')
    await page.getByRole('combobox', { name: '阅读宽度' }).selectOption('34')
    const targetVisible = await target.evaluate(element => {
      const reader = document.querySelector('.reader')!.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      return rect.top < reader.bottom && rect.bottom > reader.top
    })
    expect(targetVisible).toBe(true)
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('keeps Markdown blocks readable in a narrow window', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-narrow-'))
  const file = path.join(folder, 'narrow.md')
  const columns = Array.from({ length: 8 }, (_, index) => `第${index + 1}列内容很长`)
  const table = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n| ${columns.map((_, index) => String(index).repeat(15)).join(' | ')} |`
  await writeFile(file, '# 排版检查\n\n中英混排 Markdown 123。\n\n- [x] 已完成任务\n\n> 引用文字。\n\n---\n\n' + table + '\n\n```ts\nconst longLine = "' + 'x'.repeat(220) + '"\n```\n\n![宽图](wide.svg)\n')
  await writeFile(path.join(folder, 'wide.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="300"><rect width="1600" height="300" fill="purple"/></svg>')
  const app = await electron.launch({ args: argsFor(file), executablePath: launchBinary })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 760, height: 800 })
    await expect(page.locator('.left')).toBeHidden()
    await expect(page.locator('.right')).toBeHidden()
    await expect(page.getByRole('heading', { name: '排版检查' })).toBeVisible()
    await expect(page.getByRole('checkbox')).toBeChecked()
    await page.getByRole('img', { name: '宽图' }).scrollIntoViewIfNeeded()
    await expect.poll(() => page.getByRole('img', { name: '宽图' }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1600)
    const layout = await page.evaluate(() => {
      const paper = document.querySelector('.paper')! as HTMLElement
      const table = document.querySelector('.document-section table')! as HTMLElement
      const code = document.querySelector('.document-section pre')! as HTMLElement
      const image = document.querySelector('.document-section img')! as HTMLImageElement
      return {
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        paperFits: paper.scrollWidth <= paper.clientWidth,
        tableScrolls: table.scrollWidth > table.clientWidth,
        codeScrolls: code.scrollWidth > code.clientWidth,
        imageFits: image.complete && image.naturalWidth === 1600 && image.getBoundingClientRect().width <= paper.clientWidth
      }
    })
    expect(layout).toEqual({ bodyFits: true, paperFits: true, tableScrolls: true, codeScrolls: true, imageFits: true })
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('opens a 5 MB 原稿 and searches it', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-large-'))
  const file = path.join(folder, 'large.md')
  await writeFile(file, ('plain text paragraph '.repeat(250) + '\n').repeat(1050) + '\n独特终点词\n')
  const app = await electron.launch({ args: argsFor(file), executablePath: launchBinary })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('大文件使用分块阅读模式')).toBeVisible({ timeout: 20000 })
    await page.getByRole('textbox', { name: '搜索当前原稿' }).fill('独特终点词')
    await expect(page.getByText('1 处匹配')).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /独特终点词/ }).click()
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
})

test('opens a folder and a dropped file, then restores reading position', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'readlog-folder-'))
  const first = path.join(folder, 'first.md')
  const second = path.join(folder, 'second.md')
  await writeFile(first, '# 第一篇\n\n' + ('一行阅读内容。\n\n'.repeat(300)))
  await writeFile(second, '# 第二篇\n\n从文件列表打开。\n')
  const app = await electron.launch({ args: packagedBinary ? [] : ['.'], executablePath: launchBinary })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, folder)
    await page.getByRole('button', { name: '打开文件夹' }).first().click()
    await page.getByRole('button', { name: 'second.md' }).click()
    await expect(page.getByRole('heading', { name: '第二篇' })).toBeVisible()

    await page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'test-file-input'
      document.body.append(input)
    })
    await page.locator('#test-file-input').setInputFiles(first)
    const nativePath = await page.locator('#test-file-input').evaluate(input => window.reader.pathForFile((input as HTMLInputElement).files![0]))
    expect(nativePath).toBe(first)
    await page.locator('#test-file-input').evaluate(input => {
      const transfer = new DataTransfer()
      transfer.items.add((input as HTMLInputElement).files![0])
      document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    })
    await expect(page.getByRole('heading', { name: '第一篇' })).toBeVisible()
    await page.locator('.reader').evaluate(element => { element.scrollTop = 900 })
    await expect.poll(() => page.locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(700)
    await page.getByRole('button', { name: 'second.md' }).first().click()
    await page.getByRole('button', { name: 'first.md' }).first().click()
    await expect.poll(() => page.locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(700)
    await app.close()
    const reopened = await electron.launch({ args: argsFor(first), executablePath: launchBinary })
    try {
      const reopenedPage = await reopened.firstWindow()
      await expect(reopenedPage.getByRole('heading', { name: '第一篇' })).toBeVisible()
      await expect.poll(() => reopenedPage.locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(700)
    } finally { await reopened.close() }
  } finally { await app.close().catch(() => {}); await rm(folder, { recursive: true, force: true }) }
})
