import { TooManyRequestsError } from './app-error.js';

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export class AttemptLimiter {
  private state: AttemptState = { failures: 0, windowStartedAt: 0, blockedUntil: 0 };

  constructor(
    private readonly prefix: string,
    private readonly defaultMaxAttempts = 5,
  ) {}

  assertAllowed(now = Date.now()): void {
    if (this.state.blockedUntil > now) {
      throw new TooManyRequestsError();
    }
    if (this.state.blockedUntil > 0) {
      this.reset();
    }
  }

  recordFailure(now = Date.now()): void {
    const windowMilliseconds =
      positiveInteger(`${this.prefix}_WINDOW_SECONDS`, 5 * 60) * 1000;
    if (this.state.windowStartedAt === 0 || now - this.state.windowStartedAt >= windowMilliseconds) {
      this.state = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
    }

    this.state.failures += 1;
    const maxAttempts = positiveInteger(`${this.prefix}_MAX_ATTEMPTS`, this.defaultMaxAttempts);
    if (this.state.failures >= maxAttempts) {
      this.state.blockedUntil =
        now + positiveInteger(`${this.prefix}_BLOCK_SECONDS`, 15 * 60) * 1000;
    }
  }

  reset(): void {
    this.state = { failures: 0, windowStartedAt: 0, blockedUntil: 0 };
  }
}
