import { describe, expect, it, vi } from "vitest";

import { AiProviderError, InvalidAiResponseError, withAiRetry } from "../src/index.js";

function noopSleep(): ReturnType<typeof vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>> {
  return vi.fn(async () => undefined);
}

describe("withAiRetry", () => {
  it("retries a 429 and returns the eventual success", async () => {
    const sleep = noopSleep();
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new AiProviderError("rate limited", 429);
      return "ok";
    });

    await expect(withAiRetry(operation, { sleep })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("retries a 5xx server error", async () => {
    const sleep = noopSleep();
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new AiProviderError("upstream error", 503);
      return "ok";
    });

    await expect(withAiRetry(operation, { sleep })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries a malformed-but-200 envelope (e.g. missing citations)", async () => {
    const sleep = noopSleep();
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        throw new InvalidAiResponseError("AI web-research response contained no machine-readable citations.");
      }
      return "ok";
    });

    await expect(withAiRetry(operation, { sleep })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("never retries a non-retryable HTTP status — a real bug, not a transient failure", async () => {
    const sleep = noopSleep();
    const operation = vi.fn(async () => {
      throw new AiProviderError("bad request", 400);
    });

    await expect(withAiRetry(operation, { sleep })).rejects.toMatchObject({ status: 400 });
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never retries an error unrelated to AI transport — never masks a real downstream bug", async () => {
    const sleep = noopSleep();
    const operation = vi.fn(async () => {
      throw new TypeError("citation not present in provider list");
    });

    await expect(withAiRetry(operation, { sleep })).rejects.toThrow(TypeError);
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    const sleep = noopSleep();
    const operation = vi.fn(async () => {
      throw new AiProviderError("still rate limited", 429);
    });

    await expect(withAiRetry(operation, { sleep, maxAttempts: 3 })).rejects.toMatchObject({ status: 429 });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("honors the provider's own retryAfterMs instead of computed backoff", async () => {
    const sleep = noopSleep();
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new AiProviderError("rate limited", 429, undefined, 4_107);
      return "ok";
    });

    await withAiRetry(operation, { sleep, baseDelayMs: 1_000 });

    expect(sleep).toHaveBeenCalledWith(4_107, undefined);
  });

  it("stops retrying immediately once the caller's signal is already aborted", async () => {
    const sleep = noopSleep();
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => {
      throw new AiProviderError("rate limited", 429);
    });

    await expect(
      withAiRetry(operation, { sleep, signal: controller.signal }),
    ).rejects.toMatchObject({ status: 429 });
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("succeeds without any retry when the first attempt works", async () => {
    const sleep = noopSleep();
    const operation = vi.fn(async () => "ok");

    await expect(withAiRetry(operation, { sleep })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
