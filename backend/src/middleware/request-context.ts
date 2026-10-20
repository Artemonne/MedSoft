import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function assignRequestContext(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  request.requestId = randomUUID();
  response.setHeader('X-Request-Id', request.requestId);
  next();
}
