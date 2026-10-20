import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { accountsApi, type ManagedAccount } from '../api/accounts';
import { getErrorMessage } from '../api/client';
import { medicalWorkersApi } from '../api/medical-workers';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type { MedicalWorkerRole } from '../types';

const roleLabels: Record<MedicalWorkerRole, string> = {
  doctor: 'Врач',
  nurse: 'Медсестра / медбрат',
  'laboratory-technician': 'Лаборант',
  other: 'Другая',
};

interface PasswordIssue {
  username: string;
  password: string;
}

export function AccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['admin', 'accounts'], queryFn: accountsApi.list });
  const workers = useQuery({ queryKey: ['medical-workers'], queryFn: medicalWorkersApi.list });
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [passwordIssue, setPasswordIssue] = useState<PasswordIssue | null>(null);
  const [statusTarget, setStatusTarget] = useState<ManagedAccount | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<ManagedAccount | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [severity, setSeverity] = useState<'success' | 'error'>('success');

  const linkedWorkerIds = useMemo(
    () => new Set(accounts.data?.flatMap((account) => account.medicalWorker ? [account.medicalWorker.id] : []) ?? []),
    [accounts.data],
  );
  const availableWorkers = workers.data?.filter((worker) => !worker.isDeleted && !linkedWorkerIds.has(worker.id)) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
  const fail = (error: unknown) => { setSeverity('error'); setMessage(getErrorMessage(error)); };

  const create = useMutation({
    mutationFn: () => accountsApi.create(username.trim(), Number(workerId)),
    onSuccess: async (result) => {
      await refresh();
      setCreateOpen(false);
      setPasswordIssue({ username: result.account.username, password: result.generatedPassword });
      setUsername('');
      setWorkerId('');
    },
    onError: fail,
  });
  const resetPassword = useMutation({
    mutationFn: (account: ManagedAccount) => accountsApi.resetPassword(account.id),
    onSuccess: async (result, account) => {
      await refresh();
      setPasswordTarget(null);
      setPasswordIssue({ username: account.username, password: result.generatedPassword });
    },
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (account: ManagedAccount) => accountsApi.setActive(account.id, !account.isActive),
    onSuccess: async (result) => {
      await refresh();
      setStatusTarget(null);
      setSeverity('success');
      setMessage(`Состояние изменено. Отозвано refresh-сессий: ${result.revokedRefreshTokens}.`);
    },
    onError: fail,
  });
  const role = useMutation({
    mutationFn: ({ account, nextRole }: { account: ManagedAccount; nextRole: MedicalWorkerRole }) =>
      accountsApi.setRole(account.id, nextRole),
    onSuccess: async (result) => {
      await refresh();
      setSeverity('success');
      setMessage(`Роль изменена. Отозвано refresh-сессий: ${result.revokedRefreshTokens}.`);
    },
    onError: fail,
  });

  return <Stack gap={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
      <Typography variant="h4" component="h1">Аккаунты медработников</Typography>
      <Button variant="contained" onClick={() => setCreateOpen(true)}>Создать аккаунт</Button>
    </Stack>
    {accounts.isPending ? <LoadingState /> : accounts.isError ? <ErrorState message={getErrorMessage(accounts.error)} /> :
      <TableContainer component={Paper}><Table>
        <TableHead><TableRow><TableCell>Username</TableCell><TableCell>Медработник</TableCell><TableCell>Роль</TableCell><TableCell>Статус</TableCell><TableCell>Создан</TableCell><TableCell>Изменён</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead>
        <TableBody>
          {accounts.data.length === 0 && <TableRow><TableCell colSpan={7} align="center">Аккаунты не созданы</TableCell></TableRow>}
          {accounts.data.map((account) => <TableRow key={account.id} hover>
            <TableCell>{account.username}</TableCell>
            <TableCell>{account.medicalWorker ? `${account.medicalWorker.lastName} ${account.medicalWorker.firstName}` : 'Не связан'}</TableCell>
            <TableCell>{account.medicalWorker && <Select size="small" value={account.medicalWorker.role} disabled={role.isPending || account.medicalWorker.isDeleted} onChange={(event) => role.mutate({ account, nextRole: event.target.value as MedicalWorkerRole })}>{Object.entries(roleLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select>}</TableCell>
            <TableCell><Chip size="small" color={account.isActive ? 'success' : 'default'} label={account.isActive ? 'Активен' : 'Отключён'} /></TableCell>
            <TableCell>{new Date(account.createdAt).toLocaleString('ru-RU')}</TableCell>
            <TableCell>{new Date(account.updatedAt).toLocaleString('ru-RU')}</TableCell>
            <TableCell align="right"><Button onClick={() => setPasswordTarget(account)}>Новый пароль</Button><Button color={account.isActive ? 'error' : 'success'} onClick={() => setStatusTarget(account)}>{account.isActive ? 'Деактивировать' : 'Активировать'}</Button></TableCell>
          </TableRow>)}
        </TableBody>
      </Table></TableContainer>}

    <Dialog open={createOpen} onClose={() => !create.isPending && setCreateOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>Новый аккаунт</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}>
        <TextField label="Username" value={username} onChange={(event) => setUsername(event.target.value)} inputProps={{ minLength: 3, maxLength: 16 }} helperText="От 3 до 16 символов" autoFocus />
        <FormControl><InputLabel id="account-worker-label">Медработник</InputLabel><Select labelId="account-worker-label" label="Медработник" value={workerId} onChange={(event) => setWorkerId(String(event.target.value))}>
          {availableWorkers.map((worker) => <MenuItem key={worker.id} value={worker.id}>{worker.lastName} {worker.firstName} — {worker.position}</MenuItem>)}
        </Select></FormControl>
        {workers.isError && <Alert severity="error">Не удалось загрузить медработников.</Alert>}
        {!workers.isPending && availableWorkers.length === 0 && <Alert severity="info">Нет медработников без аккаунта.</Alert>}
      </Stack></DialogContent><DialogActions><Button onClick={() => setCreateOpen(false)} disabled={create.isPending}>Отмена</Button><Button variant="contained" onClick={() => create.mutate()} disabled={create.isPending || username.trim().length < 3 || !workerId}>Создать</Button></DialogActions>
    </Dialog>

    <Dialog open={Boolean(passwordIssue)} onClose={() => setPasswordIssue(null)} fullWidth maxWidth="sm">
      <DialogTitle>Пароль выдан один раз</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}>
        <Alert severity="warning">Сохраните и безопасно передайте пароль медработнику. После закрытия он больше не будет показан.</Alert>
        <TextField label="Username" value={passwordIssue?.username ?? ''} InputProps={{ readOnly: true }} />
        <TextField label="Новый пароль" value={passwordIssue?.password ?? ''} InputProps={{ readOnly: true }} inputProps={{ 'data-testid': 'issued-password' }} />
      </Stack></DialogContent><DialogActions><Button variant="contained" onClick={() => setPasswordIssue(null)}>Я сохранил пароль</Button></DialogActions>
    </Dialog>

    <ConfirmDialog open={Boolean(passwordTarget)} title="Сгенерировать новый пароль?" message="Все активные refresh-сессии аккаунта будут отозваны." confirmLabel="Сгенерировать" pending={resetPassword.isPending} onCancel={() => setPasswordTarget(null)} onConfirm={() => passwordTarget && resetPassword.mutate(passwordTarget)} />
    <ConfirmDialog open={Boolean(statusTarget)} title={statusTarget?.isActive ? 'Деактивировать аккаунт?' : 'Активировать аккаунт?'} message={statusTarget?.isActive ? 'Активные refresh-сессии будут отозваны.' : 'Старые отозванные сессии не восстановятся.'} confirmLabel={statusTarget?.isActive ? 'Деактивировать' : 'Активировать'} pending={status.isPending} onCancel={() => setStatusTarget(null)} onConfirm={() => statusTarget && status.mutate(statusTarget)} />
    <FeedbackSnackbar message={message} severity={severity} onClose={() => setMessage(null)} />
  </Stack>;
}
