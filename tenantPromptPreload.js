const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tenantPrompt', {
  submit: (value) => ipcRenderer.send('tenant-prompt-result', value),
  cancel: () => ipcRenderer.send('tenant-prompt-result', null),
});
