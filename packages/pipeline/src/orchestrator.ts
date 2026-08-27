import { randomUUID } from "node:crypto";

import {
  expectedBriefRelativePath,
  validateBriefArtifact,
  type BriefArtifact,
  type DayMetadata,
} from "@daily-tech/core";

import {
  ArtifactValidationError,
  PipelineRunError,
  RevisionLimitExceededError,
} from "./errors.js";
import type {
  ArtifactSink,
  BriefDraft,
  BriefWriter,
  Clock,
  EditorialReviewer,
  FailureReporter,
  MissingNewsChecker,
  ModelUsage,
  NewsFilter,
  NewsResearcher,
  PipelineContext,
  PipelineLogEvent,
  PipelineLogger,
  PipelineRunResult,
  PipelineStage,
  PipelineUsage,
  ResearchCandidate,
} from "./types.js";
import { previousIsraelDayWindow } from "./window.js";

export interface DailyBriefPipelineDependencies {
  readonly researcher: NewsResearcher;
  readonly filter: NewsFilter;
  readonly writer: BriefWriter;
  readonly reviewer: EditorialReviewer;
  readonly missingNewsChecker: MissingNewsChecker;
  readonly sink: ArtifactSink;
  readonly failureReporter: FailureReporter;
  readonly logger?: PipelineLogger;
  readonly clock?: Clock;
  readonly createRunId?: () => string;
}

export interface DailyBriefPipelineOptions {
  /** Number of rewrites after the initial draft. Must be between 1 and 3. */
  readonly maxRevisionRounds?: number;
  readonly storageRoot?: string;
}

const systemClock: Clock = { now: () => new Date() };
const silentLogger: PipelineLogger = { log: () => undefined };

export class DailyBriefPipeline {
  readonly #dependencies: Required<DailyBriefPipelineDependencies>;
  readonly #maxRevisionRounds: number;
  readonly #storageRoot: string;

