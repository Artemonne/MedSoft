import React, { useEffect, useMemo, useState } from 'react';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  Alert, AppBar, Box, Button, Chip, CircularProgress, Container, Grid, LinearProgress, Paper, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Toolbar, Typography,
} from '@mui/material';
import type { CertificateDetails, ConnectionCheckResult, ConnectionInput, ImportPatient, ImportStatus, PatientImportResult, XmlLoadResult } from '../shared/types';

interface Row extends ImportPatient { status: ImportStatus; hisPatientId: string | null; message: string }
const empty: ConnectionInput = {
  hisUrl: 'https://localhost:3001', mllpHost: '127.0.0.1', mllpPort: 2575, tlsServerName: 'localhost', sourceSystemId: 'DESKTOP-IMPORT',
  apiKey: '', clientCertificatePath: '', clientKeyPath: '', caCertificatePath: '', timeoutMs: 10_000,
};
const statusLabel: Record<ImportStatus, string> = { PENDING: 'Ожидание', SENDING: 'Отправка', SUCCESS: 'Успешно', REJECTED: 'Ошибка', UNKNOWN: 'Неизвестно' };
const statusColor: Record<ImportStatus, 'default' | 'info' | 'success' | 'error' | 'warning'> = { PENDING: 'default', SENDING: 'info', SUCCESS: 'success', REJECTED: 'error', UNKNOWN: 'warning' };

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : 'Неизвестная ошибка.';
  return text.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function CertificateCard({ value }: { value: CertificateDetails }) {
  return <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="subtitle1" fontWeight={700}>Сертификат MLLP-сервера</Typography>
    <Grid container spacing={1} mt={0.5}>
      <Grid size={{ xs: 12, md: 6 }}><b>Subject / CN:</b> {value.subject} / {value.commonName || '—'}</Grid>
      <Grid size={{ xs: 12, md: 6 }}><b>Issuer:</b> {value.issuer || '—'}</Grid>
      <Grid size={{ xs: 12, md: 6 }}><b>Срок:</b> {value.validFrom} — {value.validTo}</Grid>
      <Grid size={{ xs: 12, md: 6 }}><b>Serial:</b> {value.serialNumber || '—'}</Grid>
      <Grid size={12} sx={{ overflowWrap: 'anywhere' }}><b>SHA-256:</b> {value.fingerprintSha256 || '—'}</Grid>
      <Grid size={12}><Chip size="small" color={value.authorized ? 'success' : 'error'} label={value.authorized ? 'TLS-проверка успешна' : 'TLS-проверка не пройдена'} /></Grid>
    </Grid>
  </Paper>;
}

