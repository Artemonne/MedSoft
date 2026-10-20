import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AdministratorSetupState,
  Prisma,
  RefreshSessionSubjectType,
} from '@prisma/client';
import QRCode from 'qrcode';
import { ConflictError, UnauthorizedError } from '../lib/app-error.js';
import { AttemptLimiter } from '../lib/attempt-limiter.js';
import { consumeBootstrapSecret, verifyBootstrapSecret } from '../lib/bootstrap-secret.js';
import { hashRefreshToken, issueTokenPair, verifyToken } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { createTotpSetup, verifyTotp } from '../lib/totp.js';
import type { AdminBootstrapStartInput, AdminLoginInput } from '../schemas/admin-auth.js';
import type { AdminAuthContext } from '../types/auth.js';
import { auditService } from './audit.js';

const ADMINISTRATOR_ID = 1;
const ADMINISTRATOR_SUBJECT = 'system-administrator:1';
const loginLimiter = new AttemptLimiter('ADMIN_LOGIN');
const bootstrapLimiter = new AttemptLimiter('ADMIN_BOOTSTRAP');

function hashesMatch(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first, 'utf8');
  const secondBuffer = Buffer.from(second, 'utf8');
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function publicAdministrator(administrator: {
  id: number;
  setupState: AdministratorSetupState;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: administrator.id,
    subjectType: 'admin' as const,
    setupState: administrator.setupState,
    createdAt: administrator.createdAt,
    updatedAt: administrator.updatedAt,
  };
}

async function issueAdministratorSession() {
  const issuedAt = new Date();
  const sessionId = randomUUID();
  const tokens = await issueTokenPair({
    subjectId: ADMINISTRATOR_SUBJECT,
    subjectType: 'admin',
    sessionId,
    issuedAt,
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.refreshSession.create({
      data: {
        id: sessionId,
        subjectType: RefreshSessionSubjectType.ADMIN,
        systemAdministratorId: ADMINISTRATOR_ID,
        tokenHash: hashRefreshToken(tokens.refreshToken),
        familyId: randomUUID(),
        issuedAt,
        expiresAt: tokens.refreshTokenExpiresAt,
      },
    });
    await auditService.record(transaction, {
      eventType: 'ADMIN_LOGIN_SUCCEEDED',
      actor: { type: 'admin', administratorId: ADMINISTRATOR_ID },
      message: 'Administrator login succeeded.',
      metadata: { authenticationKind: 'administrator' },
    });
  });

  return tokens;
}

