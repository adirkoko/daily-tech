import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { israelTime, loadSchedulerConfig, ServiceScheduler } from "./scheduler.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDatabaseFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "daily-tech-scheduler-"));
  temporaryRoots.push(root);
  return join(root, "scheduler.db");
}

describe("service scheduler configuration", () => {
  it("loads safe disabled defaults", () => {
    expect(loadSchedulerConfig({})).toEqual({
      enabled: false,
      pollIntervalMs: 30_000,
      leaseDurationMs: 21_600_000,
    });
  });

  it("bounds numeric settings from the environment", () => {
    expect(loadSchedulerConfig({
      SCHEDULER_ENABLED: "true",
      SCHEDULER_POLL_SECONDS: "60",
      SCHEDULER_LEASE_HOURS: "8",
    })).toMatchObject({
      enabled: true,
      pollIntervalMs: 60_000,
      leaseDurationMs: 28_800_000,
    });
    expect(() => loadSchedulerConfig({ SCHEDULER_POLL_SECONDS: "1" })).toThrow(RangeError);
  });

  it("resolves Israel wall-clock time across daylight saving time", () => {
    expect(israelTime(new Date("2026-01-15T23:30:00.000Z"))).toEqual({
      date: "2026-01-16",
      minuteOfDay: 90,
    });
    expect(israelTime(new Date("2026-08-28T04:00:00.000Z"))).toEqual({
      date: "2026-08-28",
      minuteOfDay: 420,
    });
  });

  it("reads the generate/publish times from pipeline_settings, not fixed config", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const runGeneration = vi.fn(async () => undefined);
    const runPublication = vi.fn(async () => undefined);
    const scheduler = new ServiceScheduler(
      { enabled: true, pollIntervalMs: 30_000, leaseDurationMs: 21_600_000 },
      {},
      {
        openDatabase: async () => DailyTechDatabase.open({ filename: databaseFile }),
        runGeneration,
        runPublication,
      },
    );

    const database = DailyTechDatabase.open({ filename: databaseFile });
    database.pipelineSettings.save({
      adminKeywords: [],
      maximumStories: 8,
      gapDiscoveryEnabled: true,
      adminKeywordsResearchEnabled: true,
      editorialInstructions: "",
      generateTime: "03:00",
      publishTime: "09:00",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });
    database.close();

    // 03:00 Israel — below the saved 03:00/09:00 times is not reached yet at 02:00.
    await scheduler.tick(new Date("2026-08-27T23:00:00.000Z")); // 02:00 Israel
    expect(runGeneration).not.toHaveBeenCalled();

    await scheduler.tick(new Date("2026-08-28T00:00:00.000Z")); // 03:00 Israel
    expect(runGeneration).toHaveBeenCalledOnce();
    expect(runPublication).not.toHaveBeenCalled();

    await scheduler.tick(new Date("2026-08-28T06:00:00.000Z")); // 09:00 Israel
    expect(runPublication).toHaveBeenCalledOnce();
  });

  it("runs each due daily action only once through the durable ledger", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const runGeneration = vi.fn(async () => undefined);
    const runPublication = vi.fn(async () => undefined);
    const scheduler = new ServiceScheduler(
      { enabled: true, pollIntervalMs: 30_000, leaseDurationMs: 21_600_000 },
      {},
      {
        openDatabase: async () => DailyTechDatabase.open({ filename: databaseFile }),
        runGeneration,
        runPublication,
      },
    );

    // The default pipeline_settings row (seeded by migration) generates at 01:00 and
    // publishes at 07:00 Israel time — no explicit save needed for this test.
    const generationTime = new Date("2026-08-28T01:00:00.000Z"); // 04:00 Israel
    await scheduler.tick(generationTime);
    await scheduler.tick(generationTime);
    expect(runGeneration).toHaveBeenCalledOnce();
    expect(runPublication).not.toHaveBeenCalled();

    const publicationTime = new Date("2026-08-28T04:00:00.000Z"); // 07:00 Israel
    await scheduler.tick(publicationTime);
    await scheduler.tick(publicationTime);
    expect(runGeneration).toHaveBeenCalledOnce();
    expect(runPublication).toHaveBeenCalledOnce();
    expect(scheduler.snapshot).toMatchObject({ runningJob: null, lastError: null });
  });
});
