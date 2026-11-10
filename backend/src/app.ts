import express from 'express';
import { adminAccountsRouter } from './routes/admin-accounts.js';
import { adminDiagnosesRouter } from './routes/admin-diagnoses.js';
import { adminAuthRouter } from './routes/admin-auth.js';
import { adminLabTestsRouter } from './routes/admin-lab-tests.js';
import { adminServiceAccountsRouter } from './routes/admin-service-accounts.js';
import { serviceAuthRouter } from './routes/service-auth.js';
import { fhirR5Router } from './routes/fhir-r5.js';
import { labTestsRouter } from './routes/lab-tests.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { diagnosesRouter } from './routes/diagnoses.js';
import { medicalWorkersRouter } from './routes/medical-workers.js';
import { patientsRouter } from './routes/patients.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { medicalRecordsRouter } from './routes/medical-records.js';
import { assignRequestContext } from './middleware/request-context.js';

export const app = express();

app.use(express.json({ type: ['application/json', 'application/fhir+json'], limit: '100kb' }));
app.use(assignRequestContext);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminAuthRouter);
app.use('/api/admin/accounts', adminAccountsRouter);
app.use('/api/admin/service-accounts', adminServiceAccountsRouter);
app.use('/api/admin/diagnoses', adminDiagnosesRouter);
app.use('/api/admin/lab-tests', adminLabTestsRouter);
app.use('/api/admin/audit', auditRouter);
app.use('/api/medical-workers', medicalWorkersRouter);
app.use('/api/diagnoses', diagnosesRouter);
app.use('/api/lab-tests', labTestsRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/medical-records', medicalRecordsRouter);
app.use('/api/service-auth', serviceAuthRouter);
app.use('/api/fhir/r5', fhirR5Router);

app.use(notFoundHandler);
app.use(errorHandler);
