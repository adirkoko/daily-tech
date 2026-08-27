import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BriefPublisher,
  PublicationInProgressError,
  PublicationRunError,
  type DeploymentTrigger,
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

  it("validates, publishes, deploys, and becomes a no-op on rerun", async () => {
    database.saveDay(readyMetadata());
    await writeBrief(dailyStorageRoot);
    const trigger = {
      trigger: vi.fn<DeploymentTrigger["trigger"]>().mockResolvedValue({ requestId: "deploy-1" }),
    };
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      deploymentTrigger: trigger,
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).resolves.toMatchObject({
      outcome: "published",
      deploymentRequestId: "deploy-1",
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
    expect(trigger.trigger).toHaveBeenCalledOnce();
    expect(database.operations.listTickets({ category: "system" })).toHaveLength(0);
  });

  it("keeps a published status and safely retries a failed deployment", async () => {
    database.saveDay(readyMetadata());
    await writeBrief(dailyStorageRoot);
    const failingPublisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      deploymentTrigger: {
        trigger: vi.fn<DeploymentTrigger["trigger"]>().mockRejectedValue(new Error("hook down")),
      },
      clock: fixedClock,
    });

    await expect(failingPublisher.publish("2026-08-27")).rejects.toMatchObject({
      name: "PublicationRunError",
      phase: "deploy",
    } satisfies Partial<PublicationRunError>);
    expect(database.getDay("2026-08-27")?.status).toBe("published");
    expect(database.operations.listTickets({ category: "system" })).toHaveLength(1);

    const successfulTrigger = {
      trigger: vi.fn<DeploymentTrigger["trigger"]>().mockResolvedValue({ requestId: "retry-1" }),
    };
    const retryingPublisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      deploymentTrigger: successfulTrigger,
      clock: fixedClock,
    });
    await expect(retryingPublisher.publish("2026-08-27")).resolves.toMatchObject({
      outcome: "retriggered",
      attemptCount: 2,
      deploymentRequestId: "retry-1",
    });
  });

  it("does not change status when deterministic validation fails", async () => {
    database.saveDay(readyMetadata());
    await writeBrief(dailyStorageRoot, "2026-08-27", "# incomplete");
    const trigger = { trigger: vi.fn<DeploymentTrigger["trigger"]>() };
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot,
      deploymentTrigger: trigger,
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).rejects.toMatchObject({
      phase: "validate",
    });
    expect(database.getDay("2026-08-27")?.status).toBe("ready");
    expect(trigger.trigger).not.toHaveBeenCalled();

    await writeBrief(dailyStorageRoot, "2026-08-27", validMarkdown);
    trigger.trigger.mockResolvedValue({ requestId: null });
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
      deploymentTrigger: { trigger: vi.fn<DeploymentTrigger["trigger"]>() },
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
      deploymentTrigger: { trigger: vi.fn<DeploymentTrigger["trigger"]>() },
      clock: fixedClock,
    });

    await expect(publisher.publish("2026-08-27")).rejects.toMatchObject({ phase: "load" });
    expect(database.operations.listTickets({ category: "system" })).toHaveLength(1);
  });
});
