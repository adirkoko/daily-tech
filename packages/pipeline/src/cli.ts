#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isCalendarDate, type BriefArtifact } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";

import { OpenAiCompatibleCompletionClient } from "./ai/completion-client.js";
import { OpenAiResponsesWebResearchClient } from "./ai/web-research-client.js";
import { loadPipelineEnvironment, type PipelineEnvironmentConfig } from "./config.js";
import { exportDryRunArtifacts } from "./dry-run-export.js";
import { PipelineRunError } from "./errors.js";
import { DatabaseFailureReporter, DatabasePipelineLogger } from "./operations-adapters.js";
import { DailyBriefPipeline } from "./orchestrator.js";
import { FileSystemDatabaseArtifactSink } from "./persistence.js";
import { ModelNewsResearchProvider } from "./research/model-news-research-provider.js";
import type {
  ArtifactSink,
  FailureReporter,
  PipelineFailure,
  PipelineLogEvent,
  PipelineLogger,
} from "./types.js";
import { ModelBriefWriter } from "./writing/model-brief-writer.js";
import { previousIsraelDayWindow } from "./window.js";

const DEFAULT_DRY_RUN_OUTPUT_ROOT = "tmp/pipeline-dry-run";
const USAGE = [
  "Usage:",
  "  generate [--run-at=ISO_TIMESTAMP]",
  "  generate --dry-run --date=YYYY-MM-DD [--output-root=PATH]",
  "",
  "Without --dry-run: runs the real pipeline against the configured database and",
  "content store; status ready is persisted. --run-at defaults to now; the brief",
  "always covers the previous Israel calendar day.",
  "",
  "With --dry-run: calls the real AI provider but never opens the database or",
  "writes the content store. Writes a Markdown preview and a YAML preview of the",
  "database rows under --output-root instead. --date is required, to avoid",
  "accidental provider spend for the wrong day.",
].join("\n");

interface CliOptions {
  readonly dryRun: boolean;
  readonly runAt: Date | undefined;
  readonly outputRoot: string;
}

