import Database from "better-sqlite3";

import {
  VALIDATION_CODES,
  isBriefStatus,
  isCalendarDate,
  isUtcTimestamp,
  validateDayMetadata,
  type BriefStatus,
  type DayMetadata,
} from "@daily-tech/core";

import { DatabaseIntegrityError, MetadataValidationError } from "./errors.js";
import { getSchemaVersion, runMigrations } from "./migrations.js";
import { OperationsStore } from "./operations.js";

export interface OpenDatabaseOptions {
  readonly filename: string;
  readonly readOnly?: boolean;
  /** Defaults to true for writable databases and false for read-only databases. */
  readonly migrate?: boolean;
}

export interface ListDaysOptions {
  readonly status?: BriefStatus;
  readonly from?: string;
  readonly to?: string;
  readonly order?: "asc" | "desc";
  readonly limit?: number;
  readonly offset?: number;
}

export type PublishReadyDayResult =
  | { readonly outcome: "published"; readonly metadata: DayMetadata }
  | { readonly outcome: "already_published"; readonly metadata: DayMetadata }
  | { readonly outcome: "not_ready"; readonly metadata: DayMetadata }
  | { readonly outcome: "not_found"; readonly metadata: null };

type DatabaseRow = Record<string, null | number | bigint | string | Uint8Array>;

export class DailyTechDatabase {
  readonly #database: Database.Database;
  readonly operations: OperationsStore;

  private constructor(database: Database.Database) {
    this.#database = database;
    this.operations = new OperationsStore(database);
  }

