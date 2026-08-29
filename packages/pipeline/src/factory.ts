import { DailyTechDatabase } from "@daily-tech/db";

import type { AiCompletionClient, AiWebResearchClient } from "./ai/contracts.js";
import { DatabaseFailureReporter, DatabasePipelineLogger } from "./operations-adapters.js";
import { DailyBriefPipeline, type DailyBriefPipelineOptions } from "./orchestrator.js";
import { FileSystemDatabaseArtifactSink } from "./persistence.js";
import { ModelNewsResearchProvider } from "./research/model-news-research-provider.js";
import type { StoryIdFactory } from "./research/contracts.js";
import type { Clock } from "./types.js";
import { ModelBriefWriter } from "./writing/model-brief-writer.js";

export interface ProductionPipelineOptions {
  readonly completionClient: AiCompletionClient;
  readonly webResearchClient: AiWebResearchClient;
  readonly database: DailyTechDatabase;
  readonly storageRoot: string;
  readonly clock?: Clock;
  readonly createRunId?: () => string;
  readonly storyIds?: StoryIdFactory;
}

export function createProductionPipeline(options: ProductionPipelineOptions): DailyBriefPipeline {
  const pipelineOptions: DailyBriefPipelineOptions = {
    storageRoot: options.storageRoot,
  };
  return new DailyBriefPipeline(
    {
      researchProvider: new ModelNewsResearchProvider({ client: options.webResearchClient }),
      writer: new ModelBriefWriter({ client: options.completionClient }),
      sink: new FileSystemDatabaseArtifactSink({
        storageRoot: options.storageRoot,
        metadataStore: options.database,
      }),
      logger: new DatabasePipelineLogger(options.database),
      failureReporter: new DatabaseFailureReporter(options.database),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
      ...(options.storyIds === undefined ? {} : { storyIds: options.storyIds }),
    },
    pipelineOptions,
  );
}