  constructor(
    dependencies: DailyBriefPipelineDependencies,
    options: DailyBriefPipelineOptions = {},
  ) {
    const maxRevisionRounds = options.maxRevisionRounds ?? 3;
    if (
      !Number.isInteger(maxRevisionRounds) ||
      maxRevisionRounds < 1 ||
      maxRevisionRounds > 3
    ) {
      throw new RangeError("maxRevisionRounds must be an integer between 1 and 3.");
    }

    const storageRoot = (options.storageRoot ?? "tech_briefs/daily")
      .replaceAll("\\", "/")
      .replace(/\/+$/u, "");
    if (storageRoot.length === 0) {
      throw new TypeError("storageRoot cannot be empty.");
    }

    this.#dependencies = {
      ...dependencies,
      logger: dependencies.logger ?? silentLogger,
      clock: dependencies.clock ?? systemClock,
      createRunId: dependencies.createRunId ?? randomUUID,
    };
    this.#maxRevisionRounds = maxRevisionRounds;
    this.#storageRoot = storageRoot;
  }

  async run(runAt = this.#dependencies.clock.now()): Promise<PipelineRunResult> {
    const window = previousIsraelDayWindow(runAt);
    const runId = this.#dependencies.createRunId();
    if (runId.trim().length === 0) {
      throw new Error("createRunId returned an empty identifier.");
    }

    const context: PipelineContext = { runId, window };
    const usage = new UsageAccumulator();
    const createdAt = this.#dependencies.clock.now().toISOString();
    let activeStage: PipelineStage = "initialize";
    let researchCandidates = 0;
    let revisionRounds = 0;
    let missingItemsAdded = 0;

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

    const executeStage = async <T>(
      stage: PipelineStage,
      action: () => Promise<T>,
    ): Promise<T> => {
      activeStage = stage;
      await log("stage_started", stage);
      const value = await action();
      await log("stage_completed", stage);
      return value;
    };

    try {
      await log("run_started", "initialize");

      const research = await executeStage("research", () =>
        this.#dependencies.researcher.collect(context),
      );
      usage.add(research.usage);
      researchCandidates = research.value.length;

      const filtered = await executeStage("filter", () =>
        this.#dependencies.filter.select(context, research.value),
      );
      usage.add(filtered.usage);
      let developments = deduplicateCandidates(filtered.value);

      const written = await executeStage("write", () =>
        this.#dependencies.writer.write(context, developments),
      );
      usage.add(written.usage);
      let draft = written.value;

      while (true) {
        const editorial = await executeStage("review", () =>
          this.#dependencies.reviewer.review(context, developments, draft),
        );
        usage.add(editorial.usage);

        const missingNews = await executeStage("missing_news", () =>
          this.#dependencies.missingNewsChecker.check(context, draft),
        );
        usage.add(missingNews.usage);

        if (editorial.value.approved && missingNews.value.missing.length === 0) {
          break;
        }
        if (revisionRounds >= this.#maxRevisionRounds) {
          throw new RevisionLimitExceededError(revisionRounds);
        }

        const beforeMerge = developments.length;
        developments = deduplicateCandidates([
          ...developments,
          ...missingNews.value.missing,
        ]);
        missingItemsAdded += developments.length - beforeMerge;

        const revised = await executeStage("revise", () =>
          this.#dependencies.writer.revise({
            context,
            developments,
            draft,
            editorialFeedback: editorial.value.feedback,
            missingNews: missingNews.value,
          }),
        );
        usage.add(revised.usage);
        draft = revised.value;
        revisionRounds += 1;
      }

      const artifact = await executeStage("validate", async () =>
        this.buildAndValidateArtifact(context, draft, developments, createdAt),
      );
      await executeStage("persist", () => this.#dependencies.sink.saveReady(artifact));

      const finalUsage = usage.snapshot();
      await log("run_completed", "persist", {
        researchCandidates,
        selectedDevelopments: developments.length,
        revisionRounds,
        missingItemsAdded,
        totalTokens: finalUsage.totalTokens,
        costUsd: finalUsage.costUsd,
      });

      return {
        runId,
        window,
        artifact,
        researchCandidates,
        selectedDevelopments: developments.length,
        revisionRounds,
        missingItemsAdded,
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

  private buildAndValidateArtifact(
    context: PipelineContext,
    draft: BriefDraft,
    developments: readonly ResearchCandidate[],
    createdAt: string,
  ): BriefArtifact {
    const relativePath = expectedBriefRelativePath(context.window.date);
    if (relativePath === null) {
      throw new Error(`Cannot build a path for ${context.window.date}.`);
    }

    const metadata: DayMetadata = {
      date: context.window.date,
      ...draft.metadata,
      status: "ready",
      source_count: countUniqueSources(developments),
      created_at: createdAt,
      published_at: null,
      updated_at: null,
    };
    const validation = validateBriefArtifact({
      filePath: `${this.#storageRoot}/${relativePath}`,
      content: draft.markdown,
      metadata,
    });
    if (!validation.valid) {
      throw new ArtifactValidationError(validation.issues);
    }
    return validation.data;
  }
}

function deduplicateCandidates(
  candidates: readonly ResearchCandidate[],
): readonly ResearchCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const id = candidate.id.trim();
    if (id.length === 0) {
      throw new TypeError("Research candidate IDs cannot be empty.");
    }
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function countUniqueSources(developments: readonly ResearchCandidate[]): number {
  return new Set(
    developments.flatMap((development) =>
      development.sources.map((source) => source.url.trim()).filter(Boolean),
    ),
  ).size;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown pipeline error.";
}

class UsageAccumulator {
  #inputTokens = 0;
  #outputTokens = 0;
  #totalTokens = 0;
  #costUsd = 0;

  add(usage: ModelUsage | undefined): void {
    if (usage === undefined) {
      return;
    }
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
    this.#totalTokens += usage.totalTokens;
    this.#costUsd += usage.costUsd ?? 0;
  }

  snapshot(): PipelineUsage {
    return {
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      totalTokens: this.#totalTokens,
      costUsd: this.#costUsd,
    };
  }
}