  static open(options: OpenDatabaseOptions): DailyTechDatabase {
    if (options.filename.trim().length === 0) {
      throw new TypeError("Database filename cannot be empty.");
    }

    const readOnly = options.readOnly ?? false;
    const shouldMigrate = options.migrate ?? !readOnly;
    if (readOnly && shouldMigrate) {
      throw new TypeError("Migrations cannot run on a read-only database.");
    }

    const database = new Database(options.filename, { readonly: readOnly });

    try {
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      if (!readOnly && options.filename !== ":memory:") {
        database.pragma("journal_mode = WAL");
      }
      if (shouldMigrate) {
        runMigrations(database);
      }
      return new DailyTechDatabase(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  get schemaVersion(): number {
    return getSchemaVersion(this.#database);
  }

  saveDay(value: unknown): DayMetadata {
    const validation = validateDayMetadata(value);
    if (!validation.valid) {
      throw new MetadataValidationError(validation.issues);
    }

    const metadata = validation.data;
    this.#database
      .prepare(
        `
          INSERT INTO daily_briefs (
            date,
            summary,
            significant_items,
            worth_watching_items,
            day_intensity,
            companies,
            topics,
            developments,
            status,
            source_count,
            created_at,
            published_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (date) DO UPDATE SET
            summary = excluded.summary,
            significant_items = excluded.significant_items,
            worth_watching_items = excluded.worth_watching_items,
            day_intensity = excluded.day_intensity,
            companies = excluded.companies,
            topics = excluded.topics,
            developments = excluded.developments,
            status = excluded.status,
            source_count = excluded.source_count,
            created_at = excluded.created_at,
            published_at = excluded.published_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        metadata.date,
        metadata.summary,
        metadata.significant_items,
        metadata.worth_watching_items,
        metadata.day_intensity,
        JSON.stringify(metadata.companies),
        JSON.stringify(metadata.topics),
        JSON.stringify(metadata.developments),
        metadata.status,
        metadata.source_count,
        metadata.created_at,
        metadata.published_at,
        metadata.updated_at,
      );

    return metadata;
  }

  getDay(date: string): DayMetadata | null {
    assertDate(date, "date");
    const row = this.#database
      .prepare("SELECT * FROM daily_briefs WHERE date = ?")
      .get(date) as DatabaseRow | undefined;
    if (row === undefined) {
      return null;
    }

    return this.hydrateRows([row])[0] ?? null;
  }

  publishReadyDay(date: string, publishedAt: string): PublishReadyDayResult {
    assertDate(date, "date");
    if (!isUtcTimestamp(publishedAt)) {
      throw new TypeError("publishedAt must be an ISO 8601 UTC timestamp.");
    }

    const result = this.#database
      .prepare(
        `
          UPDATE daily_briefs
          SET status = 'published', published_at = ?
          WHERE date = ? AND status = 'ready'
        `,
      )
      .run(publishedAt, date);
    const metadata = this.getDay(date);
    if (metadata === null) {
      return { outcome: "not_found", metadata: null };
    }
    if (result.changes === 1) {
      return { outcome: "published", metadata };
    }
    return metadata.status === "published"
      ? { outcome: "already_published", metadata }
      : { outcome: "not_ready", metadata };
  }

  listDays(options: ListDaysOptions = {}): readonly DayMetadata[] {
    validateListOptions(options);

    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.status !== undefined) {
      conditions.push("status = ?");
      parameters.push(options.status);
    }
    if (options.from !== undefined) {
      conditions.push("date >= ?");
      parameters.push(options.from);
    }
    if (options.to !== undefined) {
      conditions.push("date <= ?");
      parameters.push(options.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = options.order === "asc" ? "ASC" : "DESC";
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const rows = this.#database
      .prepare(
        `SELECT * FROM daily_briefs ${where} ORDER BY date ${order} LIMIT ? OFFSET ?`,
      )
      .all(...parameters, limit, offset) as DatabaseRow[];

    return this.hydrateRows(rows);
  }

  deleteDay(date: string): boolean {
    assertDate(date, "date");
    const result = this.#database
      .prepare("DELETE FROM daily_briefs WHERE date = ?")
      .run(date);
    return result.changes === 1;
  }

  private hydrateRows(rows: readonly DatabaseRow[]): readonly DayMetadata[] {
    return rows.map((row) => {
      const date = String(row.date);
      const candidate = {
        date,
        summary: row.summary,
        significant_items: row.significant_items,
        worth_watching_items: row.worth_watching_items,
        day_intensity: row.day_intensity,
        companies: parseStringArray(row.companies, date, "companies"),
        topics: parseStringArray(row.topics, date, "topics"),
        developments: parseStringArray(row.developments, date, "developments"),
        status: row.status,
        source_count: row.source_count,
        created_at: row.created_at,
        published_at: row.published_at,
        updated_at: row.updated_at,
      };
      const validation = validateDayMetadata(candidate);
      if (!validation.valid) {
        throw new DatabaseIntegrityError(date, validation.issues);
      }
      return validation.data;
    });
  }
}

function parseStringArray(value: unknown, date: string, column: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    throw new DatabaseIntegrityError(date, [
      { code: VALIDATION_CODES.INVALID_TYPE, path: column, message: `${column} is not valid JSON.` },
    ]);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new DatabaseIntegrityError(date, [
      { code: VALIDATION_CODES.INVALID_TYPE, path: column, message: `${column} must be a JSON array of strings.` },
    ]);
  }
  return parsed;
}

function assertDate(value: string, path: string): void {
  if (!isCalendarDate(value)) {
    throw new TypeError(`${path} must be a real calendar date in YYYY-MM-DD format.`);
  }
}

function validateListOptions(options: ListDaysOptions): void {
  if (options.status !== undefined && !isBriefStatus(options.status)) {
    throw new TypeError("status is invalid.");
  }
  if (options.from !== undefined) {
    assertDate(options.from, "from");
  }
  if (options.to !== undefined) {
    assertDate(options.to, "to");
  }
  if (
    options.from !== undefined &&
    options.to !== undefined &&
    options.from > options.to
  ) {
    throw new RangeError("from cannot be later than to.");
  }
  assertIntegerInRange(options.limit ?? 100, "limit", 1, 1_000);
  assertIntegerInRange(options.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER);
}

function assertIntegerInRange(
  value: number,
  path: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be an integer between ${minimum} and ${maximum}.`);
  }
}
