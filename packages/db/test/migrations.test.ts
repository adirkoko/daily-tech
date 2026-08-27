import Database from "better-sqlite3";

import { afterEach, describe, expect, it } from "vitest";

import {
  LATEST_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from "../src/index.js";

describe("database migrations", () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("creates the current schema and is idempotent", () => {
    database = new Database(":memory:");

    runMigrations(database);
    runMigrations(database);

    expect(getSchemaVersion(database)).toBe(LATEST_SCHEMA_VERSION);
    const tables = (database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>)
      .map((row) => row.name);
    expect(tables).toEqual([
      "daily_brief_companies",
      "daily_brief_developments",
      "daily_brief_topics",
      "daily_briefs",
      "feedback_tickets",
      "operational_logs",
      "publication_jobs",
      "rate_limit_counters",
      "schema_migrations",
    ]);
  });

  it("refuses a migration history with a conflicting name", () => {
    database = new Database(":memory:");
    runMigrations(database);
    database
      .prepare("UPDATE schema_migrations SET name = ? WHERE version = 1")
      .run("different_migration");

    expect(() => runMigrations(database!)).toThrow(
      /was applied as different_migration/u,
    );
  });

  it("refuses a schema created by a newer application version", () => {
    database = new Database(":memory:");
    runMigrations(database);
    database
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      )
      .run(99, "future_migration", "2026-08-28T01:00:00.000Z");

    expect(() => runMigrations(database!)).toThrow(
      /newer than this application supports/u,
    );
  });

  it("enforces status and foreign-key constraints in SQLite", () => {
    database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    runMigrations(database);

    expect(() =>
      database!
        .prepare(
          `
            INSERT INTO daily_briefs (
              date, summary, significant_items, worth_watching_items,
              day_intensity, status, source_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          "2026-08-27",
          "Summary",
          0,
          0,
          "minimal",
          "archived",
          0,
          "2026-08-28T01:00:00.000Z",
        ),
    ).toThrow();

    expect(() =>
      database!
        .prepare(
          "INSERT INTO daily_brief_topics (day_date, position, topic) VALUES (?, ?, ?)",
        )
        .run("2026-08-27", 0, "AI"),
    ).toThrow();
  });
});
