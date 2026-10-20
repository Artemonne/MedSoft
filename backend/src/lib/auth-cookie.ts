import type { Response } from 'express';
import { getAuthConfiguration } from './auth-config.js';

export const REFRESH_COOKIE_NAME = 'medsoft_refresh';

const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/api/auth',
};

export function readRefreshCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) {
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
  response.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseCookieOptions,
    maxAge: getAuthConfiguration().refreshTokenTtlSeconds * 1000,
  });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions);
}
