import { createHash, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import {
  getAuthConfiguration,
  getJwtSigningKey,
  getJwtVerificationKey,
} from './auth-config.js';
import { UnauthorizedError } from './app-error.js';

export type TokenType = 'access' | 'refresh';
export type TokenSubjectType = 'user' | 'admin';

export interface VerifiedToken {
  subjectId: string;
  subjectType: TokenSubjectType;
  sessionId: string;
  tokenType: TokenType;
}

interface TokenPairInput {
  subjectId: string;
  subjectType: TokenSubjectType;
  sessionId: string;
  issuedAt: Date;
}

async function signToken(
  input: TokenPairInput,
  tokenType: TokenType,
  ttlSeconds: number,
): Promise<string> {
  const configuration = getAuthConfiguration();
  const issuedAt = Math.floor(input.issuedAt.getTime() / 1000);
  return new SignJWT({
    tokenType,
    subjectType: input.subjectType,
    sessionId: input.sessionId,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(configuration.issuer)
    .setAudience(configuration.audience)
    .setSubject(input.subjectId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(await getJwtSigningKey());
}

export async function issueTokenPair(input: TokenPairInput) {
  const configuration = getAuthConfiguration();
  const [accessToken, refreshToken] = await Promise.all([
    signToken(input, 'access', configuration.accessTokenTtlSeconds),
    signToken(input, 'refresh', configuration.refreshTokenTtlSeconds),
  ]);

  return {
    accessToken,
    refreshToken,
    accessTokenTtlSeconds: configuration.accessTokenTtlSeconds,
    refreshTokenExpiresAt: new Date(
      input.issuedAt.getTime() + configuration.refreshTokenTtlSeconds * 1000,
    ),
  };
}

function isStringClaim(
  payload: JWTPayload,
  name: string,
): payload is JWTPayload & Record<string, string> {
  return typeof payload[name] === 'string' && payload[name].length > 0;
}

export async function verifyToken(
  token: string,
  expectedType: TokenType,
  expectedSubjectType: TokenSubjectType,
): Promise<VerifiedToken> {
  try {
    const configuration = getAuthConfiguration();
    const { payload } = await jwtVerify(token, await getJwtVerificationKey(), {
      algorithms: ['EdDSA'],
      issuer: configuration.issuer,
      audience: configuration.audience,
      typ: 'JWT',
    });

    if (
      payload.tokenType !== expectedType ||
      payload.subjectType !== expectedSubjectType ||
      !isStringClaim(payload, 'sub') ||
      !isStringClaim(payload, 'sessionId')
    ) {
      throw new UnauthorizedError('Invalid token.');
    }

    return {
      subjectId: payload.sub as string,
      subjectType: expectedSubjectType,
      sessionId: payload.sessionId as string,
      tokenType: expectedType,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw new UnauthorizedError('Invalid or expired token.');
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}
