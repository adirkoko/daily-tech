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
  ResearchProcessingError,
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
import { israelDayWindow, previousIsraelDayWindow } from "./window.js";

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
  readonly targetDate?: string;
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
    if (options.runAt !== undefined && options.targetDate !== undefined) {
      throw new TypeError("Use either runAt or targetDate, not both.");
    }
    const runAt = options.runAt ?? this.#dependencies.clock.now();
    const settings = options.settings ?? DEFAULT_PIPELINE_SETTINGS;
    const window = options.targetDate === undefined
      ? previousIsraelDayWindow(runAt)
      : israelDayWindow(options.targetDate);
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
    const logResearch = async (
      stage: PipelineStage,
      details: NonNullable<PipelineLogEvent["details"]>,
    ): Promise<void> => {
      try {
        await log("research_stage_completed", stage, details);
      } catch {
        /* Diagnostics must never turn a valid edition into a failed run. */
      }
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
      let lightResult: ReturnType<typeof finalizeDiscoveryBatch>;
      try {
        lightResult = finalizeDiscoveryBatch(
          lightBatch,
          context,
          this.#minimumImportance,
          this.#dependencies.storyIds,
        );
      } catch (error) {
        await logResearch("light_discovery", failedDiscoveryDetails(lightBatch, error));
        throw error;
      }
      let candidates: readonly CandidateStory[] = lightResult.stories;
      await logResearch("light_discovery", discoveryDetails(lightBatch, lightResult));

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
        let gapResult: ReturnType<typeof finalizeFocusedDiscoveryBatch>;
        try {
          gapResult = finalizeFocusedDiscoveryBatch(
            gapBatch,
            candidates,
            context,
            this.#minimumImportance,
            this.#dependencies.storyIds,
          );
        } catch (error) {
          await logResearch("gap_discovery", failedDiscoveryDetails(gapBatch, error));
          throw error;
        }
        candidates = [...candidates, ...gapResult.stories];
        await logResearch("gap_discovery", discoveryDetails(gapBatch, gapResult));
      } else {
        await logResearch("gap_discovery", { state: "skipped", reason: "disabled" });
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
        let keywordResult: ReturnType<typeof finalizeFocusedDiscoveryBatch>;
        try {
          keywordResult = finalizeFocusedDiscoveryBatch(
            keywordBatch,
            candidates,
            context,
            this.#minimumImportance,
            this.#dependencies.storyIds,
          );
        } catch (error) {
          await logResearch("keyword_discovery", {
            ...failedDiscoveryDetails(keywordBatch, error),
            focusKeywords: settings.adminKeywords,
          });
          throw error;
        }
        candidates = [...candidates, ...keywordResult.stories];
        await logResearch("keyword_discovery", {
          ...discoveryDetails(keywordBatch, keywordResult),
          focusKeywords: settings.adminKeywords,
        });
      } else {
        await logResearch("keyword_discovery", {
          state: "skipped",
          reason: settings.adminKeywordsResearchEnabled ? "no_keywords" : "disabled",
          focusKeywords: settings.adminKeywords,
        });
      }

      // 4. Merge already happened above (each stage dedupes against what came
      // before it). This is only an exceptional safety valve for a pathologically
      // busy day — never the normal editorial selection, which stays the model's
      // call inside deep research, guided by settings.maximumStories.
      const boundedCandidates = candidates.length > this.#maximumDiscoveryCandidates
        ? [...candidates].sort((a, b) => b.importance - a.importance).slice(0, this.#maximumDiscoveryCandidates)
        : candidates;
      const boundedCandidateIds = new Set(boundedCandidates.map(({ id }) => id));
      const safetyCappedCandidates = candidates.filter(({ id }) => !boundedCandidateIds.has(id));

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
        let deepResult: ReturnType<typeof finalizeDeepResearchBatch>;
        try {
          deepResult = finalizeDeepResearchBatch(
            deepBatch,
            boundedCandidates,
            context,
            settings.maximumStories,
          );
        } catch (error) {
          await logResearch("deep_research", {
            state: "failed",
            candidateCount: candidates.length,
            researchedCandidateCount: boundedCandidates.length,
            selectedCount: 0,
            rejectedCount: error instanceof ResearchProcessingError
              ? error.rejectedStories.length
              : 0,
            rejectedTitles: error instanceof ResearchProcessingError
              ? error.rejectedStories.slice(0, 30).map(({ title }) => title ?? "<missing>")
              : [],
            safetyCappedCount: safetyCappedCandidates.length,
            safetyCappedTitles: safetyCappedCandidates.slice(0, 30).map(({ title }) => title),
            filteredCount: safetyCappedCandidates.length,
            filteredTitles: safetyCappedCandidates.slice(0, 30).map(({ title }) => title),
            topics: uniqueStrings(boundedCandidates.flatMap(({ topics }) => topics)).slice(0, 40),
          });
          throw error;
        }
        stories = deepResult.stories;
        await logResearch("deep_research", {
          state: "completed",
          candidateCount: candidates.length,
          researchedCandidateCount: boundedCandidates.length,
          selectedCount: stories.length,
          rejectedCount: deepResult.rejectedStories.length,
          notSelectedCount: deepResult.notSelectedStories.length,
          safetyCappedCount: safetyCappedCandidates.length,
          safetyCappedTitles: safetyCappedCandidates.slice(0, 30).map(({ title }) => title),
          filteredCount: deepResult.notSelectedStories.length + safetyCappedCandidates.length,
          selectedTitles: stories.slice(0, 30).map(({ title }) => title),
          rejectedTitles: deepResult.rejectedStories.slice(0, 30).map(({ title }) => title ?? "<missing>"),
          notSelectedTitles: deepResult.notSelectedStories.slice(0, 30).map(({ title }) => title),
          filteredTitles: [
            ...deepResult.notSelectedStories.map(({ title }) => title),
            ...safetyCappedCandidates.map(({ title }) => title),
          ].slice(0, 30),
          topics: uniqueStrings(stories.flatMap(({ topics }) => topics)).slice(0, 40),
        });
      } else {
        await logResearch("deep_research", {
          state: "skipped",
          reason: "no_candidates",
          candidateCount: 0,
          selectedCount: 0,
        });
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

function discoveryDetails(
  batch: { readonly stories: readonly { readonly title: string; readonly topics: readonly string[] }[]; readonly rejectedStories: readonly unknown[] },
  result: {
    readonly stories: readonly { readonly title: string; readonly topics: readonly string[] }[];
    readonly rejectedStories: readonly { readonly title: string | null }[];
    readonly filteredStories: readonly { readonly title: string | null; readonly reason: string }[];
  },
): NonNullable<PipelineLogEvent["details"]> {
  return {
    state: "completed",
    foundCount: batch.stories.length + batch.rejectedStories.length,
    contributedCount: result.stories.length,
    rejectedCount: result.rejectedStories.length,
    filteredCount: result.filteredStories.length,
    foundTitles: batch.stories.slice(0, 30).map(({ title }) => title),
    contributedTitles: result.stories.slice(0, 30).map(({ title }) => title),
    rejectedTitles: result.rejectedStories.slice(0, 30).map(({ title }) => title ?? "<missing>"),
    filteredTitles: result.filteredStories.slice(0, 30).map(({ title }) => title ?? "<missing>"),
    filteredReasons: result.filteredStories.slice(0, 30).map(({ reason }) => reason),
    topics: uniqueStrings(batch.stories.flatMap(({ topics }) => topics)).slice(0, 40),
  };
}

function failedDiscoveryDetails(
  batch: { readonly stories: readonly { readonly title: string; readonly topics: readonly string[] }[]; readonly rejectedStories: readonly { readonly title: string | null }[] },
  error: unknown,
): NonNullable<PipelineLogEvent["details"]> {
  const rejected = error instanceof ResearchProcessingError
    ? error.rejectedStories
    : batch.rejectedStories;
  return {
    state: "failed",
    foundCount: batch.stories.length + batch.rejectedStories.length,
    contributedCount: 0,
    rejectedCount: rejected.length,
    filteredCount: 0,
    foundTitles: batch.stories.slice(0, 30).map(({ title }) => title),
    contributedTitles: [],
    rejectedTitles: rejected.slice(0, 30).map(({ title }) => title ?? "<missing>"),
    filteredTitles: [],
    topics: uniqueStrings(batch.stories.flatMap(({ topics }) => topics)).slice(0, 40),
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Map(values.map((value) => [value.normalize("NFKC").toLocaleLowerCase("he-IL"), value])).values()];
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
