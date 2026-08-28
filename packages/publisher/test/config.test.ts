import { describe, expect, it } from "vitest";

import { loadPublisherEnvironment } from "../src/index.js";

describe("publisher environment", () => {
  it("loads storage and lease settings without requiring AI credentials", () => {
    const config = loadPublisherEnvironment({
      TECH_BRIEFS_ROOT: "custom-briefs",
      PUBLISH_LEASE_DURATION_MS: "120000",
    });
    expect(config).toMatchObject({
      leaseDurationMs: 120_000,
    });
    expect(config.databaseFile).toMatch(/custom-briefs[\\/]meta[\\/]tech_briefs\.db$/u);
  });

  it("bounds lease durations", () => {
    expect(() =>
      loadPublisherEnvironment({
        PUBLISH_LEASE_DURATION_MS: "100",
      }),
    ).toThrow(RangeError);
  });
});
