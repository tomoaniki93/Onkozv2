'use strict';

const {
  app, BrowserWindow, BrowserView,
  ipcMain, Tray, Menu, nativeImage,
  shell, session, screen, dialog,
} = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// ── Config ────────────────────────────────────────────────────────────────────
const ONKOZ_URL    = 'https://onkoz.fr';
const TITLE_HEIGHT = 36;

let mainWindow  = null;
let contentView = null;
let tray        = null;
let isQuitting  = false;

// ── Auto-updater config ───────────────────────────────────────────────────────
autoUpdater.autoDownload    = true;   // télécharger silencieusement en arrière-plan
autoUpdater.autoInstallOnAppQuit = true; // installer quand l'user ferme l'app

// Logger les événements updater en dev
autoUpdater.logger = require('electron').dialog ? null : console;

// ── Sécurité GPU ──────────────────────────────────────────────────────────────
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream', 'false');

// ── Fenêtre principale ────────────────────────────────────────────────────────
function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const winW = Math.min(1400, Math.round(sw * 0.85));
  const winH = Math.min(900,  Math.round(sh * 0.85));

  mainWindow = new BrowserWindow({
    width:  winW,
    height: winH,
    minWidth:  900,
    minHeight: 600,
    frame:          false,
    transparent:    false,
    backgroundColor: '#0e0e15',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'titlebar.html'));

  contentView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       false,
    },
  });
  mainWindow.addBrowserView(contentView);
  resizeContentView();
  contentView.webContents.loadURL(ONKOZ_URL);

  // Permissions micro / écran / notifications
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = ['media','audioCapture','videoCapture','desktopCapture','displayCapture','notifications','clipboard-read'];
    cb(ok.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    const ok = ['media','audioCapture','videoCapture','desktopCapture','displayCapture','notifications'];
    return ok.includes(permission);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    contentView.webContents.focus();
    // Vérifier les mises à jour 3 secondes après le démarrage
    setTimeout(() => checkForUpdates(), 3000);
  });

  contentView.webContents.on('did-fail-load', (e, code) => {
    if (code === -3) return;
    setTimeout(() => contentView?.webContents.loadURL(ONKOZ_URL), 3000);
  });

  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ONKOZ_URL)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('resize', resizeContentView);
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state', 'maximized');
    resizeContentView();
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state', 'normal');
    resizeContentView();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      tray?.displayBalloon({
        iconType: 'info',
        title:    'ONKOZ',
        content:  'ONKOZ tourne toujours en arrière-plan.',
      });
    }
  });
}

function resizeContentView() {
  if (!mainWindow || !contentView) return;
  const [w, h] = mainWindow.getContentSize();
  contentView.setBounds({ x: 0, y: TITLE_HEIGHT, width: w, height: h - TITLE_HEIGHT });
}

// ── Systray ───────────────────────────────────────────────────────────────────
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(img.resize({ width: 16, height: 16 }));

  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir ONKOZ',   click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Recharger',      click: () => contentView?.webContents.reload() },
    { label: 'Vérifier les mises à jour', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quitter',        click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('ONKOZ — Voice & Chat');
  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-UPDATER
// ═══════════════════════════════════════════════════════════════════════════════

function checkForUpdates(manual = false) {
  // En mode dev (non packagé), ne pas vérifier
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'ONKOZ', buttons: ['OK'],
      message: 'Vérification des mises à jour désactivée en mode développement.',
    });
    return;
  }
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[Updater]', err.message);
    if (manual) dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'Mise à jour', buttons: ['OK'],
      message: `Impossible de vérifier les mises à jour :\n${err.message}`,
    });
  });
}

// ── Mise à jour disponible → téléchargement silencieux déjà en cours ──
autoUpdater.on('update-available', (info) => {
  console.log(`[Updater] Nouvelle version disponible : ${info.version}`);
  // Notifier la titlebar
  mainWindow?.webContents.send('update-status', {
    type: 'available',
    version: info.version,
    message: `Mise à jour ${info.version} en cours de téléchargement…`,
  });
  // Bulle systray
  tray?.displayBalloon({
    iconType: 'info',
    title:    'ONKOZ — Mise à jour',
    content:  `Version ${info.version} disponible, téléchargement en cours…`,
  });
});

// ── Pas de nouvelle version ──
autoUpdater.on('update-not-available', () => {
  console.log('[Updater] Application à jour.');
  mainWindow?.webContents.send('update-status', { type: 'up-to-date' });
});

// ── Progression du téléchargement ──
autoUpdater.on('download-progress', (progress) => {
  const pct = Math.round(progress.percent);
  mainWindow?.webContents.send('update-status', {
    type:    'downloading',
    percent: pct,
    message: `Téléchargement… ${pct}%`,
  });
  // Afficher la progression dans la barre des tâches Windows
  mainWindow?.setProgressBar(pct / 100);
});

// ── Téléchargement terminé → proposer de redémarrer ──
autoUpdater.on('update-downloaded', (info) => {
  console.log(`[Updater] Version ${info.version} prête.`);
  mainWindow?.setProgressBar(-1); // effacer la barre de progression

  mainWindow?.webContents.send('update-status', {
    type:    'ready',
    version: info.version,
    message: `Version ${info.version} prête — cliquez pour redémarrer`,
  });

  tray?.displayBalloon({
    iconType: 'info',
    title:    'ONKOZ — Prêt à mettre à jour',
    content:  `Version ${info.version} prête. Cliquez ici pour redémarrer.`,
  });

  // Clic sur la bulle tray → redémarrer
  tray?.once('balloon-click', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
});

// ── Erreur updater ──
autoUpdater.on('error', (err) => {
  console.error('[Updater] Erreur :', err.message);
  mainWindow?.setProgressBar(-1);
  mainWindow?.webContents.send('update-status', { type: 'error', message: err.message });
});

// ── IPC depuis la titlebar ────────────────────────────────────────────────────
ipcMain.on('title:minimize',        () => mainWindow?.minimize());
ipcMain.on('title:maximize',        () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('title:close',           () => mainWindow?.close());
ipcMain.on('title:reload',          () => contentView?.webContents.reload());
ipcMain.on('title:devtools',        () => contentView?.webContents.openDevTools());
ipcMain.on('title:check-updates',   () => checkForUpdates(true));
ipcMain.on('title:install-update',  () => { isQuitting = true; autoUpdater.quitAndInstall(); });

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { isQuitting = true; });
