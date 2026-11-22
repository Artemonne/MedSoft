import { describe, expect, it } from 'vitest';
import { buildAdtA28, buildConnectionTest, parseAck } from '../src/main/hl7/codec.js';
import type { ImportPatient } from '../src/shared/types.js';

const patient: ImportPatient = {
  rowId: 'row-1', externalId: 'EXT|1', firstName: 'Анна', middleName: 'Игоревна', lastName: 'Ива^нова', birthDate: '1992-04-17', sex: 'FEMALE',
  address: 'Улица | дом', phone: '+7', diagnoses: [{ code: 'A00001', name: 'Тест \\ и & значение' }, { code: 'B00002', name: null }],
};

function ack(controlId: string, code = 'AA', text = '42', trigger = 'A28') {
  return `MSH|^~\\&|MEDSOFT-HIS|HIS|IMPORTER|SOURCE|20261122000000||ACK^${trigger}^ACK|ack-1|P|2.8\rMSA|${code}|${controlId}|${text}\r`;
}

describe('desktop HL7 codec', () => {
  it('builds one v2.8 ADT A28 with UAC, escaped Cyrillic PID and repeated DG1', () => {
    const message = buildAdtA28(patient, 'SOURCE-A', 'header.payload.signature');
    expect(message.payload).toContain('ADT^A28^ADT_A05');
    expect(message.payload).toContain('UAC|JWT^JSON Web Token^99MEDSOFT|MEDSOFT-HL7-IMPORTER^AP^jwt^A^header.payload.signature');
    expect(message.payload).toContain('EXT\\F\\1^^^SOURCE-A^PI');
    expect(message.payload).toContain('Ива\\S\\нова^Анна^Игоревна');
    expect(message.payload.match(/\rDG1\|/g)).toHaveLength(2);
    expect(message.payload).toContain('Тест \\E\\ и \\T\\ значение');
  });

  it('builds the authenticated QBP Q11 connection profile', () => {
    const message = buildConnectionTest('SOURCE-A', 'a.b.c');
    expect(message.payload).toContain('QBP^Q11^QBP_Q11');
    expect(message.payload).toContain('MEDSOFT_CONNECTION_TEST^Connection Test^99MEDSOFT');
    expect(message.payload.split('\r')[1]).toContain('UAC|JWT');
  });

  it('accepts success/error ACK and rejects missing or mismatched ACK', () => {
    expect(parseAck(ack('request-1'), 'request-1', 'A28')).toEqual({ code: 'AA', text: '42' });
    expect(parseAck(ack('request-1', 'AE', 'Дубликат'), 'request-1', 'A28')).toEqual({ code: 'AE', text: 'Дубликат' });
    expect(() => parseAck(ack('other'), 'request-1', 'A28')).toThrow('MSA-2');
    expect(() => parseAck(ack('', 'AA', '42'), 'request-1', 'A28')).toThrow('MSA-2');
    expect(() => parseAck('MSH|^~\\&|A|B|C|D|20261122000000||ACK^A28^ACK|ack|P|2.8\r', 'request-1', 'A28')).toThrow('MSA');
  });
});
