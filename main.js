const { app, BrowserWindow, session, WebContentsView, ipcMain, Menu, MenuItem, dialog, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// === Find in Page ===
let findModal = null;
let lastFindTerm = '';
let lastFindOpts = { forward: true, matchCase: false, findNext: false };

// Track/untrack parent-follow handlers so Find stays with the main window
let findFollow = { parent: null, handler: null };

function positionFindModal(parentWin) {
  if (!findModal || findModal.isDestroyed() || !parentWin || parentWin.isDestroyed()) return;

  const modalW = 380;
  const modalH = 160;

  try {
    // Prefer normal bounds so maximize/fullscreen doesn't give weird coordinates

  const pb = (parentWin && typeof parentWin.getNormalBounds === 'function') 
      ? parentWin.getNormalBounds()
      : parentWin.getBounds();

    // Center over parent
    let x = Math.round(pb.x + (pb.width - modalW) / 2);
    let y = Math.round(pb.y + (pb.height - modalH) / 2);

    // Clamp to display workArea
    const display = screen.getDisplayMatching({ x: pb.x, y: pb.y, width: pb.width, height: pb.height });
    const wa = display?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - modalW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - modalH));

    findModal.setBounds({ x, y, width: modalW, height: modalH });
  } catch {
    // Let WM decide if anything goes sideways
  }
}

function attachFindFollow(parentWin) {
  if (!parentWin || parentWin.isDestroyed()) return;

  // Remove previous follow handler if any
  if (findFollow.parent && findFollow.handler) {
    try { findFollow.parent.removeListener('move', findFollow.handler); } catch {}
    try { findFollow.parent.removeListener('resize', findFollow.handler); } catch {}
    try { findFollow.parent.removeListener('maximize', findFollow.handler); } catch {}
    try { findFollow.parent.removeListener('unmaximize', findFollow.handler); } catch {}
  }

  // Throttle a bit to avoid jitter during live resize
  let t = null;
  const handler = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => positionFindModal(parentWin), 40);
  };

  findFollow = { parent: parentWin, handler };

  parentWin.on('move', handler);
  parentWin.on('resize', handler);
  parentWin.on('maximize', handler);
  parentWin.on('unmaximize', handler);
}

