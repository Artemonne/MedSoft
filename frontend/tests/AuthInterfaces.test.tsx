import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';
import { AdminBootstrapPage } from '../src/pages/AdminBootstrapPage';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function providers(children: React.ReactNode, restoreSession = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}><AuthProvider restoreSession={restoreSession}>{children}</AuthProvider></QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe('authentication interfaces', () => {
  it('completes initial TOTP setup and does not show the secret afterwards', async () => {
    const manualSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/bootstrap/status')) return Promise.resolve(jsonResponse({ status: 'NOT_CONFIGURED' }));
      if (url.endsWith('/bootstrap/start')) return Promise.resolve(jsonResponse({
        status: 'TOTP_SETUP_REQUIRED', manualSecret, otpauthUrl: 'otpauth://totp/MedSoft',
        qrCodeDataUrl: 'data:image/png;base64,AAAA',
      }, 201));
      if (url.endsWith('/bootstrap/complete')) {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(body.totpCode === '123456'
          ? jsonResponse({ id: 1, setupState: 'ACTIVE', createdAt: '', updatedAt: '' })
          : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
      }
      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404));
    });
    render(<MemoryRouter initialEntries={['/admin/setup']}><Routes>
      <Route path="/admin/setup" element={<AdminBootstrapPage />} />
      <Route path="/admin/login" element={<div>Экран входа</div>} />
    </Routes></MemoryRouter>);

    await screen.findByLabelText(/Bootstrap-секрет/);
    fireEvent.change(screen.getByLabelText(/Bootstrap-секрет/), { target: { value: 'bootstrap-370553' } });
    fireEvent.change(screen.getByLabelText(/Новый пароль/), { target: { value: 'Secure password 370553' } });
    fireEvent.change(screen.getByLabelText(/Подтверждение пароля/), { target: { value: 'Secure password 370553' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать администратора' }));
    expect(await screen.findByText(manualSecret)).toBeInTheDocument();
    expect(screen.getByAltText('QR-код для настройки TOTP')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Текущий код TOTP/), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Завершить настройку' }));
    expect(await screen.findByText(/Не удалось подтвердить TOTP-код/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Текущий код TOTP/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Завершить настройку' }));
    expect(await screen.findByText('Экран входа')).toBeInTheDocument();
    expect(screen.queryByText(manualSecret)).not.toBeInTheDocument();
  });

  it('logs an administrator in only with password and TOTP', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/bootstrap/status')) return Promise.resolve(jsonResponse({ status: 'CONFIGURED' }));
      if (url.endsWith('/auth/login')) {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(body.totpCode === '123456'
          ? jsonResponse({ accessToken: 'admin-access', accessTokenExpiresIn: 900, administrator: { id: 1, setupState: 'ACTIVE', createdAt: '', updatedAt: '' } })
          : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
      }
      return Promise.resolve(jsonResponse([]));
    });
    render(providers(<MemoryRouter initialEntries={['/admin/login']}><App /></MemoryRouter>));
    await screen.findByLabelText(/Пароль/);
    fireEvent.change(screen.getByLabelText(/Пароль/), { target: { value: 'password' } });
    fireEvent.change(screen.getByLabelText(/Код TOTP/), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Неверный пароль или одноразовый код.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Код TOTP/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Медработники' })).toBeInTheDocument();
  });

  it('logs a medical worker in and reports an inactive account generically', async () => {
    let active = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input).endsWith('/api/auth/login')) return Promise.resolve(active
        ? jsonResponse({ accessToken: 'user-access', accessTokenExpiresIn: 900, account: { id: crypto.randomUUID(), username: 'doctor', isActive: true, medicalWorker: { id: 5, firstName: 'A', lastName: 'B', position: 'Doctor', role: 'doctor' } } })
        : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
      return Promise.resolve(jsonResponse([]));
    });
    render(providers(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>));
    fireEvent.change(screen.getByLabelText(/Имя пользователя/), { target: { value: 'doctor' } });
    fireEvent.change(screen.getByLabelText(/Пароль/), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText(/Неверные учётные данные или аккаунт деактивирован/)).toBeInTheDocument();
    active = true;
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('heading', { name: 'Пациенты' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});

describe('account administration interface', () => {
  it('creates an account and reveals the generated password only in the issuance dialog', async () => {
    const worker = { id: 7, firstName: 'Иван', lastName: 'Иванов', position: 'Врач', role: 'doctor', isDeleted: false, createdAt: '', updatedAt: '' };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/admin/accounts') && init?.method === 'POST') return Promise.resolve(jsonResponse({ account: { id: crypto.randomUUID(), username: 'ivanov', isActive: true, createdAt: '', updatedAt: '', medicalWorker: worker }, generatedPassword: 'AbCdEf123456' }, 201));
      if (url.endsWith('/api/admin/accounts')) return Promise.resolve(jsonResponse([]));
      if (url.endsWith('/api/medical-workers')) return Promise.resolve(jsonResponse([worker]));
      return Promise.resolve(jsonResponse([]));
    });
    const admin = { subjectType: 'admin' as const, id: 1, setupState: 'ACTIVE' as const, createdAt: '', updatedAt: '' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider initialSession={{ identity: admin, accessToken: 'token', accessTokenExpiresIn: 900 }}><MemoryRouter initialEntries={['/admin/accounts']}><App /></MemoryRouter></AuthProvider></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать аккаунт' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ivanov' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Медработник' }));
    fireEvent.click(await screen.findByRole('option', { name: /Иванов Иван/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByDisplayValue('AbCdEf123456')).toBeInTheDocument();
    expect(screen.getByText(/После закрытия он больше не будет показан/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Я сохранил пароль' }));
    await waitFor(() => expect(screen.queryByDisplayValue('AbCdEf123456')).not.toBeInTheDocument());
  });
});
