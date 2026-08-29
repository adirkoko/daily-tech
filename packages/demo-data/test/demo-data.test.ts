import Database from "better-sqlite3";
import {
  expectedBriefRelativePath,
  validateBriefArtifact,
  validateDayMetadata,
  type DayMetadata,
} from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runDemoDataCli } from "../src/cli.js";

const FIXED_NOW = new Date("2026-08-29T09:00:00.000Z");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("demo-data guardrail", () => {
  it.each([
    ["missing environment value", undefined, true],
    ["false environment value", "false", true],
    ["missing confirmation flag", "true", false],
  ])("refuses %s without writing", async (_name, envValue, confirmReset) => {
    const root = await temporaryRoot();
    const daily = join(root, "content", "daily");
    const sentinel = join(daily, "sentinel.md");
    await mkdir(daily, { recursive: true });
    await writeFile(sentinel, "keep me", "utf8");
    const errors: string[] = [];
    const args = ["clear", ...(confirmReset ? ["--confirm-reset"] : [])];

    const exitCode = await runDemoDataCli({
      args,
      cwd: root,
      environment: {
        TECH_BRIEFS_ROOT: "content",
        ALLOW_DESTRUCTIVE_DEMO_DATA_RESET: envValue,
      },
      stderr: (message) => errors.push(message),
      stdout: () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("demo-data");
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep me");
    expect(existsSync(join(root, "content", "meta"))).toBe(false);
  });

  it("allows an enabled environment with explicit confirmation", async () => {
    const root = await temporaryRoot();
    const result = await runClear(root);

    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("Demo/application data cleared successfully");
  });
});

describe("demo-data clear", () => {
  it("clears application rows and daily files while retaining migrations, sessions, and meta", async () => {
    const root = await temporaryRoot();
    const paths = pathsFor(root);
    await seedAllClearableTables(paths.databasePath);
    await mkdir(join(paths.dailyPath, "nested"), { recursive: true });
    await writeFile(join(paths.dailyPath, ".gitkeep"), "", "utf8");
    await writeFile(join(paths.dailyPath, "2026-08-28-tech_briefs.md"), "content", "utf8");
    await writeFile(join(paths.dailyPath, "nested", "old.md"), "content", "utf8");
    await writeFile(join(paths.metaPath, "keep.txt"), "keep", "utf8");

    const result = await runClear(root);

    expect(result.exitCode, result.output).toBe(0);
    const database = new Database(paths.databasePath, { readonly: true });
    try {
      for (const table of [
        "daily_briefs",
        "publication_jobs",
        "scheduled_jobs",
        "operational_logs",
        "feedback_tickets",
        "rate_limit_counters",
      ]) {
        expect(rowCount(database, table), table).toBe(0);
      }
      expect(rowCount(database, "schema_migrations")).toBeGreaterThan(0);
      expect(rowCount(database, "admin_sessions")).toBe(1);
      const sequenceRows = database
        .prepare(
          "SELECT name FROM sqlite_sequence WHERE name IN ('operational_logs', 'feedback_tickets')",
        )
        .all();
      expect(sequenceRows).toEqual([]);
    } finally {
      database.close();
    }

    expect(existsSync(join(paths.dailyPath, ".gitkeep"))).toBe(true);
    expect(existsSync(join(paths.dailyPath, "2026-08-28-tech_briefs.md"))).toBe(false);
    expect(existsSync(join(paths.dailyPath, "nested"))).toBe(false);
    await expect(readFile(join(paths.metaPath, "keep.txt"), "utf8")).resolves.toBe("keep");
    expect(existsSync(paths.databasePath)).toBe(true);
  });
});

describe("demo-data generate", () => {
  it("creates one valid brief per day plus varied statuses, tickets, and logs", async () => {
    const root = await temporaryRoot();
    const result = await runGenerate(root);

    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("Demo data generated successfully");
    const paths = pathsFor(root);
    const database = DailyTechDatabase.open({ filename: paths.databasePath, readOnly: true });
    try {
      const days = database.listDays({ order: "asc", limit: 1_000 });
      expect(days).toHaveLength(28);
      expect(days[0]?.date).toBe("2026-08-01");
      expect(days.at(-1)?.date).toBe("2026-08-28");
      expect(new Set(days.map((day) => day.status))).toEqual(
        new Set(["published", "ready", "draft", "failed"]),
      );
      expect(days.at(-1)?.status).toBe("published");

      for (const day of days) {
        expect(validateDayMetadata(day).valid, day.date).toBe(true);
        const relativePath = expectedBriefRelativePath(day.date);
        expect(relativePath).not.toBeNull();
        const filePath = join(paths.dailyPath, relativePath!);
        const content = await readFile(filePath);
        const validation = validateBriefArtifact({ filePath, content, metadata: day });
        expect(validation.valid, `${day.date}: ${validation.valid ? "" : JSON.stringify(validation.issues)}`).toBe(true);
      }

      const tickets = database.operations.listTickets({ limit: 1_000 });
      expect(tickets.some((ticket) => ticket.category === "system")).toBe(true);
      expect(tickets.some((ticket) => ticket.category !== "system")).toBe(true);
      const logs = database.operations.listLogs({ limit: 1_000 });
      expect(logs).toHaveLength(days.length);
      expect(new Set(logs.map((log) => log.eventType))).toEqual(
        new Set(["run_completed", "run_failed"]),
      );
    } finally {
      database.close();
    }
  });

  it("clears before every generation so repeated runs are deterministic and do not accumulate", async () => {
    const root = await temporaryRoot();
    const firstRun = await runGenerate(root);
    expect(firstRun.exitCode, firstRun.output).toBe(0);
    const first = readDatasetSnapshot(pathsFor(root).databasePath);

    const secondRun = await runGenerate(root);
    expect(secondRun.exitCode, secondRun.output).toBe(0);
    const second = readDatasetSnapshot(pathsFor(root).databasePath);

    expect(second).toEqual(first);
  });
});

describe("demo-data isolation", () => {
  it("is not imported or depended on by production packages and apps", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const violations: string[] = [];
    for (const topLevel of ["apps", "packages"] as const) {
      await inspectProductionTree(join(repositoryRoot, topLevel), violations);
    }
    expect(violations).toEqual([]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "daily-tech-demo-data-"));
  temporaryDirectories.push(root);
  return root;
}

function pathsFor(root: string): {
  readonly contentRoot: string;
  readonly dailyPath: string;
  readonly metaPath: string;
  readonly databasePath: string;
} {
  const contentRoot = join(root, "content");
  const metaPath = join(contentRoot, "meta");
  return {
    contentRoot,
    dailyPath: join(contentRoot, "daily"),
    metaPath,
    databasePath: join(metaPath, "tech_briefs.db"),
  };
}

async function runClear(root: string): Promise<{ readonly exitCode: number; readonly output: string }> {
  return runCli(root, ["clear", "--confirm-reset"]);
}

async function runGenerate(root: string): Promise<{ readonly exitCode: number; readonly output: string }> {
  return runCli(root, ["generate", "--months=1", "--seed=123", "--confirm-reset"]);
}

async function runCli(
  root: string,
  args: readonly string[],
): Promise<{ readonly exitCode: number; readonly output: string }> {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await runDemoDataCli({
    args,
    cwd: root,
    environment: {
      TECH_BRIEFS_ROOT: "content",
      ALLOW_DESTRUCTIVE_DEMO_DATA_RESET: "true",
    },
    now: FIXED_NOW,
    stdout: (message) => output.push(message),
    stderr: (message) => errors.push(message),
  });
  return { exitCode, output: [...output, ...errors].join("\n") };
}

async function seedAllClearableTables(databasePath: string): Promise<void> {
  await mkdir(resolve(databasePath, ".."), { recursive: true });
  const database = DailyTechDatabase.open({ filename: databasePath });
  const metadata = sampleMetadata();
  database.saveDay(metadata);
  database.operations.appendLog({
    runId: "run-2026-08-28",
    briefDate: metadata.date,
    eventType: "run_completed",
    level: "info",
    occurredAt: "2026-08-28T00:00:00.000Z",
  });
  database.operations.createTicket({
    title: "Feedback",
    category: "general",
    body: "A valid feedback body.",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
  database.operations.consumeRateLimit({
    scope: "feedback",
    keyHash: "hashed-key",
    windowStartedAt: "2026-08-28T00:00:00.000Z",
    occurredAt: "2026-08-28T00:00:00.000Z",
    limit: 5,
  });
  database.operations.beginPublication({
    dayDate: metadata.date,
    leaseOwner: "test-worker",
    leaseExpiresAt: "2026-08-28T02:00:00.000Z",
    occurredAt: "2026-08-28T01:00:00.000Z",
  });
  database.operations.beginScheduledJob({
    jobName: "generate",
    targetDate: metadata.date,
    leaseOwner: "test-worker",
    leaseExpiresAt: "2026-08-28T02:00:00.000Z",
    occurredAt: "2026-08-28T01:00:00.000Z",
  });
  database.operations.createAdminSession({
    tokenHash: "a".repeat(64),
    csrfTokenHash: "b".repeat(64),
    createdAt: "2026-08-28T00:00:00.000Z",
    expiresAt: "2026-08-29T00:00:00.000Z",
  });
  database.close();
}

function sampleMetadata(): DayMetadata {
  return {
    date: "2026-08-28",
    summary: "A valid summary.",
    significant_items: 0,
    worth_watching_items: 0,
    day_intensity: "minimal",
    companies: ["Example"],
    topics: ["Testing"],
    developments: [],
    status: "published",
    source_count: 0,
    created_at: "2026-08-27T22:00:00.000Z",
    published_at: "2026-08-28T04:00:00.000Z",
    updated_at: null,
  };
}

function rowCount(database: Database.Database, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function readDatasetSnapshot(databasePath: string): unknown {
  const database = new Database(databasePath, { readonly: true });
  try {
    return {
      days: database.prepare("SELECT * FROM daily_briefs ORDER BY date").all(),
      logs: database.prepare("SELECT * FROM operational_logs ORDER BY id").all(),
      tickets: database.prepare("SELECT * FROM feedback_tickets ORDER BY id").all(),
    };
  } finally {
    database.close();
  }
}

async function inspectProductionTree(directory: string, violations: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "demo-data" || entry.name === "dist" || entry.name === "node_modules") continue;
      await inspectProductionTree(path, violations);
      continue;
    }
    if (
      entry.name !== "package.json" &&
      ![".ts", ".tsx", ".js", ".mjs", ".cjs", ".astro"].some((extension) =>
        entry.name.endsWith(extension),
      )
    ) {
      continue;
    }
    if ((await readFile(path, "utf8")).includes("@daily-tech/demo-data")) {
      violations.push(path);
    }
  }
}
