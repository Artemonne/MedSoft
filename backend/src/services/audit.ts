import { randomUUID } from 'node:crypto';
import { AuditActorType, Prisma } from '@prisma/client';
import { AppError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';

export type AuditEventType =
  | 'ADMIN_LOGIN_SUCCEEDED'
  | 'USER_LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'MEDICAL_WORKER_CREATED'
  | 'MEDICAL_WORKER_UPDATED'
  | 'MEDICAL_WORKER_DELETED'
  | 'PATIENT_CREATED'
  | 'PATIENT_UPDATED'
  | 'PATIENT_DELETED'
  | 'MEDICAL_RECORD_CREATED'
  | 'MEDICAL_RECORD_UNLOCKED'
  | 'MEDICAL_RECORD_DIAGNOSIS_ADDED'
  | 'MEDICAL_RECORD_DIAGNOSIS_REMOVED'
  | 'MEDICAL_RECORD_PRESCRIPTION_ADDED'
  | 'MEDICAL_RECORD_PRESCRIPTION_EDITED'
  | 'MEDICAL_RECORD_PRESCRIPTION_REMOVED'
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_PASSWORD_CHANGED'
  | 'ACCOUNT_ACTIVATION_CHANGED'
  | 'ACCOUNT_ROLE_CHANGED'
  | 'ACCOUNT_DEACTIVATED_BY_WORKER_DELETION';

export type AuditActor =
  | { type: 'admin'; administratorId: 1 }
  | { type: 'user'; accountId: string }
  | { type: 'anonymous'; requestId: string }
  | { type: 'system'; identifier: string };

export interface AuditInput {
  eventType: AuditEventType;
  actor: AuditActor;
  message: string;
  metadata?: Prisma.InputJsonObject;
}

interface AuditCursor {
  occurredAt: string;
  id: string;
}

const AUDIT_LOCK_ID = 370_553_007;
const forbiddenMetadataKey = /password|hash|token|secret|authorization|cookie|jwt|totp/i;

function validateMetadata(value: Prisma.InputJsonValue, path = 'metadata'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateMetadata(item, `${path}.${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (
        key.toLowerCase() !== 'revokedrefreshtokens' &&
        forbiddenMetadataKey.test(key)
      ) {
        throw new Error(`Sensitive audit metadata key is forbidden: ${path}.${key}`);
      }
      if (nested !== null) {
        validateMetadata(nested as Prisma.InputJsonValue, `${path}.${key}`);
      }
    }
  }
}

function actorData(actor: AuditActor) {
  switch (actor.type) {
    case 'admin':
      return {
        actorType: AuditActorType.ADMIN,
        actorIdentifier: `admin:${actor.administratorId}`,
        systemAdministratorId: actor.administratorId,
      };
    case 'user':
      return {
        actorType: AuditActorType.USER,
        actorIdentifier: `account:${actor.accountId}`,
        accountId: actor.accountId,
      };
    case 'anonymous':
      return {
        actorType: AuditActorType.ANONYMOUS,
        actorIdentifier: `request:${actor.requestId}`,
      };
    case 'system':
      return {
        actorType: AuditActorType.SYSTEM,
        actorIdentifier: `system:${actor.identifier}`,
      };
  }
}

function encodeCursor(event: { occurredAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: event.occurredAt.toISOString(), id: event.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string): AuditCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as AuditCursor;
    const parsedDate = typeof value.occurredAt === 'string' ? new Date(value.occurredAt) : null;
    if (
      typeof value.id !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.id) ||
      !parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString() !== value.occurredAt
    ) {
      throw new Error();
    }
    return value;
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid audit cursor.');
  }
}

export const auditService = {
  async record(transaction: Prisma.TransactionClient, input: AuditInput) {
    if (input.metadata) {
      validateMetadata(input.metadata);
    }
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_ID})::text`;
    const latest = await transaction.auditEvent.findFirst({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true },
    });
    const occurredAt = new Date(
      Math.max(Date.now(), latest ? latest.occurredAt.getTime() + 1 : 0),
    );
    return transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        occurredAt,
        eventType: input.eventType,
        ...actorData(input.actor),
        message: input.message,
        metadata: input.metadata,
      },
    });
  },

  recordStandalone(input: AuditInput) {
    return prisma.$transaction((transaction) => this.record(transaction, input));
  },

  async checkpoint() {
    const latest = await prisma.auditEvent.findFirst({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true, id: true },
    });
    return { cursor: latest ? encodeCursor(latest) : null, serverTime: new Date() };
  },

  async list(limit: number, before?: string) {
    const cursor = before ? decodeCursor(before) : undefined;
    const events = await prisma.auditEvent.findMany({
      where: cursor
        ? {
            OR: [
              { occurredAt: { lt: new Date(cursor.occurredAt) } },
              { occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } },
            ],
          }
        : undefined,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = events.length > limit;
    const page = events.slice(0, limit);
    return {
      events: page,
      nextCursor: hasMore && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
      hasMore,
      serverTime: new Date(),
    };
  },

  async changes(limit: number, after?: string) {
    const cursor = after ? decodeCursor(after) : undefined;
    const events = await prisma.auditEvent.findMany({
      where: cursor
        ? {
            OR: [
              { occurredAt: { gt: new Date(cursor.occurredAt) } },
              { occurredAt: new Date(cursor.occurredAt), id: { gt: cursor.id } },
            ],
          }
        : undefined,
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return {
      events,
      nextCursor: events.length > 0 ? encodeCursor(events.at(-1)!) : after ?? null,
      serverTime: new Date(),
    };
  },
};