export const adminAuthService = {
  async bootstrapStatus() {
    const administrator = await prisma.systemAdministrator.findUnique({
      where: { id: ADMINISTRATOR_ID },
      select: { setupState: true },
    });

    if (!administrator) {
      return { status: 'NOT_CONFIGURED' as const };
    }
    if (administrator.setupState === AdministratorSetupState.ACTIVE) {
      return { status: 'CONFIGURED' as const };
    }
    return { status: 'SETUP_IN_PROGRESS' as const };
  },

  async startBootstrap(input: AdminBootstrapStartInput, bootstrapSecret: string) {
    bootstrapLimiter.assertAllowed();
    const existing = await prisma.systemAdministrator.findUnique({
      where: { id: ADMINISTRATOR_ID },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError('Administrator bootstrap is no longer available.');
    }

    if (!(await verifyBootstrapSecret(bootstrapSecret))) {
      bootstrapLimiter.recordFailure();
      throw new UnauthorizedError('Invalid bootstrap credentials.');
    }

    const [passwordHash, totpSetup] = await Promise.all([
      hashPassword(input.password),
      Promise.resolve(createTotpSetup()),
    ]);
    const qrCodeDataUrl = await QRCode.toDataURL(totpSetup.otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
    });

    try {
      await prisma.systemAdministrator.create({
        data: {
          id: ADMINISTRATOR_ID,
          passwordHash,
          totpSecret: totpSetup.secret,
          setupState: AdministratorSetupState.TOTP_SETUP_REQUIRED,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Administrator bootstrap is no longer available.');
      }
      throw error;
    }

    bootstrapLimiter.reset();
    return {
      status: AdministratorSetupState.TOTP_SETUP_REQUIRED,
      manualSecret: totpSetup.secret,
      otpauthUrl: totpSetup.otpauthUrl,
      qrCodeDataUrl,
    };
  },

  async completeBootstrap(totpCode: string, bootstrapSecret: string) {
    bootstrapLimiter.assertAllowed();
    const administrator = await prisma.systemAdministrator.findUnique({
      where: { id: ADMINISTRATOR_ID },
      omit: { totpSecret: false },
    });

    if (!administrator || administrator.setupState === AdministratorSetupState.ACTIVE) {
      throw new ConflictError('Administrator bootstrap is no longer available.');
    }

    const bootstrapSecretMatches = await verifyBootstrapSecret(bootstrapSecret);
    const totpMatches = Boolean(
      administrator.totpSecret && verifyTotp(administrator.totpSecret, totpCode),
    );
    if (!bootstrapSecretMatches || !totpMatches) {
      bootstrapLimiter.recordFailure();
      throw new UnauthorizedError('Invalid bootstrap credentials.');
    }

    const activated = await prisma.systemAdministrator.updateMany({
      where: {
        id: ADMINISTRATOR_ID,
        setupState: AdministratorSetupState.TOTP_SETUP_REQUIRED,
      },
      data: { setupState: AdministratorSetupState.ACTIVE },
    });
    if (activated.count !== 1) {
      throw new ConflictError('Administrator bootstrap is no longer available.');
    }

    bootstrapLimiter.reset();
    await consumeBootstrapSecret();
    const activeAdministrator = await prisma.systemAdministrator.findUniqueOrThrow({
      where: { id: ADMINISTRATOR_ID },
    });
    return publicAdministrator(activeAdministrator);
  },

  async login(input: AdminLoginInput, requestId: string) {
    try {
      loginLimiter.assertAllowed();
    } catch (error) {
      await auditService.recordStandalone({
        eventType: 'LOGIN_FAILED',
        actor: { type: 'anonymous', requestId },
        message: 'Administrator login failed.',
        metadata: { authenticationKind: 'administrator', reason: 'rate-limited' },
      });
      throw error;
    }
    const administrator = await prisma.systemAdministrator.findUnique({
      where: { id: ADMINISTRATOR_ID },
      omit: { passwordHash: false, totpSecret: false },
    });

    if (
      !administrator ||
      administrator.setupState !== AdministratorSetupState.ACTIVE ||
      !administrator.passwordHash ||
      !administrator.totpSecret
    ) {
      await hashPassword(input.password);
      loginLimiter.recordFailure();
      await auditService.recordStandalone({
        eventType: 'LOGIN_FAILED',
        actor: { type: 'anonymous', requestId },
        message: 'Administrator login failed.',
        metadata: { authenticationKind: 'administrator' },
      });
      throw new UnauthorizedError('Invalid administrator credentials.');
    }

    const passwordMatches = await verifyPassword(input.password, administrator.passwordHash);
    const totpMatches = verifyTotp(administrator.totpSecret, input.totpCode);
    if (!passwordMatches || !totpMatches) {
      loginLimiter.recordFailure();
      await auditService.recordStandalone({
        eventType: 'LOGIN_FAILED',
        actor: { type: 'anonymous', requestId },
        message: 'Administrator login failed.',
        metadata: { authenticationKind: 'administrator' },
      });
      throw new UnauthorizedError('Invalid administrator credentials.');
    }

    loginLimiter.reset();
    const tokens = await issueAdministratorSession();
    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenTtlSeconds,
      refreshToken: tokens.refreshToken,
      administrator: publicAdministrator(administrator),
    };
  },

  async refresh(refreshToken: string) {
    const claims = await verifyToken(refreshToken, 'refresh', 'admin');
    if (claims.subjectId !== ADMINISTRATOR_SUBJECT) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const replacementId = randomUUID();
    const issuedAt = new Date();
    const replacementTokens = await issueTokenPair({
      subjectId: ADMINISTRATOR_SUBJECT,
      subjectType: 'admin',
      sessionId: replacementId,
      issuedAt,
    });
    const presentedHash = hashRefreshToken(refreshToken);

    const result = await prisma.$transaction(async (transaction) => {
      const session = await transaction.refreshSession.findUnique({
        where: { id: claims.sessionId },
        omit: { tokenHash: false },
        include: { systemAdministrator: true },
      });

      if (
        !session ||
        session.subjectType !== RefreshSessionSubjectType.ADMIN ||
        session.systemAdministratorId !== ADMINISTRATOR_ID ||
        !hashesMatch(session.tokenHash, presentedHash)
      ) {
        return { status: 'invalid' as const };
      }

      if (session.revokedAt || session.replacedById) {
        await transaction.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: issuedAt, revocationReason: 'reuse-detected' },
        });
        return { status: 'reused' as const };
      }

      if (
        session.expiresAt <= issuedAt ||
        session.systemAdministrator?.setupState !== AdministratorSetupState.ACTIVE
      ) {
        await transaction.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: issuedAt, revocationReason: 'subject-unavailable' },
        });
        return { status: 'invalid' as const };
      }

      const claimed = await transaction.refreshSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          replacedById: null,
          expiresAt: { gt: issuedAt },
        },
        data: { revokedAt: issuedAt, revocationReason: 'rotated' },
      });
      if (claimed.count !== 1) {
        await transaction.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: issuedAt, revocationReason: 'reuse-detected' },
        });
        return { status: 'reused' as const };
      }

      await transaction.refreshSession.create({
        data: {
          id: replacementId,
          subjectType: RefreshSessionSubjectType.ADMIN,
          systemAdministratorId: ADMINISTRATOR_ID,
          tokenHash: hashRefreshToken(replacementTokens.refreshToken),
          familyId: session.familyId,
          issuedAt,
          expiresAt: replacementTokens.refreshTokenExpiresAt,
        },
      });
      await transaction.refreshSession.update({
        where: { id: session.id },
        data: { replacedById: replacementId },
      });
      return { status: 'rotated' as const };
    });

    if (result.status !== 'rotated') {
      throw new UnauthorizedError(
        result.status === 'reused' ? 'Refresh token reuse detected.' : 'Invalid refresh token.',
      );
    }

    return {
      accessToken: replacementTokens.accessToken,
      accessTokenExpiresIn: replacementTokens.accessTokenTtlSeconds,
      refreshToken: replacementTokens.refreshToken,
    };
  },

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return;
    }

    try {
      const claims = await verifyToken(refreshToken, 'refresh', 'admin');
      if (claims.subjectId !== ADMINISTRATOR_SUBJECT) {
        return;
      }
      const session = await prisma.refreshSession.findUnique({
        where: { id: claims.sessionId },
        omit: { tokenHash: false },
      });
      if (
        session?.subjectType === RefreshSessionSubjectType.ADMIN &&
        hashesMatch(session.tokenHash, hashRefreshToken(refreshToken))
      ) {
        await prisma.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'logout' },
        });
      }
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
    }
  },

  async authenticateAccessToken(accessToken: string): Promise<AdminAuthContext> {
    const claims = await verifyToken(accessToken, 'access', 'admin');
    if (claims.subjectId !== ADMINISTRATOR_SUBJECT) {
      throw new UnauthorizedError('Invalid administrator token.');
    }
    const session = await prisma.refreshSession.findUnique({
      where: { id: claims.sessionId },
      include: { systemAdministrator: true },
    });
    if (
      !session ||
      session.subjectType !== RefreshSessionSubjectType.ADMIN ||
      session.systemAdministratorId !== ADMINISTRATOR_ID ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.systemAdministrator?.setupState !== AdministratorSetupState.ACTIVE
    ) {
      throw new UnauthorizedError('Administrator session is not active.');
    }
    return { subjectType: 'admin', administratorId: 1, sessionId: session.id };
  },

  async currentAdministrator() {
    const administrator = await prisma.systemAdministrator.findUnique({
      where: { id: ADMINISTRATOR_ID },
    });
    if (!administrator || administrator.setupState !== AdministratorSetupState.ACTIVE) {
      throw new UnauthorizedError('Administrator is not active.');
    }
    return publicAdministrator(administrator);
  },
};
