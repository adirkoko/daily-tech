import { expectedBriefRelativePath, isCalendarDate } from "./date.js";
import { inspectMarkdownStructure, validateMarkdownLinks } from "./markdown.js";
import { validateDayMetadata } from "./metadata.js";
import {
  VALIDATION_CODES,
  type BriefArtifact,
  type BriefArtifactInput,
  type ValidationIssue,
  type ValidationResult,
} from "./types.js";

const FILE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-tech_briefs\.md$/u;

export function validateBriefArtifact(
  input: BriefArtifactInput,
): ValidationResult<BriefArtifact> {
  const issues: ValidationIssue[] = [];
  const normalizedPath = input.filePath.replaceAll("\\", "/");
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  const fileNameMatch = FILE_NAME_PATTERN.exec(fileName);
  const fileDate = fileNameMatch?.[1];

  if (fileDate === undefined || !isCalendarDate(fileDate)) {
    issues.push({
      code: VALIDATION_CODES.INVALID_FILE_NAME,
      path: "filePath",
      message: "Brief filename must be YYYY-MM-DD-tech_briefs.md with a valid date.",
    });
  }

  const decoded = decodeUtf8(input.content);
  if (!decoded.valid) {
    issues.push({
      code: VALIDATION_CODES.INVALID_UTF8,
      path: "content",
      message: "Brief content must be valid UTF-8.",
    });
  } else if (decoded.content.trim().length === 0) {
    issues.push({
      code: VALIDATION_CODES.EMPTY_CONTENT,
      path: "content",
      message: "Brief content cannot be empty.",
    });
  }

  const metadataResult = validateDayMetadata(input.metadata);
  if (!metadataResult.valid) {
    issues.push(...metadataResult.issues);
  } else {
    const expectedPath = expectedBriefRelativePath(metadataResult.data.date);
    if (expectedPath !== null && !normalizedPath.endsWith(expectedPath)) {
      issues.push({
        code: VALIDATION_CODES.INVALID_FILE_PATH,
        path: "filePath",
        message: `Brief path must end with ${expectedPath}.`,
      });
    }

    if (fileDate !== undefined && fileDate !== metadataResult.data.date) {
      issues.push({
        code: VALIDATION_CODES.DATE_MISMATCH,
        path: "metadata.date",
        message: "Metadata date must match the date in the filename.",
      });
    }

    if (decoded.valid && decoded.content.trim().length > 0) {
      issues.push(...validateMarkdownLinks(decoded.content));
      validateItemCounts(decoded.content, metadataResult.data, issues);
    }
  }

  if (issues.length > 0 || !decoded.valid || !metadataResult.valid) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    data: {
      filePath: input.filePath,
      content: decoded.content,
      metadata: metadataResult.data,
    },
    issues: [],
  };
}

function validateItemCounts(
  markdown: string,
  metadata: BriefArtifact["metadata"],
  issues: ValidationIssue[],
): void {
  const structure = inspectMarkdownStructure(markdown);

  validateSectionCount(
    "significant_items",
    "Meaningful developments",
    metadata.significant_items,
    structure.significantSectionPresent,
    structure.significantItems,
    issues,
  );
  validateSectionCount(
    "worth_watching_items",
    "Worth watching",
    metadata.worth_watching_items,
    structure.worthWatchingSectionPresent,
    structure.worthWatchingItems,
    issues,
  );
}

function validateSectionCount(
  metadataPath: string,
  sectionName: string,
  expected: number,
  sectionPresent: boolean,
  actual: number,
  issues: ValidationIssue[],
): void {
  if (!sectionPresent && expected > 0) {
    issues.push({
      code: VALIDATION_CODES.MISSING_SECTION,
      path: "content",
      message: `${sectionName} section is required when ${metadataPath} is greater than zero.`,
    });
  } else if (actual !== expected) {
    issues.push({
      code: VALIDATION_CODES.ITEM_COUNT_MISMATCH,
      path: `metadata.${metadataPath}`,
      message: `${metadataPath} is ${expected}, but the Markdown contains ${actual} items.`,
    });
  }
}

type DecodeResult =
  | { readonly valid: true; readonly content: string }
  | { readonly valid: false };

function decodeUtf8(content: string | Uint8Array): DecodeResult {
  if (typeof content === "string") {
    return containsUnpairedSurrogate(content)
      ? { valid: false }
      : { valid: true, content };
  }

  try {
    return {
      valid: true,
      content: new TextDecoder("utf-8", { fatal: true }).decode(content),
    };
  } catch {
    return { valid: false };
  }
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
