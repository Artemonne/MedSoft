import { readFileSync } from 'node:fs';
import { connect, type DetailedPeerCertificate, type TLSSocket } from 'node:tls';
import type { CertificateDetails, ConnectionSettings } from '../../shared/types.js';
import { ImporterError, networkError } from '../errors.js';

const VT = 0x0b; const FS = 0x1c; const CR = 0x0d;
export class UnknownOutcomeError extends ImporterError {
  constructor(message = 'ACK не получен: результат импорта неизвестен, автоматический повтор запрещён.') { super('TIMEOUT', message); this.name = 'UnknownOutcomeError'; }
}

function dn(value: Record<string, string | string[] | undefined> | undefined): string {
  if (!value) return '';
  return Object.entries(value).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([key, item]) => `${key}=${Array.isArray(item) ? item.join('+') : item}`).join(',');
}
function details(certificate: DetailedPeerCertificate, socket: TLSSocket): CertificateDetails {
  return {
    subject: dn(certificate.subject), commonName: String(certificate.subject?.CN ?? ''), issuer: dn(certificate.issuer),
    validFrom: certificate.valid_from ?? '', validTo: certificate.valid_to ?? '', serialNumber: certificate.serialNumber ?? '',
    fingerprintSha256: certificate.fingerprint256 ?? '', authorized: socket.authorized,
  };
}
function frame(payload: string): Buffer { return Buffer.concat([Buffer.from([VT]), Buffer.from(payload, 'utf8'), Buffer.from([FS, CR])]); }

export interface MllpExchange { payload: string; certificate: CertificateDetails }
export type Connector = typeof connect;

export class MllpClient {
  constructor(private readonly connector: Connector = connect) {}

  exchange(settings: ConnectionSettings, payload: string): Promise<MllpExchange> {
    let certificate: CertificateDetails | null = null;
    let sent = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = Buffer.alloc(0);
      const finish = (error?: unknown, result?: MllpExchange) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error); else resolve(result!);
      };
      let socket: TLSSocket;
      try {
        socket = this.connector({
          host: settings.mllpHost, port: settings.mllpPort, servername: settings.tlsServerName,
          cert: readFileSync(settings.clientCertificatePath), key: readFileSync(settings.clientKeyPath), ca: readFileSync(settings.caCertificatePath),
          rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
        });
      } catch (error) { reject(error instanceof ImporterError ? error : networkError(error, 'MLLP')); return; }
      const timer = setTimeout(() => finish(sent ? new UnknownOutcomeError() : new ImporterError('TIMEOUT', 'MLLP: превышено время подключения.')), settings.timeoutMs);
      socket.once('secureConnect', () => {
        if (!socket.authorized) { finish(new ImporterError('TLS', `MLLP: ${socket.authorizationError ?? 'сертификат не подтверждён'}.`)); return; }
        certificate = details(socket.getPeerCertificate(true), socket);
        sent = true;
        socket.write(frame(payload));
      });
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1_048_576) { finish(new ImporterError('INVALID_ACK', 'MLLP ACK превышает допустимый размер.')); return; }
        if (buffer[0] !== VT) { finish(new ImporterError('INVALID_ACK', 'MLLP ACK не начинается с VT.')); return; }
        const end = buffer.indexOf(FS, 1);
        if (end < 0) return;
        if (buffer[end + 1] !== CR || buffer.length !== end + 2) { finish(new ImporterError('INVALID_ACK', 'MLLP ACK имеет некорректное обрамление.')); return; }
        finish(undefined, { payload: buffer.subarray(1, end).toString('utf8'), certificate: certificate! });
      });
      socket.once('error', (error) => finish(sent ? new UnknownOutcomeError() : networkError(error, 'MLLP')));
      socket.once('close', () => { if (!settled) finish(sent ? new UnknownOutcomeError('MLLP-соединение закрыто до получения ACK; результат неизвестен.') : new ImporterError('UNAVAILABLE', 'MLLP-сервер закрыл соединение.')); });
    });
  }
}
