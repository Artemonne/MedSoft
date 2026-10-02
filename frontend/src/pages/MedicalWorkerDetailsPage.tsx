import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { Link, useParams } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { medicalWorkersApi } from '../api/medical-workers';
import { ErrorState, LoadingState } from '../components/PageFeedback';

export function MedicalWorkerDetailsPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const validId = Number.isInteger(id) && id > 0;
  const query = useQuery({
    queryKey: ['medical-workers', id],
    queryFn: () => medicalWorkersApi.get(id),
    enabled: validId,
    retry: false,
  });

  if (!validId) return <ErrorState message="Медработник не найден." />;
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState message={getErrorMessage(query.error)} />;

  const worker = query.data;
  return <Stack gap={3}>
    <Button component={Link} to="/medical-workers" sx={{ alignSelf: 'flex-start' }}>← К списку медработников</Button>
    <Typography variant="h4" component="h1">Карточка медработника</Typography>
    <Card><CardContent><Stack gap={1}>
      <Typography variant="h5">{worker.lastName} {worker.firstName}</Typography>
      <Typography><strong>ID:</strong> {worker.id}</Typography>
      <Typography><strong>Должность:</strong> {worker.position}</Typography>
      <Typography><strong>Создан:</strong> {new Date(worker.createdAt).toLocaleString('ru-RU')}</Typography>
      <Typography><strong>Изменён:</strong> {new Date(worker.updatedAt).toLocaleString('ru-RU')}</Typography>
    </Stack></CardContent></Card>
  </Stack>;
}
