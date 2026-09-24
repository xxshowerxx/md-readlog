// Copyright (C) 2026 Markdown Readlog contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// macOS signing/notarization is opt-in: it only activates when the build
// environment actually has credentials. Without this guard, a local build or a
// CI run without secrets would fail at the Package step.
const macosSigningEnabled =
  process.platform === 'darwin' && process.env.MACOS_SIGN === 'true';

const hasNotarizeCredentials =
  process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID;

module.exports = {
  packagerConfig: {
    asar: true,
    ...(process.platform === 'win32' ? { icon: './assets/icon.ico' } : {}),
    executableName: 'MarkdownReadlog',
    appBundleId: 'com.xxshowerxx.mdreadlog',
    appCategoryType: 'public.app-category.productivity',
    ...(macosSigningEnabled ? { osxSign: {} } : {}),
    ...(macosSigningEnabled && hasNotarizeCredentials
      ? {
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'MarkdownReadlog',
        setupExe: 'MD-Readlog-Setup.exe',
        setupIcon: './assets/icon.ico',
        authors: 'Markdown Readlog',
      },
    },
    // DMG is the standard macOS installer; it can only be built on macOS.
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO',
      },
    },
    // ZIP sits alongside the DMG so Squirrel.Mac / autoUpdater has a
    // static-file update target to point at later.
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
};
