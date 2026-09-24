// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// 本地快速预览：Vite 负责渲染进程（改代码即刷新），Electron 跑编译后的主进程。
// 用法：npm run dev:app -- [原稿路径 …] [--devtools] [--no-watch]
import { execFileSync, spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flags = args.filter(arg => arg.startsWith('--'))
const fileArgs = args.filter(arg => !arg.startsWith('--'))
const openDevTools = flags.includes('--devtools')
const watchMain = !flags.includes('--no-watch')
const host = process.env.READLOG_DEV_HOST ?? '127.0.0.1'
const port = Number(process.env.READLOG_DEV_PORT ?? 5173)

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

const watchers = []
let vite = null
let electron = null
let devUrl = null
let shuttingDown = false
let restarting = false
let restartTimer = null

function log(message) {
  console.log(`[dev] ${message}`)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function run(command, commandArgs, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${commandArgs.join(' ')} 退出码 ${code ?? '未知'}`))
    })
  })
}

function compileMain() {
  return run(process.execPath, [tscBin, '-p', 'tsconfig.main.json'])
}

function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 进程可能已经退出 */ }
    } else {
      child.kill('SIGTERM')
    }
  })
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)
  for (const watcher of watchers) watcher.close()
  await stop(electron)
  await stop(vite)
  process.exit(code)
}

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe']
    })
    vite = child
    let output = ''
    const timer = setTimeout(() => reject(new Error(`等待 Vite 启动超时（${host}:${port}）`)), 60000)
    const settle = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value) }
    const onData = chunk => {
      // Vite 的横幅里夹着 ANSI 颜色码（端口两侧都有），先去掉再匹配地址。
      output += String(chunk).replace(/\[[0-9;]*m/g, '')
      const ready = new RegExp(`http://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}/`).exec(output)
      if (ready) settle(null, ready[0].replace(/\/$/, ''))
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', error => settle(error instanceof Error ? error : new Error(String(error))))
    child.on('exit', code => settle(new Error(`Vite 意外退出（代码 ${code ?? '未知'}）`)))
  })
}

function startElectron() {
  // require('electron') 返回可执行文件路径，直接用它在项目根目录启动 dev 应用。
  const binary = require('electron')
  electron = spawn(binary, ['.', ...fileArgs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, READLOG_DEV_URL: devUrl, READLOG_DEVTOOLS: openDevTools ? '1' : '0' }
  })
  const current = electron
  current.on('error', error => {
    log(`Electron 启动失败：${error.message}`)
    void shutdown(1)
  })
  current.on('exit', code => {
    if (electron === current) electron = null
    if (shuttingDown || restarting) return
    log('应用窗口已退出，正在关闭开发环境…')
    void shutdown(code ?? 0)
  })
}

async function restartElectron() {
  if (shuttingDown || restarting) return
  restarting = true
  log('主进程源码有改动，正在重新编译…')
  try {
    await compileMain()
  } catch (error) {
    log(`编译失败，保留当前窗口不动：${error.message}`)
    restarting = false
    return
  }
  await stop(electron)
  electron = null
  await delay(400)
  if (shuttingDown) return
  startElectron()
  restarting = false
}

function watchMainSources() {
  for (const directory of ['src/main', 'src/shared']) {
    try {
      watchers.push(watch(path.join(root, directory), { recursive: true }, () => {
        clearTimeout(restartTimer)
        restartTimer = setTimeout(() => { void restartElectron() }, 400)
      }))
    } catch (error) {
      log(`无法监听 ${directory}，主进程改动需手动重启：${error.message}`)
    }
  }
}

async function main() {
  log('编译主进程…')
  await compileMain()
  devUrl = await startVite()
  log(`渲染进程开发服务器：${devUrl}`)
  log('启动 Electron…（改动 src/renderer 自动刷新，改动 src/main 自动重编译并重启）')
  startElectron()
  if (watchMain) watchMainSources()
}

process.on('SIGINT', () => { log('收到中断信号，正在关闭…'); void shutdown(0) })
process.on('SIGTERM', () => { void shutdown(0) })

await main().catch(error => {
  console.error(`[dev] 启动失败：${error.message}`)
  void shutdown(1)
})
