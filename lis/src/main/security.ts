import type { WebPreferences } from 'electron';

export const trustedProtocol = 'app';
export const windowWebPreferences: WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
};

export function isTrustedSender(url: string, developmentOrigin?: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${trustedProtocol}:` && parsed.host === 'renderer') return true;
    return Boolean(developmentOrigin && parsed.origin === new URL(developmentOrigin).origin);
  } catch { return false; }
}
