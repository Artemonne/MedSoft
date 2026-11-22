import { describe, expect, it, vi } from 'vitest';
import { ImporterService } from '../src/main/importer-service.js';
import { DemoXmlAdapter } from '../src/main/xml/demo-adapter.js';
import { UnknownOutcomeError } from '../src/main/hl7/mllp-client.js';
import type { ConnectionSettings, ImportProgress } from '../src/shared/types.js';

const settings: ConnectionSettings = { hisUrl: 'https://localhost:3001', mllpHost: 'localhost', mllpPort: 2575, tlsServerName: 'localhost', sourceSystemId: 'TEST-SOURCE', clientCertificatePath: 'client.pem', clientKeyPath: 'client.key', caCertificatePath: 'ca.pem', timeoutMs: 5_000 };
const xml = Buffer.from(`<medsoft-demo-patients><patient externalId="ONE"><firstName>Анна</firstName><lastName>Иванова</lastName><birthDate>1990-01-02</birthDate><sex>FEMALE</sex></patient><patient externalId="TWO"><firstName>Пётр</firstName><lastName>Петров</lastName><birthDate>1991-02-03</birthDate><sex>MALE</sex></patient><patient externalId="THREE"><firstName>Олег</firstName><lastName>Сидоров</lastName><birthDate>1992-03-04</birthDate><sex>MALE</sex></patient></medsoft-demo-patients>`);

function ack(payload: string, code: 'AA' | 'AE', text: string) {
  const controlId = payload.split('\r')[0]!.split('|')[9];
  return `MSH|^~\\&|MEDSOFT-HIS|HIS|IMPORTER|SOURCE|20261122000000||ACK^A28^ACK|ack|P|2.8\rMSA|${code}|${controlId}|${text}\r`;
}

describe('ImporterService', () => {
  it('reports success, application rejection and unknown outcome independently', async () => {
    const store = { settings: () => settings };
    const tokens = { token: vi.fn().mockResolvedValue('a.b.c'), refresh: vi.fn(), establish: vi.fn(), commit: vi.fn() };
    let call = 0;
    const mllp = { exchange: vi.fn(async (_settings: ConnectionSettings, payload: string) => {
      call += 1;
      if (call === 1) return { payload: ack(payload, 'AA', '101'), certificate: {} };
      if (call === 2) return { payload: ack(payload, 'AE', 'Внешний ID уже существует'), certificate: {} };
      throw new UnknownOutcomeError();
    }) };
    const service = new ImporterService(store as any, tokens as any, mllp as any, new DemoXmlAdapter());
    service.loadXml(xml, 'patients.xml');
    const progress: ImportProgress[] = [];
    const results = await service.importPatients((item) => progress.push(item));
    expect(results.map((result) => result.status)).toEqual(['SUCCESS', 'REJECTED', 'UNKNOWN']);
    expect(results[0]?.hisPatientId).toBe('101');
    expect(results[1]?.message).toContain('уже существует');
    expect(progress.filter((item) => item.status === 'SENDING')).toHaveLength(3);
    expect(mllp.exchange).toHaveBeenCalledTimes(3);
  });
});
