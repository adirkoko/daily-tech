import type { DayMetadata } from "@daily-tech/core";
import {
  DailyTechDatabase,
  type JsonValue,
} from "@daily-tech/db";

import type {
  FailureReporter,
  PipelineFailure,
  PipelineLogEvent,
  PipelineLogger,
} from "./types.js";

export class DatabasePipelineLogger implements PipelineLogger {
  readonly #database: DailyTechDatabase;

  constructor(database: DailyTechDatabase) {
    this.#database = database;
  }

  log(event: PipelineLogEvent): void {
    this.#database.operations.appendLog({
      runId: event.runId,
      briefDate: event.date,
      eventType: event.type,
      level: event.type === "run_failed" ? "error" : "info",
      message:
        typeof event.details?.message === "string" ? event.details.message : null,
      ...(event.details === undefined
        ? {}
        : {
            details: event.details as Readonly<Record<string, JsonValue>>,
          }),
      occurredAt: event.occurredAt,
    });
  }
}

export class DatabaseFailureReporter implements FailureReporter {
  readonly #database: DailyTechDatabase;

  constructor(database: DailyTechDatabase) {
    this.#database = database;
  }

  async report(failure: PipelineFailure): Promise<void> {
    const validationDetails =
      failure.validationIssues
        ?.slice(0, 10)
        .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
        .join("\n") ?? "";
    this.#database.operations.createTicket({
      title: `Daily brief failed for ${failure.date}`,
      category: "system",
      body: [
        `Run: ${failure.runId}`,
        `Stage: ${failure.stage}`,
        `Error: ${failure.message}`,
        validationDetails,
      ]
        .filter(Boolean)
        .join("\n"),
      createdAt: failure.occurredAt,
    });

    const existing = this.#database.getDay(failure.date);
    if (existing?.status === "ready" || existing?.status === "published") {
      return;
    }
    this.#database.saveDay(buildFailedMetadata(failure, existing));
  }
}

function buildFailedMetadata(
  failure: PipelineFailure,
  existing: DayMetadata | null,
): DayMetadata {
  if (existing !== null) {
    return {
      ...existing,
      status: "failed",
      updated_at: failure.occurredAt,
    };
  }
  return {
    date: failure.date,
    summary: "הפקת העדכון נכשלה.",
    significant_items: 0,
    worth_watching_items: 0,
    day_intensity: "minimal",
    companies: [],
    topics: [],
    developments: [],
    status: "failed",
    source_count: 0,
    created_at: failure.occurredAt,
    published_at: null,
    updated_at: null,
  };
}
