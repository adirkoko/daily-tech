import type { DayMetadata } from "@daily-tech/core";
import { describe, expect, it } from "vitest";

import { calculateStatistics } from "./statistics.js";

function day(overrides: Partial<DayMetadata> = {}): DayMetadata {
  return {
    date: "2026-08-27",
    summary: "סיכום",
    significant_items: 2,
    worth_watching_items: 1,
    day_intensity: "medium",
    companies: ["OpenAI"],
    topics: ["בינה מלאכותית"],
    developments: ["א", "ב", "ג"],
    status: "published",
    source_count: 5,
    created_at: "2026-08-27T05:00:00.000Z",
    published_at: "2026-08-27T06:00:00.000Z",
    updated_at: null,
    ...overrides,
  };
}

describe("archive statistics", () => {
  it("returns zeros for an empty archive", () => {
    expect(calculateStatistics([])).toMatchObject({
      briefCount: 0,
      developmentCount: 0,
      averageSources: 0,
      activeDayCount: 0,
      topCompanies: [],
    });
  });

  it("aggregates counts, rankings, and intensity", () => {
    const result = calculateStatistics([
      day(),
      day({
        date: "2026-08-26",
        companies: ["OpenAI", "Nvidia"],
        topics: ["שבבים"],
        day_intensity: "high",
        source_count: 8,
      }),
    ]);

    expect(result.briefCount).toBe(2);
    expect(result.developmentCount).toBe(6);
    expect(result.averageSources).toBe(6.5);
    expect(result.activeDayCount).toBe(1);
    expect(result.topCompanies[0]).toEqual({ name: "OpenAI", count: 2 });
    expect(result.intensityCounts).toMatchObject({ medium: 1, high: 1 });
  });
});
