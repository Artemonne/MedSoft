import type { ApiErrorBody } from '../types';

export type SessionSubject = 'admin' | 'user';

interface ApiSession {
  subjectType: SessionSubject;
  accessToken: string;
  expiresAt: number;
}

type SessionListener = (session: ApiSession | null) => void;

let apiSession: ApiSession | null = null;
let refreshInFlight: { subjectType: SessionSubject; promise: Promise<ApiSession> } | null = null;
const sessionListeners = new Set<SessionListener>();

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

export function getApiSession(): ApiSession | null {
  return apiSession;
}

export function setApiSession(subjectType: SessionSubject, accessToken: string, expiresInSeconds: number): void {
  apiSession = { subjectType, accessToken, expiresAt: Date.now() + expiresInSeconds * 1_000 };
  sessionListeners.forEach((listener) => listener(apiSession));
}

export function clearApiSession(): void {
  apiSession = null;
  sessionListeners.forEach((listener) => listener(null));
}

export function subscribeApiSession(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A readable fallback is supplied below for non-JSON responses.
    }
    throw new ApiError(response.status, body.error?.code, body.error?.message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function refresh(subjectType: SessionSubject): Promise<ApiSession> {
  const response = await fetch(subjectType === 'admin' ? '/api/admin/auth/refresh' : '/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Protection': '1' },
    cache: 'no-store',
  });
  const result = await parseResponse<{ accessToken: string; accessTokenExpiresIn: number }>(response);
  setApiSession(subjectType, result.accessToken, result.accessTokenExpiresIn);
  return apiSession!;
}

export function refreshApiSession(subjectType = apiSession?.subjectType): Promise<ApiSession> {
  if (!subjectType) return Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'Session is unavailable.'));
  if (refreshInFlight?.subjectType === subjectType) return refreshInFlight.promise;
  if (refreshInFlight) {
    return refreshInFlight.promise.catch(() => undefined).then(() => refreshApiSession(subjectType));
  }
  const promise = refresh(subjectType)
    .catch((error) => {
      if (!apiSession || apiSession.subjectType === subjectType) clearApiSession();
      throw error;
    })
    .finally(() => {
      if (refreshInFlight?.promise === promise) refreshInFlight = null;
    });
  refreshInFlight = { subjectType, promise };
  return promise;
}

export interface ApiRequestInit extends RequestInit {
  authenticate?: boolean;
  retryAfterRefresh?: boolean;
}

export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { authenticate = true, retryAfterRefresh = true, ...requestInit } = init ?? {};
  const headers = new Headers(requestInit.headers);
  if (requestInit.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authenticate && apiSession) headers.set('Authorization', `Bearer ${apiSession.accessToken}`);
  const response = await fetch(`/api${path}`, {
    ...requestInit,
    credentials: 'include',
    cache: requestInit.cache ?? 'no-store',
    headers,
  });

  if (response.status === 401 && authenticate && retryAfterRefresh && apiSession) {
    await refreshApiSession(apiSession.subjectType);
    return apiRequest<T>(path, { ...requestInit, authenticate, retryAfterRefresh: false });
  }
  return parseResponse<T>(response);
}

export async function logoutApiSession(subjectType: SessionSubject): Promise<void> {
  try {
    await apiRequest<void>(subjectType === 'admin' ? '/admin/auth/logout' : '/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Protection': '1' },
      authenticate: false,
      retryAfterRefresh: false,
    });
  } finally {
    clearApiSession();
  }
}

export function getErrorMessage(error: unknown, context?: 'patient-delete' | 'diagnosis' | 'medical-record') {
  if (!(error instanceof ApiError)) return 'Не удалось выполнить операцию. Попробуйте ещё раз.';
  if (error.status === 404 && context === 'medical-record') return 'Электронная медицинская карта не найдена.';
  if (error.status === 404) return 'Запись не найдена.';
  if (error.status === 409 && context === 'patient-delete') return 'Нельзя удалить пациента, для которого создана ЭМК.';
  if (error.status === 409 && context === 'diagnosis') return 'Диагноз с таким кодом или наименованием уже существует.';
  if (context === 'medical-record') {
    if (error.status === 409 && error.message.includes('deleted medical worker')) return 'Аккаунт медработника больше не активен.';
    if (error.status === 409 && error.message.includes('Diagnosis is already active')) return 'Этот диагноз уже добавлен в ЭМК.';
    if (error.status === 409 && error.message.includes('Diagnosis is not active')) return 'Диагноз уже удалён из ЭМК. Данные будут обновлены.';
    if (error.status === 409 && error.message.includes('Prescription is not active')) return 'Назначение уже неактивно. Данные будут обновлены.';
  }
  if (error.status === 401) return 'Сессия завершена. Войдите снова.';
  if (error.status === 403) return 'Недостаточно прав для выполнения операции.';
  if (error.status === 400) return 'Проверьте правильность заполнения полей.';
  return 'Не удалось выполнить операцию. Попробуйте ещё раз.';
}
