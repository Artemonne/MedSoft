import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceAccountsPage } from '../src/pages/ServiceAccountsPage';

const account = { id: '11111111-1111-4111-8111-111111111111', name: 'Main LIS', role: 'LIS', isActive: true, keyIdentifier: 'msk_abc123…', keyVersion: 1, rotatedAt: '2026-01-01T00:00:00Z', lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
function response(data: unknown) { return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('ServiceAccountsPage', () => {
  it('shows the HL7 Import role in the service account list', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => response([{ ...account, name: 'Patient Import', role: 'HL7_IMPORT' }]));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ServiceAccountsPage /></QueryClientProvider>);
    expect(await screen.findByText('Patient Import')).toBeInTheDocument();
    expect(screen.getByText('HL7 Import')).toBeInTheDocument();
  });
  it('creates an HL7 Import account and shows its API key once', async () => {
    const secret = 'msk_abcdefghijklmnop_abcdefghijklmnopqrstuvwxyzABCDEFG0123456789';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => response(init?.method === 'POST' ? { account: { ...account, role: 'HL7_IMPORT' }, apiKey: secret } : [account]));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ServiceAccountsPage /></QueryClientProvider>);
    await screen.findByText('Main LIS'); fireEvent.click(screen.getByRole('button', { name: 'Создать сервисный аккаунт' })); fireEvent.change(screen.getByLabelText('Название интеграции'), { target: { value: 'Patient Import' } }); fireEvent.mouseDown(screen.getByLabelText('Роль')); fireEvent.click(await screen.findByRole('option', { name: 'HL7 Import' })); fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body))).toEqual({ name: 'Patient Import', role: 'HL7_IMPORT' });
    expect(await screen.findByDisplayValue(secret)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Я сохранил ключ' })); expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument(); expect(screen.getByText('msk_abc123…')).toBeInTheDocument();
  });
});
