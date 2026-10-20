import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from '@mui/material';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export interface NavigationItem {
  to: string;
  label: string;
}

export function AuthenticatedLayout({ title, links }: { title: string; links: NavigationItem[] }) {
  const { identity, logout } = useAuth();
  const subject = identity?.subjectType === 'user'
    ? identity.username
    : 'Системный администратор';

  return <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
    <AppBar position="static" elevation={1}>
      <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
        <Stack sx={{ mr: { sm: 'auto' } }}>
          <Typography variant="h6">MedSoft</Typography>
          <Typography variant="caption" sx={{ opacity: 0.85 }}>{title} · {subject}</Typography>
        </Stack>
        <Box component="nav" aria-label="Основная навигация" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {links.map((link) => <Box key={link.to} component={NavLink} to={link.to} sx={{
            color: 'inherit', textDecoration: 'none', px: 1.5, py: 1, borderRadius: 1,
            '&.active': { bgcolor: 'primary.dark' },
          }}>{link.label}</Box>)}
        </Box>
        <Button color="inherit" onClick={() => void logout()}>Выйти</Button>
      </Toolbar>
    </AppBar>
    <Container component="main" maxWidth="xl" sx={{ py: 4 }}><Outlet /></Container>
  </Box>;
}
