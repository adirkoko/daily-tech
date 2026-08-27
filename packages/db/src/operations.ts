import type Database from "better-sqlite3";

import { isCalendarDate, isUtcTimestamp } from "@daily-tech/core";

export const LOG_LEVELS = ["info", "warning", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const FEEDBACK_CATEGORIES = [
  "general",
  "correction",
  "suggestion",
  "system",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ["open", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const RATE_LIMIT_SCOPES = ["admin_login", "feedback"] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

export const SCHEDULED_JOB_NAMES = ["generate", "publish"] as const;
export type ScheduledJobName = (typeof SCHEDULED_JOB_NAMES)[number];

export const SCHEDULED_JOB_STATES = ["running", "succeeded", "failed"] as const;
export type ScheduledJobState = (typeof SCHEDULED_JOB_STATES)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface AppendOperationalLogInput {
  readonly runId?: string | null;
  readonly briefDate?: string | null;
  readonly eventType: string;
  readonly level: LogLevel;
  readonly message?: string | null;
  readonly details?: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: string;
}

export interface OperationalLog {
  readonly id: number;
  readonly runId: string | null;
  readonly briefDate: string | null;
  readonly eventType: string;
  readonly level: LogLevel;
  readonly message: string | null;
  readonly details: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: string;
}

export interface ListOperationalLogsOptions {
  readonly runId?: string;
  readonly briefDate?: string;
  readonly level?: LogLevel;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CreateFeedbackTicketInput {
  readonly title: string;
  readonly submitterName?: string | null;
  readonly category: FeedbackCategory;
  readonly body: string;
  readonly createdAt: string;
}

export interface FeedbackTicket {
  readonly id: number;
  readonly title: string;
  readonly submitterName: string | null;
  readonly category: FeedbackCategory;
  readonly body: string;
  readonly status: FeedbackStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface ListFeedbackTicketsOptions {
  readonly category?: FeedbackCategory;
  readonly status?: FeedbackStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ConsumeRateLimitInput {
  readonly scope: RateLimitScope;
  /** A one-way hash of the IP or other caller identifier; never pass the raw value. */
  readonly keyHash: string;
  readonly windowStartedAt: string;
  readonly occurredAt: string;
  readonly limit: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly attemptCount: number;
  readonly remaining: number;
}

export const PUBLICATION_STATES = ["triggering", "triggered", "failed"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export interface PublicationJob {
  readonly dayDate: string;
  readonly state: PublicationState;
  readonly attemptCount: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastError: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

export interface BeginPublicationInput {
  readonly dayDate: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly occurredAt: string;
}

export type BeginPublicationResult =
  | { readonly outcome: "acquired"; readonly job: PublicationJob }
  | { readonly outcome: "already_triggered"; readonly job: PublicationJob }
  | { readonly outcome: "busy"; readonly job: PublicationJob };

export interface AdminSession {
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

export interface CreateAdminSessionInput {
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ScheduledJob {
  readonly jobName: ScheduledJobName;
  readonly targetDate: string;
  readonly state: ScheduledJobState;
  readonly attemptCount: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface BeginScheduledJobInput {
  readonly jobName: ScheduledJobName;
  readonly targetDate: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly occurredAt: string;
}

export type BeginScheduledJobResult =
  | { readonly outcome: "acquired"; readonly job: ScheduledJob }
  | { readonly outcome: "already_finished"; readonly job: ScheduledJob }
  | { readonly outcome: "busy"; readonly job: ScheduledJob };

interface OperationalLogRow {
  readonly id: number;
  readonly run_id: string | null;
  readonly brief_date: string | null;
  readonly event_type: string;
  readonly level: string;
  readonly message: string | null;
  readonly details_json: string;
  readonly occurred_at: string;
}

interface FeedbackTicketRow {
  readonly id: number;
  readonly title: string;
  readonly submitter_name: string | null;
  readonly category: string;
  readonly body: string;
  readonly status: string;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

interface PublicationJobRow {
  readonly day_date: string;
  readonly state: string;
  readonly attempt_count: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly last_error: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly updated_at: string;
}

interface AdminSessionRow {
  readonly token_hash: string;
  readonly csrf_token_hash: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly last_seen_at: string;
}

interface ScheduledJobRow {
  readonly job_name: string;
  readonly target_date: string;
  readonly state: string;
  readonly attempt_count: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly last_error: string | null;
  readonly updated_at: string;
}

export class OperationsStore {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  appendLog(input: AppendOperationalLogInput): OperationalLog {
    validateOperationalLog(input);
    const detailsJson = serializeDetails(input.details ?? {});
    const result = this.#database
      .prepare(
        `
          INSERT INTO operational_logs (
            run_id, brief_date, event_type, level, message, details_json, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.runId ?? null,
        input.briefDate ?? null,
        input.eventType,
        input.level,
        input.message ?? null,
        detailsJson,
        input.occurredAt,
      );
    return this.getLog(Number(result.lastInsertRowid));
  }

  listLogs(options: ListOperationalLogsOptions = {}): readonly OperationalLog[] {
    validatePagination(options.limit, options.offset);
    if (options.briefDate !== undefined && !isCalendarDate(options.briefDate)) {
      throw new TypeError("briefDate must use YYYY-MM-DD format.");
    }
    if (options.level !== undefined && !includes(LOG_LEVELS, options.level)) {
      throw new TypeError("level is invalid.");
    }

    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.runId !== undefined) {
      assertNonEmpty(options.runId, "runId");
      conditions.push("run_id = ?");
      parameters.push(options.runId);
    }
    if (options.briefDate !== undefined) {
      conditions.push("brief_date = ?");
      parameters.push(options.briefDate);
    }
    if (options.level !== undefined) {
      conditions.push("level = ?");
      parameters.push(options.level);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.#database
      .prepare(
        `SELECT * FROM operational_logs ${where} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, options.limit ?? 100, options.offset ?? 0) as OperationalLogRow[];
    return rows.map(mapOperationalLog);
  }

  createTicket(input: CreateFeedbackTicketInput): FeedbackTicket {
    assertNonEmpty(input.title, "title");
    assertNonEmpty(input.body, "body");
    assertTimestamp(input.createdAt, "createdAt");
    if (!includes(FEEDBACK_CATEGORIES, input.category)) {
      throw new TypeError("category is invalid.");
    }
    if (input.submitterName !== undefined && input.submitterName !== null) {
      assertNonEmpty(input.submitterName, "submitterName");
    }

    const result = this.#database
      .prepare(
        `
          INSERT INTO feedback_tickets (
            title, submitter_name, category, body, status, created_at, resolved_at
          ) VALUES (?, ?, ?, ?, 'open', ?, NULL)
        `,
      )
      .run(
        input.title,
        input.submitterName ?? null,
        input.category,
        input.body,
        input.createdAt,
      );
    return this.getTicket(Number(result.lastInsertRowid));
  }

  listTickets(options: ListFeedbackTicketsOptions = {}): readonly FeedbackTicket[] {
    validatePagination(options.limit, options.offset);
    if (options.category !== undefined && !includes(FEEDBACK_CATEGORIES, options.category)) {
      throw new TypeError("category is invalid.");
    }
    if (options.status !== undefined && !includes(FEEDBACK_STATUSES, options.status)) {
      throw new TypeError("status is invalid.");
    }

    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.category !== undefined) {
      conditions.push("category = ?");
      parameters.push(options.category);
    }
    if (options.status !== undefined) {
      conditions.push("status = ?");
      parameters.push(options.status);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.#database
      .prepare(
        `SELECT * FROM feedback_tickets ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, options.limit ?? 100, options.offset ?? 0) as FeedbackTicketRow[];
    return rows.map(mapFeedbackTicket);
  }

  resolveTicket(id: number, resolvedAt: string): FeedbackTicket | null {
    assertPositiveInteger(id, "id");
    assertTimestamp(resolvedAt, "resolvedAt");
    const result = this.#database
      .prepare(
        `
          UPDATE feedback_tickets
          SET status = 'resolved', resolved_at = ?
          WHERE id = ? AND status = 'open'
        `,
      )
      .run(resolvedAt, id);
    return result.changes === 0 ? null : this.getTicket(id);
  }

  consumeRateLimit(input: ConsumeRateLimitInput): RateLimitResult {
    if (!includes(RATE_LIMIT_SCOPES, input.scope)) {
      throw new TypeError("scope is invalid.");
    }
    assertNonEmpty(input.keyHash, "keyHash");
    assertTimestamp(input.windowStartedAt, "windowStartedAt");
    assertTimestamp(input.occurredAt, "occurredAt");
    assertPositiveInteger(input.limit, "limit");

    const row = this.#database
      .prepare(
        `
          INSERT INTO rate_limit_counters (
            scope, key_hash, window_started_at, attempt_count, updated_at
          ) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE SET
            attempt_count = rate_limit_counters.attempt_count + 1,
            updated_at = excluded.updated_at
          RETURNING attempt_count
        `,
      )
      .get(
        input.scope,
        input.keyHash,
        input.windowStartedAt,
        input.occurredAt,
      ) as { attempt_count: number };
    const attemptCount = row.attempt_count;
    return {
      allowed: attemptCount <= input.limit,
      attemptCount,
      remaining: Math.max(0, input.limit - attemptCount),
    };
  }

  resetRateLimits(scope?: RateLimitScope): number {
    if (scope !== undefined && !includes(RATE_LIMIT_SCOPES, scope)) {
      throw new TypeError("scope is invalid.");
    }
    const result =
      scope === undefined
        ? this.#database.prepare("DELETE FROM rate_limit_counters").run()
        : this.#database
            .prepare("DELETE FROM rate_limit_counters WHERE scope = ?")
            .run(scope);
    return result.changes;
  }

  beginPublication(input: BeginPublicationInput): BeginPublicationResult {
    assertCalendarDate(input.dayDate, "dayDate");
    assertNonEmpty(input.leaseOwner, "leaseOwner");
    assertTimestamp(input.leaseExpiresAt, "leaseExpiresAt");
    assertTimestamp(input.occurredAt, "occurredAt");
    if (input.leaseExpiresAt <= input.occurredAt) {
      throw new RangeError("leaseExpiresAt must be later than occurredAt.");
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getPublicationJob(input.dayDate);
      if (existing?.state === "triggered") {
        this.#database.exec("COMMIT");
        return { outcome: "already_triggered", job: existing };
      }
      if (
        existing?.state === "triggering" &&
        existing.leaseExpiresAt !== null &&
        existing.leaseExpiresAt > input.occurredAt
      ) {
        this.#database.exec("COMMIT");
        return { outcome: "busy", job: existing };
      }

      this.#database
        .prepare(
          `
            INSERT INTO publication_jobs (
              day_date, state, attempt_count, lease_owner, lease_expires_at,
              last_error, started_at, completed_at, updated_at
            ) VALUES (?, 'triggering', 1, ?, ?, NULL, ?, NULL, ?)
            ON CONFLICT (day_date) DO UPDATE SET
              state = 'triggering',
              attempt_count = publication_jobs.attempt_count + 1,
              lease_owner = excluded.lease_owner,
              lease_expires_at = excluded.lease_expires_at,
              last_error = NULL,
              started_at = excluded.started_at,
              completed_at = NULL,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          input.dayDate,
          input.leaseOwner,
          input.leaseExpiresAt,
          input.occurredAt,
          input.occurredAt,
        );
      const job = this.requirePublicationJob(input.dayDate);
      this.#database.exec("COMMIT");
      return { outcome: "acquired", job };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  completePublication(dayDate: string, leaseOwner: string, completedAt: string): PublicationJob {
    return this.finishPublication(dayDate, leaseOwner, completedAt, "triggered", null);
  }

  failPublication(
    dayDate: string,
    leaseOwner: string,
    failedAt: string,
    errorMessage: string,
  ): PublicationJob {
    assertNonEmpty(errorMessage, "errorMessage");
    return this.finishPublication(dayDate, leaseOwner, failedAt, "failed", errorMessage);
  }

  createAdminSession(input: CreateAdminSessionInput): AdminSession {
    assertSha256(input.tokenHash, "tokenHash");
    assertSha256(input.csrfTokenHash, "csrfTokenHash");
    assertTimestamp(input.createdAt, "createdAt");
    assertTimestamp(input.expiresAt, "expiresAt");
    if (input.expiresAt <= input.createdAt) {
      throw new RangeError("expiresAt must be later than createdAt.");
    }
    this.#database
      .prepare(
        `
          INSERT INTO admin_sessions (
            token_hash, csrf_token_hash, created_at, expires_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.tokenHash,
        input.csrfTokenHash,
        input.createdAt,
        input.expiresAt,
        input.createdAt,
      );
    return this.requireAdminSession(input.tokenHash);
  }

  getValidAdminSession(tokenHash: string, occurredAt: string): AdminSession | null {
    assertSha256(tokenHash, "tokenHash");
    assertTimestamp(occurredAt, "occurredAt");
    const row = this.#database
      .prepare(
        "SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ?",
      )
      .get(tokenHash, occurredAt) as AdminSessionRow | undefined;
    return row === undefined ? null : mapAdminSession(row);
  }

  touchAdminSession(tokenHash: string, occurredAt: string): boolean {
    assertSha256(tokenHash, "tokenHash");
    assertTimestamp(occurredAt, "occurredAt");
    return this.#database
      .prepare(
        "UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ? AND expires_at > ?",
      )
      .run(occurredAt, tokenHash, occurredAt).changes === 1;
  }

  deleteAdminSession(tokenHash: string): boolean {
    assertSha256(tokenHash, "tokenHash");
    return this.#database
      .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
      .run(tokenHash).changes === 1;
  }

  purgeExpiredAdminSessions(occurredAt: string): number {
    assertTimestamp(occurredAt, "occurredAt");
    return this.#database
      .prepare("DELETE FROM admin_sessions WHERE expires_at <= ?")
      .run(occurredAt).changes;
  }

  beginScheduledJob(input: BeginScheduledJobInput): BeginScheduledJobResult {
    validateScheduledJobIdentity(input.jobName, input.targetDate);
    assertNonEmpty(input.leaseOwner, "leaseOwner");
    assertTimestamp(input.leaseExpiresAt, "leaseExpiresAt");
    assertTimestamp(input.occurredAt, "occurredAt");
    if (input.leaseExpiresAt <= input.occurredAt) {
      throw new RangeError("leaseExpiresAt must be later than occurredAt.");
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getScheduledJob(input.jobName, input.targetDate);
      if (existing?.state === "succeeded" || existing?.state === "failed") {
        this.#database.exec("COMMIT");
        return { outcome: "already_finished", job: existing };
      }
      if (
        existing?.state === "running" &&
        existing.leaseExpiresAt !== null &&
        existing.leaseExpiresAt > input.occurredAt
      ) {
        this.#database.exec("COMMIT");
        return { outcome: "busy", job: existing };
      }

      this.#database.prepare(`
        INSERT INTO scheduled_jobs (
          job_name, target_date, state, attempt_count, lease_owner,
          lease_expires_at, started_at, completed_at, last_error, updated_at
        ) VALUES (?, ?, 'running', 1, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT (job_name, target_date) DO UPDATE SET
          state = 'running',
          attempt_count = scheduled_jobs.attempt_count + 1,
          lease_owner = excluded.lease_owner,
          lease_expires_at = excluded.lease_expires_at,
          started_at = excluded.started_at,
          completed_at = NULL,
          last_error = NULL,
          updated_at = excluded.updated_at
      `).run(
        input.jobName,
        input.targetDate,
        input.leaseOwner,
        input.leaseExpiresAt,
        input.occurredAt,
        input.occurredAt,
      );
      const job = this.requireScheduledJob(input.jobName, input.targetDate);
      this.#database.exec("COMMIT");
      return { outcome: "acquired", job };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  completeScheduledJob(
    jobName: ScheduledJobName,
    targetDate: string,
    leaseOwner: string,
    completedAt: string,
  ): ScheduledJob {
    return this.finishScheduledJob(jobName, targetDate, leaseOwner, completedAt, "succeeded", null);
  }

  failScheduledJob(
    jobName: ScheduledJobName,
    targetDate: string,
    leaseOwner: string,
    failedAt: string,
    errorMessage: string,
  ): ScheduledJob {
    assertNonEmpty(errorMessage, "errorMessage");
    return this.finishScheduledJob(jobName, targetDate, leaseOwner, failedAt, "failed", errorMessage);
  }

  private getLog(id: number): OperationalLog {
    const row = this.#database
      .prepare("SELECT * FROM operational_logs WHERE id = ?")
      .get(id) as OperationalLogRow | undefined;
    if (row === undefined) {
      throw new Error(`Operational log ${id} disappeared after insertion.`);
    }
    return mapOperationalLog(row);
  }

  private getTicket(id: number): FeedbackTicket {
    const row = this.#database
      .prepare("SELECT * FROM feedback_tickets WHERE id = ?")
      .get(id) as FeedbackTicketRow | undefined;
    if (row === undefined) {
      throw new Error(`Feedback ticket ${id} does not exist.`);
    }
    return mapFeedbackTicket(row);
  }

  private getPublicationJob(dayDate: string): PublicationJob | null {
    const row = this.#database
      .prepare("SELECT * FROM publication_jobs WHERE day_date = ?")
      .get(dayDate) as PublicationJobRow | undefined;
    return row === undefined ? null : mapPublicationJob(row);
  }

  private requirePublicationJob(dayDate: string): PublicationJob {
    const job = this.getPublicationJob(dayDate);
    if (job === null) {
      throw new Error(`Publication job ${dayDate} does not exist.`);
    }
    return job;
  }

  private requireAdminSession(tokenHash: string): AdminSession {
    const row = this.#database
      .prepare("SELECT * FROM admin_sessions WHERE token_hash = ?")
      .get(tokenHash) as AdminSessionRow | undefined;
    if (row === undefined) {
      throw new Error("Admin session disappeared after insertion.");
    }
    return mapAdminSession(row);
  }

  private getScheduledJob(jobName: ScheduledJobName, targetDate: string): ScheduledJob | null {
    const row = this.#database
      .prepare("SELECT * FROM scheduled_jobs WHERE job_name = ? AND target_date = ?")
      .get(jobName, targetDate) as ScheduledJobRow | undefined;
    return row === undefined ? null : mapScheduledJob(row);
  }

  private requireScheduledJob(jobName: ScheduledJobName, targetDate: string): ScheduledJob {
    const job = this.getScheduledJob(jobName, targetDate);
    if (job === null) throw new Error(`Scheduled job ${jobName}/${targetDate} does not exist.`);
    return job;
  }

  private finishScheduledJob(
    jobName: ScheduledJobName,
    targetDate: string,
    leaseOwner: string,
    occurredAt: string,
    state: "succeeded" | "failed",
    errorMessage: string | null,
  ): ScheduledJob {
    validateScheduledJobIdentity(jobName, targetDate);
    assertNonEmpty(leaseOwner, "leaseOwner");
    assertTimestamp(occurredAt, "occurredAt");
    const result = this.#database.prepare(`
      UPDATE scheduled_jobs
      SET state = ?, lease_owner = NULL, lease_expires_at = NULL,
          completed_at = ?, last_error = ?, updated_at = ?
      WHERE job_name = ? AND target_date = ?
        AND state = 'running' AND lease_owner = ?
    `).run(state, occurredAt, errorMessage, occurredAt, jobName, targetDate, leaseOwner);
    if (result.changes !== 1) {
      throw new Error(`Scheduled job lease for ${jobName}/${targetDate} is not owned by ${leaseOwner}.`);
    }
    return this.requireScheduledJob(jobName, targetDate);
  }

  private finishPublication(
    dayDate: string,
    leaseOwner: string,
    occurredAt: string,
    state: "triggered" | "failed",
    errorMessage: string | null,
  ): PublicationJob {
    assertCalendarDate(dayDate, "dayDate");
    assertNonEmpty(leaseOwner, "leaseOwner");
    assertTimestamp(occurredAt, "occurredAt");
    const result = this.#database
      .prepare(
        `
          UPDATE publication_jobs
          SET state = ?, lease_owner = NULL, lease_expires_at = NULL,
              last_error = ?, completed_at = ?, updated_at = ?
          WHERE day_date = ? AND state = 'triggering' AND lease_owner = ?
        `,
      )
      .run(
        state,
        errorMessage,
        state === "triggered" ? occurredAt : null,
        occurredAt,
        dayDate,
        leaseOwner,
      );
    if (result.changes !== 1) {
      throw new Error(`Publication lease for ${dayDate} is not owned by ${leaseOwner}.`);
    }
    return this.requirePublicationJob(dayDate);
  }
}

function validateOperationalLog(input: AppendOperationalLogInput): void {
  assertNonEmpty(input.eventType, "eventType");
  assertTimestamp(input.occurredAt, "occurredAt");
  if (!includes(LOG_LEVELS, input.level)) {
    throw new TypeError("level is invalid.");
  }
  if (input.runId !== undefined && input.runId !== null) {
    assertNonEmpty(input.runId, "runId");
  }
  if (
    input.briefDate !== undefined &&
    input.briefDate !== null &&
    !isCalendarDate(input.briefDate)
  ) {
    throw new TypeError("briefDate must use YYYY-MM-DD format.");
  }
}

function mapOperationalLog(row: OperationalLogRow): OperationalLog {
  const details = JSON.parse(row.details_json) as unknown;
  if (!isJsonObject(details)) {
    throw new Error(`Operational log ${row.id} has invalid details JSON.`);
  }
  return {
    id: row.id,
    runId: row.run_id,
    briefDate: row.brief_date,
    eventType: row.event_type,
    level: row.level as LogLevel,
    message: row.message,
    details,
    occurredAt: row.occurred_at,
  };
}

function mapPublicationJob(row: PublicationJobRow): PublicationJob {
  if (!includes(PUBLICATION_STATES, row.state)) {
    throw new Error(`Publication job ${row.day_date} has invalid state ${row.state}.`);
  }
  return {
    dayDate: row.day_date,
    state: row.state,
    attemptCount: row.attempt_count,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function mapAdminSession(row: AdminSessionRow): AdminSession {
  return {
    tokenHash: row.token_hash,
    csrfTokenHash: row.csrf_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapScheduledJob(row: ScheduledJobRow): ScheduledJob {
  if (!includes(SCHEDULED_JOB_NAMES, row.job_name) || !includes(SCHEDULED_JOB_STATES, row.state)) {
    throw new Error(`Scheduled job ${row.job_name}/${row.target_date} has invalid state.`);
  }
  return {
    jobName: row.job_name,
    targetDate: row.target_date,
    state: row.state,
    attemptCount: row.attempt_count,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function mapFeedbackTicket(row: FeedbackTicketRow): FeedbackTicket {
  return {
    id: row.id,
    title: row.title,
    submitterName: row.submitter_name,
    category: row.category as FeedbackCategory,
    body: row.body,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function serializeDetails(details: Readonly<Record<string, JsonValue>>): string {
  try {
    return JSON.stringify(details);
  } catch (error) {
    throw new TypeError("details must be JSON-serializable.", { cause: error });
  }
}

function isJsonObject(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function assertNonEmpty(value: string, path: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${path} cannot be empty.`);
  }
}

function assertTimestamp(value: string, path: string): void {
  if (!isUtcTimestamp(value)) {
    throw new TypeError(`${path} must be an ISO 8601 UTC timestamp.`);
  }
}

function assertCalendarDate(value: string, path: string): void {
  if (!isCalendarDate(value)) {
    throw new TypeError(`${path} must use YYYY-MM-DD format.`);
  }
}

function assertSha256(value: string, path: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 hex digest.`);
  }
}

function assertPositiveInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${path} must be a positive integer.`);
  }
}

function validateScheduledJobIdentity(jobName: string, targetDate: string): asserts jobName is ScheduledJobName {
  if (!includes(SCHEDULED_JOB_NAMES, jobName)) throw new TypeError("jobName is invalid.");
  assertCalendarDate(targetDate, "targetDate");
}

function validatePagination(limit = 100, offset = 0): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("limit must be an integer between 1 and 1000.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer.");
  }
}
