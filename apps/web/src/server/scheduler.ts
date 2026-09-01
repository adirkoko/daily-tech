import { randomUUID } from "node:crypto";

import { PipelineRunError, runPipelineCli } from "@daily-tech/pipeline";
import {
  PublicationRunError,
  previousIsraelCalendarDate,
  runPublisherCli,
} from "@daily-tech/publisher";
import type { DailyTechDatabase, ScheduledJobName } from "@daily-tech/db";

import { invalidateSiteSnapshot } from "../lib/content.js";
import { openServerDatabase } from "./database.js";

export interface SchedulerConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
}

export interface SchedulerSnapshot {
  readonly enabled: boolean;
  readonly runningJob: string | null;
  readonly lastTickAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
}

interface IsraelTime {
  readonly date: string;
  readonly minuteOfDay: number;
}

interface SchedulerDependencies {
  readonly openDatabase?: () => Promise<DailyTechDatabase>;
  readonly runGeneration?: typeof runPipelineCli;
  readonly runPublication?: typeof runPublisherCli;
}

const israelFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const schedulerKey = Symbol.for("daily-tech.service-scheduler");
const schedulerGlobal = globalThis as typeof globalThis & {
  [schedulerKey]?: ServiceScheduler;
};

export function loadSchedulerConfig(environment: NodeJS.ProcessEnv = process.env): SchedulerConfig {
  return {
    enabled: booleanValue(environment.SCHEDULER_ENABLED ?? "false", "SCHEDULER_ENABLED"),
    pollIntervalMs: integer(environment.SCHEDULER_POLL_SECONDS ?? "30", "SCHEDULER_POLL_SECONDS", 5, 3_600) * 1_000,
    leaseDurationMs: integer(environment.SCHEDULER_LEASE_HOURS ?? "6", "SCHEDULER_LEASE_HOURS", 1, 24) * 60 * 60 * 1_000,
  };
}

export function ensureSchedulerStarted(environment: NodeJS.ProcessEnv = process.env): ServiceScheduler {
  const existing = schedulerGlobal[schedulerKey];
  if (existing !== undefined) return existing;
  const scheduler = new ServiceScheduler(loadSchedulerConfig(environment), environment);
  schedulerGlobal[schedulerKey] = scheduler;
  scheduler.start();
  return scheduler;
}

export function schedulerSnapshot(): SchedulerSnapshot {
  return ensureSchedulerStarted().snapshot;
}

export class ServiceScheduler {
  readonly #config: SchedulerConfig;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #openDatabase: () => Promise<DailyTechDatabase>;
  readonly #runGeneration: typeof runPipelineCli;
  readonly #runPublication: typeof runPublisherCli;
  #timer: NodeJS.Timeout | undefined;
  #tickRunning = false;
  #snapshot: SchedulerSnapshot;

  constructor(
    config: SchedulerConfig,
    environment: NodeJS.ProcessEnv = process.env,
    dependencies: SchedulerDependencies = {},
  ) {
    this.#config = config;
    this.#environment = environment;
    this.#openDatabase = dependencies.openDatabase ?? openServerDatabase;
    this.#runGeneration = dependencies.runGeneration ?? runPipelineCli;
    this.#runPublication = dependencies.runPublication ?? runPublisherCli;
    this.#snapshot = {
      enabled: config.enabled,
      runningJob: null,
      lastTickAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
  }

