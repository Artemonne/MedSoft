import { randomUUID } from 'node:crypto';
import { Sex } from '@prisma/client';
import type {
  Hl7Delimiters,
  Hl7Header,
  ParsedAdtA28,
  ParsedConnectionTest,
  ParsedHl7Message,
} from './types.js';

export type AckCode = 'AA' | 'AE' | 'AR';

export class Hl7MessageError extends Error {
  constructor(
    message: string,
    public readonly ackCode: Exclude<AckCode, 'AA'> = 'AE',
    public readonly errCode = '207',
    public readonly controlId = '',
  ) {
    super(message);
    this.name = 'Hl7MessageError';
  }
}

interface Segment {
  name: string;
  fields: string[];
}

const connectionProfile = 'MEDSOFT_CONNECTION_TEST';

function required(value: string, name: string, controlId = ''): string {
  if (!value) throw new Hl7MessageError(`${name} is required.`, 'AE', '101', controlId);
  return value;
}

function unescapeValue(value: string, delimiters: Hl7Delimiters, controlId: string): string {
  let result = '';
  let offset = 0;
  while (offset < value.length) {
    const start = value.indexOf(delimiters.escape, offset);
    if (start < 0) return result + value.slice(offset);
    result += value.slice(offset, start);
    const end = value.indexOf(delimiters.escape, start + 1);
    if (end < 0) throw new Hl7MessageError('Unterminated HL7 escape sequence.', 'AE', '102', controlId);
    const token = value.slice(start + 1, end);
    const replacement = token === 'F' ? delimiters.field
      : token === 'S' ? delimiters.component
        : token === 'R' ? delimiters.repetition
          : token === 'E' ? delimiters.escape
            : token === 'T' ? delimiters.subcomponent
              : null;
    if (replacement !== null) {
      result += replacement;
    } else if (/^X(?:[0-9A-Fa-f]{2})+$/.test(token)) {
      try {
        result += new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(token.slice(1), 'hex'));
      } catch {
        throw new Hl7MessageError('Invalid hexadecimal HL7 escape sequence.', 'AE', '102', controlId);
      }
    } else {
      throw new Hl7MessageError('Unsupported HL7 escape sequence.', 'AE', '102', controlId);
    }
    offset = end + 1;
  }
  return result;
}

function components(value: string, header: Hl7Header): string[] {
  return value.split(header.delimiters.component).map((item) => unescapeValue(item, header.delimiters, header.controlId));
}

function field(segment: Segment, number: number): string {
  return segment.fields[segment.name === 'MSH' ? number - 1 : number] ?? '';
}

function single(segments: Segment[], name: string, controlId: string, requiredSegment = true): Segment | undefined {
  const found = segments.filter((segment) => segment.name === name);
  if (found.length > 1) throw new Hl7MessageError(`${name} must not repeat.`, 'AE', '100', controlId);
  if (requiredSegment && found.length === 0) throw new Hl7MessageError(`${name} segment is required.`, 'AE', '100', controlId);
  return found[0];
}

function parseSegments(payload: string): { segments: Segment[]; delimiters: Hl7Delimiters } {
  if (payload.includes('\n')) throw new Hl7MessageError('HL7 segments must be separated by CR.', 'AR', '100');
  const lines = payload.endsWith('\r') ? payload.slice(0, -1).split('\r') : payload.split('\r');
  if (lines.length === 0 || !lines[0].startsWith('MSH') || lines[0].length < 8) {
    throw new Hl7MessageError('MSH segment is required first.', 'AR', '100');
  }
  const fieldSeparator = lines[0][3];
  const encoding = lines[0].slice(4, 8);
  if (new Set(fieldSeparator + encoding).size !== 5) {
    throw new Hl7MessageError('MSH delimiters must be five distinct characters.', 'AR', '102');
  }
  const delimiters = {
    field: fieldSeparator,
    component: encoding[0],
    repetition: encoding[1],
    escape: encoding[2],
    subcomponent: encoding[3],
  };
  const segments = lines.map((line) => {
    if (!/^[A-Z0-9]{3}/.test(line)) throw new Hl7MessageError('Invalid segment identifier.', 'AR', '100');
    return { name: line.slice(0, 3), fields: line.split(fieldSeparator) };
  });
  return { segments, delimiters };
}

