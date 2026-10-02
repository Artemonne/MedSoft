import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material';
import { NavLink, Outlet } from 'react-router-dom';

const workspaces = [
  {
    label: 'Администратор',
    links: [
      { to: '/medical-workers', label: 'Медработники' },
      { to: '/diagnoses', label: 'Диагнозы' },
    ],
  },
  {
    label: 'Медработник',
    links: [{ to: '/patients', label: 'Пациенты' }],
  },
];

export function AppLayout() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static" elevation={1}>
        <Toolbar sx={{ gap: { xs: 1, sm: 3 }, flexWrap: 'wrap', py: 1 }}>
          <Typography variant="h6" component="div" sx={{ mr: { sm: 'auto' } }}>
            Учебная HIS
          </Typography>
          <Box component="nav" aria-label="Основная навигация" sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {workspaces.map((workspace) => <Box key={workspace.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.8, mr: 0.5 }}>{workspace.label}:</Typography>
              {workspace.links.map((link) => (
                <Box
                  key={link.to}
                  component={NavLink}
                  to={link.to}
                  sx={{
                    color: 'inherit', textDecoration: 'none', px: 1.5, py: 1, borderRadius: 1,
                    '&.active': { bgcolor: 'primary.dark' },
                  }}
                >
                  {link.label}
                </Box>
              ))}
            </Box>)}
          </Box>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
