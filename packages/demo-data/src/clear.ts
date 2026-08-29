import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { readdir, rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";

export const TABLES_TO_CLEAR = [
  "publication_jobs",
  "scheduled_jobs",
  "operational_logs",
  "feedback_tickets",
  "rate_limit_counters",
  "daily_briefs",
] as const;

export const TABLES_TO_KEEP = ["schema_migrations", "admin_sessions"] as const;

export interface DemoDataPaths {
  readonly contentRoot: string;
  readonly dailyContentPath: string;
  readonly databasePath: string;
}

export interface ClearApplicationDataResult {
  readonly databaseExisted: boolean;
}

export function resolveDemoDataPaths(
  cwd: string,
  environment: Readonly<Record<string, string | undefined>>,
): DemoDataPaths {
  const configuredRoot = environment.TECH_BRIEFS_ROOT?.trim();
  const contentRoot = resolve(cwd, configuredRoot === undefined || configuredRoot.length === 0 ? "tech_briefs" : configuredRoot);
  return {
    contentRoot,
    dailyContentPath: resolve(contentRoot, "daily"),
    databasePath: resolve(contentRoot, "meta", "tech_briefs.db"),
  };
}

export async function clearApplicationData(
  paths: DemoDataPaths,
): Promise<ClearApplicationDataResult> {
  const databaseExisted = existsSync(paths.databasePath);

  if (databaseExisted) {
    const database = new Database(paths.databasePath);
    try {
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      const clearDatabase = database.transaction(() => {
        database.prepare("DELETE FROM publication_jobs").run();
        database.prepare("DELETE FROM scheduled_jobs").run();
        database.prepare("DELETE FROM operational_logs").run();
        database.prepare("DELETE FROM feedback_tickets").run();
        database.prepare("DELETE FROM rate_limit_counters").run();
        database.prepare("DELETE FROM daily_briefs").run();
        database
          .prepare(
            "DELETE FROM sqlite_sequence WHERE name IN ('operational_logs', 'feedback_tickets')",
          )
          .run();
      });
      clearDatabase.immediate();
    } finally {
      database.close();
    }
  }

  await clearDailyContent(paths.dailyContentPath);
  return { databaseExisted };
}

async function clearDailyContent(directoryPath: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isFile() && entry.name === ".gitkeep") continue;

    if (entry.isDirectory()) {
      await clearDailyContent(entryPath);
      const remaining = await readdir(entryPath);
      if (remaining.length === 0) await rmdir(entryPath);
      continue;
    }

    await rm(entryPath, { force: true, recursive: entry.isSymbolicLink() });
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
