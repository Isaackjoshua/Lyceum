import { join } from 'node:path'
import { app, shell, BrowserWindow, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
// Imported first, for its side effect: pins the app name before anything
// reads app.getPath('userData').
import './appIdentity.js'
import { closeDatabase, initDatabase } from './db/index.js'
import { registerIpcHandlers } from './ipc/index.js'
import { migrateLegacyKey } from './security/keyVault.js'


/**
 * Content Security Policy.
 *
 * Dev needs 'unsafe-inline' for Vite's injected styles and a websocket for HMR;
 * production is locked down. Neither allows remote script. Every model call is
 * made by the main process, whichever provider it goes to, so connect-src does
 * not need to name any provider endpoint — a compromised renderer cannot reach
 * one directly.
 */
function contentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    is.dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    is.dev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    // Interactive widgets are srcdoc iframes; they carry their own stricter
    // CSP and run at an opaque origin (see WidgetFrame).
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ]
  return directives.join('; ')
}

/** True when a URL belongs to the app itself. */
function isAppUrl(url: string): boolean {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  return devServer ? url.startsWith(devServer) : url.startsWith('file://')
}

/**
 * Opens a link in the system browser, but only if it is an ordinary web link.
 * Everything else is dropped: `shell.openExternal` hands the URL to the OS,
 * which will happily launch a registered handler for an arbitrary scheme.
 */
function openExternally(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.warn(`[security] refused to open a non-web URL (${parsed.protocol})`)
    return
  }
  void shell.openExternal(parsed.toString())
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0d',
    title: 'Lyceum',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true
    }
  })

  window.on('ready-to-show', () => window.show())

  // External links open in the user's browser, never in an Electron window —
  // and only if they are web links. Handing an arbitrary scheme to the OS is
  // how `file:`, `smb:` or a registered custom-protocol handler turns a link in
  // model-authored markdown into local code execution.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })

  // Block in-app navigation away from the app's own origin.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      openExternally(url)
    }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

// Single instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.lyceum.app')

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [contentSecurityPolicy()]
        }
      })
    })

    // Deny every permission request; nothing in Lyceum needs camera, mic or geo.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false))

    initDatabase()
    migrateLegacyKey()
    registerIpcHandlers()

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    closeDatabase()
  })
}