export async function runPipelineCli(
  environment: NodeJS.ProcessEnv = process.env,
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<void> {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const options = parseArguments(arguments_);
  const config = loadPipelineEnvironment(environment);
  const sharedOptions = {
    apiKey: config.aiApiKey,
    model: config.aiModel,
    baseUrl: config.aiBaseUrl,
  };
  const researchProvider = new ModelNewsResearchProvider({
    client: new OpenAiResponsesWebResearchClient(sharedOptions),
  });
  const writer = new ModelBriefWriter({ client: new OpenAiCompatibleCompletionClient(sharedOptions) });

  if (options.dryRun) {
    await runDryRun(researchProvider, writer, config, options);
    return;
  }

  await mkdir(dirname(config.databaseFile), { recursive: true });
  const database = DailyTechDatabase.open({ filename: config.databaseFile });
  try {
    const pipeline = new DailyBriefPipeline(
      {
        researchProvider,
        writer,
        sink: new FileSystemDatabaseArtifactSink({
          storageRoot: config.dailyStorageRoot,
          metadataStore: database,
        }),
        logger: new DatabasePipelineLogger(database),
        failureReporter: new DatabaseFailureReporter(database),
      },
      { storageRoot: config.dailyStorageRoot },
    );
    const result = await pipeline.run(options.runAt);
    process.stdout.write(
      `${JSON.stringify({
        runId: result.runId,
        date: result.window.date,
        status: result.artifact.metadata.status,
        sourceCount: result.artifact.metadata.source_count,
      })}\n`,
    );
  } finally {
    database.close();
  }
}

async function runDryRun(
  researchProvider: ModelNewsResearchProvider,
  writer: ModelBriefWriter,
  config: PipelineEnvironmentConfig,
  options: CliOptions,
): Promise<void> {
  if (options.runAt === undefined) {
    throw new TypeError(`--dry-run requires --date=YYYY-MM-DD.\n\n${USAGE}`);
  }
  const events: PipelineLogEvent[] = [];
  const logger: PipelineLogger = {
    log(event) {
      events.push(event);
      if (event.type === "run_failed") {
        process.stderr.write(`[dry-run] FAILED stage=${event.stage}\n`);
      } else {
        process.stdout.write(`[dry-run] OK stage=${event.stage}\n`);
      }
    },
  };
  const failureReporter: FailureReporter = {
    async report(failure: PipelineFailure) {
      process.stderr.write(`[dry-run] FAILURE stage=${failure.stage} message=${failure.message}\n`);
      for (const issue of failure.validationIssues ?? []) {
        process.stderr.write(
          `[dry-run] VALIDATION code=${issue.code} path=${issue.path} message=${issue.message}\n`,
        );
      }
    },
  };
  const sink = new CapturingArtifactSink();
  const pipeline = new DailyBriefPipeline(
    { researchProvider, writer, sink, logger, failureReporter },
    { storageRoot: config.dailyStorageRoot },
  );

  process.stdout.write(
    `[dry-run] TARGET date=${previousIsraelDayWindow(options.runAt).date} output=${resolve(options.outputRoot)}\n`,
  );
  const result = await pipeline.run(options.runAt);
  const artifact = sink.requireArtifact();
  const paths = await exportDryRunArtifacts(artifact, events, options.outputRoot);
  process.stdout.write(
    [
      `[dry-run] SUCCESS date=${result.window.date} status=${result.artifact.metadata.status}`,
      `[dry-run] MARKDOWN ${paths.markdownPath}`,
      `[dry-run] DATABASE_YAML ${paths.yamlPath}`,
      "",
    ].join("\n"),
  );
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  let dryRun = false;
  let runAtValue: string | undefined;
  let dateValue: string | undefined;
  let outputRoot = DEFAULT_DRY_RUN_OUTPUT_ROOT;
  for (const argument of arguments_) {
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument.startsWith("--run-at=")) {
      if (runAtValue !== undefined) throw new TypeError("--run-at may be supplied only once.");
      runAtValue = argument.slice("--run-at=".length);
      continue;
    }
    if (argument.startsWith("--date=")) {
      if (dateValue !== undefined) throw new TypeError("--date may be supplied only once.");
      dateValue = argument.slice("--date=".length);
      continue;
    }
    if (argument.startsWith("--output-root=")) {
      outputRoot = argument.slice("--output-root=".length).trim();
      if (outputRoot.length === 0) throw new TypeError("--output-root cannot be empty.");
      continue;
    }
    throw new TypeError(`Unknown argument: ${argument}\n\n${USAGE}`);
  }
  if (runAtValue !== undefined && dateValue !== undefined) {
    throw new TypeError(`Use either --run-at or --date, not both.\n\n${USAGE}`);
  }
  const runAt = dateValue !== undefined
    ? runAtForTargetDate(dateValue)
    : runAtValue !== undefined
      ? parseRunAt(runAtValue)
      : undefined;
  return { dryRun, runAt, outputRoot };
}

function parseRunAt(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`--run-at must contain a valid ISO timestamp.\n\n${USAGE}`);
  }
  return parsed;
}

function runAtForTargetDate(date: string): Date {
  if (!isCalendarDate(date)) {
    throw new TypeError(`--date must be a real date in YYYY-MM-DD format.\n\n${USAGE}`);
  }
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
    if (this.#artifact !== null) throw new Error("Dry-run sink received more than one artifact.");
    this.#artifact = artifact;
  }

  requireArtifact(): BriefArtifact {
    if (this.#artifact === null) throw new Error("Pipeline completed without a ready artifact.");
    return this.#artifact;
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runPipelineCli().catch((error: unknown) => {
    const stage = error instanceof PipelineRunError ? ` stage=${error.stage}` : "";
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown pipeline error."}${stage}\n`);
    process.exitCode = 1;
  });
}
