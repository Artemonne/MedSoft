import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/app-error.js';
import { operationOutcome } from '../fhir/outcome.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (request.originalUrl.startsWith('/api/fhir/r5')) {
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    const invalidJson = error instanceof SyntaxError && 'body' in error;
    const status = tooLarge ? 413 : invalidJson ? 400 : 500;
    response.status(status).type('application/fhir+json').json(operationOutcome(tooLarge ? 'too-costly' : invalidJson ? 'invalid' : 'exception', tooLarge ? 'FHIR request body is too large.' : invalidJson ? 'Request body contains invalid JSON.' : 'An internal server error occurred.'));
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      response.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A record with the same unique value already exists.',
        },
      });
      return;
    }

    if (error.code === 'P2025') {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested record was not found.',
        },
      });
      return;
    }

    if (error.code === 'P2003') {
      response.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'The operation conflicts with related data.',
        },
      });
      return;
    }
  }

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON.',
      },
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
};
