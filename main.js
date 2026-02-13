const { app, BrowserWindow, session, WebContentsView, ipcMain } = require('electron');
const path = require('path');

const ADMIN_PARTITION = 'persist:admin-centers';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile('index.html');

  // Create the embedded content view (below the toolbar)
  const adminView = new WebContentsView({
    webPreferences: {
      partition: ADMIN_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

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

  // Initial navigation
  adminView.webContents.loadURL('https://admin.microsoft.com/AdminPortal/');

  // IPC handler from renderer to navigate
  ipcMain.on('navigate-admin', (_evt, url) => {
    adminView.webContents.loadURL(url);
  });


  // --- tenant prompt (modal window) ---
  ipcMain.handle('prompt-sharepoint-tenant', async (_evt, initialValue) => {
    return await openTenantPrompt(win, initialValue || '');
  });
}


// Modal prompt helper
function openTenantPrompt(parentWindow, initialValue) {
  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      parent: parentWindow,
      modal: true,
      width: 560,
      height: 220,
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

    const reply = (value) => {
      resolve(value);
      if (!promptWin.isDestroyed()) promptWin.close();
    };

    ipcMain.once('tenant-prompt-result', (_e, value) => reply(value));
    promptWin.on('closed', () => resolve(null));

    promptWin.once('ready-to-show', () => promptWin.show());
    promptWin.loadFile('tenantPrompt.html', { query: { value: initialValue } });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
