import { randomUUID } from 'node:crypto';
import type { ImportPatient } from '../../shared/types.js';
import { ImporterError } from '../errors.js';

const delimiters = { field: '|', component: '^', repetition: '~', escape: '\\', subcomponent: '&' } as const;

function escape(value: string): string {
  return value
    .replaceAll(delimiters.escape, '\\E\\')
    .replaceAll(delimiters.field, '\\F\\')
    .replaceAll(delimiters.component, '\\S\\')
    .replaceAll(delimiters.repetition, '\\R\\')
    .replaceAll(delimiters.subcomponent, '\\T\\')
    .replaceAll('\r', '\\X0D\\')
    .replaceAll('\n', '\\X0A\\');
}

function unescape(value: string, encoding: string): string {
  const [component = '^', repetition = '~', escapeCharacter = '\\', subcomponent = '&'] = encoding;
  return value.replace(new RegExp(`${escapeCharacter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([FSRET]|X(?:[0-9A-Fa-f]{2})+)${escapeCharacter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), (_match, token: string) => {
    if (token === 'F') return '|';
    if (token === 'S') return component;
    if (token === 'R') return repetition;
    if (token === 'E') return escapeCharacter;
    if (token === 'T') return subcomponent;
    return Buffer.from(token.slice(1), 'hex').toString('utf8');
  });
}

function timestamp(date = new Date()): string { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, ''); }
function msh(type: string, controlId: string, sourceSystemId: string): string {
  const fields = ['MSH', '^~\\&', 'MEDSOFT-HL7-IMPORTER', sourceSystemId, 'MEDSOFT-HIS', 'HIS', timestamp(), '', type, controlId, 'P', '2.8', '', '', '', '', '', 'UNICODE UTF-8'];
  return fields.join('|');
}
function uac(token: string): string { return `UAC|JWT^JSON Web Token^99MEDSOFT|MEDSOFT-HL7-IMPORTER^AP^jwt^A^${token}`; }

export interface OutboundMessage { controlId: string; payload: string }

export function buildAdtA28(patient: ImportPatient, sourceSystemId: string, token: string): OutboundMessage {
  const controlId = randomUUID();
  const pid3 = `${escape(patient.externalId)}^^^${sourceSystemId}^PI`;
  const pid5 = [patient.lastName, patient.firstName, patient.middleName ?? ''].map(escape).join('^');
  const sex = patient.sex === 'MALE' ? 'M' : patient.sex === 'FEMALE' ? 'F' : 'U';
  const birthDate = patient.birthDate.replaceAll('-', '');
  const pid = ['PID', '', '', pid3, '', pid5, '', birthDate, sex, '', '', escape(patient.address ?? ''), '', escape(patient.phone ?? '')].join('|');
  const diagnoses = patient.diagnoses.map((diagnosis, index) => `DG1|${index + 1}||${diagnosis.code}^${escape(diagnosis.name ?? '')}^99MEDSOFT-DIAGNOSIS`);
  return {
    controlId,
    payload: [msh('ADT^A28^ADT_A05', controlId, sourceSystemId), uac(token), `EVN|A28|${timestamp()}`, pid, 'PV1||N', ...diagnoses].join('\r') + '\r',
  };
}

export function buildConnectionTest(sourceSystemId: string, token: string): OutboundMessage {
  const controlId = randomUUID();
  return {
    controlId,
    payload: [msh('QBP^Q11^QBP_Q11', controlId, sourceSystemId), uac(token), `QPD|MEDSOFT_CONNECTION_TEST^Connection Test^99MEDSOFT|${randomUUID()}`, 'RCP|I'].join('\r') + '\r',
  };
}

export interface AckResult { code: 'AA' | 'AE' | 'AR'; text: string }
export function parseAck(payload: string, expectedControlId: string, expectedTrigger: 'A28' | 'Q11'): AckResult {
  if (payload.includes('\n') || !payload.startsWith('MSH') || payload.length < 8) throw new ImporterError('INVALID_ACK', 'MLLP-сервер вернул некорректный ACK.');
  const field = payload[3]!;
  const encoding = payload.slice(4, 8);
  const component = encoding[0] ?? '^';
  const segments = payload.replace(/\r$/, '').split('\r').map((segment) => segment.split(field));
  const header = segments[0]!;
  const messageType = header[8]?.split(component).join('^');
  if (header[11] !== '2.8' || messageType !== `ACK^${expectedTrigger}^ACK`) throw new ImporterError('INVALID_ACK', 'ACK имеет неверную версию или тип сообщения.');
  const msaSegments = segments.filter((segment) => segment[0] === 'MSA');
  if (msaSegments.length !== 1) throw new ImporterError('INVALID_ACK', 'ACK не содержит единственный сегмент MSA.');
  const msa = msaSegments[0]!;
  if (!['AA', 'AE', 'AR'].includes(msa[1] ?? '')) throw new ImporterError('INVALID_ACK', 'ACK содержит неизвестный код подтверждения.');
  if (msa[2] !== expectedControlId) throw new ImporterError('INVALID_ACK', 'MSA-2 не соответствует отправленному MSH-10.');
  const text = unescape(msa[3] ?? '', encoding);
  if (!text) throw new ImporterError('INVALID_ACK', 'ACK не содержит результат в MSA-3.');
  return { code: msa[1] as AckResult['code'], text };
}