function parseHeader(segments: Segment[], delimiters: Hl7Delimiters): Hl7Header {
  const msh = segments[0];
  const controlId = field(msh, 10);
  const type = field(msh, 9).split(delimiters.component);
  const version = field(msh, 12);
  if (version !== '2.8') throw new Hl7MessageError('Only HL7 version 2.8 is supported.', 'AR', '203', controlId);
  if (field(msh, 11) !== 'P') throw new Hl7MessageError('MSH-11 must be P.', 'AR', '203', controlId);
  if (type.length < 3 || type.some((item) => !item)) {
    throw new Hl7MessageError('MSH-9 must contain message type, trigger, and structure.', 'AR', '203', controlId);
  }
  if (!/^[A-Za-z0-9._-]{1,199}$/.test(controlId)) {
    throw new Hl7MessageError('MSH-10 must be a non-empty message control identifier.', 'AR', '101', controlId);
  }
  return {
    sendingApplication: required(field(msh, 3), 'MSH-3', controlId),
    sendingFacility: required(field(msh, 4), 'MSH-4', controlId),
    receivingApplication: required(field(msh, 5), 'MSH-5', controlId),
    receivingFacility: required(field(msh, 6), 'MSH-6', controlId),
    messageTime: required(field(msh, 7), 'MSH-7', controlId),
    messageType: type[0],
    triggerEvent: type[1],
    structure: type[2],
    controlId,
    delimiters,
  };
}

function parseUac(segments: Segment[], header: Hl7Header): string {
  if (segments[1]?.name !== 'UAC') {
    throw new Hl7MessageError('UAC segment is required immediately after MSH.', 'AE', '100', header.controlId);
  }
  const uac = single(segments, 'UAC', header.controlId)!;
  const credentialType = components(field(uac, 1), header);
  const credential = components(field(uac, 2), header);
  if (credentialType[0] !== 'JWT' || credentialType[2] !== '99MEDSOFT') {
    throw new Hl7MessageError('UAC-1 must identify the MedSoft JWT profile.', 'AE', '207', header.controlId);
  }
  if (credential[0] !== 'MEDSOFT-HL7-IMPORTER' || credential[1] !== 'AP' || credential[2] !== 'jwt' || credential[3] !== 'A') {
    throw new Hl7MessageError('UAC-2 must use the AP/jwt/A credential profile.', 'AE', '207', header.controlId);
  }
  const token = credential[4] ?? '';
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Hl7MessageError('UAC JWT is missing or malformed.', 'AE', '207', header.controlId);
  }
  return token;
}

function dateOnly(value: string, controlId: string): Date {
  if (!/^\d{8}$/.test(value)) throw new Hl7MessageError('PID-7 must use YYYYMMDD.', 'AE', '102', controlId);
  const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const result = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== normalized || result > new Date()) {
    throw new Hl7MessageError('PID-7 must be a valid non-future date.', 'AE', '102', controlId);
  }
  return result;
}

function limited(value: string, max: number, name: string, controlId: string): string {
  if (!value || value.length > max) throw new Hl7MessageError(`${name} must contain 1 to ${max} characters.`, 'AE', '102', controlId);
  return value;
}

function parseAdt(segments: Segment[], header: Hl7Header, accessToken: string): ParsedAdtA28 {
  const allowed = new Set(['MSH', 'UAC', 'EVN', 'PID', 'PV1', 'DG1']);
  if (segments.some((segment) => !allowed.has(segment.name))) {
    throw new Hl7MessageError('Message contains an unsupported segment.', 'AR', '200', header.controlId);
  }
  const pid = single(segments, 'PID', header.controlId)!;
  const identifierRepetitions = field(pid, 3).split(header.delimiters.repetition);
  if (identifierRepetitions.length !== 1) throw new Hl7MessageError('PID-3 must contain exactly one identifier.', 'AE', '102', header.controlId);
  const identifier = components(identifierRepetitions[0], header);
  const assigningAuthority = (identifier[3] ?? '').split(header.delimiters.subcomponent)[0];
  const externalIdValue = limited(identifier[0] ?? '', 100, 'PID-3.1', header.controlId);
  const externalIdSource = limited(assigningAuthority, 100, 'PID-3.4.1', header.controlId);
  if (externalIdSource !== header.sendingFacility) {
    throw new Hl7MessageError('PID-3.4.1 must match MSH-4.', 'AE', '102', header.controlId);
  }
  const name = components(field(pid, 5), header);
  const lastName = limited(name[0] ?? '', 50, 'PID-5.1', header.controlId);
  const firstName = limited(name[1] ?? '', 50, 'PID-5.2', header.controlId);
  const middleName = name[2] ? limited(name[2], 50, 'PID-5.3', header.controlId) : null;
  const sex = field(pid, 8) === 'M' ? Sex.MALE : field(pid, 8) === 'F' ? Sex.FEMALE : field(pid, 8) === 'U' ? Sex.UNKNOWN : null;
  if (!sex) throw new Hl7MessageError('PID-8 must be M, F, or U.', 'AE', '102', header.controlId);
  const diagnoses = segments.filter((segment) => segment.name === 'DG1').map((segment, index) => {
    if (field(segment, 1) !== String(index + 1)) throw new Hl7MessageError('DG1-1 must be sequential starting at 1.', 'AE', '102', header.controlId);
    const coded = components(field(segment, 3), header);
    if (!/^[A-Za-z0-9]{6}$/.test(coded[0] ?? '')) throw new Hl7MessageError('DG1-3.1 must be a six-character code.', 'AE', '102', header.controlId);
    if (coded[2] !== '99MEDSOFT-DIAGNOSIS') throw new Hl7MessageError('DG1-3.3 uses an unsupported coding system.', 'AE', '103', header.controlId);
    const diagnosisName = coded[1] ? limited(coded[1], 160, 'DG1-3.2', header.controlId) : null;
    return { code: coded[0], name: diagnosisName, codingSystem: '99MEDSOFT-DIAGNOSIS' as const };
  });
  if (new Set(diagnoses.map((diagnosis) => diagnosis.code)).size !== diagnoses.length) {
    throw new Hl7MessageError('DG1 diagnosis codes must not repeat.', 'AE', '102', header.controlId);
  }
  return {
    kind: 'patient-import', header, accessToken,
    patient: {
      externalIdSource,
      externalIdValue,
      firstName,
      middleName,
      lastName,
      birthDate: dateOnly(field(pid, 7), header.controlId),
      sex,
      address: field(pid, 11) ? unescapeValue(field(pid, 11), header.delimiters, header.controlId) : null,
      phone: field(pid, 13) ? unescapeValue(field(pid, 13), header.delimiters, header.controlId) : null,
      diagnoses,
    },
  };
}

