import { randomUUID } from "node:crypto";

import {
  validateDayMetadata,
  type DayMetadata,
} from "@daily-tech/core";
import type { DailyTechDatabase } from "@daily-tech/db";
import { runPublisherCli } from "@daily-tech/publisher";
import {
  OpenAiCompatibleCompletionClient,
  OpenAiResponsesWebResearchClient,
  PipelineRunError,
  createProductionPipeline,
  loadPipelineEnvironment,
  type DayMetadataStore,
  type FailureReporter,
  type PipelineFailure,
} from "@daily-tech/pipeline";

import { invalidateSiteSnapshot } from "../lib/content.js";
import { getServerConfig } from "./config.js";
import { openServerDatabase } from "./database.js";
import { loadSchedulerConfig } from "./scheduler.js";

export type AdminGenerationMode = "retry" | "regenerate";

export type StartAdminGenerationResult =
  | { readonly outcome: "started"; readonly attemptCount: number }
  | { readonly outcome: "busy" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "invalid_state"; readonly status: DayMetadata["status"] };

interface AdminGenerationRequest {
  readonly date: string;
  readonly mode: AdminGenerationMode;
}

interface AdminGenerationDependencies {
  readonly openDatabase?: () => Promise<DailyTechDatabase>;
  readonly runGeneration?: (date: string, environment: NodeJS.ProcessEnv) => Promise<void>;
  readonly runPublication?: typeof runPublisherCli;
  readonly validateConfiguration?: (environment: NodeJS.ProcessEnv) => void;
  readonly now?: () => Date;
  readonly createLeaseOwner?: () => string;
  readonly leaseDurationMs?: number;
}

const serviceKey = Symbol.for("daily-tech.admin-generation-service");
const serviceGlobal = globalThis as typeof globalThis & {
  [serviceKey]?: AdminGenerationService;
};

export function adminGenerationService(): AdminGenerationService {
  const existing = serviceGlobal[serviceKey];
  if (existing !== undefined) return existing;
  const service = new AdminGenerationService(process.env);
  serviceGlobal[serviceKey] = service;
  return service;
}

