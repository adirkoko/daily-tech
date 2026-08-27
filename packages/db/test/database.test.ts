import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DailyTechDatabase,
  LATEST_SCHEMA_VERSION,
  MetadataValidationError,
} from "../src/index.js";
import { createMetadata } from "./fixtures.js";

describe("DailyTechDatabase", () => {
  let database: DailyTechDatabase;

  beforeEach(() => {
    database = DailyTechDatabase.open({ filename: ":memory:" });
  });

  afterEach(() => {
    database.close();
  });

  it("opens at the latest schema version", () => {
    expect(database.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
  });

  it("saves and hydrates a full day record", () => {
    const metadata = createMetadata();

    expect(database.saveDay(metadata)).toBe(metadata);
    expect(database.getDay(metadata.date)).toEqual(metadata);
  });

  it("atomically replaces scalar and normalized list values", () => {
    database.saveDay(createMetadata());
    const replacement = createMetadata({
      summary: "תקציר מתוקן.",
      companies: ["Anthropic"],
      topics: [],
      developments: ["עדכון יחיד"],
      significant_items: 1,
      worth_watching_items: 0,
      updated_at: "2026-08-28T06:30:00.000Z",
    });

    database.saveDay(replacement);

    expect(database.getDay(replacement.date)).toEqual(replacement);
  });

  it("returns null for a missing day", () => {
    expect(database.getDay("2026-08-27")).toBeNull();
  });

  it("lists days with stable date ordering, filters, and pagination", () => {
    database.saveDay(
      createMetadata({ date: "2026-08-25", status: "published", published_at: "2026-08-26T04:00:00.000Z" }),
    );
    database.saveDay(createMetadata({ date: "2026-08-26", status: "failed" }));
    database.saveDay(
      createMetadata({ date: "2026-08-27", status: "published", published_at: "2026-08-28T04:00:00.000Z" }),
    );

    expect(database.listDays().map(({ date }) => date)).toEqual([
      "2026-08-27",
      "2026-08-26",
      "2026-08-25",
    ]);
    expect(
      database
        .listDays({
          status: "published",
          from: "2026-08-20",
          to: "2026-08-27",
          order: "asc",
          limit: 1,
          offset: 1,
        })
        .map(({ date }) => date),
    ).toEqual(["2026-08-27"]);
  });

  it("deletes a day and reports whether it existed", () => {
    database.saveDay(createMetadata());

    expect(database.deleteDay("2026-08-27")).toBe(true);
    expect(database.deleteDay("2026-08-27")).toBe(false);
    expect(database.getDay("2026-08-27")).toBeNull();
  });

  it("rejects invalid metadata before writing", () => {
    expect(() =>
      database.saveDay(createMetadata({ status: "invalid" as "ready" })),
    ).toThrow(MetadataValidationError);
    expect(database.listDays()).toHaveLength(0);
  });

  it("validates dates, ranges, and pagination options", () => {
    expect(() => database.getDay("today")).toThrow(TypeError);
    expect(() =>
      database.listDays({ from: "2026-08-28", to: "2026-08-27" }),
    ).toThrow(RangeError);
    expect(() => database.listDays({ limit: 0 })).toThrow(RangeError);
    expect(() => database.listDays({ offset: -1 })).toThrow(RangeError);
  });

  it("does not allow migrations on a read-only connection", () => {
    expect(() =>
      DailyTechDatabase.open({
        filename: ":memory:",
        readOnly: true,
        migrate: true,
      }),
    ).toThrow(TypeError);
  });
});
