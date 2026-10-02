import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderApp(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the main navigation', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    renderApp('/patients');

    expect(screen.getByRole('link', { name: 'Медработники' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Диагнозы' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Пациенты' })).toBeInTheDocument();
  });

  it('renders mocked medical workers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([{
      id: 1, firstName: 'Иван', lastName: 'Иванов', position: 'Терапевт', isDeleted: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]));
    renderApp('/medical-workers');

    expect(await screen.findByText('Иванов')).toBeInTheDocument();
    expect(screen.getByText('Терапевт')).toBeInTheDocument();
  });

  it('rejects a diagnosis code that is not six characters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    renderApp('/diagnoses');
    await screen.findByText('Диагнозы не найдены');

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    fireEvent.change(screen.getByLabelText('Код'), { target: { value: 'A12' } });
    fireEvent.change(screen.getByLabelText('Наименование'), { target: { value: 'Грипп' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Код должен содержать ровно 6 символов')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a future patient birth date', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    renderApp('/patients');
    await screen.findByText('Пациенты не найдены');

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Иванов' } });
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Иван' } });
    fireEvent.change(screen.getByLabelText('Дата рождения'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Дата рождения не может быть в будущем')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a readable patient delete conflict', async () => {
    const patient = {
      id: 1, firstName: 'Иван', lastName: 'Иванов', middleName: null, birthDate: '1990-01-01T00:00:00.000Z',
      sex: 'MALE', comment: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ error: { code: 'CONFLICT', message: 'A patient with a medical record cannot be deleted.' } }, 409));
      return Promise.resolve(jsonResponse([patient]));
    });
    renderApp('/patients');
    await screen.findByText('Иванов');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Нельзя удалить пациента, для которого создана ЭМК.')).toBeInTheDocument();
  });

  it('shows Create Medical Record when the patient has no record', async () => {
    const patient = {
      id: 1, firstName: 'Иван', lastName: 'Иванов', middleName: null, birthDate: '1990-01-01T00:00:00.000Z',
      sex: 'MALE', comment: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/medical-record')) return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Medical record not found.' } }, 404));
      return Promise.resolve(jsonResponse(patient));
    });
    renderApp('/patients/1');

    expect(await screen.findByRole('button', { name: 'Создать ЭМК' })).toBeInTheDocument();
  });
});
