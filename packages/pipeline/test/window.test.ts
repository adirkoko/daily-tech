import { describe, expect, it } from "vitest";

import { previousIsraelDayWindow } from "../src/index.js";

describe("previousIsraelDayWindow", () => {
  it("returns the previous local day during daylight saving time", () => {
    const window = previousIsraelDayWindow(new Date("2026-08-28T00:30:00.000Z"));

    expect(window.date).toBe("2026-08-27");
    expect(window.start.toISOString()).toBe("2026-08-26T21:00:00.000Z");
    expect(window.endExclusive.toISOString()).toBe("2026-08-27T21:00:00.000Z");
  });

  it("returns the previous local day during standard time", () => {
    const window = previousIsraelDayWindow(new Date("2026-01-15T01:00:00.000Z"));

    expect(window.date).toBe("2026-01-14");
    expect(window.start.toISOString()).toBe("2026-01-13T22:00:00.000Z");
    expect(window.endExclusive.toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });

  it("produces a 23-hour window when Israel enters daylight saving time", () => {
    const window = previousIsraelDayWindow(new Date("2026-03-28T01:00:00.000Z"));
    expect(window.date).toBe("2026-03-27");
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(23 * 60 * 60 * 1_000);
  });

  it("produces a 25-hour window when Israel returns to standard time", () => {
    const window = previousIsraelDayWindow(new Date("2026-10-26T01:00:00.000Z"));
    expect(window.date).toBe("2026-10-25");
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(25 * 60 * 60 * 1_000);
  });

  it("rejects invalid dates", () => {
    expect(() => previousIsraelDayWindow(new Date(Number.NaN))).toThrow(TypeError);
  });
});
