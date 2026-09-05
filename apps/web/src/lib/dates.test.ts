import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  buildCalendar,
  formatHebrewDate,
  isIsraelTimeAtOrAfter,
  toIsraelDate,
} from "./dates.js";

describe("date utilities", () => {
  it("uses the Israel calendar date instead of the server timezone", () => {
    expect(toIsraelDate(new Date("2026-03-26T21:30:00Z"))).toBe("2026-03-26");
    expect(toIsraelDate(new Date("2026-03-26T22:30:00Z"))).toBe("2026-03-27");
  });

  it("adds calendar days across leap years", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("compares public schedule times in Israel across daylight-saving changes", () => {
    expect(isIsraelTimeAtOrAfter("07:00", new Date("2026-09-06T03:59:00Z"))).toBe(false);
    expect(isIsraelTimeAtOrAfter("07:00", new Date("2026-09-06T04:00:00Z"))).toBe(true);
    expect(isIsraelTimeAtOrAfter("07:00", new Date("2026-01-06T04:59:00Z"))).toBe(false);
    expect(isIsraelTimeAtOrAfter("07:00", new Date("2026-01-06T05:00:00Z"))).toBe(true);
  });

  it("builds a stable six-week Sunday-first calendar", () => {
    const cells = buildCalendar("2026-08");
    expect(cells).toHaveLength(42);
    expect(cells[0]?.date).toBe("2026-07-26");
    expect(cells[6]?.date).toBe("2026-08-01");
    expect(cells.at(-1)?.date).toBe("2026-09-05");
  });

  it("formats public dates in Hebrew", () => {
    expect(formatHebrewDate("2026-08-27")).toContain("אוגוסט");
  });
});