export class AdminGenerationService {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #openDatabase: () => Promise<DailyTechDatabase>;
  readonly #runGeneration: (date: string, environment: NodeJS.ProcessEnv) => Promise<void>;
  readonly #runPublication: typeof runPublisherCli;
  readonly #validateConfiguration: (environment: NodeJS.ProcessEnv) => void;
  readonly #now: () => Date;
  readonly #createLeaseOwner: () => string;
  readonly #leaseDurationMs: number;
  readonly #running = new Set<Promise<void>>();

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    dependencies: AdminGenerationDependencies = {},
  ) {
    this.#environment = environment;
    this.#openDatabase = dependencies.openDatabase ?? openServerDatabase;
    this.#runGeneration = dependencies.runGeneration ?? runProductionAdminGeneration;
    this.#runPublication = dependencies.runPublication ?? runPublisherCli;
    this.#validateConfiguration =
      dependencies.validateConfiguration ?? ((value) => { loadPipelineEnvironment(value); });
    this.#now = dependencies.now ?? (() => new Date());
    this.#createLeaseOwner = dependencies.createLeaseOwner ?? (() => `admin-generate-${randomUUID()}`);
    this.#leaseDurationMs =
      dependencies.leaseDurationMs ?? loadSchedulerConfig(environment).leaseDurationMs;
  }

  async start(request: AdminGenerationRequest): Promise<StartAdminGenerationResult> {
    this.#validateConfiguration(this.#environment);
    const database = await this.#openDatabase();
    const leaseOwner = this.#createLeaseOwner();
    const occurredAt = this.#now().toISOString();
    const leaseExpiresAt = new Date(
      Date.parse(occurredAt) + this.#leaseDurationMs,
    ).toISOString();
    try {
      const existing = database.getDay(request.date);
      if (existing === null) return { outcome: "not_found" };
      if (request.mode === "retry" && existing.status !== "failed") {
        return { outcome: "invalid_state", status: existing.status };
      }

      const claim = database.operations.beginScheduledJob({
        jobName: "generate",
        targetDate: request.date,
        leaseOwner,
        leaseExpiresAt,
        occurredAt,
        restartFinished: "any",
      });
      if (claim.outcome !== "acquired") return { outcome: "busy" };

      try {
        database.operations.appendLog({
          briefDate: request.date,
          eventType: "admin_generation_started",
          level: "info",
          message: null,
          details: { mode: request.mode, leaseOwner },
          occurredAt,
        });
      } catch {
        /* Generation remains authoritative if observational logging fails. */
      }
      const task = this.#execute(request, leaseOwner);
      this.#running.add(task);
      void task.finally(() => this.#running.delete(task));
      return { outcome: "started", attemptCount: claim.job.attemptCount };
    } finally {
      database.close();
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.#running]);
  }

  async #execute(request: AdminGenerationRequest, leaseOwner: string): Promise<void> {
    try {
      await this.#runGeneration(request.date, this.#environment);
      if (
        request.mode === "retry" &&
        await this.#failedPublicationNeedsRecovery(request.date)
      ) {
        await this.#retryFailedPublication(request.date);
      }
      invalidateSiteSnapshot();
      const completedAt = this.#now().toISOString();
      const database = await this.#openDatabase();
      try {
        const saved = database.getDay(request.date);
        database.operations.completeScheduledJob(
          "generate",
          request.date,
          leaseOwner,
          completedAt,
        );
        try {
          database.operations.appendLog({
            briefDate: request.date,
            eventType: "admin_generation_completed",
            level: "info",
            message: null,
            details: {
              mode: request.mode,
              finalStatus: saved?.status ?? "missing",
            },
            occurredAt: completedAt,
          });
        } catch {
          /* Generation remains authoritative if observational logging fails. */
        }
      } finally {
        database.close();
      }
    } catch (error) {
      try {
        await this.#recordFailure(request, leaseOwner, error);
      } catch {
        /* Never leave a rejected background promise for the Node process. */
      }
    }
  }

  async #failedPublicationNeedsRecovery(date: string): Promise<boolean> {
    const database = await this.#openDatabase();
    try {
      return (
        database.getDay(date)?.status === "ready" &&
        database.operations.getScheduledJob("publish", date)?.state === "failed"
      );
    } finally {
      database.close();
    }
  }

  async #retryFailedPublication(date: string): Promise<void> {
    const leaseOwner = `${this.#createLeaseOwner()}-publish`;
    const occurredAt = this.#now().toISOString();
    const leaseExpiresAt = new Date(
      Date.parse(occurredAt) + this.#leaseDurationMs,
    ).toISOString();
    const database = await this.#openDatabase();
    let acquired = false;
    try {
      const claim = database.operations.beginScheduledJob({
        jobName: "publish",
        targetDate: date,
        leaseOwner,
        leaseExpiresAt,
        occurredAt,
        restartFinished: "failed",
      });
      acquired = claim.outcome === "acquired";
      if (acquired) {
        try {
          database.operations.appendLog({
            briefDate: date,
            eventType: "admin_publication_retry_started",
            level: "info",
            message: null,
            occurredAt,
          });
        } catch {
          /* Publication remains authoritative if observational logging fails. */
        }
      }
    } finally {
      database.close();
    }
    if (!acquired) return;

    try {
      await this.#runPublication(this.#environment, [
        `--date=${date}`,
        `--run-at=${occurredAt}`,
      ]);
      invalidateSiteSnapshot();
      const completedAt = this.#now().toISOString();
      const completionDatabase = await this.#openDatabase();
      try {
        completionDatabase.operations.completeScheduledJob(
          "publish",
          date,
          leaseOwner,
          completedAt,
        );
        try {
          completionDatabase.operations.appendLog({
            briefDate: date,
            eventType: "admin_publication_retry_completed",
            level: "info",
            message: null,
            occurredAt: completedAt,
          });
        } catch {
          /* Publication remains authoritative if observational logging fails. */
        }
      } finally {
        completionDatabase.close();
      }
    } catch (error) {
      const failedAt = this.#now().toISOString();
      const failureDatabase = await this.#openDatabase();
      try {
        failureDatabase.operations.failScheduledJob(
          "publish",
          date,
          leaseOwner,
          failedAt,
          errorMessage(error),
        );
        try {
          failureDatabase.operations.appendLog({
            briefDate: date,
            eventType: "admin_publication_retry_failed",
            level: "error",
            message: errorMessage(error),
            occurredAt: failedAt,
          });
        } catch {
          /* The publisher already reports its own domain failure when available. */
        }
      } finally {
        failureDatabase.close();
      }
    }
  }

  async #recordFailure(
    request: AdminGenerationRequest,
    leaseOwner: string,
    error: unknown,
  ): Promise<void> {
    const failedAt = this.#now().toISOString();
    const message = errorMessage(error);
    const database = await this.#openDatabase();
    try {
      database.operations.failScheduledJob(
        "generate",
        request.date,
        leaseOwner,
        failedAt,
        message,
      );
      database.operations.appendLog({
        briefDate: request.date,
        eventType: "admin_generation_failed",
        level: "error",
        message,
        details: {
          mode: request.mode,
          pipelineReported: error instanceof PipelineRunError,
        },
        occurredAt: failedAt,
      });
    } finally {
      database.close();
    }
  }
}

