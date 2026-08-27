export const DAY_INTENSITIES = [
  "minimal",
  "low",
  "medium",
  "high",
  "extreme",
] as const;

export type DayIntensity = (typeof DAY_INTENSITIES)[number];

export const BRIEF_STATUSES = ["draft", "ready", "published", "failed"] as const;

export type BriefStatus = (typeof BRIEF_STATUSES)[number];

/**
 * Stored metadata for one daily brief. Field names intentionally match the SQLite
 * columns documented in docs/data-model.md, avoiding a mapping layer at boundaries.
 */
export interface DayMetadata {
  readonly date: string;
  readonly summary: string;
  readonly significant_items: number;
  readonly worth_watching_items: number;
  readonly day_intensity: DayIntensity;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly developments: readonly string[];
  readonly status: BriefStatus;
  readonly source_count: number;
  readonly created_at: string;
  readonly published_at: string | null;
  readonly updated_at: string | null;
}

export const VALIDATION_CODES = {
  REQUIRED: "required",
  INVALID_TYPE: "invalid_type",
  INVALID_VALUE: "invalid_value",
  DUPLICATE_VALUE: "duplicate_value",
  INVALID_DATE: "invalid_date",
  INVALID_TIMESTAMP: "invalid_timestamp",
  INVALID_FILE_NAME: "invalid_file_name",
  INVALID_FILE_PATH: "invalid_file_path",
  DATE_MISMATCH: "date_mismatch",
  EMPTY_CONTENT: "empty_content",
  INVALID_UTF8: "invalid_utf8",
  EMPTY_LINK: "empty_link",
  MISSING_SECTION: "missing_section",
  ITEM_COUNT_MISMATCH: "item_count_mismatch",
} as const;

export type ValidationCode =
  (typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | {
      readonly valid: true;
      readonly data: T;
      readonly issues: readonly [];
    }
  | {
      readonly valid: false;
      readonly issues: readonly ValidationIssue[];
    };

export interface BriefArtifactInput {
  /** Absolute or storage-root-relative path to the Markdown file. */
  readonly filePath: string;
  /** Raw bytes are preferred at filesystem boundaries so UTF-8 can be verified. */
  readonly content: string | Uint8Array;
  readonly metadata: unknown;
}

export interface BriefArtifact {
  readonly filePath: string;
  readonly content: string;
  readonly metadata: DayMetadata;
}
