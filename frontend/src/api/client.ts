import type { ApiErrorBody } from '../types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
    message = 'Request failed',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A readable fallback is supplied below for non-JSON responses.
    }
    throw new ApiError(response.status, body.error?.code, body.error?.message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getErrorMessage(error: unknown, context?: 'patient-delete' | 'diagnosis') {
  if (!(error instanceof ApiError)) {
    return 'Не удалось выполнить операцию. Попробуйте ещё раз.';
  }
  if (error.status === 404) return 'Запись не найдена.';
  if (error.status === 409 && context === 'patient-delete') {
    return 'Нельзя удалить пациента, для которого создана ЭМК.';
  }
  if (error.status === 409 && context === 'diagnosis') {
    return 'Диагноз с таким кодом или наименованием уже существует.';
  }
  if (error.status === 400) return 'Проверьте правильность заполнения полей.';
  return 'Не удалось выполнить операцию. Попробуйте ещё раз.';
}
