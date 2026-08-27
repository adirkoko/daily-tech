import type { ValidationIssue } from "@daily-tech/core";

import type { PublicationPhase } from "./types.js";

export class PublicationRunError extends Error {
  readonly phase: PublicationPhase;
  readonly reportingError: unknown;

  constructor(phase: PublicationPhase, cause: unknown, reportingError?: unknown) {
    super(`Brief publication failed during ${phase}.`, { cause });
    this.name = "PublicationRunError";
    this.phase = phase;
    this.reportingError = reportingError;
  }
}

export class PublicationValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`Brief failed pre-publication validation (${issues.length} issues).`);
    this.name = "PublicationValidationError";
    this.issues = issues;
  }
}

export class PublicationInProgressError extends Error {
  readonly leaseExpiresAt: string;

  constructor(date: string, leaseExpiresAt: string) {
    super(`Publication for ${date} is already in progress until ${leaseExpiresAt}.`);
    this.name = "PublicationInProgressError";
    this.leaseExpiresAt = leaseExpiresAt;
  }
}

export class DeploymentTriggerError extends Error {
  readonly status: number | null;

  constructor(message: string, options: { readonly status?: number; readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DeploymentTriggerError";
    this.status = options.status ?? null;
  }
}
