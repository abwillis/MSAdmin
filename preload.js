const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adminNav', {
  go: (url) => ipcRenderer.send('navigate-admin', url),
  promptSharePointTenant: (initialValue) => ipcRenderer.invoke('prompt-sharepoint-tenant', initialValue),
});
