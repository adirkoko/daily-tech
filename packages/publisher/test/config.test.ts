import { describe, expect, it } from "vitest";

import { loadPublisherEnvironment } from "../src/index.js";

describe("publisher environment", () => {
  it("loads deployment settings without requiring AI credentials", () => {
    const config = loadPublisherEnvironment({
      TECH_BRIEFS_ROOT: "custom-briefs",
      PUBLISH_WEBHOOK_URL: "https://deploy.example/hooks/123",
      PUBLISH_WEBHOOK_TOKEN: "secret-token",
      PUBLISH_WEBHOOK_TIMEOUT_MS: "5000",
      PUBLISH_LEASE_DURATION_MS: "120000",
    });
    expect(config).toMatchObject({
      webhookUrl: "https://deploy.example/hooks/123",
      webhookToken: "secret-token",
      webhookTimeoutMs: 5_000,
      leaseDurationMs: 120_000,
    });
    expect(config.databaseFile).toMatch(/custom-briefs[\\/]meta[\\/]tech_briefs\.db$/u);
  });

  it("requires a valid HTTP deployment webhook", () => {
    expect(() => loadPublisherEnvironment({})).toThrow(/PUBLISH_WEBHOOK_URL/u);
    expect(() =>
      loadPublisherEnvironment({ PUBLISH_WEBHOOK_URL: "file:///deploy" }),
    ).toThrow(/http or https/u);
  });

  it("bounds timeouts and lease durations", () => {
    expect(() =>
      loadPublisherEnvironment({
        PUBLISH_WEBHOOK_URL: "https://deploy.example/hook",
        PUBLISH_WEBHOOK_TIMEOUT_MS: "100",
      }),
    ).toThrow(RangeError);
  });
});
