import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { AuthCard } from '../components/AuthCard';
import { LoadingState } from '../components/PageFeedback';

export function AdminLoginPage() {
  const { identity, isRestoring, loginAdmin } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [pending, setPending] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void authApi.bootstrapStatus().then(({ status }) => {
      if (!active) return;
      if (status !== 'CONFIGURED') navigate('/admin/setup', { replace: true });
      else setCheckingSetup(false);
    }).catch(() => active && setCheckingSetup(false));
    return () => { active = false; };
  }, [navigate]);

  if (isRestoring) return <AuthCard title="Вход администратора"><LoadingState /></AuthCard>;
  if (identity) {
    return <Navigate to={identity.subjectType === 'admin' ? '/admin/medical-workers' : '/app/patients'} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await loginAdmin(password, totpCode);
      navigate('/admin/medical-workers', { replace: true });
    } catch {
      setError('Неверный пароль или одноразовый код.');
    } finally {
      setPending(false);
    }
  };

  return <AuthCard title="Вход администратора" subtitle="Для входа требуются пароль и текущий код из приложения-аутентификатора.">
    <Stack component="form" gap={2} onSubmit={(event) => void submit(event)}>
      {error && <Alert severity="error">{error}</Alert>}
      <TextField label="Пароль" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" autoFocus />
      <TextField label="Код TOTP" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputProps={{ inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6 }} required />
      <Button type="submit" variant="contained" size="large" disabled={pending || checkingSetup || !password || totpCode.length !== 6}>{pending ? 'Вход…' : 'Войти'}</Button>
      <Link component={RouterLink} to="/login" textAlign="center">Вход медработника</Link>
    </Stack>
  </AuthCard>;
}
