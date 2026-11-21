import { readFileSync } from 'node:fs';
import type { TlsOptions } from 'node:tls';
import { fileURLToPath } from 'node:url';

export interface MllpTlsConfiguration {
  host: string;
  port: number;
  maxMessageBytes: number;
  idleTimeoutMs: number;
  tls: TlsOptions;
}

interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => Buffer;
}

const defaultCertificateDirectory = new URL('../../../certificates/local/', import.meta.url);

function port(value: string | undefined): number {
  const parsed = Number(value ?? '2575');
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('HL7_MLLP_PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}

function nonEmpty(value: string | undefined, fallback: string, name: string): string {
  const result = value?.trim() || fallback;
  if (!result) {
    throw new Error(`${name} must not be empty.`);
  }
  return result;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function loadMllpTlsConfiguration(options: LoadOptions = {}): MllpTlsConfiguration {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? readFileSync;
  const keyPath = nonEmpty(
    env.HL7_MLLP_TLS_KEY_PATH,
    fileURLToPath(new URL('server.key.pem', defaultCertificateDirectory)),
    'HL7_MLLP_TLS_KEY_PATH',
  );
  const certificatePath = nonEmpty(
    env.HL7_MLLP_TLS_CERT_PATH,
    fileURLToPath(new URL('server.cert.pem', defaultCertificateDirectory)),
    'HL7_MLLP_TLS_CERT_PATH',
  );
  const clientCaPath = nonEmpty(
    env.HL7_MLLP_CLIENT_CA_PATH,
    fileURLToPath(new URL('ca.cert.pem', defaultCertificateDirectory)),
    'HL7_MLLP_CLIENT_CA_PATH',
  );

  return {
    host: nonEmpty(env.HL7_MLLP_HOST, '127.0.0.1', 'HL7_MLLP_HOST'),
    port: port(env.HL7_MLLP_PORT),
    maxMessageBytes: positiveInteger(env.HL7_MLLP_MAX_MESSAGE_BYTES, 102_400, 'HL7_MLLP_MAX_MESSAGE_BYTES'),
    idleTimeoutMs: positiveInteger(env.HL7_MLLP_IDLE_TIMEOUT_MS, 10_000, 'HL7_MLLP_IDLE_TIMEOUT_MS'),
    tls: {
      key: readFile(keyPath),
      cert: readFile(certificatePath),
      ca: [readFile(clientCaPath)],
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    },
  };
}
