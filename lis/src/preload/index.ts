import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ConnectionInput, type LisApi, type RequestFilter } from '../shared/types.js';

const api: LisApi = Object.freeze({
  getConnectionStatus: () => ipcRenderer.invoke(IPC.status),
  configureConnection: (input: ConnectionInput) => ipcRenderer.invoke(IPC.configure, input),
  testConnection: () => ipcRenderer.invoke(IPC.test),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  listRequests: (input: { filter: RequestFilter; offset: number }) => ipcRenderer.invoke(IPC.listRequests, input),
  getRequestDetails: (id: string) => ipcRenderer.invoke(IPC.requestDetails, id),
});
contextBridge.exposeInMainWorld('lis', api);
