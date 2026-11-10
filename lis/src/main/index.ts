import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } from 'electron';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LisDatabase } from './database/index.js';
import { ConnectionService } from './auth/connection-service.js';
import { registerIpc } from './ipc/index.js';
import { trustedProtocol, windowWebPreferences } from './security.js';
import { FhirRequestService } from './fhir/request-service.js';
import { SubmissionService } from './fhir/submission-service.js';

protocol.registerSchemesAsPrivileged([{ scheme: trustedProtocol, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  const rendererRoot = join(__dirname, '../renderer');
  protocol.handle(trustedProtocol, (request) => {
    const url = new URL(request.url); const requested = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)); const file = resolve(rendererRoot, requested); const relation = relative(rendererRoot, file);
    if (relation.startsWith('..') || relation.includes(':')) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const database = new LisDatabase(join(app.getPath('userData'), 'medsoft-lis.sqlite'));
  const secrets = {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptStringAsync(value),
    decrypt: async (value: Uint8Array) => (await safeStorage.decryptStringAsync(Buffer.from(value))).result,
  };
  const service = new ConnectionService(database, secrets);
  const requests = new FhirRequestService(service);
  const submissions = new SubmissionService(database, service, requests);
  const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
  registerIpc(ipcMain, service, requests, submissions, developmentOrigin);
  const window = new BrowserWindow({ title: 'MedSoft LIS', width: 1100, height: 720, minWidth: 760, minHeight: 560, webPreferences: { ...windowWebPreferences, preload: join(__dirname, '../preload/index.mjs') } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAllowed(url, developmentOrigin)) event.preventDefault(); });
  if (developmentOrigin) void window.loadURL(developmentOrigin); else void window.loadURL(`${trustedProtocol}://renderer/index.html`);
  app.on('before-quit', () => database.close());
});

function isAllowed(url: string, developmentOrigin?: string) { try { const parsed = new URL(url); return (parsed.protocol === `${trustedProtocol}:` && parsed.host === 'renderer') || Boolean(developmentOrigin && parsed.origin === new URL(developmentOrigin).origin); } catch { return false; } }
app.on('window-all-closed', () => app.quit());
