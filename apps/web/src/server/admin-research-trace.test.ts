import type { OperationalLog } from "@daily-tech/db";
import { describe, expect, it } from "vitest";

import { latestResearchTrace } from "./admin-research-trace.js";

function log(overrides: Partial<OperationalLog>): OperationalLog {
  return {
    id: 1,
    runId: "run-new",
    briefDate: "2026-08-27",
    eventType: "research_stage_completed",
    level: "info",
    message: null,
    details: {},
    occurredAt: "2026-08-28T01:00:00.000Z",
    ...overrides,
  };
}

describe("latestResearchTrace", () => {
  it("uses only the newest run and maps discovery contribution details", () => {
    const trace = latestResearchTrace([
      log({
        id: 3,
        details: {
          stage: "gap_discovery",
          state: "completed",
          foundCount: 3,
          contributedCount: 1,
          filteredCount: 1,
          rejectedCount: 1,
          topics: ["Agents", "Cloud"],
          contributedTitles: ["נמצא פער"],
          filteredTitles: ["כפילות"],
          filteredReasons: ["duplicate"],
          rejectedTitles: ["מקור שבור"],
          rejectedReasons: ["No eligible citation remained."],
        },
      }),
      log({ id: 2, details: { stage: "light_discovery", state: "completed", foundCount: 4 } }),
      log({ id: 1, runId: "run-old", details: { stage: "light_discovery", foundCount: 99 } }),
    ]);

    expect(trace).toMatchObject({
      runId: "run-new",
      stages: [
        { key: "light_discovery", foundCount: 4 },
        {
          key: "gap_discovery",
          foundCount: 3,
          contributedCount: 1,
          filteredCount: 1,
          rejectedCount: 1,
          topics: ["Agents", "Cloud"],
          filteredTitles: ["כפילות", "מקור שבור"],
          filteredReasons: ["duplicate", "No eligible citation remained."],
        },
      ],
    });
  });

  it("does not show an older trace when the latest run failed before research output", () => {
    const trace = latestResearchTrace([
      log({ id: 3, runId: "run-new", eventType: "run_failed", details: { stage: "light_discovery" } }),
      log({ id: 2, runId: "run-old", details: { stage: "light_discovery", foundCount: 8 } }),
    ]);

    expect(trace).toMatchObject({ runId: "run-new", stages: [] });
  });
});