export function App() {
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState<ConnectionInput>(empty);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConnectionCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [xml, setXml] = useState<XmlLoadResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [importing, setImporting] = useState(false);
  const [completed, setCompleted] = useState(0);

  useEffect(() => { void window.hl7Importer.getSettings().then((stored) => { if (stored) setSettings({ ...stored, apiKey: '' }); }).catch((next) => setError(errorText(next))); }, []);
  useEffect(() => window.hl7Importer.onImportProgress((progress) => {
    setCompleted(progress.completed);
    setRows((current) => current.map((row) => row.rowId === progress.rowId ? {
      ...row, status: progress.status, hisPatientId: progress.result?.hisPatientId ?? row.hisPatientId, message: progress.result?.message ?? row.message,
    } : row));
  }), []);

  const set = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const choose = async (key: 'clientCertificatePath' | 'clientKeyPath' | 'caCertificatePath', kind: 'clientCertificate' | 'clientKey' | 'caCertificate') => {
    const path = await window.hl7Importer.chooseFile(kind); if (path) set(key, path);
  };
  const test = async () => {
    setChecking(true); setError(null); setCheck(null);
    try { const result = await window.hl7Importer.testConnection(settings); setCheck(result); if (result.ok) set('apiKey', ''); }
    catch (next) { setError(errorText(next)); }
    finally { setChecking(false); }
  };
  const chooseXml = async () => {
    setError(null);
    try {
      const result = await window.hl7Importer.chooseXml();
      if (!result) return;
      setXml(result); setRows(result.patients.map((patient) => ({ ...patient, status: 'PENDING', hisPatientId: null, message: '' }))); setCompleted(0);
    } catch (next) { setError(errorText(next)); }
  };
  const startImport = async () => {
    setImporting(true); setError(null); setCompleted(0); setRows((current) => current.map((row) => ({ ...row, status: 'PENDING', hisPatientId: null, message: '' })));
    try {
      const results = await window.hl7Importer.importPatients();
      const byId = new Map(results.map((result: PatientImportResult) => [result.rowId, result]));
      setRows((current) => current.map((row) => { const result = byId.get(row.rowId); return result ? { ...row, status: result.status, hisPatientId: result.hisPatientId, message: result.message } : row; }));
    } catch (next) { setError(errorText(next)); }
    finally { setImporting(false); }
  };
  const counters = useMemo(() => ({ success: rows.filter((row) => row.status === 'SUCCESS').length, failed: rows.filter((row) => ['REJECTED', 'UNKNOWN'].includes(row.status)).length }), [rows]);

  return <Box minHeight="100vh"><AppBar position="static" elevation={0}><Toolbar><Typography variant="h6" fontWeight={700}>MedSoft · Импорт пациентов HL7 v2.8</Typography></Toolbar></AppBar>
    <Container maxWidth="xl" sx={{ py: 3 }}><Paper sx={{ mb: 3 }}><Tabs value={tab} onChange={(_event, value) => setTab(value)}><Tab icon={<SettingsEthernetIcon />} iconPosition="start" label="Настройки" /><Tab icon={<UploadFileIcon />} iconPosition="start" label="Импорт пациентов" /></Tabs></Paper>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {tab === 0 ? <Stack gap={2}>
        <Paper sx={{ p: 3 }}><Typography variant="h5" mb={2}>Подключение к HIS</Typography><Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="Base URL API HIS" value={settings.hisUrl} onChange={(event) => set('hisUrl', event.target.value)} /></Grid>
          <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="API-ключ HL7 Import" type="password" autoComplete="off" value={settings.apiKey} onChange={(event) => set('apiKey', event.target.value)} helperText="Не сохраняется после успешной проверки" /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth label="Адрес MLLP" value={settings.mllpHost} onChange={(event) => set('mllpHost', event.target.value)} /></Grid>
          <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth label="Порт" type="number" value={settings.mllpPort} onChange={(event) => set('mllpPort', Number(event.target.value))} /></Grid>
          <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label="Имя TLS-сервера (SAN)" value={settings.tlsServerName} onChange={(event) => set('tlsServerName', event.target.value)} /></Grid>
          <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label="Source System ID" value={settings.sourceSystemId} onChange={(event) => set('sourceSystemId', event.target.value)} /></Grid>
          <PathField label="Клиентский сертификат" value={settings.clientCertificatePath} onChange={(value) => set('clientCertificatePath', value)} onChoose={() => void choose('clientCertificatePath', 'clientCertificate')} />
          <PathField label="Приватный ключ клиента" value={settings.clientKeyPath} onChange={(value) => set('clientKeyPath', value)} onChoose={() => void choose('clientKeyPath', 'clientKey')} />
          <PathField label="Доверенный корневой CA" value={settings.caCertificatePath} onChange={(value) => set('caCertificatePath', value)} onChoose={() => void choose('caCertificatePath', 'caCertificate')} />
          <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label="Тайм-аут, мс" type="number" value={settings.timeoutMs} onChange={(event) => set('timeoutMs', Number(event.target.value))} /></Grid>
        </Grid><Button variant="contained" size="large" sx={{ mt: 3 }} disabled={checking} onClick={() => void test()}>{checking ? <><CircularProgress size={20} color="inherit" sx={{ mr: 1 }} />Проверка…</> : 'Проверить соединение'}</Button></Paper>
        {check && <Paper sx={{ p: 2 }}><Stack gap={1}><Alert severity={check.api.ok ? 'success' : 'error'}>{check.api.message}</Alert><Alert severity={check.mllp.ok ? 'success' : 'error'}>{check.mllp.message}</Alert>{check.certificate && <CertificateCard value={check.certificate} />}</Stack></Paper>}
      </Stack> : <Stack gap={2}>
        <Paper sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'center' }}><Button variant="outlined" startIcon={<UploadFileIcon />} disabled={importing} onClick={() => void chooseXml()}>Выбрать XML</Button><Typography>{xml ? `${xml.fileName}: пациентов ${rows.length}` : 'Файл не выбран'}</Typography><Box flex={1} /><Chip color="success" label={`Успешно: ${counters.success}`} /><Chip color="error" label={`Ошибок: ${counters.failed}`} /><Button variant="contained" disabled={importing || rows.length === 0} onClick={() => void startImport()}>{importing ? 'Импорт…' : 'Запустить импорт'}</Button></Stack>
          {importing && <Box mt={2}><LinearProgress variant="determinate" value={rows.length ? completed / rows.length * 100 : 0} /><Typography variant="caption">Обработано {completed} из {rows.length}</Typography></Box>}
        </Paper>
        {xml?.demonstrationFormat && <Alert severity="warning">Используется демонстрационный XML-формат. Совместимость с файлом преподавателя требует проверки по реальному образцу.</Alert>}
        {xml?.errors.map((message) => <Alert severity="warning" key={message}>{message}</Alert>)}
        <TableContainer component={Paper} sx={{ maxHeight: '58vh' }}><Table stickyHeader size="small"><TableHead><TableRow><TableCell>Внешний ID</TableCell><TableCell>ФИО</TableCell><TableCell>Статус</TableCell><TableCell>ID HIS</TableCell><TableCell>Результат</TableCell></TableRow></TableHead><TableBody>
          {rows.map((row) => <TableRow key={row.rowId}><TableCell>{row.externalId}</TableCell><TableCell>{[row.lastName, row.firstName, row.middleName].filter(Boolean).join(' ')}</TableCell><TableCell><Chip size="small" color={statusColor[row.status]} label={statusLabel[row.status]} /></TableCell><TableCell>{row.hisPatientId ?? '—'}</TableCell><TableCell>{row.message || '—'}</TableCell></TableRow>)}
          {rows.length === 0 && <TableRow><TableCell colSpan={5} align="center">Выберите XML-файл с пациентами.</TableCell></TableRow>}
        </TableBody></Table></TableContainer>
      </Stack>}
    </Container></Box>;
}

function PathField({ label, value, onChange, onChoose }: { label: string; value: string; onChange: (value: string) => void; onChoose: () => void }) {
  return <Grid size={{ xs: 12, md: 6 }}><Stack direction="row" gap={1}><TextField fullWidth label={label} value={value} onChange={(event) => onChange(event.target.value)} /><Button variant="outlined" onClick={onChoose}>Обзор…</Button></Stack></Grid>;
}
