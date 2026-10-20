import { useState, type FormEvent } from 'react';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthCard } from '../components/AuthCard';
import { LoadingState } from '../components/PageFeedback';

export function UserLoginPage() {
  const { identity, isRestoring, loginUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isRestoring) return <AuthCard title="Вход медработника"><LoadingState /></AuthCard>;
  if (identity) {
    return <Navigate to={identity.subjectType === 'admin' ? '/admin/medical-workers' : '/app/patients'} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await loginUser(username.trim(), password);
      const requested = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(requested?.startsWith('/app/') ? requested : '/app/patients', { replace: true });
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setPending(false);
    }
  };

  return <AuthCard title="Вход медработника" subtitle="Используйте выданные администратором логин и пароль.">
    <Stack component="form" gap={2} onSubmit={(event) => void submit(event)}>
      {error && <Alert severity="error">Неверные учётные данные или аккаунт деактивирован.</Alert>}
      <TextField label="Имя пользователя" value={username} onChange={(event) => setUsername(event.target.value)} inputProps={{ minLength: 3, maxLength: 16 }} required autoFocus />
      <TextField label="Пароль" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
      <Button type="submit" variant="contained" size="large" disabled={pending || username.trim().length < 3 || !password}>{pending ? 'Вход…' : 'Войти'}</Button>
      <Link component={RouterLink} to="/admin/login" textAlign="center">Вход администратора</Link>
    </Stack>
  </AuthCard>;
}
