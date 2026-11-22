import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } from 'electron';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigurationStore } from './configuration/store.js';
import { TokenService } from './auth/token-service.js';
import { MllpClient } from './hl7/mllp-client.js';
import { DemoXmlAdapter } from './xml/demo-adapter.js';
import { ImporterService } from './importer-service.js';
import { registerIpc } from './ipc.js';
import { trustedProtocol, windowWebPreferences } from './security.js';

protocol.registerSchemesAsPrivileged([{ scheme: trustedProtocol, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  const rendererRoot = join(__dirname, '../renderer');
  protocol.handle(trustedProtocol, (request) => {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const file = resolve(rendererRoot, requested);
    const relation = relative(rendererRoot, file);
    if (relation.startsWith('..') || relation.includes(':')) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const secrets = {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptStringAsync(value),
    decrypt: async (value: Uint8Array) => (await safeStorage.decryptStringAsync(Buffer.from(value))).result,
  };
  const store = new ConfigurationStore(join(app.getPath('userData'), 'hl7-importer.json'), secrets);
  const tokens = new TokenService(store);
  const service = new ImporterService(store, tokens, new MllpClient(), new DemoXmlAdapter());
  const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
  registerIpc(ipcMain, service, developmentOrigin);
  const window = new BrowserWindow({
    title: 'MedSoft HL7 Importer', width: 1180, height: 780, minWidth: 900, minHeight: 620,
    webPreferences: { ...windowWebPreferences, preload: join(__dirname, '../preload/index.cjs') },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAllowed(url, developmentOrigin)) event.preventDefault(); });
  if (developmentOrigin) void window.loadURL(developmentOrigin); else void window.loadURL(`${trustedProtocol}://renderer/index.html`);
});

function isAllowed(url: string, developmentOrigin?: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === `${trustedProtocol}:` && parsed.host === 'renderer' || Boolean(developmentOrigin && parsed.origin === new URL(developmentOrigin).origin); }
  catch { return false; }
}
app.on('window-all-closed', () => app.quit());
