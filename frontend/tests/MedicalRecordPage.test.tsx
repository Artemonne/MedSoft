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

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockApi(state = record) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    if (url.endsWith('/patients/3')) return Promise.resolve(jsonResponse(patient));
    if (url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse([diagnosis]));
    if (url.endsWith('/unlock')) return Promise.resolve(jsonResponse({ ...state, isEditingLocked: false }));
    if (method === 'POST' && url.endsWith('/diagnoses')) return Promise.resolve(jsonResponse({ diagnosis, version: 1 }, 201));
    if (method === 'POST' && url.endsWith('/prescriptions')) return Promise.resolve(jsonResponse({ prescriptionId: crypto.randomUUID(), text: 'Новое назначение', version: 1 }, 201));
    if (url.endsWith('/events')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/medical-records/7')) return Promise.resolve(jsonResponse(state));
    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404));
  });
}

function renderPage(role: MedicalWorkerRole = 'doctor') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const identity = { subjectType: 'user' as const, id: '11111111-1111-4111-8111-111111111111', username: 'worker', isActive: true, medicalWorker: { id: 5, firstName: 'Анна', lastName: 'Петрова', position: 'Врач', role } };
  return render(<QueryClientProvider client={client}><AuthProvider initialSession={{ identity, accessToken: 'token', accessTokenExpiresIn: 900 }}><MemoryRouter initialEntries={['/app/medical-records/7']}><App /></MemoryRouter></AuthProvider></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('MedicalRecordPage authorization-aware UI', () => {
  it('renders current medical record state', async () => {
    mockApi(); renderPage();
    expect(await screen.findByText('J00.01 — Острый назофарингит')).toBeInTheDocument();
    expect(screen.getByText('Принимать препарат два раза в день')).toBeInTheDocument();
  });

  it('allows only a doctor to request unlock', async () => {
    const fetchMock = mockApi({ ...record, isEditingLocked: true }); renderPage('doctor');
    fireEvent.click(await screen.findByRole('button', { name: 'Разблокировать' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/medical-records/7/unlock'))).toBe(true));
  });

  it('does not offer unlock or mutation controls to a laboratory technician', async () => {
    mockApi({ ...record, isEditingLocked: true }); renderPage('laboratory-technician');
    await screen.findByText(/ЭМК заблокирована/);
    expect(screen.queryByRole('button', { name: 'Разблокировать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить диагноз' })).not.toBeInTheDocument();
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
});
