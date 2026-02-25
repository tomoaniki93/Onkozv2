'use strict';

const {
  app, BrowserWindow, BrowserView,
  ipcMain, Tray, Menu, nativeImage,
  shell, session, screen,
} = require('electron');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const ONKOZ_URL    = 'https://onkoz.fr';
const TITLE_HEIGHT = 36;   // hauteur de la barre de titre custom

let mainWindow  = null;
let contentView = null;
let tray        = null;
let isQuitting  = false;

// ── Sécurité : désactiver l'acceleration GPU si problème ─────────────────────
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
    frame:          false,     // barre de titre custom
    transparent:    false,
    backgroundColor: '#0e0e15',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      webviewTag:        false,
    },
    show: false,
    titleBarStyle: 'hidden',
  });

  // ── Barre de titre custom ──
  mainWindow.loadFile(path.join(__dirname, 'titlebar.html'));

  // ── BrowserView pour le contenu ONKOZ ──
  contentView = new BrowserView({
    webPreferences: {
      contextIsolation:    true,
      nodeIntegration:     false,
      webviewTag:          false,
      // WebRTC permissions
      allowRunningInsecureContent: false,
    },
  });
  mainWindow.addBrowserView(contentView);
  resizeContentView();

  // Charger ONKOZ
  contentView.webContents.loadURL(ONKOZ_URL);

  // ── Permissions micro / écran / notifications ──
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'videoCapture', 'desktopCapture', 'displayCapture', 'notifications', 'clipboard-read'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'audioCapture', 'videoCapture', 'desktopCapture', 'displayCapture', 'notifications'];
    return allowed.includes(permission);
  });

  // ── Afficher une fois prête ──
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Focus sur le contenu
    contentView.webContents.focus();
  });

  // ── Reconnexion auto si la page tombe ──
  contentView.webContents.on('did-fail-load', (e, code, desc) => {
    if (code === -3) return; // ERR_ABORTED (navigation normale)
    console.log('[ONKOZ] Chargement échoué, retry dans 3s…', code, desc);
    setTimeout(() => {
      contentView?.webContents.loadURL(ONKOZ_URL);
    }, 3000);
  });

  // ── Ouvrir les liens externes dans le navigateur ──
  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ONKOZ_URL)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Adapter la vue si redimensionnement ──
  mainWindow.on('resize', resizeContentView);
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state', 'maximized');
    resizeContentView();
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state', 'normal');
    resizeContentView();
  });

  // ── Minimiser dans le tray au lieu de fermer ──
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

// ── Redimensionner le BrowserView sous la titlebar ───────────────────────────
function resizeContentView() {
  if (!mainWindow || !contentView) return;
  const [w, h] = mainWindow.getContentSize();
  contentView.setBounds({ x: 0, y: TITLE_HEIGHT, width: w, height: h - TITLE_HEIGHT });
}

// ── Icône dans la barre des tâches (System Tray) ──────────────────────────────
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(img.resize({ width: 16, height: 16 }));

  const menu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir ONKOZ',
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    {
      label: 'Recharger',
      click: () => contentView?.webContents.reload(),
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  tray.setToolTip('ONKOZ — Voice & Chat');
  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC depuis la titlebar ────────────────────────────────────────────────────
ipcMain.on('title:minimize',   () => mainWindow?.minimize());
ipcMain.on('title:maximize',   () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('title:close',      () => mainWindow?.close());
ipcMain.on('title:reload',     () => contentView?.webContents.reload());
ipcMain.on('title:devtools',   () => contentView?.webContents.openDevTools());

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });
