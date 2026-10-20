import type { Response } from 'express';
import { getAuthConfiguration } from './auth-config.js';

export const USER_REFRESH_COOKIE_NAME = 'medsoft_refresh';
export const ADMIN_REFRESH_COOKIE_NAME = 'medsoft_admin_refresh';

const commonCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
};

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setRefreshCookie(response: Response, token: string): void {
  response.cookie(USER_REFRESH_COOKIE_NAME, token, {
    ...commonCookieOptions,
    path: '/api/auth',
    maxAge: getAuthConfiguration().refreshTokenTtlSeconds * 1000,
  });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(USER_REFRESH_COOKIE_NAME, {
    ...commonCookieOptions,
    path: '/api/auth',
  });
}

export function readRefreshCookie(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, USER_REFRESH_COOKIE_NAME);
}

export function readAdminRefreshCookie(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, ADMIN_REFRESH_COOKIE_NAME);
}

export function setAdminRefreshCookie(response: Response, token: string): void {
  response.cookie(ADMIN_REFRESH_COOKIE_NAME, token, {
    ...commonCookieOptions,
    path: '/api/admin/auth',
    maxAge: getAuthConfiguration().refreshTokenTtlSeconds * 1000,
  });
}

export function clearAdminRefreshCookie(response: Response): void {
  response.clearCookie(ADMIN_REFRESH_COOKIE_NAME, {
    ...commonCookieOptions,
    path: '/api/admin/auth',
  });
}
