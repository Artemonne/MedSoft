import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ConnectionInput, type Hl7ImporterApi, type ImportProgress } from '../shared/types.js';

const api: Hl7ImporterApi = Object.freeze({
  getSettings: () => ipcRenderer.invoke(IPC.settings),
  chooseFile: (kind: 'clientCertificate' | 'clientKey' | 'caCertificate') => ipcRenderer.invoke(IPC.chooseFile, kind),
  testConnection: (input: ConnectionInput) => ipcRenderer.invoke(IPC.testConnection, input),
  chooseXml: () => ipcRenderer.invoke(IPC.chooseXml),
  importPatients: () => ipcRenderer.invoke(IPC.importPatients),
  onImportProgress: (listener: (progress: ImportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => listener(progress);
    ipcRenderer.on(IPC.progress, handler);
    return () => ipcRenderer.removeListener(IPC.progress, handler);
  },
});
contextBridge.exposeInMainWorld('hl7Importer', api);
