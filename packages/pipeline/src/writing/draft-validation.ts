import type { PipelineContext } from "../types.js";
import { canonicalizeUrl } from "../research/citation-validation.js";
import type { ResearchedStory } from "../research/contracts.js";
import type { BriefDraft } from "./contracts.js";

export class DraftResearchBoundaryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Draft crossed the research boundary (${issues.length} issues).`);
    this.name = "DraftResearchBoundaryError";
    this.issues = issues;
  }
}

export function validateDraftAgainstStories(
  draft: BriefDraft,
  stories: readonly ResearchedStory[],
): void {
  const issues: string[] = [];
  const expectedIds = new Set(stories.map(({ id }) => id));
  const includedIds = new Set(draft.includedStoryIds);
  if (includedIds.size !== draft.includedStoryIds.length) {
    issues.push("included_story_ids contains duplicates.");
  }
  if (!setsEqual(expectedIds, includedIds)) {
    issues.push("included_story_ids must contain every researched story exactly once.");
  }

  const allowedUrls = new Set(
    stories.flatMap(({ sources }) => sources.map(({ url }) => canonicalizeUrl(url))),
  );
  for (const url of markdownUrls(draft.markdown)) {
    try {
      if (!allowedUrls.has(canonicalizeUrl(url))) {
        issues.push(`Draft contains a URL absent from research: ${url}`);
      }
    } catch {
      issues.push(`Draft contains an invalid URL: ${url}`);
    }
  }

  const expectedItems = stories.length;
  if (draft.metadata.significant_items + draft.metadata.worth_watching_items !== expectedItems) {
    issues.push("Draft item counts do not match researched stories.");
  }
  const allowedCompanies = normalizedSet(stories.flatMap(({ companies }) => companies));
  const allowedTopics = normalizedSet(stories.flatMap(({ topics }) => topics));
  if (draft.metadata.companies.some((company) => !allowedCompanies.has(normalize(company)))) {
    issues.push("Draft metadata contains a company absent from research.");
  }
  if (draft.metadata.topics.some((topic) => !allowedTopics.has(normalize(topic)))) {
    issues.push("Draft metadata contains a topic absent from research.");
  }
  if (draft.metadata.developments.length !== expectedItems) {
    issues.push("Draft developments count does not match researched stories.");
  }
  if (issues.length > 0) throw new DraftResearchBoundaryError(issues);
}

export function createQuietDayDraft(context: PipelineContext): BriefDraft {
  return {
    markdown: `# Daily Tech — ${context.window.date}\n\nלא נמצאו התפתחויות טכנולוגיות משמעותיות בחלון הזמן שנבדק.\n`,
    includedStoryIds: [],
    metadata: {
      summary: "לא נמצאו התפתחויות טכנולוגיות משמעותיות בחלון הזמן שנבדק.",
      significant_items: 0,
      worth_watching_items: 0,
      day_intensity: "minimal",
      companies: [],
      topics: [],
      developments: [],
    },
  };
}

function markdownUrls(markdown: string): readonly string[] {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

function normalizedSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map(normalize));
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function setsEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  return first.size === second.size && [...first].every((value) => second.has(value));
}
