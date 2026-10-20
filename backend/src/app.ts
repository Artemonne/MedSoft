import express from 'express';
import { adminAccountsRouter } from './routes/admin-accounts.js';
import { adminDiagnosesRouter } from './routes/admin-diagnoses.js';
import { adminAuthRouter } from './routes/admin-auth.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { diagnosesRouter } from './routes/diagnoses.js';
import { medicalWorkersRouter } from './routes/medical-workers.js';
import { patientsRouter } from './routes/patients.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { medicalRecordsRouter } from './routes/medical-records.js';
import { assignRequestContext } from './middleware/request-context.js';

export const app = express();

app.use(express.json());
app.use(assignRequestContext);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminAuthRouter);
app.use('/api/admin/accounts', adminAccountsRouter);
app.use('/api/admin/diagnoses', adminDiagnosesRouter);
app.use('/api/admin/audit', auditRouter);
app.use('/api/medical-workers', medicalWorkersRouter);
app.use('/api/diagnoses', diagnosesRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/medical-records', medicalRecordsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
