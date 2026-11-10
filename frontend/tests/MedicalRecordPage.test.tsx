import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';
import type { MedicalWorkerRole } from '../src/types';

const record = {
  id: 7, patientId: 3, isEditingLocked: false, createdAt: '2026-10-01T08:00:00.000Z',
  diagnoses: [{ diagnosisId: 11, code: 'J00.01', name: 'Острый назофарингит' }],
  prescriptions: [{ prescriptionId: '11111111-1111-4111-8111-111111111111', text: 'Принимать препарат два раза в день' }],
};
const patient = { id: 3, firstName: 'Иван', lastName: 'Иванов', middleName: null, birthDate: '1990-01-01T00:00:00.000Z', sex: 'MALE', comment: null, createdAt: '', updatedAt: '' };
const diagnosis = { id: 12, code: 'A00.01', name: 'Холера', createdAt: '', updatedAt: '' };
const labTest = { id: 21, name: 'Глюкоза', loincCode: '2345-7', resultKind: 'QUANTITY', unitCode: 'mg/dL', unitDisplay: 'мг/дл', methodDescription: null, isActive: true, createdAt: '', updatedAt: '' };
const labOrder = { id: '22222222-2222-4222-8222-222222222222', labTestId: 21, name: 'Глюкоза', loincCode: '2345-7', orderedAt: '2026-10-02T08:00:00.000Z', status: 'completed', requester: { id: 5, firstName: 'Анна', middleName: null, lastName: 'Петрова', position: 'Врач', isDeleted: false }, result: { id: '33333333-3333-4333-8333-333333333333', kind: 'QUANTITY', textValue: null, quantityValue: '5.600000', unitCode: 'mg/dL', unitDisplay: 'мг/дл', effectiveAt: '2026-10-02T09:00:00.000Z', registeredAt: '2026-10-02T09:05:00.000Z' } };

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockApi(state = record, events: unknown[] = [], labTests: unknown[] = [labTest], labOrders: unknown[] = [labOrder]) {
  let currentState = state;
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    if (url.endsWith('/patients/3')) return Promise.resolve(jsonResponse(patient));
    if (url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse([diagnosis]));
    if (url.endsWith('/lab-tests')) return Promise.resolve(jsonResponse(labTests));
    if (method === 'POST' && url.endsWith('/lab-orders')) {
      currentState = { ...currentState, isEditingLocked: true };
      return Promise.resolve(jsonResponse({ id: 'batch', orders: [labOrder] }, 201));
    }
    if (url.includes('/lab-orders')) return Promise.resolve(jsonResponse(labOrders));
    if (url.endsWith('/unlock')) {
      currentState = { ...currentState, isEditingLocked: false };
      return Promise.resolve(jsonResponse(currentState));
    }
    if (method === 'POST' && url.endsWith('/diagnoses')) {
      currentState = { ...currentState, isEditingLocked: true };
      return Promise.resolve(jsonResponse({ diagnosis, version: 1 }, 201));
    }
    if (method === 'POST' && url.endsWith('/prescriptions')) {
      currentState = { ...currentState, isEditingLocked: true };
      return Promise.resolve(jsonResponse({ prescriptionId: crypto.randomUUID(), text: 'Новое назначение', version: 1 }, 201));
    }
    if (url.endsWith('/events')) return Promise.resolve(jsonResponse(events));
    if (url.includes('/medical-records/7')) return Promise.resolve(jsonResponse(currentState));
    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404));
  });
}

