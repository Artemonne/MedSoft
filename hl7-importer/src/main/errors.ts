import { ZodError } from 'zod';

export type ErrorCategory = 'ADDRESS' | 'UNAVAILABLE' | 'TLS' | 'UNTRUSTED_CERTIFICATE' | 'AUTHENTICATION' | 'FORBIDDEN' | 'INVALID_ACK' | 'TIMEOUT' | 'VALIDATION' | 'UNKNOWN';

export class ImporterError extends Error {
  constructor(public readonly category: ErrorCategory, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImporterError';
  }
}

export function userMessage(error: unknown): string {
  if (error instanceof ImporterError) return error.message;
  if (error instanceof ZodError) return `Некорректные настройки: ${error.issues.map((issue) => issue.message).join('; ')}`;
  return 'Непредвиденная ошибка приложения.';
}

export function networkError(error: unknown, context: string): ImporterError {
  const code = typeof error === 'object' && error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
  if (['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID'].includes(code)) return new ImporterError('TLS', `${context}: сертификат недействителен по сроку.`, { cause: error });
  if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT'].includes(code)) return new ImporterError('UNTRUSTED_CERTIFICATE', `${context}: сертификат не подписан доверенным центром.`, { cause: error });
  if (['ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA', 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE'].includes(code)) return new ImporterError('TLS', `${context}: ошибка проверки TLS-сертификата.`, { cause: error });
  if (['ENOTFOUND', 'ERR_INVALID_URL'].includes(code)) return new ImporterError('ADDRESS', `${context}: указан неправильный адрес.`, { cause: error });
  if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code)) return new ImporterError('UNAVAILABLE', `${context}: сервер недоступен.`, { cause: error });
  if (code === 'ETIMEDOUT' || error instanceof DOMException && error.name === 'TimeoutError') return new ImporterError('TIMEOUT', `${context}: превышено время ожидания.`, { cause: error });
  return new ImporterError('UNAVAILABLE', `${context}: не удалось установить соединение.`, { cause: error });
}
