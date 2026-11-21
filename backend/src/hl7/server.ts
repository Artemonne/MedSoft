import { randomUUID } from 'node:crypto';
import { createServer, type DetailedPeerCertificate, type Server, type TLSSocket } from 'node:tls';
import { UnauthorizedError } from '../lib/app-error.js';
import type { MllpTlsConfiguration } from '../config/mllp-tls.js';
import { serviceAuthService } from '../services/service-auth.js';
import { serviceRoleAllowsHl7Import } from '../services/service-permissions.js';
import type { AuditActor } from '../services/audit.js';
import { buildAck, Hl7MessageError, inspectMessageHeader, parseHl7Message } from './codec.js';
import { Hl7ImportError, importHl7Patient, recordHl7ImportFailure } from './import-service.js';
import { frameMllp, MllpDecoder } from './mllp.js';
import type { ClientCertificateIdentity, Hl7Header } from './types.js';

function distinguishedName(value: Record<string, string | string[] | undefined> | undefined): string {
  if (!value) return '';
  return Object.entries(value).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([key, item]) => `${key}=${Array.isArray(item) ? item.join('+') : item}`).join(',');
}

function certificateIdentity(certificate: DetailedPeerCertificate): ClientCertificateIdentity {
  return {
    fingerprintSha256: certificate.fingerprint256 || '',
    subject: distinguishedName(certificate.subject),
    issuer: distinguishedName(certificate.issuer),
    serialNumber: certificate.serialNumber || '',
    validFrom: certificate.valid_from || '',
    validTo: certificate.valid_to || '',
  };
}

function anonymousActor(controlId: string): AuditActor {
  return { type: 'anonymous', requestId: controlId || randomUUID() };
}

async function safeFailureAudit(input: Parameters<typeof recordHl7ImportFailure>[0]): Promise<void> {
  try {
    await recordHl7ImportFailure(input);
  } catch {
    // Audit failure must not expose details or terminate the TLS listener.
  }
}

function safeHeader(payload: string): Partial<Hl7Header> {
  return inspectMessageHeader(payload);
}

export async function processHl7Payload(payload: Buffer, certificate: ClientCertificateIdentity): Promise<string> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    await safeFailureAudit({ actor: anonymousActor(''), controlId: '', errorCode: 'INVALID_UTF8', errorMessage: 'HL7 payload is not valid UTF-8.', certificate });
    return buildAck({ code: 'AR', text: 'HL7 payload is not valid UTF-8.', errCode: '102' });
  }

  let parsed;
  try {
    parsed = parseHl7Message(text);
  } catch (error) {
    const header = safeHeader(text);
    const failure = error instanceof Hl7MessageError ? error : new Hl7MessageError('Invalid HL7 message.', 'AR', '100', header.controlId);
    await safeFailureAudit({ actor: anonymousActor(header.controlId ?? ''), controlId: header.controlId ?? '', errorCode: failure.errCode, errorMessage: failure.message, certificate });
    return buildAck({ header, code: failure.ackCode, text: failure.message, errCode: failure.errCode });
  }

  let actor;
  try {
    actor = await serviceAuthService.authenticateAccessToken(parsed.accessToken);
    if (!serviceRoleAllowsHl7Import(actor.role)) {
      await safeFailureAudit({ actor: { type: 'service', serviceAccountId: actor.serviceAccountId }, controlId: parsed.header.controlId, errorCode: 'FORBIDDEN_ROLE', errorMessage: 'HL7 Import role is required.', certificate });
      return buildAck({ header: parsed.header, code: 'AE', text: 'HL7 Import role is required.', errCode: '207' });
    }
  } catch (error) {
    const message = error instanceof UnauthorizedError ? 'JWT authentication failed.' : 'Authentication failed.';
    await safeFailureAudit({ actor: anonymousActor(parsed.header.controlId), controlId: parsed.header.controlId, errorCode: 'JWT_AUTHENTICATION_FAILED', errorMessage: message, certificate });
    return buildAck({ header: parsed.header, code: 'AE', text: message, errCode: '207' });
  }

  if (parsed.kind === 'connection-test') {
    return buildAck({ header: parsed.header, code: 'AA', text: 'Connection successful.' });
  }

  try {
    const patientId = await importHl7Patient(parsed, actor, certificate);
    return buildAck({ header: parsed.header, code: 'AA', text: String(patientId) });
  } catch (error) {
    const failure = error instanceof Hl7ImportError ? error : new Hl7ImportError('IMPORT_FAILED', 'Patient import failed.');
    await safeFailureAudit({ actor: { type: 'service', serviceAccountId: actor.serviceAccountId }, controlId: parsed.header.controlId, errorCode: failure.code, errorMessage: failure.message, certificate });
    return buildAck({ header: parsed.header, code: 'AE', text: failure.message, errCode: '207' });
  }
}

function serveSocket(socket: TLSSocket, configuration: MllpTlsConfiguration): void {
  if (!socket.authorized) {
    socket.destroy();
    return;
  }
  const certificate = certificateIdentity(socket.getPeerCertificate(true));
  const decoder = new MllpDecoder(configuration.maxMessageBytes);
  let queue = Promise.resolve();
  socket.setTimeout(configuration.idleTimeoutMs, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', (chunk: Buffer) => {
    for (const event of decoder.push(chunk)) {
      if (event.type === 'error') {
        socket.destroy();
        return;
      }
      queue = queue.then(async () => {
        const ack = await processHl7Payload(event.payload, certificate);
        if (!socket.destroyed) socket.write(frameMllp(ack));
      }).catch(() => {
        if (!socket.destroyed) socket.write(frameMllp(buildAck({ code: 'AE', text: 'Message processing failed.', errCode: '207' })));
      });
    }
  });
}

export function createHl7MllpServer(configuration: MllpTlsConfiguration): Server {
  const server = createServer(configuration.tls, (socket) => serveSocket(socket, configuration));
  server.on('tlsClientError', () => {});
  return server;
}
