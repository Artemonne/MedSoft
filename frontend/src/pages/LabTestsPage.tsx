import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { labTestsApi } from '../api/lab-tests';
import { getErrorMessage } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, FeedbackSnackbar, LoadingState } from '../components/PageFeedback';
import type { LabTest, LabTestInput } from '../types';

const emptyForm: LabTestInput = { name: '', loincCode: '', resultKind: 'TEXT', unitCode: null, unitDisplay: null, methodDescription: null };

export function LabTestsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['lab-tests'], queryFn: labTestsApi.list });
  const [editing, setEditing] = useState<LabTest | null | undefined>(undefined);
  const [changing, setChanging] = useState<LabTest | null>(null);
  const [form, setForm] = useState<LabTestInput>(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [severity, setSeverity] = useState<'success' | 'error'>('error');
  const refresh = () => client.invalidateQueries({ queryKey: ['lab-tests'] });
  const save = useMutation({ mutationFn: () => editing ? labTestsApi.update(editing.id, form) : labTestsApi.create(form), onSuccess: async () => { await refresh(); setEditing(undefined); }, onError: (error) => setMessage(getErrorMessage(error)) });
  const active = useMutation({ mutationFn: (item: LabTest) => labTestsApi.setActive(item.id, !item.isActive), onSuccess: async () => { await refresh(); setChanging(null); }, onError: (error) => setMessage(getErrorMessage(error)) });
  const seed = useMutation({ mutationFn: labTestsApi.seed, onSuccess: async ({ created, total }) => { await refresh(); setSeverity('success'); setMessage(`Справочник синхронизирован: добавлено ${created} из ${total}.`); }, onError: (error) => setMessage(getErrorMessage(error)) });
  const open = (item: LabTest | null) => { setEditing(item); setForm(item ? { name: item.name, loincCode: item.loincCode, resultKind: item.resultKind, unitCode: item.unitCode, unitDisplay: item.unitDisplay, methodDescription: item.methodDescription } : emptyForm); };
  const setKind = (resultKind: LabTestInput['resultKind']) => setForm({ ...form, resultKind, unitCode: resultKind === 'TEXT' ? null : form.unitCode, unitDisplay: resultKind === 'TEXT' ? null : form.unitDisplay });

  return <Stack gap={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}><Typography variant="h4">Лабораторные анализы</Typography><Stack direction="row" gap={1}><Button variant="outlined" onClick={() => seed.mutate()} disabled={seed.isPending}>Загрузить исходные</Button><Button variant="contained" onClick={() => open(null)}>Создать</Button></Stack></Stack>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState /> : <TableContainer component={Paper}><Table><TableHead><TableRow><TableCell>LOINC</TableCell><TableCell>Наименование</TableCell><TableCell>Результат</TableCell><TableCell>Единица</TableCell><TableCell>Метод</TableCell><TableCell>Статус</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead><TableBody>{query.data.map((item) => <TableRow key={item.id} hover><TableCell>{item.loincCode}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.resultKind === 'TEXT' ? 'Текст' : 'Число'}</TableCell><TableCell>{item.unitDisplay ?? '—'}</TableCell><TableCell>{item.methodDescription ?? '—'}</TableCell><TableCell>{item.isActive ? 'Активен' : 'Неактивен'}</TableCell><TableCell align="right"><Button onClick={() => open(item)}>Изменить</Button><Button color={item.isActive ? 'error' : 'primary'} onClick={() => setChanging(item)}>{item.isActive ? 'Деактивировать' : 'Активировать'}</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>}
    <Dialog open={editing !== undefined} onClose={() => setEditing(undefined)} fullWidth maxWidth="sm"><DialogTitle>{editing ? 'Изменить анализ' : 'Новый анализ'}</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}><TextField label="Наименование" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><TextField label="Код LOINC" value={form.loincCode} onChange={(e) => setForm({ ...form, loincCode: e.target.value })} /><FormControl><InputLabel>Тип результата</InputLabel><Select label="Тип результата" value={form.resultKind} onChange={(e) => setKind(e.target.value as LabTestInput['resultKind'])}><MenuItem value="TEXT">Текст</MenuItem><MenuItem value="QUANTITY">Число</MenuItem></Select></FormControl>{form.resultKind === 'QUANTITY' && <><TextField label="Код UCUM" value={form.unitCode ?? ''} onChange={(e) => setForm({ ...form, unitCode: e.target.value || null })} /><TextField label="Отображение единицы" value={form.unitDisplay ?? ''} onChange={(e) => setForm({ ...form, unitDisplay: e.target.value || null })} /></>}<TextField label="Метод" value={form.methodDescription ?? ''} onChange={(e) => setForm({ ...form, methodDescription: e.target.value || null })} /></Stack></DialogContent><DialogActions><Button onClick={() => setEditing(undefined)}>Отмена</Button><Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button></DialogActions></Dialog>
    <ConfirmDialog open={Boolean(changing)} title={changing?.isActive ? 'Деактивировать анализ?' : 'Активировать анализ?'} message="Исторические назначения и результаты сохранятся." pending={active.isPending} onCancel={() => setChanging(null)} onConfirm={() => changing && active.mutate(changing)} />
    <FeedbackSnackbar message={message} severity={severity} onClose={() => { setMessage(null); setSeverity('error'); }} />
  </Stack>;
}
