// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  workers: 1,
  reporter: 'list'
})
