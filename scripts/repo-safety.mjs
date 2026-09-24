// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'

function git(...args) {
  return execFileSync('git', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
}

function paths(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

const privatePath = /^(?:\.scratch|\.research-cache|docs|\.agents|\.codex|\.claude|secrets|credentials|private|local)(?:\/|$)|^(?:AGENTS|CONTEXT|CONTEXT-MAP)\.md$|(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc)$|\.(?:pem|key|p12|pfx|p8|jks|keystore)$/i
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/
]
// Scope mirrors the two places this check runs from:
//   working    - fast, pre-commit: untracked and modified files only
//   repository - CI: tracked paths plus the full Git history
//   all        - default, everything
const scopeArg = process.argv.slice(2).find((arg) => arg.startsWith('--scope='))
const scope = scopeArg ? scopeArg.slice('--scope='.length) : 'all'
const checksWorking = scope === 'all' || scope === 'working'
const checksRepository = scope === 'all' || scope === 'repository'

const failures = new Set()
const checkedBlobs = new Set()

function checkPath(path, source) {
  if ((path !== '.env.example' && privatePath.test(path)) || (path.toLowerCase().endsWith('.md') && path !== 'README.md')) {
    failures.add(`${source}: private or unreviewed document path: ${path}`)
  }
}

function checkContent(buffer, path, source) {
  if (buffer.includes(0)) return // Binary files need separate manual review.
  const content = buffer.toString('utf8')
  if (credentialPatterns.some(pattern => pattern.test(content))) {
    failures.add(`${source}: possible credential in ${path}`)
  }
}

if (checksRepository) {
  // Read indexed content through `ls-files -s` + `cat-file` rather than
  // `git show :<path>`: the latter fails with "bad object" for some paths.
  for (const entry of paths(git('ls-files', '-s', '-z'))) {
    const match = /^\d+ ([0-9a-f]+) \d+\t(.*)$/s.exec(entry)
    if (!match) continue
    const [, blob, path] = match
    checkPath(path, 'index')
    if (checkedBlobs.has(blob)) continue
    checkedBlobs.add(blob)
    checkContent(git('cat-file', 'blob', blob), path, 'index')
    if (existsSync(path) && statSync(path).isFile()) checkContent(readFileSync(path), path, 'working tree')
  }
}

if (checksWorking) {
  for (const path of paths(git('ls-files', '--others', '--exclude-standard', '-z'))) {
    checkPath(path, 'untracked')
    if (existsSync(path) && statSync(path).isFile()) checkContent(readFileSync(path), path, 'untracked')
  }
}

if (checksRepository) {
  for (const commit of git('rev-list', '--all').toString('utf8').split(/\s+/).filter(Boolean)) {
    for (const entry of paths(git('ls-tree', '-r', '-z', commit))) {
      const match = /^\d+ blob ([0-9a-f]+)\t(.*)$/s.exec(entry)
      if (!match) continue
      const [, blob, path] = match
      checkPath(path, `history ${commit.slice(0, 8)}`)
      if (checkedBlobs.has(blob)) continue
      checkedBlobs.add(blob)
      checkContent(git('cat-file', 'blob', blob), path, `history ${commit.slice(0, 8)}`)
    }
  }
}

if (failures.size) {
  for (const failure of failures) console.error(failure)
  console.error('Repository safety check failed. Review every finding before committing or pushing.')
  process.exitCode = 1
} else {
  const historyNote = checksRepository ? ` (${checkedBlobs.size} historical blobs checked)` : ''
  console.log(`Repository safety check passed [scope=${scope}]${historyNote}.`)
}
