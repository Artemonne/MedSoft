import type { MedicalWorkerRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/app-error.js';

export function authorizeMedicalWorkerRoles(...allowedRoles: MedicalWorkerRole[]) {
  const allowed = new Set<MedicalWorkerRole>(allowedRoles);

  return (request: Request, _response: Response, next: NextFunction): void => {
    if (request.auth?.subjectType !== 'user') {
      throw new UnauthorizedError();
    }
    if (!allowed.has(request.auth.medicalWorker.role)) {
      throw new ForbiddenError('Insufficient permissions.');
    }
    next();
  };
}
