import { app, BrowserWindow, Menu } from 'electron';

import { disconnectAll } from './datasources/connections.js';
import { createMainWindow } from './windows.js';
import { registerAllIpc } from './ipc/index.js';
import { buildApplicationMenu } from './menu.js';
import { setupUpdater } from './updater.js';

// Windows installer entry; resolves before app is "ready" when Squirrel kicks in.
import electronSquirrelStartup from 'electron-squirrel-startup';
if (electronSquirrelStartup) {
  app.quit();
}

// Single-instance lock — a second launch focuses the existing window
// instead of spawning a duplicate.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// HiDPI / fractional scale on Linux. On Wayland the compositor reports the
// effective scale via WaylandFractionalScaleV1, so trust it and only fall
// back to GDK_SCALE on X11 (where toolkits historically used that var).
// NODEGRIP_SCALE remains an explicit override for either session type.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch(
    'enable-features',
    'WaylandFractionalScaleV1,WaylandWindowDecorations',
  );
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
  // On Wayland the compositor owns scaling. GTK env vars still leak into
  // Chromium's font/UI sizing path even when we don't pass them as flags,
  // so wipe them unless the user explicitly opts in via NODEGRIP_SCALE.
  if (isWayland && !process.env.NODEGRIP_SCALE) {
    delete process.env.GDK_SCALE;
    delete process.env.GDK_DPI_SCALE;
  }
  const rawScale = process.env.NODEGRIP_SCALE ?? (isWayland ? undefined : process.env.GDK_SCALE);
  const scale = rawScale ? Number.parseFloat(rawScale) : NaN;
  if (Number.isFinite(scale) && scale > 0) {
    app.commandLine.appendSwitch('force-device-scale-factor', String(scale));
    app.commandLine.appendSwitch('high-dpi-support', '1');
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildApplicationMenu());
  registerAllIpc();
  createMainWindow();

  // Two-track updater: Squirrel auto-update on Win/macOS via
  // update.electronjs.org, GitHub-API check + renderer banner on Linux.
  setupUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// Tear down every live DB pool before the process exits. `before-quit`
// runs once and gives us a chance to await async cleanup; we don't
// `preventDefault`, just race the disconnect against shutdown so a
// hung server can't block exit forever.
app.on('before-quit', () => {
  void disconnectAll();
});
