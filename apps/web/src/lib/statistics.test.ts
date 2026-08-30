import type { DayMetadata } from "@daily-tech/core";
import { describe, expect, it } from "vitest";

import {
  calculateStatistics,
  parseStatisticsRange,
  selectTrailingDays,
} from "./statistics.js";

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
    expect(result.topCompanies[0]).toEqual({ name: "OpenAI", count: 2 });
    expect(result.intensityCounts).toMatchObject({ medium: 1, high: 1 });
  });

  it("returns ten rankings and counts a value at most once per day", () => {
    const result = calculateStatistics([
      day({ companies: ["OpenAI", "OpenAI"] }),
      ...Array.from({ length: 9 }, (_, index) => day({
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        companies: [`Company ${index}`],
      })),
    ]);

    expect(result.topCompanies).toHaveLength(10);
    expect(result.topCompanies.find((item) => item.name === "OpenAI")?.count).toBe(1);
  });
});

describe("statistics ranges", () => {
  it("defaults invalid or missing ranges to the trailing month", () => {
    expect(parseStatisticsRange(null)).toBe("month");
    expect(parseStatisticsRange("quarter")).toBe("month");
    expect(parseStatisticsRange("year")).toBe("year");
  });

  it("selects 30 complete dates before the current Israel date", () => {
    const selected = selectTrailingDays([
      day({ date: "2026-07-30" }),
      day({ date: "2026-07-31" }),
      day({ date: "2026-08-29" }),
      day({ date: "2026-08-30" }),
    ], "2026-08-30", "month");

    expect(selected.map((item) => item.date)).toEqual(["2026-07-31", "2026-08-29"]);
  });

  it("uses a rolling 365-day window instead of a calendar year", () => {
    const selected = selectTrailingDays([
      day({ date: "2025-08-29" }),
      day({ date: "2025-08-30" }),
      day({ date: "2026-08-29" }),
    ], "2026-08-30", "year");

    expect(selected.map((item) => item.date)).toEqual(["2025-08-30", "2026-08-29"]);
  });
});
