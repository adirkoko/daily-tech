import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  expectedBriefRelativePath,
  isCalendarDate,
  validateBriefArtifact,
} from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";

import {
  PublicationInProgressError,
  PublicationRunError,
  PublicationValidationError,
} from "./errors.js";
import type {
  DeploymentTrigger,
  PublicationPhase,
  PublicationResult,
  PublisherClock,
} from "./types.js";

export interface BriefPublisherOptions {
  readonly database: DailyTechDatabase;
  readonly dailyStorageRoot: string;
  readonly deploymentTrigger: DeploymentTrigger;
  readonly clock?: PublisherClock;
  readonly leaseDurationMs?: number;
}

const systemClock: PublisherClock = { now: () => new Date() };

export class BriefPublisher {
  readonly #database: DailyTechDatabase;
  readonly #dailyStorageRoot: string;
  readonly #deploymentTrigger: DeploymentTrigger;
  readonly #clock: PublisherClock;
  readonly #leaseDurationMs: number;

  constructor(options: BriefPublisherOptions) {
    this.#database = options.database;
    this.#dailyStorageRoot = options.dailyStorageRoot;
    this.#deploymentTrigger = options.deploymentTrigger;
    this.#clock = options.clock ?? systemClock;
    this.#leaseDurationMs = options.leaseDurationMs ?? 600_000;
    if (!Number.isInteger(this.#leaseDurationMs) || this.#leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer.");
    }
  }

  async publish(date: string): Promise<PublicationResult> {
    if (!isCalendarDate(date)) {
      throw new TypeError("date must use YYYY-MM-DD format.");
    }

    const runId = `publish-${date}-${randomUUID()}`;
    const leaseOwner = runId;
    let phase: PublicationPhase = "load";
    let leaseAcquired = false;
    const startedAt = this.#timestamp();
    this.#log(runId, date, "publication_started", "info", startedAt, null, {});

    try {
      const original = this.#database.getDay(date);
      if (original === null) {
        throw new Error(`No brief metadata exists for ${date}.`);
      }
      if (original.status !== "ready" && original.status !== "published") {
        throw new Error(`Brief ${date} has status ${original.status}; expected ready or published.`);
      }

      phase = "acquire";
      const leaseExpiresAt = new Date(
        new Date(startedAt).getTime() + this.#leaseDurationMs,
      ).toISOString();
      const lease = this.#database.operations.beginPublication({
        dayDate: date,
        leaseOwner,
        occurredAt: startedAt,
        leaseExpiresAt,
      });
      if (lease.outcome === "already_triggered") {
        if (original.status !== "published") {
          throw new Error(
            `Publication job for ${date} is triggered but brief status is ${original.status}.`,
          );
        }
        this.#log(runId, date, "publication_skipped", "info", startedAt, null, {
          reason: "already_triggered",
          attemptCount: lease.job.attemptCount,
        });
        return {
          runId,
          date,
          outcome: "already_triggered",
          publishedAt: original.published_at ?? lease.job.completedAt ?? startedAt,
          deploymentRequestId: null,
          attemptCount: lease.job.attemptCount,
        };
      }
      if (lease.outcome === "busy") {
        const expiresAt = lease.job.leaseExpiresAt ?? leaseExpiresAt;
        this.#log(runId, date, "publication_skipped", "warning", startedAt, null, {
          reason: "lease_busy",
          leaseExpiresAt: expiresAt,
        });
        throw new PublicationInProgressError(date, expiresAt);
      }
      leaseAcquired = true;

      phase = "validate";
      const relativePath = expectedBriefRelativePath(date);
      if (relativePath === null) {
        throw new Error(`Could not build an artifact path for ${date}.`);
      }
      const filePath = join(this.#dailyStorageRoot, ...relativePath.split("/"));
      const content = await readFile(filePath);
      const validation = validateBriefArtifact({
        filePath,
        content,
        metadata: original,
      });
      if (!validation.valid) {
        throw new PublicationValidationError(validation.issues);
      }

      phase = "transition";
      const transition = this.#database.publishReadyDay(date, startedAt);
      if (transition.outcome === "not_found" || transition.outcome === "not_ready") {
        throw new Error(`Brief ${date} changed to an unpublishable state during publication.`);
      }
      const publishedAt = transition.metadata.published_at ?? startedAt;
      this.#log(runId, date, "publication_status_changed", "info", this.#timestamp(), null, {
        transition: transition.outcome,
      });

      phase = "deploy";
      const receipt = await this.#deploymentTrigger.trigger({ runId, date, publishedAt });

      phase = "finalize";
      const completedAt = this.#timestamp();
      const completed = this.#database.operations.completePublication(
        date,
        leaseOwner,
        completedAt,
      );
      const outcome = transition.outcome === "published" ? "published" : "retriggered";
      this.#log(runId, date, "publication_completed", "info", completedAt, null, {
        outcome,
        attemptCount: completed.attemptCount,
        deploymentRequestId: receipt.requestId,
      });
      return {
        runId,
        date,
        outcome,
        publishedAt,
        deploymentRequestId: receipt.requestId,
        attemptCount: completed.attemptCount,
      };
    } catch (error) {
      if (error instanceof PublicationInProgressError) {
        throw error;
      }
      const failedAt = this.#timestamp();
      let reportingError: unknown;
      try {
        if (leaseAcquired) {
          this.#database.operations.failPublication(
            date,
            leaseOwner,
            failedAt,
            errorMessage(error),
          );
        }
        this.#log(runId, date, "publication_failed", "error", failedAt, errorMessage(error), {
          phase,
        });
        this.#database.operations.createTicket({
          title: `Brief publication failed for ${date}`,
          category: "system",
          body: `Run: ${runId}\nPhase: ${phase}\nError: ${errorMessage(error)}`,
          createdAt: failedAt,
        });
      } catch (reportingFailure) {
        reportingError = reportingFailure;
      }
      throw new PublicationRunError(phase, error, reportingError);
    }
  }

  #timestamp(): string {
    const value = this.#clock.now();
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Publisher clock returned an invalid Date.");
    }
    return value.toISOString();
  }

  #log(
    runId: string,
    date: string,
    eventType: string,
    level: "info" | "warning" | "error",
    occurredAt: string,
    message: string | null,
    details: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.#database.operations.appendLog({
      runId,
      briefDate: date,
      eventType,
      level,
      message,
      details,
      occurredAt,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown publication failure.";
}
