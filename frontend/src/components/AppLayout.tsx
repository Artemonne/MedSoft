import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material';
import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/medical-workers', label: 'Медработники' },
  { to: '/diagnoses', label: 'Диагнозы' },
  { to: '/patients', label: 'Пациенты' },
];

export function AppLayout() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static" elevation={1}>
        <Toolbar sx={{ gap: { xs: 1, sm: 3 }, flexWrap: 'wrap', py: 1 }}>
          <Typography variant="h6" component="div" sx={{ mr: { sm: 'auto' } }}>
            Учебная HIS
          </Typography>
          <Box component="nav" aria-label="Основная навигация" sx={{ display: 'flex', gap: 0.5 }}>
            {links.map((link) => (
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
          </Box>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
