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
      "admin_sessions",
      "daily_briefs",
      "feedback_tickets",
      "operational_logs",
      "pipeline_settings",
      "publication_jobs",
      "rate_limit_counters",
      "scheduled_jobs",
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

  it("enforces the status and JSON-array constraints on daily_briefs", () => {
    database = new Database(":memory:");
    runMigrations(database);
    const insert = database.prepare(
      `
        INSERT INTO daily_briefs (
          date, summary, significant_items, worth_watching_items,
          day_intensity, companies, topics, developments, status, source_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    expect(() =>
      insert.run(
        "2026-08-27",
        "Summary",
        0,
        0,
        "minimal",
        "[]",
        "[]",
        "[]",
        "archived",
        0,
        "2026-08-28T01:00:00.000Z",
      ),
    ).toThrow();

    expect(() =>
      insert.run(
        "2026-08-27",
        "Summary",
        0,
        0,
        "minimal",
        "not json",
        "[]",
        "[]",
        "ready",
        0,
        "2026-08-28T01:00:00.000Z",
      ),
    ).toThrow();

    expect(() =>
      insert.run(
        "2026-08-27",
        "Summary",
        0,
        0,
        "minimal",
        '{"not":"an array"}',
        "[]",
        "[]",
        "ready",
        0,
        "2026-08-28T01:00:00.000Z",
      ),
    ).toThrow();
  });

  it("seeds exactly one pipeline_settings row with sane defaults", () => {
    database = new Database(":memory:");
    runMigrations(database);

    const rows = database.prepare("SELECT * FROM pipeline_settings").all() as Array<{
      id: number;
      admin_keywords: string;
      maximum_stories: number;
      gap_discovery_enabled: number;
      admin_keywords_research_enabled: number;
      generate_time: string;
      publish_time: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      admin_keywords: "[]",
      maximum_stories: 8,
      gap_discovery_enabled: 1,
      admin_keywords_research_enabled: 1,
      generate_time: "01:00",
      publish_time: "07:00",
    });

    expect(() =>
      database!.prepare("INSERT INTO pipeline_settings (id, updated_at) VALUES (2, ?)").run(
        "2026-08-28T01:00:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      database!.prepare("UPDATE pipeline_settings SET maximum_stories = 21 WHERE id = 1").run(),
    ).toThrow();
    expect(() =>
      database!.prepare("UPDATE pipeline_settings SET generate_time = '9:00' WHERE id = 1").run(),
    ).toThrow();
    expect(() =>
      database!.prepare("UPDATE pipeline_settings SET generate_time = '25:00' WHERE id = 1").run(),
    ).toThrow();
  });
});
