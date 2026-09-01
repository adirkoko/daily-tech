import { randomUUID } from "node:crypto";

import {
  DEFAULT_PIPELINE_SETTINGS,
  expectedBriefRelativePath,
  validateBriefArtifact,
  type BriefArtifact,
  type DayMetadata,
  type PipelineSettings,
} from "@daily-tech/core";

import { ArtifactValidationError, PipelineRunError } from "./errors.js";
import {
  RESEARCH_CATEGORIES,
  SOURCE_TYPES,
  type CandidateStory,
  type DeepResearchedStory,
  type Importance,
  type NewsDiscoveryScope,
  type NewsResearchProvider,
  type StoryIdFactory,
} from "./research/contracts.js";
import { randomStoryIdFactory } from "./research/story-id.js";
import {
  finalizeDeepResearchBatch,
  finalizeDiscoveryBatch,
  finalizeFocusedDiscoveryBatch,
} from "./research/story-validation.js";
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
  /** Safety cap on one discovery/gap/keyword call's own output size — an API-shape
   *  guard, not an editorial setting. */
  readonly maximumCandidatesPerCall?: number;
  /** Exceptional safety valve bounding how many merged candidates may be sent into
   *  deep research at all on a pathologically busy day. Never the normal editorial
   *  selection mechanism — that stays the model's call inside deep research,
   *  guided by the operator's maximumStories setting. */
  readonly maximumDiscoveryCandidates?: number;
}

export interface RunPipelineOptions {
  readonly runAt?: Date;
  readonly settings?: PipelineSettings;
}

const systemClock: Clock = { now: () => new Date() };
const silentLogger: PipelineLogger = { log: () => undefined };

export class DailyBriefPipeline {
  readonly #dependencies: Required<DailyBriefPipelineDependencies>;
  readonly #storageRoot: string;
  readonly #scope: NewsDiscoveryScope;
  readonly #minimumImportance: Importance;
  readonly #maximumCandidatesPerCall: number;
  readonly #maximumDiscoveryCandidates: number;

  constructor(
    dependencies: DailyBriefPipelineDependencies,
    options: DailyBriefPipelineOptions = {},
  ) {
    this.#minimumImportance = options.minimumImportance ?? 3;
    this.#maximumCandidatesPerCall = boundedInteger(
      options.maximumCandidatesPerCall ?? 20,
      1,
      30,
      "maximumCandidatesPerCall",
    );
    this.#maximumDiscoveryCandidates = boundedInteger(
      options.maximumDiscoveryCandidates ?? 40,
      5,
      100,
      "maximumDiscoveryCandidates",
    );
    this.#scope = {
      categories: RESEARCH_CATEGORIES,
      minimumImportance: this.#minimumImportance,
      maximumCandidatesPerCall: this.#maximumCandidatesPerCall,
      preferredSourceTypes: SOURCE_TYPES,
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

  async run(options: RunPipelineOptions = {}): Promise<PipelineRunResult> {
    const runAt = options.runAt ?? this.#dependencies.clock.now();
    const settings = options.settings ?? DEFAULT_PIPELINE_SETTINGS;
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
      // 1. Light discovery: broad, shallow — find what happened, not why it matters.
      const lightBatch = await executeStage("light_discovery", () =>
        this.#dependencies.researchProvider.discover({ context, scope: this.#scope }),
      );
      let candidates: readonly CandidateStory[] = finalizeDiscoveryBatch(
        lightBatch,
        context,
        this.#minimumImportance,
        this.#dependencies.storyIds,
      ).stories;

      // 2. Gap discovery: did the broad pass miss anything material?
      if (settings.gapDiscoveryEnabled) {
        const gapBatch = await executeStage("gap_discovery", () =>
          this.#dependencies.researchProvider.findGaps({
            context,
            existingStories: candidates,
            minimumImportance: this.#minimumImportance,
            maximumCandidatesPerCall: this.#maximumCandidatesPerCall,
          }),
        );
        const gapCandidates = finalizeFocusedDiscoveryBatch(
          gapBatch,
          candidates,
          context,
          this.#minimumImportance,
          this.#dependencies.storyIds,
        ).stories;
        candidates = [...candidates, ...gapCandidates];
      }

      // 3. Admin keywords: extra attention on operator-chosen areas, never an
      // inclusion requirement. Skipped entirely — no model call — when disabled or
      // when the operator has not configured any keywords.
      if (settings.adminKeywordsResearchEnabled && settings.adminKeywords.length > 0) {
        const keywordBatch = await executeStage("keyword_discovery", () =>
          this.#dependencies.researchProvider.findGaps({
            context,
            existingStories: candidates,
            minimumImportance: this.#minimumImportance,
            maximumCandidatesPerCall: this.#maximumCandidatesPerCall,
            focusKeywords: settings.adminKeywords,
          }),
        );
        const keywordCandidates = finalizeFocusedDiscoveryBatch(
          keywordBatch,
          candidates,
          context,
          this.#minimumImportance,
          this.#dependencies.storyIds,
        ).stories;
        candidates = [...candidates, ...keywordCandidates];
      }

      // 4. Merge already happened above (each stage dedupes against what came
      // before it). This is only an exceptional safety valve for a pathologically
      // busy day — never the normal editorial selection, which stays the model's
      // call inside deep research, guided by settings.maximumStories.
      const boundedCandidates = candidates.length > this.#maximumDiscoveryCandidates
        ? [...candidates].sort((a, b) => b.importance - a.importance).slice(0, this.#maximumDiscoveryCandidates)
        : candidates;

      // 5. Deep research: one call covering every candidate, however many searches
      // it needs. The model decides which candidates hold up, up to maximumStories.
      let stories: readonly DeepResearchedStory[] = [];
      if (boundedCandidates.length > 0) {
        const deepBatch = await executeStage("deep_research", () =>
          this.#dependencies.researchProvider.deepResearch({
            context,
            candidates: boundedCandidates,
            maximumStories: settings.maximumStories,
            editorialInstructions: settings.editorialInstructions,
          }),
        );
        stories = finalizeDeepResearchBatch(
          deepBatch,
          boundedCandidates,
          context,
          settings.maximumStories,
        ).stories;
      }

      // 6. Draft: a single edit pass, no web search, no revision loop.
      const draft: BriefDraft = stories.length > 0
        ? await executeStage("draft", () =>
            this.#dependencies.writer.write(context, stories, settings.editorialInstructions),
          )
        : await executeStage("draft", async () => createQuietDayDraft());
      await executeStage("draft_validation", async () =>
        validateDraftAgainstStories(draft, stories),
      );

      // 7-8. Validate mechanically, then persist as ready.
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
    stories: readonly DeepResearchedStory[],
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

function countUniqueSources(stories: readonly DeepResearchedStory[]): number {
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
