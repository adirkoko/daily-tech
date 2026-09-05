import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DayMetadata } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminGenerationService,
  PreservingDayMetadataStore,
  PreservingGenerationFailureReporter,
} from "./admin-generation.js";
import { assertBriefMutationAllowed } from "./admin-content.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDatabaseFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "daily-tech-admin-generation-"));
  temporaryRoots.push(root);
  return join(root, "daily-tech.db");
}

function metadata(overrides: Partial<DayMetadata> = {}): DayMetadata {
  return {
    date: "2026-08-27",
    summary: "תקציר קודם",
    significant_items: 1,
    worth_watching_items: 0,
    day_intensity: "low",
    companies: ["Example"],
    topics: ["AI"],
    developments: ["התפתחות"],
    status: "failed",
    source_count: 1,
    created_at: "2026-08-28T01:00:00.000Z",
    published_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("AdminGenerationService", () => {
  it("allows retry only for failed briefs and prevents concurrent generation", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const seeded = DailyTechDatabase.open({ filename: databaseFile });
    seeded.saveDay(metadata());
    seeded.close();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const runGeneration = vi.fn(() => blocked);
    const service = new AdminGenerationService({}, {
      openDatabase: async () => DailyTechDatabase.open({ filename: databaseFile }),
      runGeneration,
      validateConfiguration: () => undefined,
      now: () => new Date("2026-08-28T02:00:00.000Z"),
      createLeaseOwner: () => "admin-test",
      leaseDurationMs: 60_000,
    });

    await expect(service.start({ date: "2026-08-27", mode: "retry" })).resolves.toMatchObject({
      outcome: "started",
      attemptCount: 1,
    });
    await expect(service.start({ date: "2026-08-27", mode: "retry" })).resolves.toEqual({
      outcome: "busy",
    });
    expect(runGeneration).toHaveBeenCalledOnce();

    release();
    await service.waitForIdle();
    const result = DailyTechDatabase.open({ filename: databaseFile });
    expect(result.operations.getScheduledJob("generate", "2026-08-27")).toMatchObject({
      state: "succeeded",
      attemptCount: 1,
    });
    result.close();
  });

  it("rejects retry for a non-failed brief without creating a job", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const seeded = DailyTechDatabase.open({ filename: databaseFile });
    seeded.saveDay(metadata({ status: "ready" }));
    seeded.close();
    const service = new AdminGenerationService({}, {
      openDatabase: async () => DailyTechDatabase.open({ filename: databaseFile }),
      runGeneration: vi.fn(async () => undefined),
      validateConfiguration: () => undefined,
      leaseDurationMs: 60_000,
    });

    await expect(service.start({ date: "2026-08-27", mode: "retry" })).resolves.toEqual({
      outcome: "invalid_state",
      status: "ready",
    });
    const result = DailyTechDatabase.open({ filename: databaseFile });
    expect(result.operations.getScheduledJob("generate", "2026-08-27")).toBeNull();
    result.close();
  });

  it("recovers a failed scheduled publication after a successful retry", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const seeded = DailyTechDatabase.open({ filename: databaseFile });
    seeded.saveDay(metadata());
    seeded.operations.beginScheduledJob({
      jobName: "publish",
      targetDate: "2026-08-27",
      leaseOwner: "scheduler-publish",
      occurredAt: "2026-08-28T04:00:00.000Z",
      leaseExpiresAt: "2026-08-28T10:00:00.000Z",
    });
    seeded.operations.failScheduledJob(
      "publish",
      "2026-08-27",
      "scheduler-publish",
      "2026-08-28T04:01:00.000Z",
      "Brief was not ready.",
    );
    seeded.close();

    const runGeneration = vi.fn(async () => {
      const database = DailyTechDatabase.open({ filename: databaseFile });
      const existing = database.getDay("2026-08-27")!;
      database.saveDay({ ...existing, status: "ready", updated_at: "2026-08-28T05:00:00.000Z" });
      database.close();
    });
    const runPublication = vi.fn(async () => {
      const database = DailyTechDatabase.open({ filename: databaseFile });
      expect(database.publishReadyDay(
        "2026-08-27",
        "2026-08-28T05:00:00.000Z",
      ).outcome).toBe("published");
      database.close();
    });
    const service = new AdminGenerationService({}, {
      openDatabase: async () => DailyTechDatabase.open({ filename: databaseFile }),
      runGeneration,
      runPublication,
      validateConfiguration: () => undefined,
      now: () => new Date("2026-08-28T05:00:00.000Z"),
      createLeaseOwner: () => "admin-recovery",
      leaseDurationMs: 60_000,
    });

    await expect(service.start({ date: "2026-08-27", mode: "retry" })).resolves.toMatchObject({
      outcome: "started",
    });
    await service.waitForIdle();

    expect(runPublication).toHaveBeenCalledWith({}, [
      "--date=2026-08-27",
      "--run-at=2026-08-28T05:00:00.000Z",
    ]);
    const result = DailyTechDatabase.open({ filename: databaseFile });
    expect(result.getDay("2026-08-27")?.status).toBe("published");
    expect(result.operations.getScheduledJob("publish", "2026-08-27")).toMatchObject({
      state: "succeeded",
      attemptCount: 2,
    });
    result.close();
  });
});

