import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import {
  currentAdminAccessToken,
  getAuditCheckpoint,
  getAuditHistory,
  startAuditPolling,
  type AuditEvent,
} from '../api/audit';
import { getErrorMessage } from '../api/client';
import { ErrorState, LoadingState } from '../components/PageFeedback';

function mergeNewest(current: AuditEvent[], incoming: AuditEvent[]): AuditEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  incoming.forEach((event) => byId.set(event.id, event));
  return [...byId.values()].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
}

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(true);

  useEffect(() => {
    let stopPolling: (() => void) | undefined;
    let active = true;
    const initialize = async () => {
      try {
        const checkpoint = await getAuditCheckpoint(currentAdminAccessToken());
        const history = await getAuditHistory();
        if (!active) return;
        setEvents(history.events);
        setNextCursor(history.nextCursor);
        setError(null);
        stopPolling = startAuditPolling({
          initialCursor: checkpoint.cursor,
          getAccessToken: currentAdminAccessToken,
          onEvents: (incoming) => {
            if (incoming.length > 0) setEvents((existing) => mergeNewest(existing, incoming));
          },
          onFreshnessChange: setCurrent,
          onError: (nextError) => setError(getErrorMessage(nextError)),
        });
      } catch (nextError) {
        if (active) {
          setCurrent(false);
          setError(getErrorMessage(nextError));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    return () => { active = false; stopPolling?.(); };
  }, []);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await getAuditHistory(50, nextCursor);
      setEvents((existing) => mergeNewest(existing, page.events));
      setNextCursor(page.nextCursor);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      setCurrent(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return <Stack gap={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
      <Typography variant="h4" component="h1">Аудит безопасности</Typography>
      <Chip color={current ? 'success' : 'warning'} label={current ? 'Данные актуальны' : 'Данные могут быть устаревшими'} />
    </Stack>
    {error && <Alert severity="error">{error} Старые записи не считаются актуальными.</Alert>}
    {loading ? <LoadingState /> : events.length === 0 ? <Alert severity="info">События аудита отсутствуют.</Alert> : <>
      <TableContainer component={Paper}><Table>
        <TableHead><TableRow><TableCell>Время</TableCell><TableCell>Событие</TableCell><TableCell>Инициатор</TableCell><TableCell>Описание</TableCell><TableCell>Детали</TableCell></TableRow></TableHead>
        <TableBody>{events.map((event) => <TableRow key={event.id} hover>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(event.occurredAt).toLocaleString('ru-RU')}</TableCell>
          <TableCell>{event.eventType}</TableCell>
          <TableCell><Chip size="small" label={`${event.actorType}: ${event.actorIdentifier}`} /></TableCell>
          <TableCell>{event.message}</TableCell>
          <TableCell><Typography component="code" variant="caption" sx={{ overflowWrap: 'anywhere' }}>{event.metadata ? JSON.stringify(event.metadata) : '—'}</Typography></TableCell>
        </TableRow>)}</TableBody>
      </Table></TableContainer>
      {nextCursor && <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore} sx={{ alignSelf: 'center' }}>{loadingMore ? 'Загрузка…' : 'Показать более ранние'}</Button>}
    </>}
    {!loading && error && events.length === 0 && <ErrorState message="Не удалось получить журнал аудита." />}
  </Stack>;
}
