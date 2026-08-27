import { describe, expect, it } from "vitest";

import {
  expectedBriefRelativePath,
  isCalendarDate,
  isUtcTimestamp,
} from "../src/index.js";

describe("date utilities", () => {
  it("accepts real ISO calendar dates, including leap days", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-08-27")).toBe(true);
  });

  it("rejects impossible or loosely formatted dates", () => {
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-8-27")).toBe(false);
  });

  it("builds the documented storage path", () => {
    expect(expectedBriefRelativePath("2026-08-27")).toBe(
      "2026/august/2026-08-27/2026-08-27-tech_briefs.md",
    );
    expect(expectedBriefRelativePath("not-a-date")).toBeNull();
  });

  it("requires UTC ISO timestamps", () => {
    expect(isUtcTimestamp("2026-08-28T01:42:10.000Z")).toBe(true);
    expect(isUtcTimestamp("2026-08-28T01:42:10.1Z")).toBe(true);
    expect(isUtcTimestamp("2026-08-28T04:42:10+03:00")).toBe(false);
    expect(isUtcTimestamp("2026-02-30T01:42:10.000Z")).toBe(false);
    expect(isUtcTimestamp("2026-08-28T25:00:00.000Z")).toBe(false);
    expect(isUtcTimestamp("2026-08-28")).toBe(false);
  });
});
