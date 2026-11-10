import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceAccountsPage } from '../src/pages/ServiceAccountsPage';

const account = { id: '11111111-1111-4111-8111-111111111111', name: 'Main LIS', role: 'LIS', isActive: true, keyIdentifier: 'msk_abc123…', keyVersion: 1, rotatedAt: '2026-01-01T00:00:00Z', lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
function response(data: unknown) { return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('ServiceAccountsPage', () => {
  it('shows a newly issued API key once without adding it to the list', async () => {
    const secret = 'msk_abcdefghijklmnop_abcdefghijklmnopqrstuvwxyzABCDEFG0123456789';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => response(init?.method === 'POST' ? { account, apiKey: secret } : [account]));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ServiceAccountsPage /></QueryClientProvider>);
    await screen.findByText('Main LIS'); fireEvent.click(screen.getByRole('button', { name: 'Создать сервисный аккаунт' })); fireEvent.change(screen.getByLabelText('Название интеграции'), { target: { value: 'Second LIS' } }); fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByDisplayValue(secret)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Я сохранил ключ' })); expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument(); expect(screen.getByText('msk_abc123…')).toBeInTheDocument();
  });
});
