const { app, BrowserWindow, session, WebContentsView, ipcMain, Menu, MenuItem, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Help → About (mirrors main2.js behavior) -------------------------------
function showAboutDialog(parentWindow) {
  const v = process.versions || {};
  const iconPath = getAppIcon();
  const iconImg = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  const detail =
    `Version: ${app.getVersion()}\n` +
    `Node: ${v.node || 'unknown'}\n` +
    `V8: ${v.v8 || 'unknown'}\n` +
    `Electron: ${v.electron || 'unknown'}\n` +
    `Chromium: ${v.chrome || 'unknown'}`;

  dialog.showMessageBox(parentWindow, {
    type: 'info',
    title: `About ${app.getName()}`,
    message: app.getName(),
    detail,
    icon: iconImg,
    buttons: ['OK'],
    defaultId: 0
  });
}

function extendMenuWithAbout(getMainWindow) {
  let menu = Menu.getApplicationMenu();

  // Create menu if it does not exist yet
  if (!menu) {
    menu = new Menu();
    Menu.setApplicationMenu(menu);
  }

  // Find or create Help submenu
  let helpItem = menu.items.find(i => i.label === 'Help');
  let helpSubmenu;

  if (helpItem && helpItem.submenu) {
    helpSubmenu = helpItem.submenu;
  } else {
    helpSubmenu = new Menu();
    menu.append(new MenuItem({ label: 'Help', submenu: helpSubmenu }));
  }

  // Avoid duplicate About
  const hasAbout = helpSubmenu.items.some(i => i.label === 'About');
  if (!hasAbout) {
    helpSubmenu.append(new MenuItem({
      label: 'About',
      click: () => {
        const win = typeof getMainWindow === 'function'
          ? getMainWindow()
          : undefined;
        showAboutDialog(win);
      }
    }));
  }

  // Re-apply so Linux DEs refresh the menu
  Menu.setApplicationMenu(menu);
}

function attachContextMenuCopyReload(wc) {
  // Avoid duplicate menus if this function is called more than once for the same webContents.
  if (wc.__msadminContextMenuAttached) return;
  wc.__msadminContextMenuAttached = true;

  wc.on('context-menu', (_event, params) => {
    const template = [];

    // Preserve "existing" expected items when right-clicking in editable fields:
    // Cut/Copy/Paste/Select All (based on what Chromium says is available).
    const ef = params.editFlags || {};

    if (ef.canCut) template.push({ label: 'Cut', role: 'cut' });

    // Copy should be available when there's selection OR canCopy is true.
    if (ef.canCopy || (params.selectionText && params.selectionText.trim().length > 0)) {
      template.push({ label: 'Copy', role: 'copy' });
    }

    if (ef.canPaste) template.push({ label: 'Paste', role: 'paste' });

    if (ef.canSelectAll) template.push({ type: 'separator' }, { label: 'Select All', role: 'selectAll' });

    // Add Reload without removing anything else.
    if (template.length > 0) template.push({ type: 'separator' });
    template.push({
      label: 'Reload',
      click: () => wc.reload()
    });

    Menu.buildFromTemplate(template).popup();
  });
}

function getAppIcon() {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'assets', 'win', 'msadmin_center-for-linux.ico');
  }

  if (process.platform === 'linux') {
    // Use the largest size for the window icon
    return path.join(
      __dirname,
      'assets',
      'msadmin_center-for-linux_1024x1024.png'
    );
  }

  return undefined; // macOS handled differently (if added later)
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    const p = getWindowStatePath();
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeWindowState(state) {
  try {
    const p = getWindowStatePath();
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // intentionally ignore write errors
  }
}

function attachCopyReloadContextMenu(wc) {
  wc.on('context-menu', (_event, params) => {
    const template = [];

    // Show Copy when there is selected text
    if (params.selectionText && params.selectionText.trim().length > 0) {
      template.push({ label: 'Copy', role: 'copy' });
      template.push({ type: 'separator' });
    }

    template.push({
      label: 'Reload',
      click: () => wc.reload()
    });

    Menu.buildFromTemplate(template).popup();
  });
}

const ADMIN_PARTITION = 'persist:admin-centers';


function createWindow() {
  const saved = readWindowState();

  const win = new BrowserWindow({
    ...(saved?.bounds ? saved.bounds : { width: 1200, height: 800 }),
   icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  extendMenuWithAbout(() => win);

  // If it was maximized last time, re-maximize after creation
  if (saved?.isMaximized) {
    win.maximize();
  }

  win.loadFile('index.html')

  // Create the embedded content view (below the toolbar)
  const adminView = new WebContentsView({
    webPreferences: {
      partition: ADMIN_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Right-click context menus (Copy + Reload) for both the UI chrome and the embedded admin view.
  attachContextMenuCopyReload(win.webContents);
  attachContextMenuCopyReload(adminView.webContents);

  win.contentView.addChildView(adminView);

  const layout = () => {
    const [w, h] = win.getContentSize();
    const toolbarHeight = 56; // match CSS
    adminView.setBounds({ x: 0, y: toolbarHeight, width: w, height: h - toolbarHeight });
  };

  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  layout();


  let lastNormalBounds = saved?.bounds || win.getBounds();

  const updateNormalBounds = () => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      lastNormalBounds = win.getBounds();
    }
  };

  win.on('resize', updateNormalBounds);
  win.on('move', updateNormalBounds);

  win.on('close', () => {
    // Save normal bounds + maximize state
    const state = {
      bounds: lastNormalBounds,
      isMaximized: win.isMaximized()
    };
    writeWindowState(state);
  });

  // Initial navigation
  adminView.webContents.loadURL('https://admin.microsoft.com/AdminPortal/');

  // IPC handler from renderer to navigate
  ipcMain.on('navigate-admin', (_evt, url) => {
    adminView.webContents.loadURL(url);
  });

  // --- tenant prompt (modal window) ---
  ipcMain.handle('prompt-sharepoint-tenant', async (_evt, initialValue) => {
    return await openGenericPrompt(win, initialValue || '');
  });

  ipcMain.handle('prompt-onprem-exchange', async (_evt, initialValue) => {
    return await openGenericPrompt(win, {
      title: 'On-Prem Exchange EAC URL',
      label: 'Enter the on-prem EAC/ECP URL (example: https://mail.contoso.com/ecp)',
      value: initialValue || ''
    });
  });
}

// Modal prompt helper
function openGenericPrompt(parentWindow, { title, label, hint, value }) {
  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      parent: parentWindow,
      modal: true,
      width: 560,
      height: 240,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'tenantPromptPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const reply = (val) => { resolve(val); if (!promptWin.isDestroyed()) promptWin.close(); };
    ipcMain.once('tenant-prompt-result', (_e, val) => reply(val));
    promptWin.on('closed', () => resolve(null));
    promptWin.once('ready-to-show', () => promptWin.show());

    promptWin.loadFile('tenantPrompt.html', {
      query: { title, label, hint: hint || '', value: value || '' }
    });
  });
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