function renderPage(role: MedicalWorkerRole = 'doctor') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const identity = { subjectType: 'user' as const, id: '11111111-1111-4111-8111-111111111111', username: 'worker', isActive: true, medicalWorker: { middleName: null, id: 5, firstName: 'Анна', lastName: 'Петрова', position: 'Врач', role } };
  return render(<QueryClientProvider client={client}><AuthProvider initialSession={{ identity, accessToken: 'token', accessTokenExpiresIn: 900 }}><MemoryRouter initialEntries={['/app/medical-records/7']}><App /></MemoryRouter></AuthProvider></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('MedicalRecordPage authorization-aware UI', () => {
  it('renders current medical record state', async () => {
    mockApi(); renderPage();
    expect(await screen.findByText('J00.01 — Острый назофарингит')).toBeInTheDocument();
    expect(screen.getByText('Принимать препарат два раза в день')).toBeInTheDocument();
    expect(await screen.findByText('Глюкоза')).toBeInTheDocument();
    expect(screen.getByText(/5.600000 мг\/дл/)).toBeInTheDocument();
  });

  it('creates selected laboratory orders with one stable client request id and relocks the record', async () => {
    const fetchMock = mockApi(); renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить анализы' }));
    fireEvent.click(await screen.findByRole('button', { name: /Глюкоза/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/lab-orders') && init?.method === 'POST');
      const body = JSON.parse(String(call?.[1]?.body));
      expect(body.labTestIds).toEqual([21]);
      expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(await screen.findByText(/Анализы назначены/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назначить анализы' })).not.toBeInTheDocument();
  });

  it('supports multiple selection, deselection and blocks an empty submission', async () => {
    const second = { ...labTest, id: 22, name: 'Гемоглобин', loincCode: '718-7' };
    mockApi(record, [], [labTest, second], []); renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить анализы' }));
    const submit = screen.getByRole('button', { name: 'Назначить' });
    expect(submit).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: /Глюкоза/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Гемоглобин/ }));
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Глюкоза/ }));
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('shows the laboratory empty state', async () => {
    mockApi(record, [], [labTest], []); renderPage();
    expect(await screen.findByText('Лабораторных назначений нет')).toBeInTheDocument();
  });

  it.each(['nurse', 'laboratory-technician', 'other'] as const)('does not offer laboratory creation to the %s role', async (role) => {
    mockApi(); renderPage(role);
    await screen.findByText('Глюкоза');
    expect(screen.queryByRole('button', { name: 'Назначить анализы' })).not.toBeInTheDocument();
  });

  it('preserves event history and reconstruction at a selected date and time', async () => {
    const fetchMock = mockApi(record, [{
      version: 1,
      type: 'DIAGNOSIS_ADDED',
      payload: record.diagnoses[0],
      createdAt: '2026-10-01T08:00:00.000Z',
      worker: { id: 5, firstName: 'Анна', lastName: 'Петрова', position: 'Врач', isDeleted: false },
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'История' }));
    expect(await screen.findByText('Добавлен диагноз')).toBeInTheDocument();
    expect(screen.getByText('Версия 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Текущее состояние' }));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Время'), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(await screen.findByText(/Состояние на/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/medical-records/7?at='))).toBe(true);
  });

  it('allows only a doctor to request unlock', async () => {
    const fetchMock = mockApi({ ...record, isEditingLocked: true }); renderPage('doctor');
    fireEvent.click(await screen.findByRole('button', { name: 'Разблокировать' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/medical-records/7/unlock'))).toBe(true));
  });

  it.each(['nurse', 'laboratory-technician', 'other'] as const)(
    'does not offer unlock to the %s role',
    async (role) => {
      mockApi({ ...record, isEditingLocked: true }); renderPage(role);
      await screen.findByText(/ЭМК заблокирована/);
      expect(screen.queryByRole('button', { name: 'Разблокировать' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
    },
  );

  it('allows a nurse to edit a record that a doctor has already unlocked', async () => {
    mockApi(record); renderPage('nurse');
    expect(await screen.findByRole('button', { name: 'Добавить диагноз' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Разблокировать' })).not.toBeInTheDocument();
  });

  it('never sends workerId when adding a diagnosis', async () => {
    const fetchMock = mockApi(); renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить диагноз' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Диагноз' }));
    fireEvent.click(await screen.findByRole('option', { name: 'A00.01 — Холера' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/medical-records/7/diagnoses') && init?.method === 'POST');
      expect(call?.[1]?.body).toBe(JSON.stringify({ diagnosisId: 12 }));
      expect(String(call?.[1]?.body)).not.toContain('workerId');
    });
    expect(await screen.findByText(/ЭМК снова открыта только для просмотра/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
  });

  it('never sends workerId when adding a prescription', async () => {
    const fetchMock = mockApi(); renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить назначение' }));
    fireEvent.change(screen.getByLabelText('Текст назначения'), { target: { value: 'Новое назначение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/prescriptions') && init?.method === 'POST');
      expect(call?.[1]?.body).toBe(JSON.stringify({ text: 'Новое назначение' }));
      expect(String(call?.[1]?.body)).not.toContain('workerId');
    });
  });

  it('drops editing controls and refreshes the current role after a forbidden write', async () => {
    let currentState = record;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input); const method = init?.method ?? 'GET';
      if (url.endsWith('/patients/3')) return Promise.resolve(jsonResponse(patient));
      if (url.includes('/lab-orders')) return Promise.resolve(jsonResponse([]));
      if (url.endsWith('/api/auth/me')) return Promise.resolve(jsonResponse({
        id: '11111111-1111-4111-8111-111111111111', username: 'worker', isActive: true,
        medicalWorker: { middleName: null, id: 5, firstName: 'Анна', lastName: 'Петрова', position: 'Врач', role: 'other' },
      }));
      if (method === 'GET' && url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse([diagnosis]));
      if (method === 'POST' && url.endsWith('/diagnoses')) {
        currentState = { ...currentState, isEditingLocked: true };
        return Promise.resolve(jsonResponse({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403));
      }
      if (url.endsWith('/events')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/medical-records/7')) return Promise.resolve(jsonResponse(currentState));
      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404));
    });
    renderPage('doctor');
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить диагноз' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Диагноз' }));
    fireEvent.click(await screen.findByRole('option', { name: 'A00.01 — Холера' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText('Недостаточно прав для выполнения операции.')).toBeInTheDocument();
    expect(await screen.findByText('Другая роль')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
  });

  it('leaves the editing interface when the account session is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input); const method = init?.method ?? 'GET';
      if (url.endsWith('/patients/3')) return Promise.resolve(jsonResponse(patient));
      if (url.includes('/lab-orders')) return Promise.resolve(jsonResponse([]));
      if (method === 'GET' && url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse([diagnosis]));
      if (method === 'POST' && url.endsWith('/diagnoses')) {
        return Promise.resolve(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
      }
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
      }
      if (url.includes('/medical-records/7')) return Promise.resolve(jsonResponse(record));
      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404));
    });
    renderPage('doctor');
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить диагноз' }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Диагноз' }));
    fireEvent.click(await screen.findByRole('option', { name: 'A00.01 — Холера' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByRole('heading', { name: 'Вход медработника' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
