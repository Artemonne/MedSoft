import { basename } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { dialog } from 'electron';
import { IPC, type ConnectionInput } from '../shared/types.js';
import type { ImporterService } from './importer-service.js';
import { isTrustedSender } from './security.js';

const fileFilters = {
  clientCertificate: [{ name: 'Сертификаты PEM', extensions: ['pem', 'crt', 'cer'] }],
  clientKey: [{ name: 'Закрытые ключи PEM', extensions: ['pem', 'key'] }],
  caCertificate: [{ name: 'Сертификаты CA', extensions: ['pem', 'crt', 'cer'] }],
};

export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, service: ImporterService, developmentOrigin?: string): void {
  const secure = <T extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: T) => Promise<R> | R) => async (event: IpcMainInvokeEvent, ...args: T) => {
    if (!isTrustedSender(event.senderFrame?.url ?? '', developmentOrigin)) throw new Error('Недоверенный источник IPC.');
    return handler(event, ...args);
  };
  ipcMain.handle(IPC.settings, secure(() => service.settings()));
  ipcMain.handle(IPC.chooseFile, secure(async (_event, kind: keyof typeof fileFilters) => {
    if (!(kind in fileFilters)) throw new Error('Неизвестный тип файла.');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: fileFilters[kind] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }));
  ipcMain.handle(IPC.testConnection, secure((_event, input: ConnectionInput) => service.testConnection(input)));
  ipcMain.handle(IPC.chooseXml, secure(async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'XML', extensions: ['xml'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    if (statSync(path).size > 2 * 1024 * 1024) throw new Error('XML превышает лимит 2 МБ.');
    return service.loadXml(readFileSync(path), basename(path));
  }));
  ipcMain.handle(IPC.importPatients, secure((event) => service.importPatients((progress) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC.progress, progress);
  })));
}