describe("admin content mutation guard", () => {
  it("blocks edits during an active generation lease and permits them after expiry", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const database = DailyTechDatabase.open({ filename: databaseFile });
    database.operations.beginScheduledJob({
      jobName: "generate",
      targetDate: "2026-08-27",
      leaseOwner: "generation",
      occurredAt: "2026-08-28T01:00:00.000Z",
      leaseExpiresAt: "2026-08-28T02:00:00.000Z",
    });

    expect(() => assertBriefMutationAllowed(
      database,
      "2026-08-27",
      new Date("2026-08-28T01:30:00.000Z"),
    )).toThrow("לא ניתן לשמור או למחוק");
    expect(() => assertBriefMutationAllowed(
      database,
      "2026-08-27",
      new Date("2026-08-28T02:00:00.000Z"),
    )).not.toThrow();
    database.close();
  });
});

describe("PreservingDayMetadataStore", () => {
  it("keeps a published day published while replacing its statistical metadata", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const database = DailyTechDatabase.open({ filename: databaseFile });
    database.saveDay(metadata({
      status: "published",
      published_at: "2026-08-28T04:00:00.000Z",
    }));
    const store = new PreservingDayMetadataStore(
      database,
      "2026-08-27",
      () => new Date("2026-09-01T10:00:00.000Z"),
    );

    const saved = store.saveDay(metadata({
      summary: "תקציר חדש",
      significant_items: 7,
      source_count: 9,
      status: "ready",
      created_at: "2026-09-01T09:00:00.000Z",
    }));

    expect(saved).toMatchObject({
      status: "published",
      summary: "תקציר חדש",
      significant_items: 7,
      source_count: 9,
      created_at: "2026-08-28T01:00:00.000Z",
      published_at: "2026-08-28T04:00:00.000Z",
      updated_at: "2026-09-01T10:00:00.000Z",
    });
    database.close();
  });
});

describe("PreservingGenerationFailureReporter", () => {
  it("records the failure without changing an existing draft", async () => {
    const databaseFile = await temporaryDatabaseFile();
    const database = DailyTechDatabase.open({ filename: databaseFile });
    const original = database.saveDay(metadata({ status: "draft" }));
    const reporter = new PreservingGenerationFailureReporter(database);

    await reporter.report({
      runId: "regenerate-test",
      date: original.date,
      stage: "draft",
      occurredAt: "2026-09-01T10:00:00.000Z",
      message: "Provider failed.",
    });

    expect(database.getDay(original.date)).toEqual(original);
    expect(database.operations.listTickets({ category: "system" })).toContainEqual(
      expect.objectContaining({ title: expect.stringContaining("regeneration failed") }),
    );
    database.close();
  });
});
