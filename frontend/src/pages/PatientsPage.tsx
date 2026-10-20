import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel,
  MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material';
import { patientsApi } from '../api/patients';
import { getErrorMessage } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type { Patient, PatientInput, Sex } from '../types';
import { useAuth } from '../auth/AuthContext';

const emptyForm: PatientInput = { firstName: '', lastName: '', middleName: null, birthDate: '', sex: 'UNKNOWN', comment: null };
const sexLabels: Record<Sex, string> = { MALE: 'Мужской', FEMALE: 'Женский', UNKNOWN: 'Не установлен' };

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function validate(form: PatientInput) {
  const errors: Partial<Record<keyof PatientInput, string>> = {};
  if (form.firstName.trim().length < 1 || form.firstName.trim().length > 50) errors.firstName = 'От 1 до 50 символов';
  if (form.lastName.trim().length < 1 || form.lastName.trim().length > 50) errors.lastName = 'От 1 до 50 символов';
  if (form.middleName && form.middleName.trim().length > 50) errors.middleName = 'Не более 50 символов';
  if (!form.birthDate) errors.birthDate = 'Укажите дату рождения';
  else if (form.birthDate > todayString()) errors.birthDate = 'Дата рождения не может быть в будущем';
  if (form.comment && form.comment.trim().length > 32) errors.comment = 'Не более 32 символов';
  return errors;
}

export function PatientsPage() {
  const { identity } = useAuth();
  const role = identity?.subjectType === 'user' ? identity.medicalWorker.role : 'other';
  const canWrite = role === 'doctor' || role === 'nurse';
  const canDelete = role === 'doctor';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['patients'], queryFn: patientsApi.list });
  const [editing, setEditing] = useState<Patient | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Patient | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => editing ? patientsApi.update(editing.id, form) : patientsApi.create(form),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['patients'] }); setEditing(undefined); },
    onError: (error) => setMessage(getErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: patientsApi.remove,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['patients'] }); setDeleting(null); },
    onError: (error) => { setDeleting(null); setMessage(getErrorMessage(error, 'patient-delete')); },
  });
  const openForm = (patient: Patient | null) => {
    setEditing(patient);
    setForm(patient ? {
      firstName: patient.firstName, lastName: patient.lastName, middleName: patient.middleName,
      birthDate: patient.birthDate.slice(0, 10), sex: patient.sex, comment: patient.comment,
    } : emptyForm);
    setErrors({});
  };
  const submit = () => { const next = validate(form); setErrors(next); if (Object.keys(next).length === 0) save.mutate(); };

  return <Stack gap={3}>
    <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h4" component="h1">Пациенты</Typography>{canWrite && <Button variant="contained" onClick={() => openForm(null)}>Создать</Button>}</Stack>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState /> : <TableContainer component={Paper}><Table>
      <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Фамилия</TableCell><TableCell>Имя</TableCell><TableCell>Отчество</TableCell><TableCell>Дата рождения</TableCell><TableCell>Пол</TableCell><TableCell>Комментарий</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead>
      <TableBody>{query.data.length === 0 && <TableRow><TableCell colSpan={8} align="center">Пациенты не найдены</TableCell></TableRow>}{query.data.map((patient) => <TableRow key={patient.id} hover>
        <TableCell>{patient.id}</TableCell><TableCell>{patient.lastName}</TableCell><TableCell>{patient.firstName}</TableCell><TableCell>{patient.middleName || '—'}</TableCell><TableCell>{new Date(patient.birthDate).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</TableCell><TableCell>{sexLabels[patient.sex]}</TableCell><TableCell>{patient.comment || '—'}</TableCell>
        <TableCell align="right"><Button onClick={() => navigate(`/app/patients/${patient.id}`)}>Открыть</Button>{canWrite && <Button onClick={() => openForm(patient)}>Редактировать</Button>}{canDelete && <Button color="error" onClick={() => setDeleting(patient)}>Удалить</Button>}</TableCell>
      </TableRow>)}</TableBody>
    </Table></TableContainer>}
    <Dialog open={editing !== undefined} onClose={() => !save.isPending && setEditing(undefined)} fullWidth maxWidth="sm"><DialogTitle>{editing ? 'Редактировать пациента' : 'Новый пациент'}</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}>
      <TextField label="Фамилия" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} error={Boolean(errors.lastName)} helperText={errors.lastName} autoFocus />
      <TextField label="Имя" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} error={Boolean(errors.firstName)} helperText={errors.firstName} />
      <TextField label="Отчество" value={form.middleName ?? ''} onChange={(event) => setForm({ ...form, middleName: event.target.value || null })} error={Boolean(errors.middleName)} helperText={errors.middleName} />
      <TextField label="Дата рождения" type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} error={Boolean(errors.birthDate)} helperText={errors.birthDate} InputLabelProps={{ shrink: true }} inputProps={{ max: todayString() }} />
      <FormControl><InputLabel id="patient-sex-label">Пол</InputLabel><Select labelId="patient-sex-label" label="Пол" value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value as Sex })}>{(Object.keys(sexLabels) as Sex[]).map((sex) => <MenuItem key={sex} value={sex}>{sexLabels[sex]}</MenuItem>)}</Select></FormControl>
      <TextField label="Комментарий" value={form.comment ?? ''} onChange={(event) => setForm({ ...form, comment: event.target.value || null })} error={Boolean(errors.comment)} helperText={errors.comment} />
    </Stack></DialogContent><DialogActions><Button onClick={() => setEditing(undefined)} disabled={save.isPending}>Отмена</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>Сохранить</Button></DialogActions></Dialog>
    <ConfirmDialog open={Boolean(deleting)} title="Удалить пациента?" message="Это действие нельзя отменить." pending={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    <FeedbackSnackbar message={message} onClose={() => setMessage(null)} />
  </Stack>;
}
