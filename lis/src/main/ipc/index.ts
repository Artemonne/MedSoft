import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/types.js';
import type { ConnectionService } from '../auth/connection-service.js';
import type { FhirRequestService } from '../fhir/request-service.js';
import { isTrustedSender } from '../security.js';

export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, service: ConnectionService, requests: FhirRequestService, developmentOrigin?: string) {
  const secure = <T extends unknown[], R>(handler: (...args: T) => Promise<R> | R) => async (event: IpcMainInvokeEvent, ...args: T) => {
    if (!isTrustedSender(event.senderFrame?.url ?? '', developmentOrigin)) throw new Error('Недоверенный источник IPC.');
    return handler(...args);
  };
  ipcMain.handle(IPC.status, secure(() => service.status()));
  ipcMain.handle(IPC.configure, secure((input: unknown) => service.configure(input)));
  ipcMain.handle(IPC.test, secure(() => service.test()));
  ipcMain.handle(IPC.disconnect, secure(async () => { const result = await service.disconnect(); requests.clear(); return result; }));
  ipcMain.handle(IPC.listRequests, secure((input: unknown) => requests.list(input)));
  ipcMain.handle(IPC.requestDetails, secure((id: unknown) => requests.details(id)));
}
