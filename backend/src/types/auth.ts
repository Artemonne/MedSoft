import type { MedicalWorkerRole } from '@prisma/client';

export interface AuthContext {
  subjectType: 'user';
  accountId: string;
  username: string;
  sessionId: string;
  medicalWorker: {
    id: number;
    role: MedicalWorkerRole;
  };
}
