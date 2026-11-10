import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';

export class FhirError extends Error { constructor(public status: number, public issueCode: string, message: string) { super(message); } }
export function operationOutcome(code: string, diagnostics: string) { return { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code, diagnostics }] }; }
export function sendFhir(response: Response, body: unknown, status = 200) { response.status(status).type('application/fhir+json').json(body); }
export const fhirErrorHandler: ErrorRequestHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof FhirError) return void sendFhir(response, operationOutcome(error.issueCode, error.message), error.status);
  if (error instanceof AppError) {
    const code = error.status === 401 ? 'login' : error.status === 403 ? 'forbidden' : error.status === 404 ? 'not-found' : error.status === 429 ? 'throttled' : 'invalid';
    return void sendFhir(response, operationOutcome(code, error.status === 401 ? 'Authentication failed.' : error.message), error.status);
  }
  sendFhir(response, operationOutcome('exception', 'An internal server error occurred.'), 500);
};
