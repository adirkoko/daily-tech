import type { DayIntensity } from "@daily-tech/core";

import type { AiCompletionClient } from "../ai/contracts.js";
import type { ResearchedStory } from "../research/contracts.js";
import type { PipelineContext, StageResult } from "../types.js";

export interface GeneratedDayMetadata {
  readonly summary: string;
  readonly significant_items: number;
  readonly worth_watching_items: number;
  readonly day_intensity: DayIntensity;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly developments: readonly string[];
}

export interface BriefDraft {
  readonly markdown: string;
  readonly metadata: GeneratedDayMetadata;
  readonly includedStoryIds: readonly string[];
}

export interface RevisionRequest {
  readonly context: PipelineContext;
  readonly stories: readonly ResearchedStory[];
  readonly draft: BriefDraft;
  readonly missingStories: readonly ResearchedStory[];
}

export interface BriefWriter {
  write(
    context: PipelineContext,
    stories: readonly ResearchedStory[],
  ): Promise<StageResult<BriefDraft>>;
  revise(request: RevisionRequest): Promise<StageResult<BriefDraft>>;
}

export interface ModelBriefWriterOptions {
  readonly client: AiCompletionClient;
  /** Optional explicit provider/model override; omitted by default. */
  readonly temperature?: number;
}
