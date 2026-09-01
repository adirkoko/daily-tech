import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DailyTechDatabase } from "@daily-tech/db";

import {
  DatabaseFailureReporter,
  DatabasePipelineLogger,
} from "../src/index.js";
import { validArtifact } from "./fixtures.js";

describe("database operations adapters", () => {
  let database: DailyTechDatabase;

  beforeEach(() => {
    database = DailyTechDatabase.open({ filename: ":memory:" });
  });

  afterEach(() => {
    database.close();
  });

  it("stores pipeline events as structured operational logs, tagged with the stage", () => {
    const logger = new DatabasePipelineLogger(database);

    logger.log({
      runId: "run-1",
      date: "2026-08-27",
      type: "run_completed",
      stage: "persist",
      occurredAt: "2026-08-28T01:05:00.000Z",
      details: { sourceCount: 12 },
    });

    expect(database.operations.listLogs()).toEqual([
      expect.objectContaining({
        runId: "run-1",
        briefDate: "2026-08-27",
        eventType: "run_completed",
        level: "info",
        details: { stage: "persist", sourceCount: 12 },
      }),
    ]);
  });

  it("creates a System ticket and failed day record", async () => {
    const reporter = new DatabaseFailureReporter(database);

    await reporter.report({
      runId: "run-1",
      date: "2026-08-27",
      stage: "light_discovery",
      occurredAt: "2026-08-28T01:05:00.000Z",
      message: "Research provider unavailable",
    });

    expect(database.operations.listTickets()).toEqual([
      expect.objectContaining({
        category: "system",
        status: "open",
        body: expect.stringContaining("Research provider unavailable"),
      }),
    ]);
    expect(database.getDay("2026-08-27")).toEqual(
      expect.objectContaining({ status: "failed", significant_items: 0 }),
    );
  });

  it("never downgrades an already ready artifact after a rerun failure", async () => {
    database.saveDay(validArtifact.metadata);
    const reporter = new DatabaseFailureReporter(database);

    await reporter.report({
      runId: "rerun-1",
      date: "2026-08-27",
      stage: "light_discovery",
      occurredAt: "2026-08-28T02:00:00.000Z",
      message: "Rerun failed",
    });

    expect(database.getDay("2026-08-27")?.status).toBe("ready");
    expect(database.operations.listTickets()).toHaveLength(1);
  });
});
