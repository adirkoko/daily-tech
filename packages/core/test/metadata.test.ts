import { describe, expect, it } from "vitest";

import {
  BRIEF_STATUSES,
  DAY_INTENSITIES,
  isBriefStatus,
  isDayIntensity,
  validateDayMetadata,
} from "../src/index.js";
import { validMetadata } from "./fixtures.js";

describe("metadata values", () => {
  it("exports the documented allowed values", () => {
    expect(DAY_INTENSITIES).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "extreme",
    ]);
    expect(BRIEF_STATUSES).toEqual(["draft", "ready", "published", "failed"]);
  });

  it("narrows status and intensity values", () => {
    expect(isDayIntensity("extreme")).toBe(true);
    expect(isDayIntensity("busy")).toBe(false);
    expect(isBriefStatus("published")).toBe(true);
    expect(isBriefStatus("archived")).toBe(false);
  });
});

describe("validateDayMetadata", () => {
  it("accepts a complete metadata record", () => {
    expect(validateDayMetadata(validMetadata)).toEqual({
      valid: true,
      data: validMetadata,
      issues: [],
    });
  });

  it("reports all independently invalid fields in one pass", () => {
    const result = validateDayMetadata({
      ...validMetadata,
      date: "2026-02-30",
      summary: " ",
      significant_items: -1,
      day_intensity: "busy",
      status: "archived",
      source_count: 1.5,
      created_at: "yesterday",
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          "metadata.date",
          "metadata.summary",
          "metadata.significant_items",
          "metadata.day_intensity",
          "metadata.status",
          "metadata.source_count",
          "metadata.created_at",
        ]),
      );
    }
  });

  it("rejects missing fields, malformed lists, and duplicates", () => {
    const { topics: _topics, ...missingTopics } = validMetadata;
    const result = validateDayMetadata({
      ...missingTopics,
      companies: ["OpenAI", " openai "],
      developments: [""],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "required", path: "metadata.topics" }),
          expect.objectContaining({
            code: "duplicate_value",
            path: "metadata.companies[1]",
          }),
          expect.objectContaining({
            code: "invalid_value",
            path: "metadata.developments[0]",
          }),
        ]),
      );
    }
  });

  it("allows empty lists for a quiet day", () => {
    expect(
      validateDayMetadata({
        ...validMetadata,
        significant_items: 0,
        worth_watching_items: 0,
        day_intensity: "minimal",
        companies: [],
        topics: [],
        developments: [],
        source_count: 0,
      }).valid,
    ).toBe(true);
  });
});
