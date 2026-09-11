/** Transport metadata stays machine-readable; components still receive a normal Error message. */
export class GameApiError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: { status?: number; code?: string; retryAfter?: string | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "GameApiError";
    this.status = options.status;
    this.code = options.code;
    const value = options.retryAfter?.trim();
    const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
    const delay = seconds !== undefined ? seconds * 1000 : value ? Date.parse(value) - Date.now() : NaN;
    this.retryAfterMs = Number.isFinite(delay) ? Math.max(0, delay) : undefined;
  }

  get retryable(): boolean {
    return this.status === undefined || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}
