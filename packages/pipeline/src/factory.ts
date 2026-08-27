import { DailyTechDatabase } from "@daily-tech/db";

import type { AiCompletionClient } from "./ai-client.js";
import {
  PromptedBriefWriter,
  PromptedEditorialReviewer,
  PromptedNewsFilter,
  SearchBackedMissingNewsChecker,
  SearchBackedNewsResearcher,
  type NewsSearchProvider,
} from "./agents.js";
import {
  DatabaseFailureReporter,
  DatabasePipelineLogger,
} from "./operations-adapters.js";
import {
  DailyBriefPipeline,
  type DailyBriefPipelineOptions,
} from "./orchestrator.js";
import { FileSystemDatabaseArtifactSink } from "./persistence.js";
import type { Clock } from "./types.js";

export interface ProductionPipelineOptions {
  readonly client: AiCompletionClient;
  readonly search: NewsSearchProvider;
  readonly database: DailyTechDatabase;
  readonly storageRoot: string;
  readonly maxRevisionRounds?: number;
  readonly clock?: Clock;
  readonly createRunId?: () => string;
}

export function createProductionPipeline(
  options: ProductionPipelineOptions,
): DailyBriefPipeline {
  const pipelineOptions: DailyBriefPipelineOptions = {
    storageRoot: options.storageRoot,
    ...(options.maxRevisionRounds === undefined
      ? {}
      : { maxRevisionRounds: options.maxRevisionRounds }),
  };
  return new DailyBriefPipeline(
    {
      researcher: new SearchBackedNewsResearcher({
        client: options.client,
        search: options.search,
      }),
      filter: new PromptedNewsFilter(options.client),
      writer: new PromptedBriefWriter(options.client),
      reviewer: new PromptedEditorialReviewer(options.client),
      missingNewsChecker: new SearchBackedMissingNewsChecker({
        client: options.client,
        search: options.search,
      }),
      sink: new FileSystemDatabaseArtifactSink({
        storageRoot: options.storageRoot,
        metadataStore: options.database,
      }),
      logger: new DatabasePipelineLogger(options.database),
      failureReporter: new DatabaseFailureReporter(options.database),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.createRunId === undefined
        ? {}
        : { createRunId: options.createRunId }),
    },
    pipelineOptions,
  );
}
