import { describe, expect, it } from 'vitest';
import { networkError } from '../src/main/errors.js';

describe('connection error classification', () => {
  it.each([
    ['ENOTFOUND', 'ADDRESS', 'неправильный адрес'],
    ['ECONNREFUSED', 'UNAVAILABLE', 'сервер недоступен'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNTRUSTED_CERTIFICATE', 'доверенным центром'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS', 'TLS-сертификата'],
    ['ETIMEDOUT', 'TIMEOUT', 'время ожидания'],
  ])('maps %s to a distinct user-facing category', (code, category, message) => {
    const result = networkError(Object.assign(new Error(code), { code }), 'Тест');
    expect(result.category).toBe(category);
    expect(result.message).toContain(message);
  });
});
