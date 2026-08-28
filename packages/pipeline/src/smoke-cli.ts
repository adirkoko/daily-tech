#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isCalendarDate, type BriefArtifact } from "@daily-tech/core";

import { OpenAiCompatibleCompletionClient } from "./ai/completion-client.js";
import { OpenAiResponsesWebResearchClient } from "./ai/web-research-client.js";
import { loadPipelineEnvironment } from "./config.js";
import { PipelineRunError } from "./errors.js";
import { DailyBriefPipeline } from "./orchestrator.js";
import { ModelNewsResearchProvider } from "./research/model-news-research-provider.js";
import {
  exportSmokeArtifacts,
  type SmokeExportPaths,
} from "./smoke-export.js";
import type {
  ArtifactSink,
  FailureReporter,
  PipelineFailure,
  PipelineLogEvent,
  PipelineLogger,
} from "./types.js";
import { ModelBriefWriter } from "./writing/model-brief-writer.js";
import { previousIsraelDayWindow } from "./window.js";

const DEFAULT_OUTPUT_ROOT = "tmp/pipeline-smoke";
const USAGE = [
  "Usage:",
  "  npm run generate:smoke -- --date=YYYY-MM-DD [--output-root=PATH]",
  "",
  "The date is the Israel calendar day to research. No database is opened and no brief is published.",
].join("\n");

interface SmokeCliOptions {
  readonly date: string;
  readonly outputRoot: string;
}

export async function runPipelineSmokeCli(
  environment: NodeJS.ProcessEnv = process.env,
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseArguments(arguments_);
  if (options === null) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const config = loadPipelineEnvironment(environment);
  const sharedClientOptions = {
    apiKey: config.aiApiKey,
    model: config.aiModel,
    baseUrl: config.aiBaseUrl,
  };
  const logger = new ConsoleCaptureLogger();
  const failureReporter = new ConsoleFailureReporter();
  const sink = new CapturingArtifactSink();
  const pipeline = new DailyBriefPipeline(
    {
      researchProvider: new ModelNewsResearchProvider({
        client: new OpenAiResponsesWebResearchClient(sharedClientOptions),
      }),
      writer: new ModelBriefWriter({
        client: new OpenAiCompatibleCompletionClient(sharedClientOptions),
      }),
      sink,
      logger,
      failureReporter,
    },
    {
      storageRoot: config.dailyStorageRoot,
      maxRevisionRounds: config.maxRevisionRounds,
    },
  );

  process.stdout.write(
    `[pipeline-smoke] TARGET date=${options.date} output=${resolve(options.outputRoot)}\n`,
  );
  const result = await pipeline.run(runAtForTargetDate(options.date));
  const artifact = sink.requireArtifact();
  if (artifact !== result.artifact) {
    throw new Error("Smoke sink did not capture the final validated artifact.");
  }
  process.stdout.write("[pipeline-smoke] START stage=export\n");
  let paths: SmokeExportPaths;
  try {
    paths = await exportSmokeArtifacts(artifact, logger.events, options.outputRoot);
  } catch (error) {
    throw new SmokeExportError(error);
  }
  process.stdout.write("[pipeline-smoke] OK stage=export\n");

  process.stdout.write(
    [
      `[pipeline-smoke] SUCCESS date=${result.window.date} status=${result.artifact.metadata.status}`,
      `[pipeline-smoke] MODEL_REQUESTS count=${result.modelRequests} revisions=${result.revisionRounds}`,
      `[pipeline-smoke] STORIES researched=${result.researchedStories} included=${result.includedStories} rejected=${result.rejectedStories} gap_added=${result.gapStoriesAdded}`,
      `[pipeline-smoke] USAGE tokens=${result.usage.totalTokens} web_search_calls=${result.usage.webSearchCalls} cost_usd=${result.usage.costUsd} web_search_cost_usd=${result.usage.webSearchCostUsd}`,
      `[pipeline-smoke] MARKDOWN ${paths.markdownPath}`,
      `[pipeline-smoke] DATABASE_YAML ${paths.yamlPath}`,
      "",
    ].join("\n"),
  );
}

