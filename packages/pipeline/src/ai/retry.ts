import { AiProviderError, InvalidAiResponseError } from "./contracts.js";

export interface AiRetryOptions {
  /** Total attempts, including the first — not additional retries. */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly signal?: AbortSignal;
  /** Injectable for tests; defaults to a real timer. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 8_000;

/**
 * Retries a single AI-provider call across the transient failures actually
 * observed in production: HTTP 429/5xx, and a malformed-but-200 envelope
 * (missing web-search call, missing output text, missing machine-readable
 * citations — occasional provider flakiness, not a schema or prompt bug).
 *
 * Deliberately narrow: everything else — a non-retryable HTTP status (4xx other
 * than 429), or a validation failure raised downstream after the client already
 * returned successfully (citation-boundary checks, story rejection, schema
 * mismatches) — is a real result, not a transport hiccup, and is never retried
 * here. Retrying those would waste provider spend and mask real bugs.
 */
export async function withAiRetry<T>(
  operation: () => Promise<T>,
  options: AiRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < maxAttempts
        && options.signal?.aborted !== true
        && isRetryableAiError(error);
      if (!canRetry) throw error;
      const suggested = error instanceof AiProviderError ? error.retryAfterMs : null;
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(suggested ?? withJitter(backoff), options.signal);
    }
  }
}

function isRetryableAiError(error: unknown): boolean {
  if (error instanceof AiProviderError) {
    return error.status === 429 || (error.status !== null && error.status >= 500);
  }
  return error instanceof InvalidAiResponseError;
}

function withJitter(delayMs: number): number {
  return Math.round(delayMs * (0.8 + Math.random() * 0.4));
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
