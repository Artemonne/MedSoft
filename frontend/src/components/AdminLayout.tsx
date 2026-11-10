import { AuthenticatedLayout } from './AuthenticatedLayout';

const links = [
  { to: '/admin/medical-workers', label: 'Медработники' },
  { to: '/admin/diagnoses', label: 'Диагнозы' },
  { to: '/admin/lab-tests', label: 'Лабораторные анализы' },
  { to: '/admin/accounts', label: 'Аккаунты' },
  { to: '/admin/audit', label: 'Аудит' },
];

export function AdminLayout() {
  return <AuthenticatedLayout title="Администратор" links={links} />;
}