export class PreservingDayMetadataStore implements DayMetadataStore {
  readonly #database: DailyTechDatabase;
  readonly #date: string;
  readonly #now: () => Date;

  constructor(database: DailyTechDatabase, date: string, now: () => Date = () => new Date()) {
    this.#database = database;
    this.#date = date;
    this.#now = now;
  }

  saveDay(value: unknown): DayMetadata {
    const validation = validateDayMetadata(value);
    if (!validation.valid) {
      throw new TypeError(`Generated metadata is invalid: ${validation.issues.map((issue) => issue.path).join(", ")}`);
    }
    const generated = validation.data;
    if (generated.date !== this.#date) {
      throw new TypeError(`Generated date ${generated.date} does not match ${this.#date}.`);
    }
    const existing = this.#database.getDay(this.#date);
    if (existing === null) {
      throw new Error(`Brief ${this.#date} disappeared during regeneration.`);
    }
    return this.#database.saveDay({
      ...generated,
      status: existing.status === "published" ? "published" : "ready",
      created_at: existing.created_at,
      published_at: existing.status === "published" ? existing.published_at : null,
      updated_at: this.#now().toISOString(),
    });
  }
}

/** Regeneration is replace-on-success: a failed attempt must never mutate the
 * content or lifecycle state that existed when the operator started it. */
export class PreservingGenerationFailureReporter implements FailureReporter {
  readonly #database: DailyTechDatabase;

  constructor(database: DailyTechDatabase) {
    this.#database = database;
  }

  async report(failure: PipelineFailure): Promise<void> {
    const validationDetails = failure.validationIssues
      ?.slice(0, 10)
      .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
      .join("\n") ?? "";
    this.#database.operations.createTicket({
      title: `Daily brief regeneration failed for ${failure.date}`,
      category: "system",
      body: [
        `Run: ${failure.runId}`,
        `Stage: ${failure.stage}`,
        `Error: ${failure.message}`,
        validationDetails,
      ].filter(Boolean).join("\n"),
      createdAt: failure.occurredAt,
    });
  }
}

async function runProductionAdminGeneration(
  date: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const ai = loadPipelineEnvironment(environment);
  const server = getServerConfig(environment);
  const sharedOptions = {
    apiKey: ai.aiApiKey,
    model: ai.aiModel,
    baseUrl: ai.aiBaseUrl,
  };
  const database = await openServerDatabase();
  try {
    if (database.getDay(date) === null) throw new Error(`Brief ${date} does not exist.`);
    const pipeline = createProductionPipeline({
      completionClient: new OpenAiCompatibleCompletionClient(sharedOptions),
      webResearchClient: new OpenAiResponsesWebResearchClient(sharedOptions),
      database,
      metadataStore: new PreservingDayMetadataStore(database, date),
      failureReporter: new PreservingGenerationFailureReporter(database),
      storageRoot: server.dailyStorageRoot,
    });
    await pipeline.run({ targetDate: date, settings: database.pipelineSettings.get() });
  } finally {
    database.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
