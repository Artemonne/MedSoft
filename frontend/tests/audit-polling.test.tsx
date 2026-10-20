import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAuditPolling } from '../src/api/audit';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('audit polling client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls every second with fresh authorization and advances the cursor without duplicates', async () => {
    vi.useFakeTimers();
    const tokens = ['admin-token-one', 'admin-token-two'];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        events: [{ id: 'event-1' }],
        nextCursor: 'cursor-1',
        serverTime: new Date().toISOString(),
      }))
      .mockResolvedValueOnce(response({
        events: [],
        nextCursor: 'cursor-1',
        serverTime: new Date().toISOString(),
      }));
    const onEvents = vi.fn();
    const onFreshnessChange = vi.fn();
    const stop = startAuditPolling({
      initialCursor: 'cursor-0',
      getAccessToken: () => tokens.shift()!,
      onEvents,
      onFreshnessChange,
      onError: vi.fn(),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit/changes?after=cursor-0');
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get('Authorization')).toBe('Bearer admin-token-one');

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/audit/changes?after=cursor-1');
    expect((fetchMock.mock.calls[1][1]?.headers as Headers).get('Authorization')).toBe('Bearer admin-token-two');
    expect(onEvents).toHaveBeenNthCalledWith(1, [{ id: 'event-1' }]);
    expect(onEvents).toHaveBeenNthCalledWith(2, []);
    expect(onFreshnessChange).toHaveBeenLastCalledWith(true);
    stop();
  });

  it('marks the view stale and does not replay cached events after a polling error', async () => {
    vi.useFakeTimers();
    const onEvents = vi.fn();
    const onFreshnessChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }, 503),
    );

    const stop = startAuditPolling({
      initialCursor: null,
      getAccessToken: () => 'admin-token',
      onEvents,
      onFreshnessChange,
      onError,
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    expect(onFreshnessChange).toHaveBeenCalledWith(false);
    expect(onEvents).not.toHaveBeenCalled();
    stop();
  });
});
