import { describe, expect, it } from "vitest";

import { DEFAULT_PIPELINE_SETTINGS, validatePipelineSettings } from "../src/index.js";

function settings(overrides: Partial<typeof DEFAULT_PIPELINE_SETTINGS> = {}) {
  return { ...DEFAULT_PIPELINE_SETTINGS, ...overrides };
}

describe("validatePipelineSettings", () => {
  it("accepts the defaults", () => {
    const result = validatePipelineSettings(DEFAULT_PIPELINE_SETTINGS);
    expect(result.valid).toBe(true);
  });

  it("accepts a fully configured settings object", () => {
    const result = validatePipelineSettings(
      settings({
        adminKeywords: ["OpenAI", "Robotics"],
        maximumStories: 12,
        gapDiscoveryEnabled: false,
        adminKeywordsResearchEnabled: false,
        editorialInstructions: "Give more weight to developer tools this week.",
        generateTime: "02:15",
        publishTime: "08:30",
        updatedAt: "2026-08-29T05:00:00.000Z",
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a non-object value", () => {
    expect(validatePipelineSettings(null).valid).toBe(false);
    expect(validatePipelineSettings("nope").valid).toBe(false);
  });

  it("rejects duplicate admin keywords case-insensitively", () => {
    const result = validatePipelineSettings(settings({ adminKeywords: ["OpenAI", "openai"] }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((issue) => issue.code === "duplicate_value")).toBe(true);
    }
  });

  it("rejects an empty or blank keyword", () => {
    const result = validatePipelineSettings(settings({ adminKeywords: ["  "] }));
    expect(result.valid).toBe(false);
  });

  it("accepts up to 50 admin keywords and rejects larger lists", () => {
    const keywords = Array.from({ length: 50 }, (_, index) => `topic-${index + 1}`);
    expect(validatePipelineSettings(settings({ adminKeywords: keywords })).valid).toBe(true);
    expect(
      validatePipelineSettings(settings({ adminKeywords: [...keywords, "topic-51"] })).valid,
    ).toBe(false);
  });

  it("rejects maximumStories outside the allowed range", () => {
    expect(validatePipelineSettings(settings({ maximumStories: 0 })).valid).toBe(false);
    expect(validatePipelineSettings(settings({ maximumStories: 21 })).valid).toBe(false);
    expect(validatePipelineSettings(settings({ maximumStories: 8.5 })).valid).toBe(false);
  });

  it("rejects malformed clock times", () => {
    expect(validatePipelineSettings(settings({ generateTime: "1:00" })).valid).toBe(false);
    expect(validatePipelineSettings(settings({ publishTime: "24:00" })).valid).toBe(false);
  });

  it("rejects editorial instructions over the length limit", () => {
    const result = validatePipelineSettings(
      settings({ editorialInstructions: "x".repeat(4_001) }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a non-boolean toggle", () => {
    const result = validatePipelineSettings(settings({ gapDiscoveryEnabled: "yes" as unknown as boolean }));
    expect(result.valid).toBe(false);
  });
});
