import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DailyTechDatabase } from "../src/index.js";
import { createMetadata } from "./fixtures.js";

describe("OperationsStore", () => {
  let database: DailyTechDatabase;

  beforeEach(() => {
    database = DailyTechDatabase.open({ filename: ":memory:" });
  });

  afterEach(() => {
    database.close();
  });

  it("appends structured logs and filters them", () => {
    database.operations.appendLog({
      runId: "run-1",
      briefDate: "2026-08-27",
      eventType: "stage_completed",
      level: "info",
      message: "Research completed",
      details: { candidates: 14, nested: { approved: true } },
      occurredAt: "2026-08-28T01:05:00.000Z",
    });
    database.operations.appendLog({
      runId: "run-2",
      briefDate: "2026-08-28",
      eventType: "run_failed",
      level: "error",
      message: "Provider unavailable",
      occurredAt: "2026-08-29T01:05:00.000Z",
    });

    expect(database.operations.listLogs({ runId: "run-1" })).toEqual([
      expect.objectContaining({
        runId: "run-1",
        level: "info",
        details: { candidates: 14, nested: { approved: true } },
      }),
    ]);
    expect(database.operations.listLogs({ level: "error" })).toHaveLength(1);
  });

  it("creates, filters, and resolves system tickets", () => {
    const ticket = database.operations.createTicket({
      title: "Daily brief generation failed",
      category: "system",
      body: "The provider was unavailable.",
      createdAt: "2026-08-28T01:05:00.000Z",
    });

    expect(ticket).toEqual(
      expect.objectContaining({
        id: 1,
        category: "system",
        status: "open",
        resolvedAt: null,
      }),
    );
    expect(
      database.operations.listTickets({ category: "system", status: "open" }),
    ).toHaveLength(1);

    expect(
      database.operations.resolveTicket(1, "2026-08-28T08:00:00.000Z"),
    ).toEqual(
      expect.objectContaining({
        id: 1,
        status: "resolved",
        resolvedAt: "2026-08-28T08:00:00.000Z",
      }),
    );
    expect(
      database.operations.resolveTicket(1, "2026-08-28T09:00:00.000Z"),
    ).toBeNull();
  });

  it("atomically counts attempts inside a fixed rate-limit window", () => {
    const input = {
      scope: "feedback" as const,
      keyHash: "sha256:caller",
      windowStartedAt: "2026-08-28T00:00:00.000Z",
      occurredAt: "2026-08-28T01:00:00.000Z",
      limit: 3,
    };

    expect(database.operations.consumeRateLimit(input)).toEqual({
      allowed: true,
      attemptCount: 1,
      remaining: 2,
    });
    database.operations.consumeRateLimit(input);
    expect(database.operations.consumeRateLimit(input).allowed).toBe(true);
    expect(database.operations.consumeRateLimit(input)).toEqual({
      allowed: false,
      attemptCount: 4,
      remaining: 0,
    });
    expect(database.operations.resetRateLimits("feedback")).toBe(1);
    expect(database.operations.consumeRateLimit(input).attemptCount).toBe(1);
  });

  it("leases publication work, blocks overlap, and completes idempotently", () => {
    database.saveDay(createMetadata());
    const first = database.operations.beginPublication({
      dayDate: "2026-08-27",
      leaseOwner: "publisher-1",
      occurredAt: "2026-08-28T04:00:00.000Z",
      leaseExpiresAt: "2026-08-28T04:10:00.000Z",
    });
    expect(first).toMatchObject({
      outcome: "acquired",
      job: { state: "triggering", attemptCount: 1, leaseOwner: "publisher-1" },
    });

    expect(
      database.operations.beginPublication({
        dayDate: "2026-08-27",
        leaseOwner: "publisher-2",
        occurredAt: "2026-08-28T04:01:00.000Z",
        leaseExpiresAt: "2026-08-28T04:11:00.000Z",
      }),
    ).toMatchObject({ outcome: "busy", job: { leaseOwner: "publisher-1" } });

    const completed = database.operations.completePublication(
      "2026-08-27",
      "publisher-1",
      "2026-08-28T04:02:00.000Z",
    );
    expect(completed).toMatchObject({
      state: "triggered",
      completedAt: "2026-08-28T04:02:00.000Z",
      leaseOwner: null,
    });
    expect(
      database.operations.beginPublication({
        dayDate: "2026-08-27",
        leaseOwner: "publisher-3",
        occurredAt: "2026-08-28T05:00:00.000Z",
        leaseExpiresAt: "2026-08-28T05:10:00.000Z",
      }),
    ).toMatchObject({ outcome: "already_triggered", job: { attemptCount: 1 } });
  });

  it("retries failed or expired publication leases", () => {
    database.saveDay(createMetadata());
    database.operations.beginPublication({
      dayDate: "2026-08-27",
      leaseOwner: "publisher-1",
      occurredAt: "2026-08-28T04:00:00.000Z",
      leaseExpiresAt: "2026-08-28T04:10:00.000Z",
    });
    const failed = database.operations.failPublication(
      "2026-08-27",
      "publisher-1",
      "2026-08-28T04:02:00.000Z",
      "Deploy hook returned 500.",
    );
    expect(failed).toMatchObject({ state: "failed", lastError: "Deploy hook returned 500." });

    expect(
      database.operations.beginPublication({
        dayDate: "2026-08-27",
        leaseOwner: "publisher-2",
        occurredAt: "2026-08-28T04:03:00.000Z",
        leaseExpiresAt: "2026-08-28T04:13:00.000Z",
      }),
    ).toMatchObject({ outcome: "acquired", job: { attemptCount: 2 } });

    expect(
      database.operations.beginPublication({
        dayDate: "2026-08-27",
        leaseOwner: "publisher-3",
        occurredAt: "2026-08-28T04:14:00.000Z",
        leaseExpiresAt: "2026-08-28T04:24:00.000Z",
      }),
    ).toMatchObject({ outcome: "acquired", job: { attemptCount: 3, leaseOwner: "publisher-3" } });
  });

  it("validates operational inputs before writing", () => {
    expect(() =>
      database.operations.appendLog({
        eventType: "",
        level: "info",
        occurredAt: "not-a-time",
      }),
    ).toThrow(TypeError);
    expect(() =>
      database.operations.createTicket({
        title: " ",
        category: "system",
        body: "Body",
        createdAt: "2026-08-28T01:00:00.000Z",
      }),
    ).toThrow(TypeError);
    expect(() =>
      database.operations.consumeRateLimit({
        scope: "feedback",
        keyHash: "hash",
        windowStartedAt: "2026-08-28T00:00:00.000Z",
        occurredAt: "2026-08-28T01:00:00.000Z",
        limit: 0,
      }),
    ).toThrow(RangeError);
  });
});