function parseConnectionTest(segments: Segment[], header: Hl7Header, accessToken: string): ParsedConnectionTest {
  const allowed = new Set(['MSH', 'UAC', 'QPD', 'RCP']);
  if (segments.some((segment) => !allowed.has(segment.name))) throw new Hl7MessageError('Connection test contains an unsupported segment.', 'AR', '200', header.controlId);
  const qpd = single(segments, 'QPD', header.controlId)!;
  single(segments, 'RCP', header.controlId);
  const queryName = components(field(qpd, 1), header);
  if (queryName[0] !== connectionProfile || queryName[2] !== '99MEDSOFT') {
    throw new Hl7MessageError('QPD-1 is not the MedSoft connection test profile.', 'AR', '203', header.controlId);
  }
  return { kind: 'connection-test', header, accessToken, queryTag: required(field(qpd, 2), 'QPD-2', header.controlId) };
}

export function parseHl7Message(payload: string): ParsedHl7Message {
  const { segments, delimiters } = parseSegments(payload);
  const header = parseHeader(segments, delimiters);
  const accessToken = parseUac(segments, header);
  const message = `${header.messageType}^${header.triggerEvent}^${header.structure}`;
  if (message === 'ADT^A28^ADT_A05') return parseAdt(segments, header, accessToken);
  if (message === 'QBP^Q11^QBP_Q11') return parseConnectionTest(segments, header, accessToken);
  throw new Hl7MessageError('Unsupported HL7 message type.', 'AR', '200', header.controlId);
}

export function inspectMessageHeader(payload: string): Partial<Hl7Header> {
  try {
    const { segments, delimiters } = parseSegments(payload);
    return parseHeader(segments, delimiters);
  } catch (error) {
    if (error instanceof Hl7MessageError) return { controlId: error.controlId };
    return {};
  }
}

function escapeValue(value: string, delimiters: Hl7Delimiters): string {
  return value
    .replaceAll(delimiters.escape, `${delimiters.escape}E${delimiters.escape}`)
    .replaceAll(delimiters.field, `${delimiters.escape}F${delimiters.escape}`)
    .replaceAll(delimiters.component, `${delimiters.escape}S${delimiters.escape}`)
    .replaceAll(delimiters.repetition, `${delimiters.escape}R${delimiters.escape}`)
    .replaceAll(delimiters.subcomponent, `${delimiters.escape}T${delimiters.escape}`);
}

function hl7Timestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

export function buildAck(input: {
  header?: Partial<Hl7Header>;
  code: AckCode;
  text: string;
  errCode?: string;
}): string {
  const delimiters = input.header?.delimiters ?? { field: '|', component: '^', repetition: '~', escape: '\\', subcomponent: '&' };
  const messageTrigger = input.header?.triggerEvent || 'A28';
  const msh9 = `ACK${delimiters.component}${messageTrigger}${delimiters.component}ACK`;
  const safeText = escapeValue(input.text.slice(0, 200), delimiters);
  const msh = ['MSH', `${delimiters.component}${delimiters.repetition}${delimiters.escape}${delimiters.subcomponent}`, 'MEDSOFT-HIS', 'HIS', input.header?.sendingApplication ?? '', input.header?.sendingFacility ?? '', hl7Timestamp(), '', msh9, randomUUID(), 'P', '2.8'].join(delimiters.field);
  const msa = ['MSA', input.code, escapeValue(input.header?.controlId ?? '', delimiters), safeText].join(delimiters.field);
  const err = input.code === 'AA' ? null : ['ERR', '', '', `${input.errCode ?? '207'}${delimiters.component}Application error${delimiters.component}HL70357`, '', '', '', safeText].join(delimiters.field);
  return [msh, msa, ...(err ? [err] : [])].join('\r') + '\r';
}
