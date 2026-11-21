import { describe, expect, it } from 'vitest';
import { buildAck, Hl7MessageError, parseHl7Message } from '../src/hl7/codec.js';
import { frameMllp, MllpDecoder } from '../src/hl7/mllp.js';

const token = 'header.payload.signature';

function msh(type: string, controlId = 'message-1') {
  return `MSH|^~\\&|IMPORTER|SOURCE-A|MEDSOFT-HIS|HIS|20261121200000||${type}|${controlId}|P|2.8`;
}

function uac(jwt = token) {
  return `UAC|JWT^JSON Web Token^99MEDSOFT|MEDSOFT-HL7-IMPORTER^AP^jwt^A^${jwt}`;
}

function adt(controlId = 'message-1') {
  return [
    msh('ADT^A28^ADT_A05', controlId),
    uac(),
    'PID|||external-1^^^SOURCE-A^PI||Ivanov\\F\\Test^Ivan^Ivanovich||20000102|M|||City\\S\\Street||+70000000000',
    'DG1|1||A00001^First diagnosis^99MEDSOFT-DIAGNOSIS',
    'DG1|2||B00002^Second diagnosis^99MEDSOFT-DIAGNOSIS',
  ].join('\r') + '\r';
}

describe('HL7 v2.8 codec', () => {
  it('parses MSH special indexing, UAC ED, PID and repeated DG1 fields', () => {
    const parsed = parseHl7Message(adt());
    expect(parsed.kind).toBe('patient-import');
    if (parsed.kind !== 'patient-import') return;
    expect(parsed.header).toMatchObject({
      sendingApplication: 'IMPORTER',
      sendingFacility: 'SOURCE-A',
      receivingApplication: 'MEDSOFT-HIS',
      receivingFacility: 'HIS',
      controlId: 'message-1',
    });
    expect(parsed.accessToken).toBe(token);
    expect(parsed.patient).toMatchObject({
      externalIdSource: 'SOURCE-A',
      externalIdValue: 'external-1',
      lastName: 'Ivanov|Test',
      firstName: 'Ivan',
      middleName: 'Ivanovich',
      address: 'City^Street',
      phone: '+70000000000',
    });
    expect(parsed.patient.diagnoses.map((item) => item.code)).toEqual(['A00001', 'B00002']);
  });

  it('parses the authenticated QBP Q11 connection-test profile', () => {
    const parsed = parseHl7Message([
      msh('QBP^Q11^QBP_Q11', 'connection-1'),
      uac(),
      'QPD|MEDSOFT_CONNECTION_TEST^Connection Test^99MEDSOFT|query-1',
      'RCP|I',
    ].join('\r') + '\r');
    expect(parsed).toMatchObject({ kind: 'connection-test', queryTag: 'query-1', accessToken: token });
  });

  it('rejects invalid versions, UAC profiles and patient data', () => {
    expect(() => parseHl7Message(adt().replace('|2.8\r', '|2.7\r'))).toThrow('Only HL7 version 2.8');
    expect(() => parseHl7Message(adt().replace('^AP^jwt^A^', '^AP^jwt^Base64^'))).toThrow('AP/jwt/A');
    expect(() => parseHl7Message(adt().replace('20000102', '20990102'))).toThrow('non-future');
    expect(() => parseHl7Message(adt().split('\r').filter((segment) => !segment.startsWith('UAC')).join('\r'))).toThrow('UAC segment is required');
    expect(() => parseHl7Message(adt().replace(`${uac()}\rPID`, `PID|||placeholder\r${uac()}\rPID`))).toThrow('immediately after MSH');
    try {
      parseHl7Message(adt().replace('ADT^A28^ADT_A05', 'ADT^A08^ADT_A01'));
    } catch (error) {
      expect(error).toBeInstanceOf(Hl7MessageError);
      expect((error as Hl7MessageError).ackCode).toBe('AR');
    }
  });

  it('builds correlated success and escaped error acknowledgements', () => {
    const parsed = parseHl7Message(adt());
    const success = buildAck({ header: parsed.header, code: 'AA', text: '42' });
    expect(success).toContain('ACK^A28^ACK');
    expect(success).toContain('\rMSA|AA|message-1|42\r');
    const failure = buildAck({ header: parsed.header, code: 'AE', text: 'Bad | value', errCode: '207' });
    expect(failure).toContain('MSA|AE|message-1|Bad \\F\\ value');
    expect(failure).toContain('ERR|||207^Application error^HL70357');
  });
});

describe('MLLP framing', () => {
  it('reassembles fragmented frames and separates combined frames', () => {
    const first = frameMllp(adt('one'));
    const second = frameMllp(adt('two'));
    const decoder = new MllpDecoder(102_400);
    expect(decoder.push(first.subarray(0, 7))).toEqual([]);
    const events = decoder.push(Buffer.concat([first.subarray(7), second]));
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.type === 'frame')).toBe(true);
    expect(events[0].type === 'frame' && events[0].payload.toString()).toContain('one');
    expect(events[1].type === 'frame' && events[1].payload.toString()).toContain('two');
  });

  it('reports malformed and oversized frames without throwing', () => {
    const malformed = new MllpDecoder(10).push(Buffer.from('not-mllp'));
    expect(malformed).toEqual([{ type: 'error', message: 'MLLP frame must begin with VT.' }]);
    const oversized = new MllpDecoder(3).push(Buffer.from([0x0b, 1, 2, 3, 4]));
    expect(oversized[0]).toMatchObject({ type: 'error' });
  });
});
