#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { DailyTechDatabase } from "@daily-tech/db";

import { OpenAiCompatibleClient } from "./ai-client.js";
import { BraveSearchProvider } from "./brave-search.js";
import { loadPipelineEnvironment } from "./config.js";
import { createProductionPipeline } from "./factory.js";

export async function runPipelineCli(
  environment: NodeJS.ProcessEnv = process.env,
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const config = loadPipelineEnvironment(environment);
  const runAt = parseRunAt(arguments_);
  await mkdir(dirname(config.databaseFile), { recursive: true });
  const database = DailyTechDatabase.open({ filename: config.databaseFile });
  try {
    const pipeline = createProductionPipeline({
      client: new OpenAiCompatibleClient({
        apiKey: config.aiApiKey,
        model: config.aiModel,
        baseUrl: config.aiBaseUrl,
      }),
      search: new BraveSearchProvider({ apiKey: config.braveSearchApiKey }),
      database,
      storageRoot: config.dailyStorageRoot,
      maxRevisionRounds: config.maxRevisionRounds,
    });
    const result = await pipeline.run(runAt);
    process.stdout.write(
      `${JSON.stringify({
        runId: result.runId,
        date: result.window.date,
        status: result.artifact.metadata.status,
        developments: result.selectedDevelopments,
        revisionRounds: result.revisionRounds,
        sourceCount: result.artifact.metadata.source_count,
        usage: result.usage,
      })}\n`,
    );
  } finally {
    database.close();
  }
}

function parseRunAt(arguments_: readonly string[]): Date | undefined {
  const runAtArgument = arguments_.find((argument) => argument.startsWith("--run-at="));
  if (runAtArgument === undefined) {
    return undefined;
  }
  const value = new Date(runAtArgument.slice("--run-at=".length));
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("--run-at must contain a valid ISO timestamp.");
  }
  return value;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runPipelineCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown pipeline error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
