import { describe, expect, it } from 'vitest';
import { loadMllpTlsConfiguration } from '../src/config/mllp-tls.js';

describe('MLLP mTLS configuration', () => {
  it('loads a separate TLS 1.3 listener configuration with mandatory client certificates', () => {
    const paths: string[] = [];
    const configuration = loadMllpTlsConfiguration({
      env: {
        HL7_MLLP_HOST: '127.0.0.1',
        HL7_MLLP_PORT: '32575',
        HL7_MLLP_TLS_KEY_PATH: 'mllp-server.key.pem',
        HL7_MLLP_TLS_CERT_PATH: 'mllp-server.cert.pem',
        HL7_MLLP_CLIENT_CA_PATH: 'client-ca.cert.pem',
      },
      readFile: (path) => {
        paths.push(path);
        return Buffer.from(path);
      },
    });

    expect(configuration.host).toBe('127.0.0.1');
    expect(configuration.port).toBe(32575);
    expect(paths).toEqual([
      'mllp-server.key.pem',
      'mllp-server.cert.pem',
      'client-ca.cert.pem',
    ]);
    expect(configuration.tls).toMatchObject({
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    });
  });

  it('rejects an invalid MLLP port before starting a listener', () => {
    expect(() => loadMllpTlsConfiguration({
      env: { HL7_MLLP_PORT: '70000' },
      readFile: () => Buffer.from('unused'),
    })).toThrow('HL7_MLLP_PORT');
  });
});
