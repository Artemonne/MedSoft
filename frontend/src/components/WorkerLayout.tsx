import { AuthenticatedLayout } from './AuthenticatedLayout';

const links = [
  { to: '/app/patients', label: 'Пациенты' },
  { to: '/app/diagnoses', label: 'Диагнозы' },
];

export function WorkerLayout() {
  return <AuthenticatedLayout title="Медработник" links={links} />;
}
