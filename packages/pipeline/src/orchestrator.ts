import { randomUUID } from "node:crypto";

import {
  expectedBriefRelativePath,
  validateBriefArtifact,
  type BriefArtifact,
  type DayMetadata,
} from "@daily-tech/core";

import { ArtifactValidationError, PipelineRunError, RevisionLimitExceededError } from "./errors.js";
import {
  RESEARCH_CATEGORIES,
  SOURCE_TYPES,
  type Importance,
  type NewsResearchProvider,
  type NewsResearchScope,
  type ResearchedStory,
  type StoryIdFactory,
} from "./research/contracts.js";
import { randomStoryIdFactory } from "./research/story-id.js";
import { finalizeGapBatch, finalizeResearchBatch } from "./research/story-validation.js";
import type {
  ArtifactSink,
  Clock,
  FailureReporter,
  ModelUsage,
  PipelineContext,
  PipelineLogEvent,
  PipelineLogger,
  PipelineRunResult,
  PipelineStage,
  PipelineUsage,
} from "./types.js";
import type { BriefDraft, BriefWriter } from "./writing/contracts.js";
import { createQuietDayDraft, validateDraftAgainstStories } from "./writing/draft-validation.js";
import { previousIsraelDayWindow } from "./window.js";

export interface DailyBriefPipelineDependencies {
  readonly researchProvider: NewsResearchProvider;
  readonly writer: BriefWriter;
  readonly sink: ArtifactSink;
  readonly failureReporter: FailureReporter;
  readonly logger?: PipelineLogger;
  readonly clock?: Clock;
  readonly createRunId?: () => string;
  readonly storyIds?: StoryIdFactory;
}

export interface DailyBriefPipelineOptions {
  readonly maxRevisionRounds?: number;
  readonly storageRoot?: string;
  readonly minimumImportance?: Importance;
  readonly maximumStories?: number;
  readonly maximumMissingStories?: number;
}

const systemClock: Clock = { now: () => new Date() };
const silentLogger: PipelineLogger = { log: () => undefined };
const defaultScope: NewsResearchScope = {
  categories: RESEARCH_CATEGORIES,
  minimumImportance: 3,
  maximumStories: 12,
  preferredSourceTypes: SOURCE_TYPES,
};

export class DailyBriefPipeline {
  readonly #dependencies: Required<DailyBriefPipelineDependencies>;
  readonly #maxRevisionRounds: number;
  readonly #storageRoot: string;
  readonly #scope: NewsResearchScope;
  readonly #maximumMissingStories: number;

