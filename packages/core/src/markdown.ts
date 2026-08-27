import {
  VALIDATION_CODES,
  type ValidationIssue,
} from "./types.js";

export const DEFAULT_MARKDOWN_HEADINGS = {
  significant: ["ההתפתחויות המשמעותיות", "Meaningful developments"],
  worthWatching: ["שווה לעקוב", "Worth watching"],
} as const;

export interface BriefMarkdownHeadings {
  readonly significant: readonly string[];
  readonly worthWatching: readonly string[];
}

export interface MarkdownStructure {
  readonly significantSectionPresent: boolean;
  readonly significantItems: number;
  readonly worthWatchingSectionPresent: boolean;
  readonly worthWatchingItems: number;
}

export function inspectMarkdownStructure(
  markdown: string,
  headings: BriefMarkdownHeadings = DEFAULT_MARKDOWN_HEADINGS,
): MarkdownStructure {
  let activeSection: "significant" | "worthWatching" | null = null;
  let significantSectionPresent = false;
  let worthWatchingSectionPresent = false;
  let significantItems = 0;
  let worthWatchingItems = 0;

  for (const line of markdown.split(/\r?\n/u)) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line.trim());
    if (heading === null) {
      continue;
    }

    const level = heading[1]?.length;
    const title = heading[2]?.trim();
    if (level === undefined || title === undefined) {
      continue;
    }

    if (level === 2) {
      if (headings.significant.includes(title)) {
        activeSection = "significant";
        significantSectionPresent = true;
      } else if (headings.worthWatching.includes(title)) {
        activeSection = "worthWatching";
        worthWatchingSectionPresent = true;
      } else {
        activeSection = null;
      }
    } else if (level === 3 && activeSection === "significant") {
      significantItems += 1;
    } else if (level === 3 && activeSection === "worthWatching") {
      worthWatchingItems += 1;
    }
  }

  return {
    significantSectionPresent,
    significantItems,
    worthWatchingSectionPresent,
    worthWatchingItems,
  };
}

export function validateMarkdownLinks(markdown: string): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const linkPattern = /!?\[[^\]]*\]\(([^)]*)\)/gu;

  for (const match of markdown.matchAll(linkPattern)) {
    const destination = match[1]?.trim() ?? "";
    if (destination.length === 0) {
      issues.push({
        code: VALIDATION_CODES.EMPTY_LINK,
        path: `content:${lineNumberAt(markdown, match.index)}`,
        message: "Markdown links must have a destination.",
      });
    }
  }

  return issues;
}

function lineNumberAt(value: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (value.charCodeAt(position) === 10) {
      line += 1;
    }
  }
  return line;
}
