import type { ValidationIssue } from "@daily-tech/core";

export class MetadataValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`Invalid day metadata (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "MetadataValidationError";
    this.issues = issues;
  }
}

export class DatabaseIntegrityError extends Error {
  readonly date: string;
  readonly issues: readonly ValidationIssue[];

  constructor(date: string, issues: readonly ValidationIssue[]) {
    super(`Stored metadata for ${date} failed validation.`);
    this.name = "DatabaseIntegrityError";
    this.date = date;
    this.issues = issues;
  }
}

export class PipelineSettingsValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`Invalid pipeline settings (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "PipelineSettingsValidationError";
    this.issues = issues;
  }
}

export class PipelineSettingsIntegrityError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super("Stored pipeline settings failed validation.");
    this.name = "PipelineSettingsIntegrityError";
    this.issues = issues;
  }
}
