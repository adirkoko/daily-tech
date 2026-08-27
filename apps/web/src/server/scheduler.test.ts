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

describe("service scheduler configuration", () => {
  it("loads safe disabled defaults", () => {
    expect(loadSchedulerConfig({})).toEqual({
      enabled: false,
      generateAtMinute: 60,
      publishAtMinute: 420,
      pollIntervalMs: 30_000,
      leaseDurationMs: 21_600_000,
    });
  });

  it("parses configured daily times and bounds numeric settings", () => {
    expect(loadSchedulerConfig({
      SCHEDULER_ENABLED: "true",
      SCHEDULER_GENERATE_TIME: "02:15",
      SCHEDULER_PUBLISH_TIME: "08:45",
      SCHEDULER_POLL_SECONDS: "60",
      SCHEDULER_LEASE_HOURS: "8",
    })).toMatchObject({
      enabled: true,
      generateAtMinute: 135,
      publishAtMinute: 525,
      pollIntervalMs: 60_000,
      leaseDurationMs: 28_800_000,
    });
    expect(() => loadSchedulerConfig({ SCHEDULER_GENERATE_TIME: "25:00" })).toThrow(TypeError);
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

  it("runs each due daily action only once through the durable ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "daily-tech-scheduler-"));
    temporaryRoots.push(root);
    const databaseFile = join(root, "scheduler.db");
    const runGeneration = vi.fn(async () => undefined);
    const runPublication = vi.fn(async () => undefined);
    const scheduler = new ServiceScheduler(
      {
        enabled: true,
        generateAtMinute: 60,
        publishAtMinute: 420,
        pollIntervalMs: 30_000,
        leaseDurationMs: 21_600_000,
      },
      {},
      {
        openDatabase: async () => DailyTechDatabase.open({ filename: databaseFile }),
        runGeneration,
        runPublication,
      },
    );

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
