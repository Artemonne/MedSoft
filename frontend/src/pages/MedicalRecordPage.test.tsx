import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const currentState = {
  id: 7,
  patientId: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  diagnoses: [{ diagnosisId: 11, code: 'J00.01', name: 'Острый назофарингит' }],
  prescriptions: [{ prescriptionId: '11111111-1111-4111-8111-111111111111', text: 'Принимать препарат два раза в день' }],
};

const historicalState = {
  ...currentState,
  diagnoses: [{ diagnosisId: 12, code: 'A00.01', name: 'Исторический диагноз' }],
  prescriptions: [],
};

const patient = {
  id: 3, firstName: 'Иван', lastName: 'Иванов', middleName: 'Иванович', birthDate: '1990-01-01T00:00:00.000Z',
  sex: 'MALE', comment: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const worker = {
  id: 5, firstName: 'Анна', lastName: 'Петрова', position: 'Терапевт', isDeleted: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const diagnosis = {
  id: 12, code: 'A00.01', name: 'Холера', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockApi(eventWorkerDeleted = false) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('?at=')) return Promise.resolve(jsonResponse(historicalState));
    if (url.endsWith('/medical-records/7/events')) return Promise.resolve(jsonResponse([{
      version: 4,
      type: 'DIAGNOSIS_ADDED',
      payload: { diagnosisId: 11, code: 'J00.01', name: 'Острый назофарингит' },
      createdAt: '2026-10-02T11:30:00.000Z',
      worker: { ...worker, isDeleted: eventWorkerDeleted },
    }]));
    if (url.endsWith('/medical-workers')) return Promise.resolve(jsonResponse([worker]));
    if (method === 'POST' && url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse({ diagnosis, version: 5 }, 201));
    if (url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse([diagnosis]));
    if (url.endsWith('/patients/3')) return Promise.resolve(jsonResponse(patient));
    if (method === 'POST' && url.endsWith('/prescriptions')) return Promise.resolve(jsonResponse({ prescriptionId: '22222222-2222-4222-8222-222222222222', text: 'Новое назначение', version: 5 }, 201));
    if (method === 'PUT' && url.includes('/prescriptions/')) return Promise.resolve(jsonResponse({ previousPrescriptionId: currentState.prescriptions[0].prescriptionId, prescriptionId: '22222222-2222-4222-8222-222222222222', text: 'Изменённое назначение', versions: [5, 6] }));
    if (method === 'DELETE') return Promise.resolve(jsonResponse({ version: 5 }));
    if (url.endsWith('/medical-records/7')) return Promise.resolve(jsonResponse(currentState));
    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404));
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/medical-records/7']}><App /></MemoryRouter></QueryClientProvider>);
}

async function enableEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Начать редактирование' }));
  const dialog = await screen.findByRole('dialog', { name: 'Редактирование ЭМК' });
  fireEvent.mouseDown(await within(dialog).findByRole('combobox', { name: 'Медработник' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Петрова Анна — Терапевт' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Начать редактирование' }));
  await screen.findByText('Редактирует: Петрова Анна, Терапевт');
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MedicalRecordPage', () => {
  it('renders current diagnoses and prescriptions', async () => {
    mockApi(); renderPage();
    expect(await screen.findByText('J00.01 — Острый назофарингит')).toBeInTheDocument();
    expect(screen.getByText('Принимать препарат два раза в день')).toBeInTheDocument();
  });

  it('keeps editing controls unavailable before worker selection', async () => {
    mockApi(); renderPage();
    await screen.findByText('J00.01 — Острый назофарингит');
    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить назначение' })).not.toBeInTheDocument();
  });

  it('enables editing controls after selecting a worker', async () => {
    mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит');
    await enableEditing();
    expect(screen.getByRole('button', { name: 'Добавить диагноз' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить назначение' })).toBeInTheDocument();
  });

  it('sends workerId and diagnosisId when adding a diagnosis', async () => {
    const fetchMock = mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит'); await enableEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить диагноз' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить диагноз' });
    fireEvent.mouseDown(await within(dialog).findByRole('combobox', { name: 'Диагноз' }));
    fireEvent.click(await screen.findByRole('option', { name: 'A00.01 — Холера' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/medical-records/7/diagnoses', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workerId: 5, diagnosisId: 12 }) })));
    expect(await screen.findByRole('button', { name: 'Начать редактирование' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
  });

  it('sends workerId and text when adding a prescription', async () => {
    const fetchMock = mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит'); await enableEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить назначение' }));
    fireEvent.change(screen.getByLabelText('Текст назначения'), { target: { value: 'Новое назначение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/medical-records/7/prescriptions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workerId: 5, text: 'Новое назначение' }) })));
    expect(await screen.findByRole('button', { name: 'Начать редактирование' })).toBeInTheDocument();
  });

  it('refetches state after editing a prescription', async () => {
    const fetchMock = mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит'); await enableEditing();
    const initialGets = fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith('/medical-records/7') && !init?.method).length;
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(screen.getByLabelText('Текст назначения'), { target: { value: 'Изменённое назначение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith('/medical-records/7') && !init?.method).length).toBeGreaterThan(initialGets));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(currentState.prescriptions[0].prescriptionId), expect.objectContaining({ method: 'PUT' }));
  });

  it('renders human-readable event descriptions', async () => {
    mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит');
    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    expect(await screen.findByText('Добавлен диагноз')).toBeInTheDocument();
    expect(screen.getByText('Версия 4')).toBeInTheDocument();
  });

  it('displays a soft-deleted historical worker', async () => {
    mockApi(true); renderPage(); await screen.findByText('J00.01 — Острый назофарингит');
    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    expect(await screen.findByText(/Петрова Анна, Терапевт \(удалён\)/)).toBeInTheDocument();
  });

  it('requests historical state with the selected local date and time', async () => {
    const fetchMock = mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит');
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Время'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/medical-records/7?at='))).toBe(true));
    expect(await screen.findByText('A00.01 — Исторический диагноз')).toBeInTheDocument();
  });

  it('keeps historical state read-only', async () => {
    mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит'); await enableEditing();
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Время'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    await screen.findByText('A00.01 — Исторический диагноз');

    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуться к текущему состоянию' })).toBeInTheDocument();
  });

  it('disables modifications again after finishing editing', async () => {
    mockApi(); renderPage(); await screen.findByText('J00.01 — Острый назофарингит'); await enableEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить редактирование' }));
    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Начать редактирование' })).toBeInTheDocument();
  });
});