  get snapshot(): SchedulerSnapshot {
    return { ...this.#snapshot };
  }

  start(): void {
    if (!this.#config.enabled || this.#timer !== undefined) return;
    this.#timer = setInterval(() => { void this.tick(); }, this.#config.pollIntervalMs);
    this.#timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.#config.enabled || this.#tickRunning) return;
    this.#tickRunning = true;
    this.#snapshot = { ...this.#snapshot, lastTickAt: now.toISOString() };
    try {
      // Read fresh every tick (not cached at startup) so an Admin change to the
      // generate/publish time takes effect on the next tick, no restart needed.
      const settings = await this.#readPipelineSettings();
      const israel = israelTime(now);
      const targetDate = previousIsraelCalendarDate(now);
      if (israel.minuteOfDay >= parseTime(settings.generateTime, "generateTime")) {
        await this.#runJob("generate", targetDate, now);
      }
      if (israel.minuteOfDay >= parseTime(settings.publishTime, "publishTime")) {
        await this.#runJob("publish", targetDate, now);
      }
    } catch (error) {
      this.#snapshot = { ...this.#snapshot, lastError: errorMessage(error) };
    } finally {
      this.#tickRunning = false;
    }
  }

  async #readPipelineSettings() {
    const database = await this.#openDatabase();
    try {
      return database.pipelineSettings.get();
    } finally {
      database.close();
    }
  }

  async #runJob(jobName: ScheduledJobName, targetDate: string, runAt: Date): Promise<void> {
    const leaseOwner = `scheduler-${jobName}-${randomUUID()}`;
    const occurredAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(occurredAt) + this.#config.leaseDurationMs).toISOString();
    const database = await this.#openDatabase();
    let acquired = false;
    try {
      const claim = database.operations.beginScheduledJob({
        jobName,
        targetDate,
        leaseOwner,
        leaseExpiresAt,
        occurredAt,
      });
      acquired = claim.outcome === "acquired";
      if (acquired) {
        database.operations.appendLog({
          briefDate: targetDate,
          eventType: `scheduler_${jobName}_started`,
          level: "info",
          message: null,
          details: { leaseOwner },
          occurredAt,
        });
      }
    } finally {
      database.close();
    }
    if (!acquired) return;

    this.#snapshot = { ...this.#snapshot, runningJob: `${jobName}:${targetDate}`, lastError: null };
    try {
      if (jobName === "generate") {
        await this.#runGeneration(this.#environment, [`--run-at=${runAt.toISOString()}`]);
      } else {
        await this.#runPublication(this.#environment, [
          `--date=${targetDate}`,
          `--run-at=${runAt.toISOString()}`,
        ]);
      }
      invalidateSiteSnapshot();
      const completedAt = new Date().toISOString();
      const completionDatabase = await this.#openDatabase();
      try {
        completionDatabase.operations.completeScheduledJob(
          jobName,
          targetDate,
          leaseOwner,
          completedAt,
        );
        completionDatabase.operations.appendLog({
          briefDate: targetDate,
          eventType: `scheduler_${jobName}_completed`,
          level: "info",
          message: null,
          occurredAt: completedAt,
        });
      } finally {
        completionDatabase.close();
      }
      this.#snapshot = {
        ...this.#snapshot,
        runningJob: null,
        lastSuccessAt: completedAt,
        lastError: null,
      };
    } catch (error) {
      let message = errorMessage(error);
      try {
        await this.#recordFailure(jobName, targetDate, leaseOwner, error);
      } catch (reportingError) {
        message = `${message} (scheduler reporting failed: ${errorMessage(reportingError)})`;
      }
      this.#snapshot = { ...this.#snapshot, runningJob: null, lastError: message };
    }
  }

  async #recordFailure(
    jobName: ScheduledJobName,
    targetDate: string,
    leaseOwner: string,
    error: unknown,
  ): Promise<void> {
    const failedAt = new Date().toISOString();
    const message = errorMessage(error);
    const database = await this.#openDatabase();
    try {
      database.operations.failScheduledJob(
        jobName,
        targetDate,
        leaseOwner,
        failedAt,
        message,
      );
      database.operations.appendLog({
        briefDate: targetDate,
        eventType: `scheduler_${jobName}_failed`,
        level: "error",
        message,
        occurredAt: failedAt,
      });
      if (!(error instanceof PipelineRunError) && !(error instanceof PublicationRunError)) {
        database.operations.createTicket({
          title: `Scheduled ${jobName} failed for ${targetDate}`,
          category: "system",
          body: `Scheduler error: ${message}`,
          createdAt: failedAt,
        });
      }
    } finally {
      database.close();
    }
  }
}

export function israelTime(value: Date): IsraelTime {
  const parts = Object.fromEntries(
    israelFormatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Could not resolve the current Israel time.");
  }
  return { date: `${year}-${month}-${day}`, minuteOfDay: hour * 60 + minute };
}

function parseTime(value: string, name: string): number {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (match === null || !Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) {
    throw new TypeError(`${name} must use 24-hour HH:MM format.`);
  }
  return hour * 60 + minute;
}

function booleanValue(value: string, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError(`${name} must be true or false.`);
}

function integer(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown scheduler error.";
}
