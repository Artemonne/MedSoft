import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { diagnosesApi } from '../api/diagnoses';
import { getErrorMessage } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type { Diagnosis, DiagnosisInput } from '../types';

const emptyForm: DiagnosisInput = { code: '', name: '' };

function validate(form: DiagnosisInput) {
  const errors: Partial<Record<keyof DiagnosisInput, string>> = {};
  if (form.code.trim().length !== 6) errors.code = 'Код должен содержать ровно 6 символов';
  if (form.name.trim().length < 3 || form.name.trim().length > 24) errors.name = 'От 3 до 24 символов';
  return errors;
}

export function DiagnosesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['diagnoses'], queryFn: diagnosesApi.list });
  const [editing, setEditing] = useState<Diagnosis | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Diagnosis | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] = useState<'success' | 'error'>('error');
  const save = useMutation({
    mutationFn: () => editing ? diagnosesApi.update(editing.id, form) : diagnosesApi.create(form),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['diagnoses'] }); setEditing(undefined); },
    onError: (error) => { setMessageSeverity('error'); setMessage(getErrorMessage(error, 'diagnosis')); },
  });
  const remove = useMutation({
    mutationFn: diagnosesApi.remove,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['diagnoses'] }); setDeleting(null); },
    onError: (error) => { setMessageSeverity('error'); setMessage(getErrorMessage(error)); },
  });
  const seed = useMutation({
    mutationFn: diagnosesApi.seed,
    onSuccess: async ({ created, total }) => {
      await queryClient.invalidateQueries({ queryKey: ['diagnoses'] });
      setMessageSeverity('success');
      setMessage(created > 0
        ? `Добавлено диагнозов: ${created} из ${total}.`
        : 'Все исходные диагнозы уже загружены.');
    },
    onError: (error) => { setMessageSeverity('error'); setMessage(getErrorMessage(error, 'diagnosis')); },
  });
  const openForm = (diagnosis: Diagnosis | null) => {
    setEditing(diagnosis); setForm(diagnosis ? { code: diagnosis.code, name: diagnosis.name } : emptyForm); setErrors({});
  };
  const submit = () => {
    const next = validate(form); setErrors(next); if (Object.keys(next).length === 0) save.mutate();
  };

  return <Stack gap={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2}>
      <Typography variant="h4" component="h1">Диагнозы</Typography>
      <Stack direction="row" gap={1}>
        <Button variant="outlined" onClick={() => seed.mutate()} disabled={seed.isPending}>Загрузить исходные</Button>
        <Button variant="contained" onClick={() => openForm(null)}>Создать</Button>
      </Stack>
    </Stack>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState /> : <TableContainer component={Paper}><Table>
      <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Код</TableCell><TableCell>Наименование</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead>
      <TableBody>{query.data.length === 0 && <TableRow><TableCell colSpan={4} align="center">Диагнозы не найдены</TableCell></TableRow>}{query.data.map((item) => <TableRow key={item.id} hover><TableCell>{item.id}</TableCell><TableCell>{item.code}</TableCell><TableCell>{item.name}</TableCell><TableCell align="right"><Button onClick={() => openForm(item)}>Редактировать</Button><Button color="error" onClick={() => setDeleting(item)}>Удалить</Button></TableCell></TableRow>)}</TableBody>
    </Table></TableContainer>}
    <Dialog open={editing !== undefined} onClose={() => !save.isPending && setEditing(undefined)} fullWidth maxWidth="sm"><DialogTitle>{editing ? 'Редактировать диагноз' : 'Новый диагноз'}</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}>
      <TextField label="Код" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} error={Boolean(errors.code)} helperText={errors.code} autoFocus inputProps={{ maxLength: 6 }} />
      <TextField label="Наименование" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} error={Boolean(errors.name)} helperText={errors.name} />
    </Stack></DialogContent><DialogActions><Button onClick={() => setEditing(undefined)} disabled={save.isPending}>Отмена</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>Сохранить</Button></DialogActions></Dialog>
    <ConfirmDialog open={Boolean(deleting)} title="Удалить диагноз?" message="Это действие нельзя отменить." pending={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    <FeedbackSnackbar message={message} severity={messageSeverity} onClose={() => setMessage(null)} />
  </Stack>;
}
