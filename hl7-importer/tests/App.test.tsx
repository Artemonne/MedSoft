// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import type { Hl7ImporterApi, ImportPatient } from '../src/shared/types';

const patients: ImportPatient[] = [
  { rowId: 'one', externalId: 'EXT-1', firstName: 'Анна', middleName: null, lastName: 'Иванова', birthDate: '1990-01-01', sex: 'FEMALE', address: null, phone: null, diagnoses: [] },
  { rowId: 'two', externalId: 'EXT-2', firstName: 'Пётр', middleName: null, lastName: 'Петров', birthDate: '1991-02-02', sex: 'MALE', address: null, phone: null, diagnoses: [] },
];

function api(overrides: Partial<Hl7ImporterApi> = {}): Hl7ImporterApi {
  return {
    getSettings: vi.fn().mockResolvedValue(null), chooseFile: vi.fn().mockResolvedValue(null),
    testConnection: vi.fn().mockResolvedValue({ ok: true, api: { ok: true, message: 'API успешно' }, mllp: { ok: true, message: 'MLLP успешно' }, certificate: { subject: 'CN=localhost', commonName: 'localhost', issuer: 'CN=Test CA', validFrom: 'today', validTo: 'tomorrow', serialNumber: '01', fingerprintSha256: 'AA:BB', authorized: true } }),
    chooseXml: vi.fn().mockResolvedValue({ fileName: 'demo.xml', patients, errors: [], demonstrationFormat: true }),
    importPatients: vi.fn().mockResolvedValue([
      { rowId: 'one', status: 'SUCCESS', hisPatientId: '101', message: 'Пациент импортирован.' },
      { rowId: 'two', status: 'REJECTED', hisPatientId: null, message: 'Дубликат' },
    ]),
    onImportProgress: vi.fn().mockReturnValue(() => {}), ...overrides,
  };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('desktop UI', () => {
  it('shows independent HTTP/MLLP checks and server certificate details', async () => {
    Object.defineProperty(window, 'hl7Importer', { configurable: true, value: api() });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить соединение' }));
    expect(await screen.findByText('API успешно')).toBeInTheDocument();
    expect(screen.getByText('MLLP успешно')).toBeInTheDocument();
    expect(screen.getByText(/CN=localhost/)).toBeInTheDocument();
    expect(screen.getByText(/AA:BB/)).toBeInTheDocument();
  });

  it('displays XML patients, progress outcomes and aggregate counters', async () => {
    Object.defineProperty(window, 'hl7Importer', { configurable: true, value: api() });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Импорт пациентов' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать XML' }));
    expect(await screen.findByText(/demo.xml: пациентов 2/)).toBeInTheDocument();
    expect(screen.getByText('Иванова Анна')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Запустить импорт' }));
    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    expect(screen.getByText('Дубликат')).toBeInTheDocument();
    expect(screen.getByText('Успешно: 1')).toBeInTheDocument();
    expect(screen.getByText('Ошибок: 1')).toBeInTheDocument();
  });
});
