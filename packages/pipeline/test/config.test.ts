import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadPipelineEnvironment } from "../src/index.js";

describe("loadPipelineEnvironment", () => {
  it("loads required secrets and derives storage paths", () => {
    expect(
      loadPipelineEnvironment({
        AI_API_KEY: "ai-key",
        AI_MODEL: "model-name",
        TECH_BRIEFS_ROOT: "custom-content",
      }),
    ).toEqual({
      aiResearchTimeoutMs: 240_000,
      aiCompletionTimeoutMs: 120_000,
      aiRetry: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000 },
      aiApiKey: "ai-key",
      aiModel: "model-name",
      aiBaseUrl: "https://api.openai.com/v1",
      contentRoot: resolve("custom-content"),
      dailyStorageRoot: resolve("custom-content", "daily"),
      databaseFile: resolve("custom-content", "meta", "tech_briefs.db"),
    });
  });

  it("rejects missing secrets", () => {
    expect(() => loadPipelineEnvironment({})).toThrow(/AI_API_KEY/u);
  });
});

describe("AI environment controls", () => {
  const required = { AI_API_KEY: "key", AI_MODEL: "model" };
  const variables = [
    "AI_RESEARCH_TIMEOUT_MS", "AI_COMPLETION_TIMEOUT_MS", "AI_MAX_ATTEMPTS",
    "AI_RETRY_BASE_DELAY_MS", "AI_RETRY_MAX_DELAY_MS",
  ];

  it("loads explicit overrides, including disabling retries", () => {
    expect(loadPipelineEnvironment({
      ...required,
      AI_RESEARCH_TIMEOUT_MS: "300000",
      AI_COMPLETION_TIMEOUT_MS: "180000",
      AI_MAX_ATTEMPTS: "1",
      AI_RETRY_BASE_DELAY_MS: "2000",
      AI_RETRY_MAX_DELAY_MS: "16000",
    })).toMatchObject({
      aiResearchTimeoutMs: 300_000,
      aiCompletionTimeoutMs: 180_000,
      aiRetry: { maxAttempts: 1, baseDelayMs: 2_000, maxDelayMs: 16_000 },
    });
  });

  it.each(variables)("rejects invalid %s values", (name) => {
    for (const value of ["", " ", "0", "-1", "1.5", "NaN", "Infinity", "abc", "2147483648", "1e3"]) {
      expect(() => loadPipelineEnvironment({ ...required, [name]: value })).toThrow(name);
    }
  });

  it("rejects a maximum delay below the base delay", () => {
    expect(() => loadPipelineEnvironment({
      ...required, AI_RETRY_BASE_DELAY_MS: "9000",
    })).toThrow(/AI_RETRY_MAX_DELAY_MS/u);
  });
});
