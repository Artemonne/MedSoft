import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { DiagnosesPage } from './pages/DiagnosesPage';
import { MedicalRecordPlaceholderPage } from './pages/MedicalRecordPlaceholderPage';
import { MedicalWorkersPage } from './pages/MedicalWorkersPage';
import { PatientDetailsPage } from './pages/PatientDetailsPage';
import { PatientsPage } from './pages/PatientsPage';

export default function App() {
  return <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<Navigate to="/patients" replace />} />
      <Route path="medical-workers" element={<MedicalWorkersPage />} />
      <Route path="diagnoses" element={<DiagnosesPage />} />
      <Route path="patients" element={<PatientsPage />} />
      <Route path="patients/:id" element={<PatientDetailsPage />} />
      <Route path="medical-records/:id" element={<MedicalRecordPlaceholderPage />} />
      <Route path="*" element={<Navigate to="/patients" replace />} />
    </Route>
  </Routes>;
}
