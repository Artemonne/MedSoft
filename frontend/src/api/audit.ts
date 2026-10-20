import { apiRequest, getApiSession } from './client';

export const AUDIT_POLL_INTERVAL_MS = 1_000;

export interface AuditEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  actorType: 'ADMIN' | 'USER' | 'ANONYMOUS' | 'SYSTEM';
  actorIdentifier: string;
  message: string;
  metadata: Record<string, unknown> | null;
  accountId: string | null;
  systemAdministratorId: number | null;
}

export interface AuditHistory {
  events: AuditEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  serverTime: string;
}

interface AuditChanges {
  events: AuditEvent[];
  nextCursor: string | null;
  serverTime: string;
}

interface AuditCheckpoint {
  cursor: string | null;
  serverTime: string;
}

export interface AuditPollingOptions {
  initialCursor: string | null;
  getAccessToken: () => string;
  onEvents: (events: AuditEvent[]) => void;
  onFreshnessChange: (isCurrent: boolean) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
}

function authorization(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export function getAuditCheckpoint(accessToken: string): Promise<AuditCheckpoint> {
  return apiRequest('/admin/audit/checkpoint', {
    headers: authorization(accessToken),
    cache: 'no-store',
  });
}

export function getAuditHistory(limit = 50, before?: string): Promise<AuditHistory> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set('before', before);
  return apiRequest(`/admin/audit?${query.toString()}`);
}

export function currentAdminAccessToken(): string {
  const session = getApiSession();
  if (session?.subjectType !== 'admin') throw new Error('Administrator session is unavailable.');
  return session.accessToken;
}

export function startAuditPolling(options: AuditPollingOptions): () => void {
  const intervalMs = options.intervalMs ?? AUDIT_POLL_INTERVAL_MS;
  if (intervalMs < 1 || intervalMs > AUDIT_POLL_INTERVAL_MS) {
    throw new RangeError(`Audit polling interval must be between 1 and ${AUDIT_POLL_INTERVAL_MS} ms.`);
  }

  let cursor = options.initialCursor;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    try {
      const query = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
      const result = await apiRequest<AuditChanges>(`/admin/audit/changes${query}`, {
        headers: authorization(options.getAccessToken()),
        cache: 'no-store',
      });
      if (stopped) return;
      options.onEvents(result.events);
      cursor = result.nextCursor;
      options.onFreshnessChange(true);
    } catch (error) {
      if (stopped) return;
      options.onFreshnessChange(false);
      options.onError(error);
    } finally {
      if (!stopped) timer = setTimeout(poll, intervalMs);
    }
  };

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