  constructor(
    dependencies: DailyBriefPipelineDependencies,
    options: DailyBriefPipelineOptions = {},
  ) {
    this.#maxRevisionRounds = boundedInteger(options.maxRevisionRounds ?? 3, 1, 3, "maxRevisionRounds");
    this.#maximumMissingStories = boundedInteger(
      options.maximumMissingStories ?? 4,
      1,
      12,
      "maximumMissingStories",
    );
    const maximumStories = boundedInteger(options.maximumStories ?? 12, 1, 30, "maximumStories");
    this.#scope = {
      ...defaultScope,
      minimumImportance: options.minimumImportance ?? defaultScope.minimumImportance,
      maximumStories,
    };
    this.#storageRoot = (options.storageRoot ?? "tech_briefs/daily")
      .replaceAll("\\", "/")
      .replace(/\/+$/u, "");
    if (this.#storageRoot.length === 0) throw new TypeError("storageRoot cannot be empty.");
    this.#dependencies = {
      ...dependencies,
      logger: dependencies.logger ?? silentLogger,
      clock: dependencies.clock ?? systemClock,
      createRunId: dependencies.createRunId ?? randomUUID,
      storyIds: dependencies.storyIds ?? randomStoryIdFactory,
    };
  }

  async run(runAt = this.#dependencies.clock.now()): Promise<PipelineRunResult> {
    const window = previousIsraelDayWindow(runAt);
    const runId = this.#dependencies.createRunId();
    if (runId.trim().length === 0) throw new Error("createRunId returned an empty identifier.");
    const context: PipelineContext = { runId, window };
    const usage = new UsageAccumulator();
    const createdAt = this.#dependencies.clock.now().toISOString();
    let activeStage: PipelineStage = "initialize";
    let revisionRounds = 0;
    let gapStoriesAdded = 0;
    let rejectedStories = 0;
    let modelRequests = 0;

    const log = async (
      type: PipelineLogEvent["type"],
      stage: PipelineStage,
      details?: PipelineLogEvent["details"],
    ): Promise<void> => {
      await this.#dependencies.logger.log({
        runId,
        date: window.date,
        type,
        stage,
        occurredAt: this.#dependencies.clock.now().toISOString(),
        ...(details === undefined ? {} : { details }),
      });
    };
    const executeStage = async <T>(stage: PipelineStage, action: () => Promise<T>): Promise<T> => {
      activeStage = stage;
      await log("stage_started", stage);
      const value = await action();
      await log("stage_completed", stage);
      return value;
    };
    const accountModelRequest = (modelUsage: ModelUsage | undefined): void => {
      modelRequests += 1;
      usage.add(modelUsage);
    };

    try {
      await log("run_started", "initialize");
      const rawResearch = await executeStage("research", () =>
        this.#dependencies.researchProvider.research({ context, scope: this.#scope }),
      );
      accountModelRequest(rawResearch.usage);
      const processedResearch = await executeStage("research_validation", async () =>
        finalizeResearchBatch(
          rawResearch.value,
          context,
          this.#scope.minimumImportance,
          this.#dependencies.storyIds,
        ),
      );
      rejectedStories += processedResearch.rejectedStories.length;
      let stories = [...processedResearch.stories];

      let modelDraftCreated = stories.length > 0;
      let draft: BriefDraft;
      if (modelDraftCreated) {
        const written = await executeStage("draft", () =>
          this.#dependencies.writer.write(context, stories),
        );
        accountModelRequest(written.usage);
        draft = written.value;
      } else {
        draft = await executeStage("draft", async () => createQuietDayDraft(context));
      }
      await executeStage("draft_validation", async () =>
        validateDraftAgainstStories(draft, stories),
      );

      while (true) {
        const gapResult = await executeStage("gap_check", () =>
          this.#dependencies.researchProvider.findGaps({
            context,
            existingStories: stories,
            draft,
            minimumImportance: this.#scope.minimumImportance,
            maximumMissingStories: this.#maximumMissingStories,
          }),
        );
        accountModelRequest(gapResult.usage);
        const processedGap = finalizeGapBatch(
          gapResult.value,
          stories,
          context,
          this.#scope.minimumImportance,
          this.#dependencies.storyIds,
        );
        rejectedStories += processedGap.rejectedStories.length;
        if (processedGap.stories.length === 0) break;
        if (revisionRounds >= this.#maxRevisionRounds) {
          throw new RevisionLimitExceededError(revisionRounds);
        }

        const missingStories = processedGap.stories;
        stories = [...stories, ...missingStories];
        gapStoriesAdded += missingStories.length;
        const revised = await executeStage("revision", () =>
          modelDraftCreated
            ? this.#dependencies.writer.revise({
                context,
                stories,
                draft,
                missingStories,
              })
            : this.#dependencies.writer.write(context, stories),
        );
        accountModelRequest(revised.usage);
        draft = revised.value;
        modelDraftCreated = true;
        revisionRounds += 1;
        await executeStage("draft_validation", async () =>
          validateDraftAgainstStories(draft, stories),
        );
      }

      const artifact = await executeStage("validate", async () =>
        this.#buildAndValidateArtifact(context, draft, stories, createdAt),
      );
      await executeStage("persist", () => this.#dependencies.sink.saveReady(artifact));

      const finalUsage = usage.snapshot();
      await log("run_completed", "persist", {
        researchedStories: processedResearch.stories.length,
        includedStories: stories.length,
        revisionRounds,
        gapStoriesAdded,
        rejectedStories,
        sourceCount: artifact.metadata.source_count,
        validationPassed: true,
        modelRequests,
        totalTokens: finalUsage.totalTokens,
        costUsd: finalUsage.costUsd,
        webSearchCalls: finalUsage.webSearchCalls,
      });
      return {
        runId,
        window,
        artifact,
        researchedStories: processedResearch.stories.length,
        includedStories: stories.length,
        revisionRounds,
        gapStoriesAdded,
        rejectedStories,
        modelRequests,
        usage: finalUsage,
      };
    } catch (error) {
      const failure = {
        runId,
        date: window.date,
        stage: activeStage,
        occurredAt: this.#dependencies.clock.now().toISOString(),
        message: errorMessage(error),
        ...(error instanceof ArtifactValidationError
          ? { validationIssues: error.issues }
          : {}),
      };
      let reportingError: unknown;
      try {
        await this.#dependencies.failureReporter.report(failure);
      } catch (failureReportError) {
        reportingError = failureReportError;
      }
      try {
        await log("run_failed", activeStage, { message: failure.message });
      } catch (loggingError) {
        reportingError ??= loggingError;
      }
      throw new PipelineRunError(activeStage, error, reportingError);
    }
  }

  #buildAndValidateArtifact(
    context: PipelineContext,
    draft: BriefDraft,
    stories: readonly ResearchedStory[],
    createdAt: string,
  ): BriefArtifact {
    const relativePath = expectedBriefRelativePath(context.window.date);
    if (relativePath === null) throw new Error(`Cannot build a path for ${context.window.date}.`);
    const metadata: DayMetadata = {
      date: context.window.date,
      ...draft.metadata,
      status: "ready",
      source_count: countUniqueSources(stories),
      created_at: createdAt,
      published_at: null,
      updated_at: null,
    };
    const validation = validateBriefArtifact({
      filePath: `${this.#storageRoot}/${relativePath}`,
      content: draft.markdown,
      metadata,
    });
    if (!validation.valid) throw new ArtifactValidationError(validation.issues);
    return validation.data;
  }
}

function countUniqueSources(stories: readonly ResearchedStory[]): number {
  return new Set(stories.flatMap(({ sources }) => sources.map(({ url }) => url))).size;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown pipeline error.";
}

class UsageAccumulator {
  #inputTokens = 0;
  #outputTokens = 0;
  #totalTokens = 0;
  #costUsd = 0;
  #webSearchCalls = 0;
  #webSearchCostUsd = 0;

  add(usage: ModelUsage | undefined): void {
    if (usage === undefined) return;
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
    this.#totalTokens += usage.totalTokens;
    this.#costUsd += usage.costUsd ?? 0;
    this.#webSearchCalls += usage.webSearchCalls ?? 0;
    this.#webSearchCostUsd += usage.webSearchCostUsd ?? 0;
  }

  snapshot(): PipelineUsage {
    return {
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      totalTokens: this.#totalTokens,
      costUsd: this.#costUsd,
      webSearchCalls: this.#webSearchCalls,
      webSearchCostUsd: this.#webSearchCostUsd,
    };
  }
}
