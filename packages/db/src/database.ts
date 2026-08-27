import Database from "better-sqlite3";

import {
  isBriefStatus,
  isCalendarDate,
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
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `
            INSERT INTO daily_briefs (
              date,
              summary,
              significant_items,
              worth_watching_items,
              day_intensity,
              status,
              source_count,
              created_at,
              published_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (date) DO UPDATE SET
              summary = excluded.summary,
              significant_items = excluded.significant_items,
              worth_watching_items = excluded.worth_watching_items,
              day_intensity = excluded.day_intensity,
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
          metadata.status,
          metadata.source_count,
          metadata.created_at,
          metadata.published_at,
          metadata.updated_at,
        );

      this.replaceRelatedValues(metadata);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

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

  #loadValues(
    table: "daily_brief_companies" | "daily_brief_topics" | "daily_brief_developments",
    valueColumn: "company" | "topic" | "digest",
    dates: readonly string[],
  ): ReadonlyMap<string, readonly string[]> {
    const valuesByDate = new Map<string, string[]>();
    if (dates.length === 0) {
      return valuesByDate;
    }

    const placeholders = dates.map(() => "?").join(", ");
    const rows = this.#database
      .prepare(
        `SELECT day_date, ${valueColumn} AS value FROM ${table} WHERE day_date IN (${placeholders}) ORDER BY day_date, position`,
      )
      .all(...dates) as Array<{ day_date: string; value: string }>;

    for (const row of rows) {
      const date = String(row.day_date);
      const values = valuesByDate.get(date) ?? [];
      values.push(String(row.value));
      valuesByDate.set(date, values);
    }
    return valuesByDate;
  }

  private replaceRelatedValues(metadata: DayMetadata): void {
    for (const table of [
      "daily_brief_companies",
      "daily_brief_topics",
      "daily_brief_developments",
    ]) {
      this.#database.prepare(`DELETE FROM ${table} WHERE day_date = ?`).run(metadata.date);
    }

    insertPositionedValues(
      this.#database,
      "daily_brief_companies",
      "company",
      metadata.date,
      metadata.companies,
    );
    insertPositionedValues(
      this.#database,
      "daily_brief_topics",
      "topic",
      metadata.date,
      metadata.topics,
    );
    insertPositionedValues(
      this.#database,
      "daily_brief_developments",
      "digest",
      metadata.date,
      metadata.developments,
    );
  }

  private hydrateRows(rows: readonly DatabaseRow[]): readonly DayMetadata[] {
    const dates = rows.map((row) => String(row.date));
    const companies = this.#loadValues(
      "daily_brief_companies",
      "company",
      dates,
    );
    const topics = this.#loadValues("daily_brief_topics", "topic", dates);
    const developments = this.#loadValues(
      "daily_brief_developments",
      "digest",
      dates,
    );

    return rows.map((row) => {
      const date = String(row.date);
      const candidate = {
        date,
        summary: row.summary,
        significant_items: row.significant_items,
        worth_watching_items: row.worth_watching_items,
        day_intensity: row.day_intensity,
        companies: companies.get(date) ?? [],
        topics: topics.get(date) ?? [],
        developments: developments.get(date) ?? [],
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

function insertPositionedValues(
  database: Database.Database,
  table: string,
  valueColumn: string,
  date: string,
  values: readonly string[],
): void {
  const statement = database.prepare(
    `INSERT INTO ${table} (day_date, position, ${valueColumn}) VALUES (?, ?, ?)`,
  );
  values.forEach((value, position) => statement.run(date, position, value));
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
