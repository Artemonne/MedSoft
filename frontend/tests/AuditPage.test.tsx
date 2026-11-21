import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearApiSession, setApiSession } from '../src/api/client';
import { AuditPage } from '../src/pages/AuditPage';

function response(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

afterEach(() => {
  cleanup();
  clearApiSession();
  vi.restoreAllMocks();
});

describe('AuditPage', () => {
  it('shows identifying fields of the HL7 client certificate', async () => {
    setApiSession('admin', 'admin-access-token', 900);
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/checkpoint')) return response({ cursor: 'cursor-1', serverTime: '2026-11-21T20:00:00Z' });
      if (url.includes('/changes')) return response({ events: [], nextCursor: 'cursor-1', serverTime: '2026-11-21T20:00:00Z' });
      return response({
        events: [{
          id: 'event-1',
          occurredAt: '2026-11-21T20:00:00Z',
          eventType: 'HL7_PATIENT_IMPORTED',
          actorType: 'SERVICE',
          actorIdentifier: 'Patient Import',
          message: 'HL7 patient imported.',
          metadata: { certificate: {
            subject: 'CN=Patient Import',
            issuer: 'CN=MedSoft Local CA',
            serialNumber: '01AB',
            fingerprintSha256: 'AA:BB:CC',
          } },
          accountId: null,
          systemAdministratorId: null,
          serviceAccountId: '11111111-1111-4111-8111-111111111111',
        }],
        nextCursor: null,
        hasMore: false,
        serverTime: '2026-11-21T20:00:00Z',
      });
    });

    render(<AuditPage />);

    expect(await screen.findByText('Сертификат: CN=Patient Import')).toBeInTheDocument();
    expect(screen.getByText('Issuer: CN=MedSoft Local CA')).toBeInTheDocument();
    expect(screen.getByText('Serial: 01AB')).toBeInTheDocument();
    expect(screen.getByText('SHA-256: AA:BB:CC')).toBeInTheDocument();
  });
});
