import { Box, Card, CardContent, Container, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50', display: 'grid', placeItems: 'center', py: 4 }}>
    <Container maxWidth="sm">
      <Card elevation={3}><CardContent sx={{ p: { xs: 3, sm: 5 } }}>
        <Stack gap={3}>
          <Stack gap={0.5}>
            <Typography variant="overline" color="primary">MedSoft</Typography>
            <Typography variant="h4" component="h1">{title}</Typography>
            {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
          </Stack>
          {children}
        </Stack>
      </CardContent></Card>
    </Container>
  </Box>;
}
