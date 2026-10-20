import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { medicalWorkersApi } from '../api/medical-workers';
import { getErrorMessage } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type { MedicalWorker, MedicalWorkerInput } from '../types';

const emptyForm: MedicalWorkerInput = { firstName: '', lastName: '', position: '' };

function validate(form: MedicalWorkerInput) {
  const errors: Partial<Record<keyof MedicalWorkerInput, string>> = {};
  for (const field of ['firstName', 'lastName'] as const) {
    const length = form[field].trim().length;
    if (length < 1 || length > 24) errors[field] = 'От 1 до 24 символов';
  }
  if (form.position.trim().length < 3 || form.position.trim().length > 24) errors.position = 'От 3 до 24 символов';
  return errors;
}

export function MedicalWorkersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['medical-workers'], queryFn: medicalWorkersApi.list });
  const [editing, setEditing] = useState<MedicalWorker | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MedicalWorker | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => editing
      ? medicalWorkersApi.update(editing.id, form)
      : medicalWorkersApi.create(form),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['medical-workers'] });
      setEditing(undefined);
    },
    onError: (error) => setMessage(getErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => medicalWorkersApi.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['medical-workers'] });
      setDeleting(null);
    },
    onError: (error) => setMessage(getErrorMessage(error)),
  });

  const openForm = (worker: MedicalWorker | null) => {
    setEditing(worker);
    setForm(worker ? { firstName: worker.firstName, lastName: worker.lastName, position: worker.position } : emptyForm);
    setErrors({});
  };
  const submit = () => {
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) save.mutate();
  };

  return (
    <Stack gap={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h4" component="h1">Медработники</Typography>
        <Stack direction="row" gap={1}><Button variant="outlined" onClick={() => navigate('/admin/accounts')}>Управление аккаунтами</Button><Button variant="contained" onClick={() => openForm(null)}>Создать</Button></Stack>
      </Stack>
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState /> : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Имя</TableCell><TableCell>Фамилия</TableCell><TableCell>Должность</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead>
            <TableBody>
              {query.data.length === 0 && <TableRow><TableCell colSpan={5} align="center">Медработники не найдены</TableCell></TableRow>}
              {query.data.map((worker) => (
                <TableRow key={worker.id} hover>
                  <TableCell>{worker.id}</TableCell><TableCell>{worker.firstName}</TableCell><TableCell>{worker.lastName}</TableCell><TableCell>{worker.position}</TableCell>
                  <TableCell align="right"><Button onClick={() => navigate(`/admin/medical-workers/${worker.id}`)}>Открыть</Button><Button onClick={() => openForm(worker)}>Редактировать</Button><Button color="error" onClick={() => setDeleting(worker)}>Удалить</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Dialog open={editing !== undefined} onClose={() => !save.isPending && setEditing(undefined)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Редактировать медработника' : 'Новый медработник'}</DialogTitle>
        <DialogContent><Stack gap={2} sx={{ pt: 1 }}>
          <TextField label="Имя" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} error={Boolean(errors.firstName)} helperText={errors.firstName} autoFocus />
          <TextField label="Фамилия" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} error={Boolean(errors.lastName)} helperText={errors.lastName} />
          <TextField label="Должность" value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} error={Boolean(errors.position)} helperText={errors.position} />
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setEditing(undefined)} disabled={save.isPending}>Отмена</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>Сохранить</Button></DialogActions>
      </Dialog>
      <ConfirmDialog open={Boolean(deleting)} title="Удалить медработника?" message="Медработник исчезнет из активного списка." pending={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
      <FeedbackSnackbar message={message} onClose={() => setMessage(null)} />
    </Stack>
  );
}
