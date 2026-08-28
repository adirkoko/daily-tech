import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BriefPublisher,
  PublicationInProgressError,
  type PublisherClock,
} from "../src/index.js";
import { readyMetadata, validMarkdown, writeBrief } from "./fixtures.js";

const fixedClock: PublisherClock = {
  now: () => new Date("2026-08-28T04:00:00.000Z"),
};

describe("BriefPublisher", () => {
  let database: DailyTechDatabase;
  let dailyStorageRoot: string;
  let temporaryRoot: string;

  beforeEach(async () => {
    database = DailyTechDatabase.open({ filename: ":memory:" });
    temporaryRoot = await mkdtemp(join(tmpdir(), "daily-tech-publisher-"));
    dailyStorageRoot = join(temporaryRoot, "daily");
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("validates, publishes locally, and becomes a no-op on rerun", async () => {
    database.saveDay(readyMetadata());
    await writeBrief(dailyStorageRoot);
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).resolves.toMatchObject({
      outcome: "published",
      attemptCount: 1,
    });
    expect(database.getDay("2026-08-27")).toMatchObject({
      status: "published",
      published_at: "2026-08-28T04:00:00.000Z",
    });
    await expect(publisher.publish("2026-08-27")).resolves.toMatchObject({
      outcome: "already_triggered",
      attemptCount: 1,
    });
    expect(database.operations.listTickets({ category: "system" })).toHaveLength(0);
  });

  it("does not change status when deterministic validation fails", async () => {
    database.saveDay(readyMetadata());
    await writeBrief(dailyStorageRoot, "2026-08-27", "# incomplete");
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).rejects.toMatchObject({
      phase: "validate",
    });
    expect(database.getDay("2026-08-27")?.status).toBe("ready");

    await writeBrief(dailyStorageRoot, "2026-08-27", validMarkdown);
    await expect(publisher.publish("2026-08-27")).resolves.toMatchObject({
      outcome: "published",
      attemptCount: 2,
    });
  });

  it("rejects overlapping publication without creating a failure ticket", async () => {
    database.saveDay(readyMetadata());
    await writeBrief(dailyStorageRoot);
    database.operations.beginPublication({
      dayDate: "2026-08-27",
      leaseOwner: "another-process",
      occurredAt: "2026-08-28T03:59:00.000Z",
      leaseExpiresAt: "2026-08-28T04:09:00.000Z",
    });
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).rejects.toBeInstanceOf(
      PublicationInProgressError,
    );
    expect(database.operations.listTickets({ category: "system" })).toHaveLength(0);
  });

  it("records a system ticket when metadata is missing", async () => {
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).rejects.toMatchObject({ phase: "load" });
    expect(database.operations.listTickets({ category: "system" })).toHaveLength(1);
  });
});
