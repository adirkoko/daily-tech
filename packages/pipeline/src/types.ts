import type {
  BriefArtifact,
  DayIntensity,
  ValidationIssue,
} from "@daily-tech/core";

export const SOURCE_TYPES = [
  "official_blog",
  "official_docs",
  "github",
  "release_notes",
  "journalism",
  "other",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface ResearchSource {
  readonly url: string;
  readonly title: string;
  readonly publisher: string;
  readonly publishedAt: string | null;
  readonly type: SourceType;
}

export interface ResearchCandidate {
  /** Stable within a run and used to deduplicate missing-news results. */
  readonly id: string;
  readonly headline: string;
  readonly summary: string;
  readonly occurredAt: string;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly sources: readonly ResearchSource[];
}

export interface BriefWindow {
  readonly date: string;
  readonly timeZone: "Asia/Jerusalem";
  readonly start: Date;
  /** Exclusive upper bound: local midnight at the beginning of the next day. */
  readonly endExclusive: Date;
}

export interface PipelineContext {
  readonly runId: string;
  readonly window: BriefWindow;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
}

export interface StageResult<T> {
  readonly value: T;
  readonly usage?: ModelUsage;
}

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
}

export interface EditorialReview {
  readonly approved: boolean;
  readonly feedback: readonly string[];
}

export interface MissingNewsReview {
  readonly missing: readonly ResearchCandidate[];
  readonly notes: readonly string[];
}

export interface RevisionRequest {
  readonly context: PipelineContext;
  readonly developments: readonly ResearchCandidate[];
  readonly draft: BriefDraft;
  readonly editorialFeedback: readonly string[];
  readonly missingNews: MissingNewsReview;
}

export interface NewsResearcher {
  collect(context: PipelineContext): Promise<StageResult<readonly ResearchCandidate[]>>;
}

export interface NewsFilter {
  select(
    context: PipelineContext,
    candidates: readonly ResearchCandidate[],
  ): Promise<StageResult<readonly ResearchCandidate[]>>;
}

export interface BriefWriter {
  write(
    context: PipelineContext,
    developments: readonly ResearchCandidate[],
  ): Promise<StageResult<BriefDraft>>;
  revise(request: RevisionRequest): Promise<StageResult<BriefDraft>>;
}

export interface EditorialReviewer {
  review(
    context: PipelineContext,
    developments: readonly ResearchCandidate[],
    draft: BriefDraft,
  ): Promise<StageResult<EditorialReview>>;
}

export interface MissingNewsChecker {
  check(
    context: PipelineContext,
    draft: BriefDraft,
  ): Promise<StageResult<MissingNewsReview>>;
}

export interface ArtifactSink {
  saveReady(artifact: BriefArtifact): Promise<void>;
}

export type PipelineStage =
  | "initialize"
  | "research"
  | "filter"
  | "write"
  | "review"
  | "missing_news"
  | "revise"
  | "validate"
  | "persist";

export type PipelineEventType =
  | "run_started"
  | "stage_started"
  | "stage_completed"
  | "run_completed"
  | "run_failed";

export interface PipelineLogEvent {
  readonly runId: string;
  readonly date: string;
  readonly type: PipelineEventType;
  readonly stage: PipelineStage;
  readonly occurredAt: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PipelineLogger {
  log(event: PipelineLogEvent): void | Promise<void>;
}

export interface PipelineFailure {
  readonly runId: string;
  readonly date: string;
  readonly stage: PipelineStage;
  readonly occurredAt: string;
  readonly message: string;
  readonly validationIssues?: readonly ValidationIssue[];
}

export interface FailureReporter {
  report(failure: PipelineFailure): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface PipelineUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export interface PipelineRunResult {
  readonly runId: string;
  readonly window: BriefWindow;
  readonly artifact: BriefArtifact;
  readonly researchCandidates: number;
  readonly selectedDevelopments: number;
  readonly revisionRounds: number;
  readonly missingItemsAdded: number;
  readonly usage: PipelineUsage;
}
