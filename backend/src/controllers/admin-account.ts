import type { Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import {
  accountIdParamsSchema,
  accountRoleSchema,
  accountStatusSchema,
  createAccountSchema,
} from '../schemas/admin-account.js';
import { adminAccountService } from '../services/admin-account.js';

function administratorId(request: Request): 1 {
  if (request.auth?.subjectType !== 'admin') {
    throw new UnauthorizedError();
  }
  return request.auth.administratorId;
}

export const adminAccountController = {
  async list(request: Request, response: Response) {
    administratorId(request);
    response.json(await adminAccountService.list());
  },

  async create(request: Request, response: Response) {
    const input = createAccountSchema.parse(request.body);
    response.status(201).json(await adminAccountService.create(input, administratorId(request)));
  },

  async resetPassword(request: Request, response: Response) {
    const { id } = accountIdParamsSchema.parse(request.params);
    response.json(await adminAccountService.resetPassword(id, administratorId(request)));
  },

  async setActive(request: Request, response: Response) {
    const { id } = accountIdParamsSchema.parse(request.params);
    const { isActive } = accountStatusSchema.parse(request.body);
    response.json(await adminAccountService.setActive(id, isActive, administratorId(request)));
  },

  async setRole(request: Request, response: Response) {
    const { id } = accountIdParamsSchema.parse(request.params);
    const input = accountRoleSchema.parse(request.body);
    response.json(await adminAccountService.setRole(id, input, administratorId(request)));
  },
};
