import express from 'express';
import { diagnosesRouter } from './routes/diagnoses.js';
import { medicalWorkersRouter } from './routes/medical-workers.js';
import { patientsRouter } from './routes/patients.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { medicalRecordsRouter } from './routes/medical-records.js';

export const app = express();

app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/medical-workers', medicalWorkersRouter);
app.use('/api/diagnoses', diagnosesRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/medical-records', medicalRecordsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
