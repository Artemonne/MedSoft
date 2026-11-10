import React, { useEffect, useState } from 'react';
import { Alert, AppBar, Box, Button, CircularProgress, Container, Drawer, List, ListItemButton, ListItemText, Paper, Stack, TextField, Toolbar, Typography } from '@mui/material';
import type { ConnectionStatus } from '../shared/types';

const sections = ['Подключение', 'Запросы', 'История'] as const;
export function App() {
  const [section, setSection] = useState<(typeof sections)[number]>('Подключение');
  const [status, setStatus] = useState<ConnectionStatus | null>(null); const [hisUrl, setHisUrl] = useState(''); const [apiKey, setApiKey] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { window.lis.getConnectionStatus().then((value) => { setStatus(value); setHisUrl(value.hisUrl ?? ''); }).catch((reason) => setError(message(reason))); }, []);
  const run = async (operation: () => Promise<ConnectionStatus>) => { setBusy(true); setError(''); try { const next = await operation(); setStatus(next); setHisUrl(next.hisUrl ?? ''); setApiKey(''); } catch (reason) { setError(message(reason)); } finally { setBusy(false); } };
  return <Box sx={{ display: 'flex', minHeight: '100vh' }}><AppBar position="fixed" sx={{ zIndex: 1300 }}><Toolbar><Typography variant="h6">MedSoft LIS</Typography></Toolbar></AppBar>
    <Drawer variant="permanent" sx={{ width: 220, '& .MuiDrawer-paper': { width: 220, pt: 8 } }}><List>{sections.map((item) => <ListItemButton key={item} selected={section === item} onClick={() => setSection(item)}><ListItemText primary={item} /></ListItemButton>)}</List></Drawer>
    <Container component="main" maxWidth="md" sx={{ ml: '220px', pt: 12, pb: 5 }}>
      {section === 'Подключение' ? <ConnectionPage status={status} hisUrl={hisUrl} apiKey={apiKey} busy={busy} error={error} setHisUrl={setHisUrl} setApiKey={setApiKey} connect={() => run(() => window.lis.configureConnection({ hisUrl, apiKey }))} test={() => run(window.lis.testConnection)} disconnect={() => run(window.lis.disconnect)} /> : <Paper sx={{ p: 4 }}><Typography variant="h4" gutterBottom>{section}</Typography><Typography color="text.secondary">{section === 'Запросы' ? 'Получение лабораторных запросов будет добавлено на следующем этапе.' : 'История выполненных исследований будет добавлена на следующем этапе.'}</Typography></Paper>}
    </Container></Box>;
}

function ConnectionPage(props: { status: ConnectionStatus | null; hisUrl: string; apiKey: string; busy: boolean; error: string; setHisUrl(v: string): void; setApiKey(v: string): void; connect(): void; test(): void; disconnect(): void }) {
  const connected = props.status?.state === 'connected';
  return <Stack gap={3}><Box><Typography variant="h4">Подключение к HIS</Typography><Typography color="text.secondary">Настройте защищённое подключение сервисного аккаунта LIS.</Typography></Box>
    {props.error && <Alert severity="error">{props.error}</Alert>}{connected && <Alert severity="success">Подключено</Alert>}
    <Paper sx={{ p: 3 }}><Stack gap={2}><TextField label="Адрес HIS" value={props.hisUrl} disabled={connected || props.busy} onChange={(event) => props.setHisUrl(event.target.value)} placeholder="https://localhost:8443" /><TextField label="API key" type="password" value={props.apiKey} disabled={connected || props.busy} onChange={(event) => props.setApiKey(event.target.value)} helperText="Ключ используется один раз и не сохраняется." />
      <Stack direction="row" gap={1} flexWrap="wrap">{!connected && <Button variant="contained" disabled={props.busy || !props.hisUrl || !props.apiKey} onClick={props.connect}>Подключиться</Button>}{props.status?.hisUrl && <Button variant="outlined" disabled={props.busy} onClick={props.test}>Проверить подключение</Button>}{props.status?.hisUrl && <Button color="error" disabled={props.busy} onClick={props.disconnect}>Отключиться</Button>}{props.busy && <CircularProgress size={24} />}</Stack></Stack></Paper>
    {props.status?.hisUrl && <Paper sx={{ p: 3 }}><Typography><b>HIS:</b> {props.status.hisUrl}</Typography><Typography><b>FHIR:</b> {props.status.fhirVersion ?? '—'}</Typography><Typography><b>Последняя проверка:</b> {props.status.lastCheckedAt ? new Date(props.status.lastCheckedAt).toLocaleString('ru-RU') : '—'}</Typography></Paper>}
  </Stack>;
}
function message(value: unknown) { return value instanceof Error ? value.message : 'Неизвестная ошибка.'; }
