import * as OTPAuth from 'otpauth';
import { describe, expect, it } from 'vitest';
import {
  createTotpSetup,
  TOTP_ISSUER,
  TOTP_LABEL,
  verifyTotp,
} from '../src/lib/totp.js';

describe('RFC 6238 TOTP helpers', () => {
  it('creates a 160-bit Base32 secret and a compatible otpauth URI', () => {
    const setup = createTotpSetup();
    const parsed = OTPAuth.URI.parse(setup.otpauthUrl);

    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(parsed).toBeInstanceOf(OTPAuth.TOTP);
    expect(parsed.issuer).toBe(TOTP_ISSUER);
    expect(parsed.label).toBe(TOTP_LABEL);
    expect(parsed.algorithm).toBe('SHA1');
    expect(parsed.digits).toBe(6);
    expect((parsed as OTPAuth.TOTP).period).toBe(30);
  });

  it('accepts only current or adjacent time-step codes', () => {
    const setup = createTotpSetup();
    const timestamp = 1_700_000_010_000;
    const generator = new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      label: TOTP_LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    });

    expect(verifyTotp(setup.secret, generator.generate({ timestamp }), timestamp)).toBe(true);
    expect(
      verifyTotp(setup.secret, generator.generate({ timestamp: timestamp - 30_000 }), timestamp),
    ).toBe(true);
    expect(
      verifyTotp(setup.secret, generator.generate({ timestamp: timestamp - 90_000 }), timestamp),
    ).toBe(false);
    expect(verifyTotp(setup.secret, 'not-six-digits', timestamp)).toBe(false);
  });
});
