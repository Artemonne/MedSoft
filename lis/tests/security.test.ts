import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../src/shared/types.js';
import { isTrustedSender, windowWebPreferences } from '../src/main/security.js';
import { registerIpc } from '../src/main/ipc/index.js';
describe('Electron security boundary', () => {
  it('enables isolation and sandbox without Node integration', () => { expect(windowWebPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false }); });
  it('registers only the fixed API and rejects untrusted IPC senders', async () => {
    const handlers = new Map<string, Function>(); const ipc = { handle: vi.fn((channel: string, handler: Function) => handlers.set(channel, handler)) };
    const service = { status: vi.fn(() => ({ state: 'not-configured' })), configure: vi.fn(), test: vi.fn(), disconnect: vi.fn() } as any;
    registerIpc(ipc as any, service, { list: vi.fn(), details: vi.fn(), clear: vi.fn() } as any, { submit: vi.fn(), reconcile: vi.fn(), listHistory: vi.fn() } as any);
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC).sort());
    await expect(handlers.get(IPC.status)!({ senderFrame: { url: 'https://evil.test/' } })).rejects.toThrow('Недоверенный');
    await expect(handlers.get(IPC.status)!({ senderFrame: { url: 'app://renderer/index.html' } })).resolves.toMatchObject({ state: 'not-configured' });
  });
  it('accepts only validated HTTPS connection input', async () => {
    const handlers = new Map<string, Function>(); const service = { status: vi.fn(), configure: vi.fn(async (value) => { const { connectionInputSchema } = await import('../src/main/configuration/validation.js'); return connectionInputSchema.parse(value); }), test: vi.fn(), disconnect: vi.fn() } as any;
    registerIpc({ handle: (channel: string, handler: Function) => handlers.set(channel, handler) } as any, service, { list: vi.fn(), details: vi.fn(), clear: vi.fn() } as any, { submit: vi.fn(), reconcile: vi.fn(), listHistory: vi.fn() } as any);
    const invoke = (value: unknown) => handlers.get(IPC.configure)!({ senderFrame: { url: 'app://renderer/index.html' } }, value);
    await expect(invoke({ hisUrl: 'file:///secret', apiKey: 'x' })).rejects.toThrow();
    await expect(invoke({ hisUrl: 'https://user:pass@his.test', apiKey: 'x' })).rejects.toThrow();
    await expect(invoke({ hisUrl: 'https://his.test', apiKey: 'x', extra: true })).rejects.toThrow();
  });
});
