import type { Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import { createServiceAccountSchema, serviceAccountIdSchema, serviceAccountStatusSchema } from '../schemas/service-account.js';
import { serviceAccountService } from '../services/service-account.js';
function adminId(request: Request): 1 { if (request.auth?.subjectType !== 'admin') throw new UnauthorizedError(); return request.auth.administratorId; }
export const adminServiceAccountController = {
  async list(request: Request, response: Response) { adminId(request); response.json(await serviceAccountService.list()); },
  async get(request: Request, response: Response) { adminId(request); const { id } = serviceAccountIdSchema.parse(request.params); response.json(await serviceAccountService.getById(id)); },
  async create(request: Request, response: Response) { const input = createServiceAccountSchema.parse(request.body); response.status(201).json(await serviceAccountService.create(input, adminId(request))); },
  async status(request: Request, response: Response) { const { id } = serviceAccountIdSchema.parse(request.params); const { isActive } = serviceAccountStatusSchema.parse(request.body); response.json(await serviceAccountService.setActive(id, isActive, adminId(request))); },
  async rotate(request: Request, response: Response) { const { id } = serviceAccountIdSchema.parse(request.params); response.json(await serviceAccountService.rotateKey(id, adminId(request))); },
};
