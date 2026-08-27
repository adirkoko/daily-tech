import type { ValidationIssue } from "@daily-tech/core";

import type { PipelineStage } from "./types.js";

export class ArtifactValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`Generated brief failed deterministic validation (${issues.length} issues).`);
    this.name = "ArtifactValidationError";
    this.issues = issues;
  }
}

export class RevisionLimitExceededError extends Error {
  readonly revisionRounds: number;

  constructor(revisionRounds: number) {
    super(`Brief was not approved after ${revisionRounds} revision rounds.`);
    this.name = "RevisionLimitExceededError";
    this.revisionRounds = revisionRounds;
  }
}

export class PipelineRunError extends Error {
  readonly stage: PipelineStage;
  readonly reportingError: unknown;

  constructor(stage: PipelineStage, cause: unknown, reportingError?: unknown) {
    super(`Daily brief pipeline failed during ${stage}.`, { cause });
    this.name = "PipelineRunError";
    this.stage = stage;
    this.reportingError = reportingError;
  }
}
