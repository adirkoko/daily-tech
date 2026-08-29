import { randomUUID } from "node:crypto";

import {
  expectedBriefRelativePath,
  validateBriefArtifact,
  type BriefArtifact,
  type DayMetadata,
} from "@daily-tech/core";

import { ArtifactValidationError, PipelineRunError } from "./errors.js";
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
  PipelineContext,
  PipelineLogEvent,
  PipelineLogger,
  PipelineRunResult,
  PipelineStage,
} from "./types.js";
import type { BriefDraft, BriefWriter } from "./writing/contracts.js";
import { createQuietDayDraft, validateDraftAgainstStories } from "./writing/draft-validation.js";
import { renderBriefMarkdown } from "./writing/render-markdown.js";
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
  maximumStories: 20,
  preferredSourceTypes: SOURCE_TYPES,
};

export class DailyBriefPipeline {
  readonly #dependencies: Required<DailyBriefPipelineDependencies>;
  readonly #storageRoot: string;
  readonly #scope: NewsResearchScope;
  readonly #maximumMissingStories: number;

  constructor(
    dependencies: DailyBriefPipelineDependencies,
    options: DailyBriefPipelineOptions = {},
  ) {
    this.#maximumMissingStories = boundedInteger(
      options.maximumMissingStories ?? 4,
      1,
      12,
      "maximumMissingStories",
    );
    const maximumStories = boundedInteger(
      options.maximumStories ?? defaultScope.maximumStories,
      1,
      30,
      "maximumStories",
    );
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
    const createdAt = this.#dependencies.clock.now().toISOString();
    let activeStage: PipelineStage = "initialize";

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
      return action();
    };

    try {
      const rawResearch = await executeStage("research", () =>
        this.#dependencies.researchProvider.research({ context, scope: this.#scope }),
      );
      const processedResearch = await executeStage("research_validation", async () =>
        finalizeResearchBatch(
          rawResearch,
          context,
          this.#scope.minimumImportance,
          this.#dependencies.storyIds,
        ),
      );
      let stories = [...processedResearch.stories];

      const hadStoriesFromResearch = stories.length > 0;
      let draft: BriefDraft = hadStoriesFromResearch
        ? await executeStage("draft", () => this.#dependencies.writer.write(context, stories))
        : await executeStage("draft", async () => createQuietDayDraft());
      await executeStage("draft_validation", async () =>
        validateDraftAgainstStories(draft, stories),
      );

      // Exactly one Gap Check, exactly one Revision at most — never a loop. Live web
      // research can always surface one more thing; a loop chasing zero missing
      // stories has no natural end. One check, one fix, then move on.
      const gapResult = await executeStage("gap_check", () =>
        this.#dependencies.researchProvider.findGaps({
          context,
          existingStories: stories,
          draft,
          minimumImportance: this.#scope.minimumImportance,
          maximumMissingStories: this.#maximumMissingStories,
        }),
      );
      const processedGap = finalizeGapBatch(
        gapResult,
        stories,
        context,
        this.#scope.minimumImportance,
        this.#dependencies.storyIds,
      );
      if (processedGap.stories.length > 0) {
        const missingStories = processedGap.stories;
        stories = [...stories, ...missingStories];
        draft = await executeStage("revision", () =>
          hadStoriesFromResearch
            ? this.#dependencies.writer.revise({ context, stories, draft, missingStories })
            : this.#dependencies.writer.write(context, stories),
        );
        await executeStage("draft_validation", async () =>
          validateDraftAgainstStories(draft, stories),
        );
      }

      const artifact = await executeStage("validate", async () =>
        this.#buildAndValidateArtifact(context, draft, stories, createdAt),
      );
      await executeStage("persist", () => this.#dependencies.sink.saveReady(artifact));

      await log("run_completed", "persist", {
        status: artifact.metadata.status,
        sourceCount: artifact.metadata.source_count,
      });
      return { runId, window, artifact };
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
      content: renderBriefMarkdown(context.window.date, draft),
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
