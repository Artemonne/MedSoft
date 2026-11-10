import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ConnectionInput, type LisApi } from '../shared/types.js';

const api: LisApi = Object.freeze({
  getConnectionStatus: () => ipcRenderer.invoke(IPC.status),
  configureConnection: (input: ConnectionInput) => ipcRenderer.invoke(IPC.configure, input),
  testConnection: () => ipcRenderer.invoke(IPC.test),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
});
contextBridge.exposeInMainWorld('lis', api);
