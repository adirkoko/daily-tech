#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { DailyTechDatabase } from "@daily-tech/db";

import { OpenAiCompatibleCompletionClient } from "./ai/completion-client.js";
import { OpenAiResponsesWebResearchClient } from "./ai/web-research-client.js";
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
    const sharedOptions = {
      apiKey: config.aiApiKey,
      model: config.aiModel,
      baseUrl: config.aiBaseUrl,
    };
    const pipeline = createProductionPipeline({
      completionClient: new OpenAiCompatibleCompletionClient(sharedOptions),
      webResearchClient: new OpenAiResponsesWebResearchClient(sharedOptions),
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
        researchedStories: result.researchedStories,
        includedStories: result.includedStories,
        revisionRounds: result.revisionRounds,
        gapStoriesAdded: result.gapStoriesAdded,
        rejectedStories: result.rejectedStories,
        modelRequests: result.modelRequests,
        sourceCount: result.artifact.metadata.source_count,
        usage: result.usage,
      })}\n`,
    );
  } finally {
    database.close();
  }
}

function parseRunAt(arguments_: readonly string[]): Date | undefined {
  const argument = arguments_.find((value) => value.startsWith("--run-at="));
  if (argument === undefined) return undefined;
  const value = new Date(argument.slice("--run-at=".length));
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("--run-at must contain a valid ISO timestamp.");
  }
  return value;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runPipelineCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown pipeline error."}\n`);
    process.exitCode = 1;
  });
}
