import { readFileSync } from 'node:fs';
import type { TlsOptions } from 'node:tls';
import { fileURLToPath } from 'node:url';

export interface MllpTlsConfiguration {
  host: string;
  port: number;
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
