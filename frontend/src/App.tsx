import { Navigate, Route, Routes } from 'react-router-dom';
import { HomeRedirect, RequireSubject } from './auth/RouteGuards';
import { AdminLayout } from './components/AdminLayout';
import { WorkerLayout } from './components/WorkerLayout';
import { AccountsPage } from './pages/AccountsPage';
import { AdminBootstrapPage } from './pages/AdminBootstrapPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AuditPage } from './pages/AuditPage';
import { DiagnosesPage } from './pages/DiagnosesPage';
import { MedicalRecordPage } from './pages/MedicalRecordPage';
import { MedicalWorkerDetailsPage } from './pages/MedicalWorkerDetailsPage';
import { MedicalWorkersPage } from './pages/MedicalWorkersPage';
import { PatientDetailsPage } from './pages/PatientDetailsPage';
import { PatientsPage } from './pages/PatientsPage';
import { UserLoginPage } from './pages/UserLoginPage';

export default function App() {
  return <Routes>
    <Route path="/login" element={<UserLoginPage />} />
    <Route path="/admin/login" element={<AdminLoginPage />} />
    <Route path="/admin/setup" element={<AdminBootstrapPage />} />

    <Route element={<RequireSubject subjectType="admin" />}>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="medical-workers" replace />} />
        <Route path="medical-workers" element={<MedicalWorkersPage />} />
        <Route path="medical-workers/:id" element={<MedicalWorkerDetailsPage />} />
        <Route path="diagnoses" element={<DiagnosesPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
    </Route>

    <Route element={<RequireSubject subjectType="user" />}>
      <Route path="/app" element={<WorkerLayout />}>
        <Route index element={<Navigate to="patients" replace />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:id" element={<PatientDetailsPage />} />
        <Route path="medical-records/:id" element={<MedicalRecordPage />} />
        <Route path="diagnoses" element={<DiagnosesPage />} />
      </Route>
    </Route>

    <Route path="/" element={<HomeRedirect />} />
    <Route path="/patients/*" element={<Navigate to="/app/patients" replace />} />
    <Route path="/medical-workers/*" element={<Navigate to="/admin/medical-workers" replace />} />
    <Route path="/diagnoses" element={<HomeRedirect />} />
    <Route path="*" element={<HomeRedirect />} />
  </Routes>;
}
