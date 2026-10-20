import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { authApi, type BootstrapSetup, type BootstrapStatus } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { AuthCard } from '../components/AuthCard';
import { LoadingState } from '../components/PageFeedback';

export function AdminBootstrapPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setup, setSetup] = useState<BootstrapSetup | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void authApi.bootstrapStatus()
      .then((result) => {
        if (!active) return;
        if (result.status === 'CONFIGURED') navigate('/admin/login', { replace: true });
        else setStatus(result.status);
      })
      .catch((nextError) => active && setError(getErrorMessage(nextError)));
    return () => { active = false; };
  }, [navigate]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('Пароль и подтверждение не совпадают.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authApi.startBootstrap({ bootstrapSecret, password, passwordConfirmation: confirmation });
      setSetup(result);
      setStatus('SETUP_IN_PROGRESS');
      setPassword('');
      setConfirmation('');
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setPending(false);
    }
  };

  const complete = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authApi.completeBootstrap(bootstrapSecret, totpCode);
      setSetup(null);
      navigate('/admin/login', { replace: true });
    } catch {
      setError('Не удалось подтвердить TOTP-код. Проверьте время и введите текущий код.');
    } finally {
      setPending(false);
    }
  };

  if (!status && !error) return <AuthCard title="Первоначальная настройка"><LoadingState /></AuthCard>;

  return <AuthCard title="Первоначальная настройка администратора" subtitle="Одноразовый bootstrap-секрет хранится вне Git и вводится только для настройки.">
    {error && <Alert severity="error">{error}</Alert>}
    {status === 'NOT_CONFIGURED' && <Stack component="form" gap={2} onSubmit={(event) => void start(event)}>
      <TextField label="Bootstrap-секрет" type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} required autoFocus />
      <TextField label="Новый пароль" type="password" value={password} onChange={(event) => setPassword(event.target.value)} helperText="Не менее 12 символов" inputProps={{ minLength: 12, maxLength: 128 }} required />
      <TextField label="Подтверждение пароля" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} error={Boolean(confirmation && confirmation !== password)} required />
      <Button type="submit" variant="contained" disabled={pending || password.length < 12 || password !== confirmation || !bootstrapSecret}>{pending ? 'Создание…' : 'Создать администратора'}</Button>
    </Stack>}
    {status === 'SETUP_IN_PROGRESS' && <Stack component="form" gap={2} onSubmit={(event) => void complete(event)}>
      {setup ? <>
        <Alert severity="warning">Сохраните секрет сейчас. После завершения настройки он больше не будет показан.</Alert>
        <Box component="img" src={setup.qrCodeDataUrl} alt="QR-код для настройки TOTP" sx={{ width: 240, maxWidth: '100%', alignSelf: 'center' }} />
        <Typography fontFamily="monospace" textAlign="center" sx={{ overflowWrap: 'anywhere' }}>{setup.manualSecret}</Typography>
      </> : <Alert severity="info">Настройка уже начата. Используйте ранее сохранённый TOTP-секрет. Повторное отображение секрета запрещено.</Alert>}
      <TextField label="Bootstrap-секрет" type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} required />
      <TextField label="Текущий код TOTP" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputProps={{ inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6 }} required />
      <Button type="submit" variant="contained" disabled={pending || !bootstrapSecret || totpCode.length !== 6}>{pending ? 'Проверка…' : 'Завершить настройку'}</Button>
    </Stack>}
    <Link component={RouterLink} to="/login" textAlign="center">Вход медработника</Link>
  </AuthCard>;
}
