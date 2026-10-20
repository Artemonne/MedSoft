import type { MedicalWorkerRole } from '@prisma/client';

export interface UserAuthContext {
  subjectType: 'user';
  accountId: string;
  username: string;
  sessionId: string;
  medicalWorker: {
    id: number;
    role: MedicalWorkerRole;
  };
}

export interface AdminAuthContext {
  subjectType: 'admin';
  administratorId: 1;
  sessionId: string;
}

export type AuthContext = UserAuthContext | AdminAuthContext;
