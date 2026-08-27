#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

const allowedScopes = new Set(["admin_login", "feedback"]);

export function resetRateLimits({ databaseFile, scope }) {
  if (!existsSync(databaseFile)) {
    throw new Error(`Database does not exist: ${databaseFile}`);
  }
  if (scope !== undefined && !allowedScopes.has(scope)) {
    throw new Error("Scope must be admin_login or feedback.");
  }

  const database = new Database(databaseFile);
  try {
    const result =
      scope === undefined
        ? database.prepare("DELETE FROM rate_limit_counters").run()
        : database
            .prepare("DELETE FROM rate_limit_counters WHERE scope = ?")
            .run(scope);
    return result.changes;
  } finally {
    database.close();
  }
}

function main() {
  const scopeArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--scope="));
  const scope = scopeArgument?.slice("--scope=".length);
  const contentRoot = resolve(process.env.TECH_BRIEFS_ROOT ?? "tech_briefs");
  const databaseFile = resolve(contentRoot, "meta", "tech_briefs.db");
  const changed = resetRateLimits({ databaseFile, scope });
  process.stdout.write(
    `Reset ${changed} rate-limit counter${changed === 1 ? "" : "s"}${scope ? ` for ${scope}` : ""}.\n`,
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reset error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
