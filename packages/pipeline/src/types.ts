import type { BriefArtifact, ValidationIssue } from "@daily-tech/core";

export interface BriefWindow {
  readonly date: string;
  readonly timeZone: "Asia/Jerusalem";
  readonly start: Date;
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
  readonly webSearchCalls?: number;
  readonly webSearchCostUsd?: number;
}

export interface StageResult<T> {
  readonly value: T;
  readonly usage?: ModelUsage;
}

export interface ArtifactSink {
  saveReady(artifact: BriefArtifact): Promise<void>;
}

export type PipelineStage =
  | "initialize"
  | "research"
  | "research_validation"
  | "draft"
  | "draft_validation"
  | "gap_check"
  | "revision"
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
  readonly webSearchCalls: number;
  readonly webSearchCostUsd: number;
}

export interface PipelineRunResult {
  readonly runId: string;
  readonly window: BriefWindow;
  readonly artifact: BriefArtifact;
  readonly researchedStories: number;
  readonly includedStories: number;
  readonly revisionRounds: number;
  readonly gapStoriesAdded: number;
  readonly rejectedStories: number;
  readonly modelRequests: number;
  readonly usage: PipelineUsage;
}
