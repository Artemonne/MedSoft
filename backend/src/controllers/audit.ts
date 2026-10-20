import type { Request, Response } from 'express';
import { auditChangesQuerySchema, auditHistoryQuerySchema } from '../schemas/audit.js';
import { auditService } from '../services/audit.js';

function disableCaching(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

export const auditController = {
  async list(request: Request, response: Response) {
    const { limit, before } = auditHistoryQuerySchema.parse(request.query);
    disableCaching(response);
    response.json(await auditService.list(limit, before));
  },

  async checkpoint(_request: Request, response: Response) {
    disableCaching(response);
    response.json(await auditService.checkpoint());
  },

  async changes(request: Request, response: Response) {
    const { limit, after } = auditChangesQuerySchema.parse(request.query);
    disableCaching(response);
    response.json(await auditService.changes(limit, after));
  },
};