function parseArguments(arguments_: readonly string[]): SmokeCliOptions | null {
  if (arguments_.includes("--help") || arguments_.includes("-h")) return null;
  let date: string | undefined;
  let outputRoot = DEFAULT_OUTPUT_ROOT;
  for (const argument of arguments_) {
    if (argument.startsWith("--date=")) {
      if (date !== undefined) throw new TypeError("--date may be supplied only once.");
      date = argument.slice("--date=".length);
      continue;
    }
    if (argument.startsWith("--output-root=")) {
      outputRoot = argument.slice("--output-root=".length).trim();
      if (outputRoot.length === 0) throw new TypeError("--output-root cannot be empty.");
      continue;
    }
    throw new TypeError(`Unknown argument: ${argument}\n\n${USAGE}`);
  }
  if (date === undefined || !isCalendarDate(date)) {
    throw new TypeError(`--date must be a real date in YYYY-MM-DD format.\n\n${USAGE}`);
  }
  return { date, outputRoot };
}

function runAtForTargetDate(date: string): Date {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const runAt = new Date(Date.UTC(year, month - 1, day + 1, 12));
  if (previousIsraelDayWindow(runAt).date !== date) {
    throw new Error(`Could not resolve the Israel research window for ${date}.`);
  }
  return runAt;
}

class CapturingArtifactSink implements ArtifactSink {
  #artifact: BriefArtifact | null = null;

  async saveReady(artifact: BriefArtifact): Promise<void> {
    if (this.#artifact !== null) throw new Error("Smoke sink received more than one artifact.");
    this.#artifact = artifact;
  }

  requireArtifact(): BriefArtifact {
    if (this.#artifact === null) throw new Error("Pipeline completed without a ready artifact.");
    return this.#artifact;
  }
}

class ConsoleCaptureLogger implements PipelineLogger {
  readonly events: PipelineLogEvent[] = [];

  log(event: PipelineLogEvent): void {
    this.events.push(event);
    if (event.type === "stage_started") {
      process.stdout.write(`[pipeline-smoke] START stage=${event.stage}\n`);
    } else if (event.type === "stage_completed") {
      process.stdout.write(`[pipeline-smoke] OK stage=${event.stage}\n`);
    } else if (event.type === "run_started") {
      process.stdout.write(`[pipeline-smoke] RUN_STARTED id=${event.runId}\n`);
    } else if (event.type === "run_failed") {
      process.stderr.write(`[pipeline-smoke] FAILED stage=${event.stage}\n`);
    }
  }
}

class ConsoleFailureReporter implements FailureReporter {
  async report(failure: PipelineFailure): Promise<void> {
    process.stderr.write(
      `[pipeline-smoke] FAILURE stage=${failure.stage} message=${failure.message}\n`,
    );
    for (const issue of failure.validationIssues ?? []) {
      process.stderr.write(
        `[pipeline-smoke] VALIDATION code=${issue.code} path=${issue.path} message=${issue.message}\n`,
      );
    }
  }
}

class SmokeExportError extends Error {
  constructor(cause: unknown) {
    super("Failed to write the smoke-test Markdown and YAML outputs.", { cause });
    this.name = "SmokeExportError";
  }
}

function formatError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(`${current.name}: ${current.message}`);
    current = current.cause;
  }
  return messages.join(" <- ") || "Unknown smoke-test failure.";
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runPipelineSmokeCli().catch((error: unknown) => {
    const stage = error instanceof PipelineRunError
      ? error.stage
      : error instanceof SmokeExportError
        ? "export"
        : "setup";
    process.stderr.write(`[pipeline-smoke] EXIT_FAILURE stage=${stage} ${formatError(error)}\n`);
    process.stderr.write("[pipeline-smoke] No smoke output should be trusted from this failed run.\n");
    process.exitCode = 1;
  });
}
