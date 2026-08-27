import { describe, expect, it } from "vitest";

import { previousIsraelCalendarDate } from "../src/index.js";

describe("publication target date", () => {
  it("uses the previous Israel day during daylight saving time", () => {
    expect(previousIsraelCalendarDate(new Date("2026-08-28T04:00:00.000Z"))).toBe(
      "2026-08-27",
    );
  });

  it("handles the DST transitions without subtracting a fixed number of hours", () => {
    expect(previousIsraelCalendarDate(new Date("2026-03-27T04:00:00.000Z"))).toBe(
      "2026-03-26",
    );
    expect(previousIsraelCalendarDate(new Date("2026-10-25T05:00:00.000Z"))).toBe(
      "2026-10-24",
    );
  });

  it("rejects an invalid clock value", () => {
    expect(() => previousIsraelCalendarDate(new Date(Number.NaN))).toThrow(TypeError);
  });
});
