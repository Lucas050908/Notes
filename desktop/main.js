// Notabene desktop shell (Electron). Serves the web app from app:// so IndexedDB is stable and private.
const { app, BrowserWindow, protocol, net, shell, ipcMain, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

app.setName('Notabene');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const APP_DIR = path.join(__dirname, 'app');
const BACKUP_DIR = () => path.join(app.getPath('userData'), 'backups');
let win = null;
let pendingAction = actionFromArgv(process.argv);

function actionFromArgv(argv) {
  if (argv.includes('--new-note')) return 'new';
  if (argv.includes('--daily')) return 'daily';
  if (argv.includes('--tasks')) return 'tasks';
  return null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 820, minWidth: 360, minHeight: 520,
    backgroundColor: '#12110f', title: 'Notabene', show: false, autoHideMenuBar: true,
    icon: path.join(APP_DIR, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://notabene/index.html');
  // Links leave the app and open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://notabene/')) { e.preventDefault(); if (/^(https?|mailto):/.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  const a = actionFromArgv(argv);
  if (a) win.webContents.send('nb-action', a);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(APP_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(APP_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  try { session.defaultSession.setSpellCheckerLanguages(['da', 'en-US']); } catch (e) { /* dictionaries are optional */ }
  // The web app asks for notification permission; grant only that.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications' || permission === 'clipboard-sanitized-write'));
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---- daily backups in the user's data folder (~/.var/app/dk.lucas.notabene/config/Notabene/backups in Flatpak) ----
const safe = (p) => path.basename(String(p || ''));
ipcMain.handle('backup:write', async (_e, name, data) => { await fs.promises.mkdir(BACKUP_DIR(), { recursive: true }); await fs.promises.writeFile(path.join(BACKUP_DIR(), safe(name)), data, 'utf8'); return true; });
ipcMain.handle('backup:list', async () => {
  try { const names = await fs.promises.readdir(BACKUP_DIR()); return Promise.all(names.map(async n => ({ name: n, size: (await fs.promises.stat(path.join(BACKUP_DIR(), n))).size }))); }
  catch (e) { return []; }
});
ipcMain.handle('backup:read', async (_e, name) => fs.promises.readFile(path.join(BACKUP_DIR(), safe(name)), 'utf8'));
ipcMain.handle('backup:remove', async (_e, name) => { await fs.promises.unlink(path.join(BACKUP_DIR(), safe(name))).catch(() => {}); return true; });
ipcMain.handle('backup:folder', async () => { await fs.promises.mkdir(BACKUP_DIR(), { recursive: true }); return shell.openPath(BACKUP_DIR()); });
ipcMain.handle('action:take', () => { const a = pendingAction; pendingAction = null; return a; });
ipcMain.on('window:focus', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
