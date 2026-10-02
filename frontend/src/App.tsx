import { Alert, Box, CircularProgress, Container, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';

type HealthResponse = {
  status: string;
};

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');

  if (!response.ok) {
    throw new Error('The backend health check failed.');
  }

  return response.json() as Promise<HealthResponse>;
}

function HomePage() {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: false,
  });

  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', py: 4 }}>
        <Paper elevation={3} sx={{ width: '100%', p: 4 }}>
          <Typography component="h1" variant="h4" gutterBottom>
            Hospital Information System
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            The frontend is running.
          </Typography>

          {healthQuery.isPending && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={24} />
              <Typography>Checking the backend...</Typography>
            </Box>
          )}

          {healthQuery.isError && (
            <Alert severity="error">The backend is unavailable.</Alert>
          )}

          {healthQuery.data && (
            <Alert severity="success">
              Backend status: {healthQuery.data.status}
            </Alert>
          )}
        </Paper>
      </Box>
    </Container>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}
