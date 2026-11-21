import type { ServiceAccountRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/app-error.js';
import { serviceAuthService } from '../services/service-auth.js';
import { serviceRoleAllows, type ServiceOperation, type ServiceResource } from '../services/service-permissions.js';
export async function authenticateServiceAccessToken(request: Request, _response: Response, next: NextFunction) { const match = request.get('authorization')?.match(/^Bearer ([^\s]+)$/); if (!match) throw new UnauthorizedError('Bearer service access token is required.'); request.auth = await serviceAuthService.authenticateAccessToken(match[1]); next(); }
export function authorizeServiceRole(...roles: ServiceAccountRole[]) { return (request: Request, _response: Response, next: NextFunction) => { if (request.auth?.subjectType !== 'service') throw new UnauthorizedError(); if (!roles.includes(request.auth.role)) throw new ForbiddenError(); next(); }; }
export function authorizeServiceOperation(resource: ServiceResource, operation: ServiceOperation) { return (request: Request, _response: Response, next: NextFunction) => { if (request.auth?.subjectType !== 'service') throw new UnauthorizedError(); if (!serviceRoleAllows(request.auth.role, resource, operation)) throw new ForbiddenError(); next(); }; }
