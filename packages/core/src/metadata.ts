import { isCalendarDate, isUtcTimestamp } from "./date.js";
import {
  BRIEF_STATUSES,
  DAY_INTENSITIES,
  VALIDATION_CODES,
  type BriefStatus,
  type DayIntensity,
  type DayMetadata,
  type ValidationIssue,
  type ValidationResult,
} from "./types.js";

const dayIntensitySet = new Set<string>(DAY_INTENSITIES);
const briefStatusSet = new Set<string>(BRIEF_STATUSES);

export function isDayIntensity(value: unknown): value is DayIntensity {
  return typeof value === "string" && dayIntensitySet.has(value);
}

export function isBriefStatus(value: unknown): value is BriefStatus {
  return typeof value === "string" && briefStatusSet.has(value);
}

export function validateDayMetadata(value: unknown): ValidationResult<DayMetadata> {
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [
        issue(
          VALIDATION_CODES.INVALID_TYPE,
          "metadata",
          "Metadata must be an object.",
        ),
      ],
    };
  }

  const issues: ValidationIssue[] = [];

  validateDate(value.date, "date", issues);
  validateNonEmptyString(value.summary, "summary", issues);
  validateNonNegativeInteger(value.significant_items, "significant_items", issues);
  validateNonNegativeInteger(
    value.worth_watching_items,
    "worth_watching_items",
    issues,
  );
  validateAllowedValue(
    value.day_intensity,
    "day_intensity",
    dayIntensitySet,
    DAY_INTENSITIES.join(", "),
    issues,
  );
  validateStringList(value.companies, "companies", issues);
  validateStringList(value.topics, "topics", issues);
  validateStringList(value.developments, "developments", issues);
  validateAllowedValue(
    value.status,
    "status",
    briefStatusSet,
    BRIEF_STATUSES.join(", "),
    issues,
  );
  validateNonNegativeInteger(value.source_count, "source_count", issues);
  validateTimestamp(value.created_at, "created_at", false, issues);
  validateTimestamp(value.published_at, "published_at", true, issues);
  validateTimestamp(value.updated_at, "updated_at", true, issues);

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, data: value as unknown as DayMetadata, issues: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  code: ValidationIssue["code"],
  path: string,
  message: string,
): ValidationIssue {
  return { code, path: `metadata.${path}`, message };
}

function validateDate(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, "Date is required."));
  } else if (typeof value !== "string" || !isCalendarDate(value)) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_DATE,
        path,
        "Date must be a real calendar date in YYYY-MM-DD format.",
      ),
    );
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (typeof value !== "string") {
    issues.push(
      issue(VALIDATION_CODES.INVALID_TYPE, path, `${path} must be a string.`),
    );
  } else if (value.trim().length === 0) {
    issues.push(
      issue(VALIDATION_CODES.INVALID_VALUE, path, `${path} cannot be empty.`),
    );
  }
}

function validateNonNegativeInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (!Number.isInteger(value) || (value as number) < 0) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_VALUE,
        path,
        `${path} must be a non-negative integer.`,
      ),
    );
  }
}

function validateAllowedValue(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  allowedDescription: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (typeof value !== "string" || !allowed.has(value)) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_VALUE,
        path,
        `${path} must be one of: ${allowedDescription}.`,
      ),
    );
  }
}

function validateStringList(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
    return;
  }

  if (!Array.isArray(value)) {
    issues.push(
      issue(VALIDATION_CODES.INVALID_TYPE, path, `${path} must be an array.`),
    );
    return;
  }

  const seen = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string" || item.trim().length === 0) {
      issues.push(
        issue(
          VALIDATION_CODES.INVALID_VALUE,
          itemPath,
          `${itemPath} must be a non-empty string.`,
        ),
      );
      return;
    }

    const normalized = item.trim().toLocaleLowerCase("en-US");
    if (seen.has(normalized)) {
      issues.push(
        issue(
          VALIDATION_CODES.DUPLICATE_VALUE,
          itemPath,
          `${path} cannot contain duplicate values.`,
        ),
      );
    }
    seen.add(normalized);
  });
}

function validateTimestamp(
  value: unknown,
  path: string,
  nullable: boolean,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    issues.push(issue(VALIDATION_CODES.REQUIRED, path, `${path} is required.`));
  } else if (nullable && value === null) {
    return;
  } else if (typeof value !== "string" || !isUtcTimestamp(value)) {
    issues.push(
      issue(
        VALIDATION_CODES.INVALID_TIMESTAMP,
        path,
        `${path} must be an ISO 8601 UTC timestamp${nullable ? " or null" : ""}.`,
      ),
    );
  }
}
