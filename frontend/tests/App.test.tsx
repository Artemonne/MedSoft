import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';
import type { AuthIdentity } from '../src/types';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const admin: AuthIdentity = {
  subjectType: 'admin', id: 1, setupState: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const doctor: AuthIdentity = {
  subjectType: 'user', id: '11111111-1111-4111-8111-111111111111', username: 'doctor', isActive: true,
  medicalWorker: { id: 5, firstName: 'Анна', lastName: 'Петрова', position: 'Врач', role: 'doctor' },
};

function renderApp(route: string, identity: AuthIdentity) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <AuthProvider initialSession={{ identity, accessToken: 'test-token', accessTokenExpiresIn: 900 }}>
      <MemoryRouter initialEntries={[route]}><App /></MemoryRouter>
    </AuthProvider>
  </QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('App routing and existing pages', () => {
  it('shows separate navigation for administrator and worker', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    const workerView = renderApp('/app/patients', doctor);
    expect(screen.getByRole('link', { name: 'Пациенты' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Аккаунты' })).not.toBeInTheDocument();
    expect(screen.getByText(/Петрова Анна · doctor/)).toBeInTheDocument();
    expect(screen.getByText('Врач')).toBeInTheDocument();
    workerView.unmount();
    renderApp('/admin/medical-workers', admin);
    expect(screen.getByRole('link', { name: 'Медработники' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Аккаунты' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Пациенты' })).not.toBeInTheDocument();
  });

  it('renders mocked medical workers in the administrator area', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([{
      id: 1, firstName: 'Иван', lastName: 'Иванов', position: 'Терапевт', role: 'doctor', isDeleted: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]));
    renderApp('/admin/medical-workers', admin);
    expect(await screen.findByText('Иванов')).toBeInTheDocument();
    expect(screen.getByText('Терапевт')).toBeInTheDocument();
  });

  it('loads the diagnosis seed through the administrator API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      Promise.resolve(jsonResponse(init?.method === 'POST' ? { created: 5, total: 5 } : [])));
    renderApp('/admin/diagnoses', admin);
    await screen.findByText('Диагнозы не найдены');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить исходные' }));
    expect(await screen.findByText('Добавлено диагнозов: 5 из 5.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/admin/diagnoses/seed')).toBe(true);
  });

  it('keeps patient validation from the previous stage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    renderApp('/app/patients', doctor);
    await screen.findByText('Пациенты не найдены');
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Иванов' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Иван' } });
    fireEvent.change(screen.getByLabelText('Дата рождения'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Дата рождения не может быть в будущем')).toBeInTheDocument();
  });

  it('prevents a user from opening administrator pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    renderApp('/admin/accounts', doctor);
    expect(await screen.findByRole('heading', { name: 'Пациенты' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Аккаунты медработников' })).not.toBeInTheDocument();
  });
});
