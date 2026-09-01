import { isClockTime, isUtcTimestamp } from "./date.js";
import { VALIDATION_CODES, type ValidationIssue, type ValidationResult } from "./types.js";

export const PIPELINE_SETTINGS_LIMITS = {
  maximumStoriesRange: [1, 20] as const,
  adminKeywordsMaxCount: 50,
  adminKeywordMaxLength: 60,
  editorialInstructionsMaxLength: 4_000,
} as const;

/**
 * Operator-tunable pipeline behavior: what the daily generation run should pay
 * particular attention to and roughly how large an edition may grow, plus the two
 * daily times readers experience. Deliberately small — infrastructure, secrets, and
 * safety limits stay in code/env; see docs/decisions.md.
 */
export interface PipelineSettings {
  /** Companies, products, technologies, or topics to research a second time, more
   *  carefully. Attention only — never a requirement to include something. */
  readonly adminKeywords: readonly string[];
  /** Guidance ceiling passed to the deep-research and drafting stages; the model
   *  chooses which candidates are worth it, up to this many. Not a target. */
  readonly maximumStories: number;
  readonly gapDiscoveryEnabled: boolean;
  readonly adminKeywordsResearchEnabled: boolean;
  /** Free-text guidance for the model, e.g. what to emphasize this week. Never
   *  overrides factual accuracy, sourcing, the date boundary, or confirmation. */
  readonly editorialInstructions: string;
  /** 24-hour "HH:MM", Israel local time. */
  readonly generateTime: string;
  /** 24-hour "HH:MM", Israel local time. */
  readonly publishTime: string;
  readonly updatedAt: string;
}

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  adminKeywords: [],
  maximumStories: 8,
  gapDiscoveryEnabled: true,
  adminKeywordsResearchEnabled: true,
  editorialInstructions: "",
  generateTime: "01:00",
  publishTime: "07:00",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export function validatePipelineSettings(value: unknown): ValidationResult<PipelineSettings> {
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [issue(VALIDATION_CODES.INVALID_TYPE, "settings", "Settings must be an object.")],
    };
  }

  const issues: ValidationIssue[] = [];

  validateAdminKeywords(value.adminKeywords, issues);
  validateMaximumStories(value.maximumStories, issues);
  validateBoolean(value.gapDiscoveryEnabled, "gapDiscoveryEnabled", issues);
  validateBoolean(value.adminKeywordsResearchEnabled, "adminKeywordsResearchEnabled", issues);
  validateEditorialInstructions(value.editorialInstructions, issues);
  validateClockTime(value.generateTime, "generateTime", issues);
  validateClockTime(value.publishTime, "publishTime", issues);
  validateTimestamp(value.updatedAt, "updatedAt", issues);

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, data: value as unknown as PipelineSettings, issues: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: ValidationIssue["code"], path: string, message: string): ValidationIssue {
  return { code, path: `settings.${path}`, message };
}

function validateAdminKeywords(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, "adminKeywords", "adminKeywords is required."));
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(issue(VALIDATION_CODES.INVALID_TYPE, "adminKeywords", "adminKeywords must be an array."));
    return;
  }
  if (value.length > PIPELINE_SETTINGS_LIMITS.adminKeywordsMaxCount) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_VALUE,
        "adminKeywords",
        `adminKeywords cannot contain more than ${PIPELINE_SETTINGS_LIMITS.adminKeywordsMaxCount} entries.`,
      ),
    );
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const path = `adminKeywords[${index}]`;
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(issue(VALIDATION_CODES.INVALID_VALUE, path, `${path} must be a non-empty string.`));
      return;
    }
    if (entry.trim().length > PIPELINE_SETTINGS_LIMITS.adminKeywordMaxLength) {
      issues.push(
        issue(
          VALIDATION_CODES.INVALID_VALUE,
          path,
          `${path} cannot exceed ${PIPELINE_SETTINGS_LIMITS.adminKeywordMaxLength} characters.`,
        ),
      );
    }
    const normalized = entry.trim().toLocaleLowerCase("en-US");
    if (seen.has(normalized)) {
      issues.push(issue(VALIDATION_CODES.DUPLICATE_VALUE, path, "adminKeywords cannot contain duplicate values."));
    }
    seen.add(normalized);
  });
}

function validateMaximumStories(value: unknown, issues: ValidationIssue[]): void {
  const [minimum, maximum] = PIPELINE_SETTINGS_LIMITS.maximumStoriesRange;
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, "maximumStories", "maximumStories is required."));
  } else if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_VALUE,
        "maximumStories",
        `maximumStories must be an integer between ${minimum} and ${maximum}.`,
      ),
    );
  }
}

function validateBoolean(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (typeof value !== "boolean") {
    issues.push(issue(VALIDATION_CODES.INVALID_TYPE, path, `${path} must be a boolean.`));
  }
}

function validateEditorialInstructions(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, "editorialInstructions", "editorialInstructions is required."));
  } else if (typeof value !== "string") {
    issues.push(issue(VALIDATION_CODES.INVALID_TYPE, "editorialInstructions", "editorialInstructions must be a string."));
  } else if (value.length > PIPELINE_SETTINGS_LIMITS.editorialInstructionsMaxLength) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_VALUE,
        "editorialInstructions",
        `editorialInstructions cannot exceed ${PIPELINE_SETTINGS_LIMITS.editorialInstructionsMaxLength} characters.`,
      ),
    );
  }
}

function validateClockTime(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (typeof value !== "string" || !isClockTime(value)) {
    issues.push(issue(VALIDATION_CODES.INVALID_VALUE, path, `${path} must use 24-hour HH:MM format.`));
  }
}

function validateTimestamp(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (typeof value !== "string" || !isUtcTimestamp(value)) {
    issues.push(issue(VALIDATION_CODES.INVALID_TIMESTAMP, path, `${path} must be an ISO 8601 UTC timestamp.`));
  }
}
