import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, InputLabel, List, ListItem, ListItemText, MenuItem,
  Paper, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getErrorMessage } from '../api/client';
import { diagnosesApi } from '../api/diagnoses';
import { medicalRecordsApi } from '../api/medical-records';
import { medicalWorkersApi } from '../api/medical-workers';
import { patientsApi } from '../api/patients';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type {
  MedicalRecordEvent, MedicalRecordPrescription, MedicalRecordState, MedicalWorker, Sex,
} from '../types';

const sexLabels: Record<Sex, string> = { MALE: 'Мужской', FEMALE: 'Женский', UNKNOWN: 'Не установлен' };
const eventLabels: Record<MedicalRecordEvent['type'], string> = {
  DIAGNOSIS_ADDED: 'Добавлен диагноз',
  DIAGNOSIS_REMOVED: 'Удалён диагноз',
  PRESCRIPTION_ADDED: 'Добавлено назначение',
  PRESCRIPTION_REMOVED: 'Отменено назначение',
};

type Removal =
  | { kind: 'diagnosis'; id: number; label: string }
  | { kind: 'prescription'; id: string; label: string };

interface Feedback {
  message: string;
  severity: 'success' | 'error';
}

function RecordStateView({
  state,
  worker,
  onAddDiagnosis,
  onEditPrescription,
  onRemove,
}: {
  state: MedicalRecordState;
  worker: MedicalWorker | null;
  onAddDiagnosis?: () => void;
  onEditPrescription?: (prescription: MedicalRecordPrescription | null) => void;
  onRemove?: (removal: Removal) => void;
}) {
  const editable = Boolean(worker && onAddDiagnosis && onEditPrescription && onRemove);
  return <Stack gap={3}>
    <Card variant="outlined"><CardContent><Stack gap={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Диагнозы</Typography>
        {editable && <Button variant="contained" onClick={onAddDiagnosis}>Добавить диагноз</Button>}
      </Stack>
      {state.diagnoses.length === 0 ? <Typography color="text.secondary">Активных диагнозов нет</Typography> : <List disablePadding>
        {state.diagnoses.map((diagnosis) => <ListItem key={diagnosis.diagnosisId} divider secondaryAction={editable ? <Button color="error" onClick={() => onRemove?.({ kind: 'diagnosis', id: diagnosis.diagnosisId, label: `${diagnosis.code} — ${diagnosis.name}` })}>Удалить</Button> : undefined}>
          <ListItemText primary={`${diagnosis.code} — ${diagnosis.name}`} />
        </ListItem>)}
      </List>}
    </Stack></CardContent></Card>
    <Card variant="outlined"><CardContent><Stack gap={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">Назначения</Typography>
        {editable && <Button variant="contained" onClick={() => onEditPrescription?.(null)}>Добавить назначение</Button>}
      </Stack>
      {state.prescriptions.length === 0 ? <Typography color="text.secondary">Активных назначений нет</Typography> : <List disablePadding>
        {state.prescriptions.map((prescription) => <ListItem key={prescription.prescriptionId} divider secondaryAction={editable ? <Stack direction="row"><Button onClick={() => onEditPrescription?.(prescription)}>Редактировать</Button><Button color="error" onClick={() => onRemove?.({ kind: 'prescription', id: prescription.prescriptionId, label: prescription.text })}>Отменить</Button></Stack> : undefined}>
          <ListItemText primary={prescription.text} />
        </ListItem>)}
      </List>}
    </Stack></CardContent></Card>
  </Stack>;
}

function EventHistory({ events }: { events: MedicalRecordEvent[] }) {
  if (events.length === 0) return <Alert severity="info">История изменений пока пуста.</Alert>;
  return <List component={Paper} disablePadding>
    {events.map((event) => {
      const detail = 'text' in event.payload
        ? event.payload.text
        : `${event.payload.code} — ${event.payload.name}`;
      const worker = `${event.worker.lastName} ${event.worker.firstName}, ${event.worker.position}`;
      return <ListItem key={event.version} divider alignItems="flex-start">
        <ListItemText
          primary={<Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography fontWeight={600}>{eventLabels[event.type]}</Typography><Chip label={`Версия ${event.version}`} size="small" variant="outlined" /></Stack>}
          secondary={<Box component="span" sx={{ display: 'block', mt: 0.5 }}>
            <Typography component="span" variant="body2" color="text.primary">{detail}</Typography><br />
            {new Date(event.createdAt).toLocaleString('ru-RU')} · {worker}{event.worker.isDeleted ? ' (удалён)' : ''}
          </Box>}
        />
      </ListItem>;
    })}
  </List>;
}

export function MedicalRecordPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const validId = Number.isInteger(id) && id > 0;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(0);
  const [workerDialog, setWorkerDialog] = useState(false);
  const [workerId, setWorkerId] = useState('');
  const [worker, setWorker] = useState<MedicalWorker | null>(null);
  const [diagnosisDialog, setDiagnosisDialog] = useState(false);
  const [diagnosisId, setDiagnosisId] = useState('');
  const [prescription, setPrescription] = useState<MedicalRecordPrescription | null | undefined>(undefined);
  const [prescriptionText, setPrescriptionText] = useState('');
  const [prescriptionError, setPrescriptionError] = useState('');
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [historyDate, setHistoryDate] = useState('');
  const [historyTime, setHistoryTime] = useState('');
  const [historicalTimestamp, setHistoricalTimestamp] = useState<string | null>(null);

  const recordQuery = useQuery({ queryKey: ['medical-record', id], queryFn: () => medicalRecordsApi.get(id), enabled: validId, retry: false });
  const patientId = recordQuery.data?.patientId ?? 0;
  const patientQuery = useQuery({ queryKey: ['patients', patientId], queryFn: () => patientsApi.get(patientId), enabled: patientId > 0, retry: false });
  const workersQuery = useQuery({ queryKey: ['medical-workers'], queryFn: medicalWorkersApi.list, enabled: workerDialog });
  const diagnosesQuery = useQuery({ queryKey: ['diagnoses'], queryFn: diagnosesApi.list, enabled: diagnosisDialog });
  const historyQuery = useQuery({ queryKey: ['medical-record', id, 'events'], queryFn: () => medicalRecordsApi.events(id), enabled: validId && tab === 1, retry: false });
  const historicalQuery = useQuery({ queryKey: ['medical-record', id, 'historical', historicalTimestamp], queryFn: () => medicalRecordsApi.getAt(id, historicalTimestamp!), enabled: validId && Boolean(historicalTimestamp), retry: false });

  const refreshRecord = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['medical-record', id], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['medical-record', id, 'events'], exact: true }),
    ]);
  };
  const handleMutationError = async (error: unknown) => {
    setFeedback({ message: getErrorMessage(error, 'medical-record'), severity: 'error' });
    if (error instanceof ApiError && error.status === 409) {
      await refreshRecord();
      if (error.message.includes('deleted medical worker')) {
        setWorker(null);
        setWorkerId('');
      }
    }
  };

  const addDiagnosis = useMutation({
    mutationFn: () => medicalRecordsApi.addDiagnosis(id, { workerId: worker!.id, diagnosisId: Number(diagnosisId) }),
    onSuccess: async () => { await refreshRecord(); setDiagnosisDialog(false); setDiagnosisId(''); setFeedback({ message: 'Диагноз добавлен.', severity: 'success' }); },
    onError: handleMutationError,
  });
  const savePrescription = useMutation({
    mutationFn: async () => {
      if (prescription) await medicalRecordsApi.editPrescription(id, prescription.prescriptionId, { workerId: worker!.id, text: prescriptionText.trim() });
      else await medicalRecordsApi.addPrescription(id, { workerId: worker!.id, text: prescriptionText.trim() });
    },
    onSuccess: async () => { await refreshRecord(); setPrescription(undefined); setFeedback({ message: prescription ? 'Назначение обновлено.' : 'Назначение добавлено.', severity: 'success' }); },
    onError: handleMutationError,
  });
  const removeItem = useMutation({
    mutationFn: async (item: Removal) => {
      if (item.kind === 'diagnosis') await medicalRecordsApi.removeDiagnosis(id, item.id, { workerId: worker!.id });
      else await medicalRecordsApi.removePrescription(id, item.id, { workerId: worker!.id });
    },
    onSuccess: async () => { const removed = removal; await refreshRecord(); setRemoval(null); setFeedback({ message: removed?.kind === 'diagnosis' ? 'Диагноз удалён.' : 'Назначение отменено.', severity: 'success' }); },
    onError: handleMutationError,
  });

  const openPrescription = (item: MedicalRecordPrescription | null) => {
    setPrescription(item); setPrescriptionText(item?.text ?? ''); setPrescriptionError('');
  };
  const submitPrescription = () => {
    const length = prescriptionText.trim().length;
    if (length < 3 || length > 128) { setPrescriptionError('От 3 до 128 символов'); return; }
    savePrescription.mutate();
  };
  const showHistoricalState = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(historyDate) || !/^\d{2}:\d{2}$/.test(historyTime)) {
      setFeedback({ message: 'Укажите корректные дату и время.', severity: 'error' }); return;
    }
    const localDate = new Date(`${historyDate}T${historyTime}:00`);
    if (Number.isNaN(localDate.getTime())) {
      setFeedback({ message: 'Укажите корректные дату и время.', severity: 'error' }); return;
    }
    setHistoricalTimestamp(localDate.toISOString());
  };

  if (!validId) return <ErrorState message="Электронная медицинская карта не найдена." />;
  if (recordQuery.isPending) return <LoadingState />;
  if (recordQuery.isError) return <ErrorState message={getErrorMessage(recordQuery.error, 'medical-record')} />;
  const state = recordQuery.data;
  const availableDiagnoses = diagnosesQuery.data?.filter((item) => !state.diagnoses.some((active) => active.diagnosisId === item.id)) ?? [];

  return <Stack gap={3}>
    <Button component={Link} to={`/patients/${state.patientId}`} sx={{ alignSelf: 'flex-start' }}>← К пациенту</Button>
    <Typography variant="h4" component="h1">Электронная медицинская карта</Typography>
    <Card><CardContent><Typography variant="overline" color="text.secondary">Пациент</Typography>
      {patientQuery.isPending ? <LoadingState /> : patientQuery.data ? <Stack gap={0.5}>
        <Typography variant="h6">{[patientQuery.data.lastName, patientQuery.data.firstName, patientQuery.data.middleName].filter(Boolean).join(' ')}</Typography>
        <Typography>Дата рождения: {new Date(patientQuery.data.birthDate).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</Typography>
        <Typography>Пол: {sexLabels[patientQuery.data.sex]}</Typography>
      </Stack> : <Alert severity="warning">Не удалось загрузить сведения о пациенте.</Alert>}
    </CardContent></Card>
    <Tabs value={tab} onChange={(_event, value: number) => { setTab(value); setHistoricalTimestamp(null); }} aria-label="Разделы ЭМК">
      <Tab label="Текущее состояние" /><Tab label="История" />
    </Tabs>
    {tab === 0 && <Stack gap={3}>
      {!historicalTimestamp && (worker ? <Alert severity="success" action={<Button color="inherit" onClick={() => { setWorker(null); setWorkerId(''); }}>Завершить редактирование</Button>}>
        Редактирует: {worker.lastName} {worker.firstName}, {worker.position}
      </Alert> : <Alert severity="info" action={<Button color="inherit" onClick={() => { setWorkerId(''); setWorkerDialog(true); }}>Начать редактирование</Button>}>ЭМК открыта только для просмотра.</Alert>)}
      {historicalTimestamp ? <Paper sx={{ p: 3 }}><Stack gap={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h5">Состояние на {new Date(historicalTimestamp).toLocaleString('ru-RU')}</Typography><Button onClick={() => setHistoricalTimestamp(null)}>Вернуться к текущему состоянию</Button></Stack>
        {historicalQuery.isPending ? <LoadingState /> : historicalQuery.isError ? <ErrorState message={getErrorMessage(historicalQuery.error, 'medical-record')} /> : <RecordStateView state={historicalQuery.data} worker={null} />}
      </Stack></Paper> : <>
        <RecordStateView state={state} worker={worker} onAddDiagnosis={() => setDiagnosisDialog(true)} onEditPrescription={openPrescription} onRemove={setRemoval} />
        <Paper sx={{ p: 3 }}><Stack gap={2}><Typography variant="h5">Состояние ЭМК на дату и время</Typography><Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'flex-start' }}>
          <TextField label="Дата" type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="Время" type="time" value={historyTime} onChange={(event) => setHistoryTime(event.target.value)} InputLabelProps={{ shrink: true }} />
          <Button variant="outlined" onClick={showHistoricalState} sx={{ minHeight: 56 }}>Показать</Button>
        </Stack></Stack></Paper>
      </>}
    </Stack>}
    {tab === 1 && (historyQuery.isPending ? <LoadingState /> : historyQuery.isError ? <ErrorState /> : <EventHistory events={historyQuery.data} />)}

    <Dialog open={workerDialog} onClose={() => setWorkerDialog(false)} fullWidth maxWidth="sm"><DialogTitle>Редактирование ЭМК</DialogTitle><DialogContent sx={{ pt: 1 }}>
      {workersQuery.isPending ? <LoadingState /> : workersQuery.isError ? <ErrorState message="Не удалось загрузить список медработников." /> : <FormControl fullWidth sx={{ mt: 1 }}><InputLabel id="worker-label">Медработник</InputLabel><Select labelId="worker-label" label="Медработник" value={workerId} onChange={(event) => setWorkerId(String(event.target.value))}>
        {workersQuery.data?.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.lastName} {item.firstName} — {item.position}</MenuItem>)}
      </Select></FormControl>}
    </DialogContent><DialogActions><Button onClick={() => setWorkerDialog(false)}>Отмена</Button><Button variant="contained" disabled={!workerId} onClick={() => { const selected = workersQuery.data?.find((item) => item.id === Number(workerId)); if (selected) { setWorker(selected); setWorkerDialog(false); } }}>Начать редактирование</Button></DialogActions></Dialog>

    <Dialog open={diagnosisDialog} onClose={() => !addDiagnosis.isPending && setDiagnosisDialog(false)} fullWidth maxWidth="sm"><DialogTitle>Добавить диагноз</DialogTitle><DialogContent>
      {diagnosesQuery.isPending ? <LoadingState /> : diagnosesQuery.isError ? <ErrorState message="Не удалось загрузить справочник диагнозов." /> : <FormControl fullWidth sx={{ mt: 1 }}><InputLabel id="diagnosis-label">Диагноз</InputLabel><Select labelId="diagnosis-label" label="Диагноз" value={diagnosisId} onChange={(event) => setDiagnosisId(String(event.target.value))}>
        {availableDiagnoses.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.code} — {item.name}</MenuItem>)}
      </Select>{availableDiagnoses.length === 0 && <Typography color="text.secondary" sx={{ mt: 2 }}>Нет доступных диагнозов</Typography>}</FormControl>}
    </DialogContent><DialogActions><Button onClick={() => setDiagnosisDialog(false)} disabled={addDiagnosis.isPending}>Отмена</Button><Button variant="contained" disabled={!diagnosisId || addDiagnosis.isPending} onClick={() => addDiagnosis.mutate()}>Добавить</Button></DialogActions></Dialog>

    <Dialog open={prescription !== undefined} onClose={() => !savePrescription.isPending && setPrescription(undefined)} fullWidth maxWidth="sm"><DialogTitle>{prescription ? 'Редактировать назначение' : 'Добавить назначение'}</DialogTitle><DialogContent><TextField autoFocus fullWidth multiline minRows={3} sx={{ mt: 1 }} label="Текст назначения" value={prescriptionText} onChange={(event) => setPrescriptionText(event.target.value)} error={Boolean(prescriptionError)} helperText={prescriptionError || `${prescriptionText.trim().length}/128`} /></DialogContent><DialogActions><Button onClick={() => setPrescription(undefined)} disabled={savePrescription.isPending}>Отмена</Button><Button variant="contained" onClick={submitPrescription} disabled={savePrescription.isPending}>Сохранить</Button></DialogActions></Dialog>

    <ConfirmDialog open={Boolean(removal)} title={removal?.kind === 'diagnosis' ? 'Удалить диагноз?' : 'Отменить назначение?'} message={removal?.label ?? ''} confirmLabel={removal?.kind === 'diagnosis' ? 'Удалить' : 'Отменить назначение'} pending={removeItem.isPending} onCancel={() => setRemoval(null)} onConfirm={() => removal && removeItem.mutate(removal)} />
    <FeedbackSnackbar message={feedback?.message ?? null} severity={feedback?.severity} onClose={() => setFeedback(null)} />
  </Stack>;
}
