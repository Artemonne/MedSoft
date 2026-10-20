import * as OTPAuth from 'otpauth';

export const TOTP_ISSUER = 'MedSoft';
export const TOTP_LABEL = 'System Administrator 370553';

function totpFromSecret(secret: OTPAuth.Secret) {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: TOTP_LABEL,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

export function createTotpSetup() {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = totpFromSecret(secret);
  return {
    secret: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

export function verifyTotp(secret: string, token: string, timestamp = Date.now()): boolean {
  if (!/^\d{6}$/.test(token)) {
    return false;
  }

  try {
    const totp = totpFromSecret(OTPAuth.Secret.fromBase32(secret));
    return totp.validate({ token, timestamp, window: 1 }) !== null;
  } catch {
    return false;
  }
}
