#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { isCalendarDate } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";

import { loadPublisherEnvironment } from "./config.js";
import { previousIsraelCalendarDate } from "./date.js";
import { BriefPublisher } from "./publisher.js";
import { LocalDeploymentTrigger } from "./local.js";
import { WebhookDeploymentTrigger } from "./webhook.js";

export async function runPublisherCli(
  environment: NodeJS.ProcessEnv = process.env,
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const config = loadPublisherEnvironment(environment);
  const runAt = parseRunAt(arguments_);
  const date = parseDate(arguments_) ?? previousIsraelCalendarDate(runAt);
  await mkdir(dirname(config.databaseFile), { recursive: true });
  const database = DailyTechDatabase.open({ filename: config.databaseFile });
  try {
    const publisher = new BriefPublisher({
      database,
      dailyStorageRoot: config.dailyStorageRoot,
      leaseDurationMs: config.leaseDurationMs,
      deploymentTrigger: config.webhookUrl === null
        ? new LocalDeploymentTrigger()
        : new WebhookDeploymentTrigger({
            url: config.webhookUrl,
            token: config.webhookToken,
            timeoutMs: config.webhookTimeoutMs,
          }),
    });
    const result = await publisher.publish(date);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    database.close();
  }
}

function parseDate(arguments_: readonly string[]): string | undefined {
  const argument = arguments_.find((value) => value.startsWith("--date="));
  if (argument === undefined) return undefined;
  const date = argument.slice("--date=".length);
  if (!isCalendarDate(date)) {
    throw new TypeError("--date must use YYYY-MM-DD format.");
  }
  return date;
}

function parseRunAt(arguments_: readonly string[]): Date {
  const argument = arguments_.find((value) => value.startsWith("--run-at="));
  if (argument === undefined) return new Date();
  const runAt = new Date(argument.slice("--run-at=".length));
  if (Number.isNaN(runAt.getTime())) {
    throw new TypeError("--run-at must contain a valid ISO timestamp.");
  }
  return runAt;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runPublisherCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown publisher error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
