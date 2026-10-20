import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, clearApiSession, getApiSession, setApiSession } from '../src/api/client';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { clearApiSession(); vi.restoreAllMocks(); });

describe('central API session', () => {
  it('uses one refresh request for concurrent expired-access responses', async () => {
    setApiSession('user', 'expired-access', 900);
    let refreshResolve!: (value: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { refreshResolve = resolve; });
    let resourceCalls = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).endsWith('/api/auth/refresh')) return pendingRefresh;
      resourceCalls += 1;
      const authorization = (init?.headers as Headers).get('Authorization');
      return Promise.resolve(authorization === 'Bearer renewed-access'
        ? response({ ok: true })
        : response({ error: { code: 'UNAUTHORIZED' } }, 401));
    });

    const first = apiRequest<{ ok: boolean }>('/patients');
    const second = apiRequest<{ ok: boolean }>('/diagnoses');
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1));
    refreshResolve(response({ accessToken: 'renewed-access', accessTokenExpiresIn: 900 }));
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(resourceCalls).toBe(4);
  });

  it('clears the in-memory session when refresh is rejected', async () => {
    setApiSession('user', 'revoked-access', 1);
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => Promise.resolve(
      String(input).endsWith('/auth/refresh')
        ? response({ error: { code: 'UNAUTHORIZED' } }, 401)
        : response({ error: { code: 'UNAUTHORIZED' } }, 401),
    ));
    await expect(apiRequest('/patients')).rejects.toMatchObject({ status: 401 });
    expect(getApiSession()).toBeNull();
  });
});
