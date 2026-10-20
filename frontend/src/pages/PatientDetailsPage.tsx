import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { patientsApi } from '../api/patients';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type { Sex } from '../types';
import { useAuth } from '../auth/AuthContext';

const sexLabels: Record<Sex, string> = { MALE: 'Мужской', FEMALE: 'Женский', UNKNOWN: 'Не установлен' };

export function PatientDetailsPage() {
  const { identity } = useAuth();
  const role = identity?.subjectType === 'user' ? identity.medicalWorker.role : 'other';
  const canCreateRecord = role === 'doctor' || role === 'nurse';
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const patient = useQuery({ queryKey: ['patients', id], queryFn: () => patientsApi.get(id), enabled: Number.isInteger(id) && id > 0, retry: false });
  const record = useQuery({ queryKey: ['patients', id, 'medical-record'], queryFn: () => patientsApi.getMedicalRecord(id), enabled: Number.isInteger(id) && id > 0, retry: false });
  const createRecord = useMutation({
    mutationFn: () => patientsApi.createMedicalRecord(id),
    onSuccess: (data) => { queryClient.setQueryData(['patients', id, 'medical-record'], data); },
    onError: (error) => setMessage(getErrorMessage(error)),
  });

  if (!Number.isInteger(id) || id <= 0) return <ErrorState message="Запись не найдена." />;
  if (patient.isPending || record.isPending) return <LoadingState />;
  if (patient.isError) return <ErrorState message={getErrorMessage(patient.error)} />;

  const fullName = [patient.data.lastName, patient.data.firstName, patient.data.middleName].filter(Boolean).join(' ');
  const medicalRecord = record.data;
  return <Stack gap={3}>
    <Button component={Link} to="/app/patients" sx={{ alignSelf: 'flex-start' }}>← К списку пациентов</Button>
    <Typography variant="h4" component="h1">{fullName}</Typography>
    <Card><CardContent><Stack gap={1}>
      <Typography><strong>Дата рождения:</strong> {new Date(patient.data.birthDate).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</Typography>
      <Typography><strong>Пол:</strong> {sexLabels[patient.data.sex]}</Typography>
      <Typography><strong>Комментарий:</strong> {patient.data.comment || '—'}</Typography>
    </Stack></CardContent></Card>
    <Divider />
    <Card><CardContent><Stack gap={2} alignItems="flex-start">
      <Typography variant="h5">Электронная медицинская карта</Typography>
      {record.isError && <Alert severity="error">Не удалось проверить наличие ЭМК.</Alert>}
      {!record.isError && (medicalRecord
        ? <Button variant="contained" onClick={() => navigate(`/app/medical-records/${medicalRecord.id}`)}>Открыть ЭМК</Button>
        : canCreateRecord ? <Button variant="contained" onClick={() => createRecord.mutate()} disabled={createRecord.isPending}>Создать ЭМК</Button> : <Alert severity="info">Ваша роль не позволяет создавать ЭМК.</Alert>)}
    </Stack></CardContent></Card>
    <FeedbackSnackbar message={message} onClose={() => setMessage(null)} />
  </Stack>;
}