function openFindModal(parentWin) {
  if (findModal && !findModal.isDestroyed()) {
    findModal.show();
    findModal.focus();
    return;
  }

  findModal = new BrowserWindow({
    parent: parentWin,
    modal: true,
    width: 380,
    height: 160,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'Find in Page',
    autoHideMenuBar: true,
    // Modal only: simplest implementation (matches main2.js approach)
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  // --- Position the find window relative to the parent window (Cinnamon-friendly) ---
  try {
    // Prefer the *restored* bounds if parent is maximized/fullscreen
    const pb = (parent && typeof parent.getNormalBounds === 'function')
      ? parent.getNormalBounds()
      : parent.getBounds();

    const modalW = 380;
    const modalH = 160;

    // Center over parent
    let x = Math.round(pb.x + (pb.width - modalW) / 2);
    let y = Math.round(pb.y + (pb.height - modalH) / 2);

    // Clamp to nearest display workArea so it doesn't end up off-screen
    const display = screen.getDisplayMatching({ x: pb.x, y: pb.y, width: pb.width, height: pb.height });
    const wa = display?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };

    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - modalW));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - modalH));

    findModal.setBounds({ x, y, width: modalW, height: modalH });
  } catch (e) {
    // If anything goes wrong, let the WM decide placement
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:12px}
    .row{display:flex;gap:8px;align-items:center}
    input[type=text]{flex:1;padding:6px 8px}
    .actions{margin-top:10px;display:flex;gap:8px;justify-content:flex-end}
    label{font-size:12px;color:#444}
  </style></head><body>
    <div class="row">
      <input id="term" type="text" placeholder="Find in page..." autofocus />
      <label><input id="match" type="checkbox"> Match case</label>
    </div>
    <div class="actions">
      <button id="prev">Previous</button>
      <button id="next">Next</button>
      <button id="clear">Clear</button>
      <button id="close">Close</button>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      const termEl = document.getElementById('term');
      const matchEl = document.getElementById('match');
      const send = (kind) => ipcRenderer.send('find-modal-submit', {
        kind,
        term: termEl.value || '',
        matchCase: !!matchEl.checked
      });
      document.getElementById('next').onclick = () => send('next');
      document.getElementById('prev').onclick = () => send('prev');
      document.getElementById('clear').onclick = () => ipcRenderer.send('find-modal-clear');
      document.getElementById('close').onclick = () => ipcRenderer.send('find-modal-close');
      termEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send('next');
        if (e.key === 'Escape') {
          ipcRenderer.send('find-modal-clear');
          ipcRenderer.send('find-modal-close');
        }
      });
    </script>
  </body></html>`;

  findModal.removeMenu();
  findModal.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
  findModal.once('ready-to-show', () => {
    try { findModal.show(); findModal.focus(); } catch {}
  });
 
 // Keep modal aligned with the parent window
 try { positionFindModal(parentWin); } catch {}
 try { attachFindFollow(parentWin); } catch {}

 findModal.on('closed', () => {
   findModal = null;
   // Cleanup follow listeners
   if (findFollow.parent && findFollow.handler) {
     try { findFollow.parent.removeListener('move', findFollow.handler); } catch {}
     try { findFollow.parent.removeListener('resize', findFollow.handler); } catch {}
     try { findFollow.parent.removeListener('maximize', findFollow.handler); } catch {}
     try { findFollow.parent.removeListener('unmaximize', findFollow.handler); } catch {}
   }
   findFollow = { parent: null, handler: null };
 });
}

function addFindToApplicationMenu(parentWin, targetWCGetter) {
  // Extend existing menu (do not replace). Create if missing.
  let menu = Menu.getApplicationMenu();
  if (!menu) {
    menu = new Menu();
    Menu.setApplicationMenu(menu);
  }

  // Ensure Edit menu exists
  let editItem = menu.items.find(i => i.label === 'Edit');
  let editSubmenu = editItem?.submenu;
  if (!editSubmenu) {
    editSubmenu = new Menu();
    // Put Edit before Help if Help exists, otherwise append.
    const helpIndex = menu.items.findIndex(i => i.label === 'Help');
    const newEdit = new MenuItem({ label: 'Edit', submenu: editSubmenu });
    if (helpIndex >= 0) menu.insert(helpIndex, newEdit);
    else menu.append(newEdit);
  }

  const hasFind = editSubmenu.items.some(i => i.label === 'Find…');
  if (!hasFind) {
    editSubmenu.append(new MenuItem({
      label: 'Find…',
      accelerator: 'Ctrl+F',
      click: () => openFindModal(parentWin)
    }));
    editSubmenu.append(new MenuItem({
      label: 'Find Next',
      accelerator: 'F3',
      click: () => {
        const wc = typeof targetWCGetter === 'function' ? targetWCGetter() : null;
        if (!wc || !lastFindTerm) return;
        lastFindOpts = { ...lastFindOpts, forward: true, findNext: true };
        try { wc.findInPage(lastFindTerm, lastFindOpts); } catch {}
      }
    }));
    editSubmenu.append(new MenuItem({
      label: 'Find Previous',
      accelerator: 'Shift+F3',
      click: () => {
        const wc = typeof targetWCGetter === 'function' ? targetWCGetter() : null;
        if (!wc || !lastFindTerm) return;
        lastFindOpts = { ...lastFindOpts, forward: false, findNext: true };
        try { wc.findInPage(lastFindTerm, lastFindOpts); } catch {}
      }
    }));
    editSubmenu.append(new MenuItem({
      label: 'Clear Highlights',
      accelerator: 'Esc',
      click: () => {
        const wc = typeof targetWCGetter === 'function' ? targetWCGetter() : null;
        if (!wc) return;
        try { wc.stopFindInPage('clearSelection'); } catch {}
      }
    }));
  }

  Menu.setApplicationMenu(menu);
}

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

  // Add Edit → Find… (Ctrl+F) targeting the embedded admin view
  addFindToApplicationMenu(win, () => adminView.webContents);

  // IPC handlers for find modal (targets adminView.webContents)
  if (!ipcMain.listenerCount('find-modal-submit')) {
    ipcMain.on('find-modal-submit', (_event, payload) => {
      const wc = adminView.webContents;
      if (!wc) return;
      const term = String(payload?.term || '').trim();
      const matchCase = !!payload?.matchCase;
      if (!term) return;

      const isNewTerm = term !== lastFindTerm;
      lastFindTerm = term;

      lastFindOpts = {
        ...lastFindOpts,
        matchCase,
        forward: (payload?.kind !== 'prev'),
        // Start new term with findNext:false; subsequent searches findNext:true
        findNext: isNewTerm ? false : true
      };

      try { wc.findInPage(lastFindTerm, lastFindOpts); } catch {}
    });
  }

  if (!ipcMain.listenerCount('find-modal-clear')) {
    ipcMain.on('find-modal-clear', () => {
      const wc = adminView.webContents;
      if (!wc) return;
      try { wc.stopFindInPage('clearSelection'); } catch {}
    });
  }

  if (!ipcMain.listenerCount('find-modal-close')) {
    ipcMain.on('find-modal-close', () => {
      if (findModal && !findModal.isDestroyed()) findModal.close();
      findModal = null;
    });
  }

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
