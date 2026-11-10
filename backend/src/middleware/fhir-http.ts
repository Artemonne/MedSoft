import type { NextFunction, Request, Response } from 'express';
import { FhirError } from '../fhir/outcome.js';
export function requireFhirJson(request: Request, _response: Response, next: NextFunction) { const accept = request.get('accept'); if (accept) { const supported = accept.split(',').some((part) => { const type = part.trim().split(';')[0]; return type === '*/*' || type === 'application/fhir+json' || type === 'application/json'; }); if (!supported) throw new FhirError(406, 'not-supported', 'Only FHIR JSON is supported.'); } next(); }
