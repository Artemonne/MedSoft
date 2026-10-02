import { Alert, Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export function MedicalRecordPlaceholderPage() {
  return <Stack gap={3}>
    <Typography variant="h4" component="h1">Электронная медицинская карта</Typography>
    <Alert severity="info">Интерфейс ЭМК будет реализован на следующем этапе.</Alert>
    <Button component={Link} to="/patients" sx={{ alignSelf: 'flex-start' }}>К списку пациентов</Button>
  </Stack>;
}
