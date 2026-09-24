// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true }
})
