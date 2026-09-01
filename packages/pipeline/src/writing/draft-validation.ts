import { canonicalizeUrl } from "../research/citation-validation.js";
import type { DeepResearchedStory } from "../research/contracts.js";
import type { BriefDraft, DraftDevelopment, DraftWorthWatchingItem } from "./contracts.js";

export class DraftResearchBoundaryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      [
        `Draft crossed the research boundary (${issues.length} issue${issues.length === 1 ? "" : "s"}):`,
        ...issues.map((issue) => `  - ${issue}`),
      ].join("\n"),
    );
    this.name = "DraftResearchBoundaryError";
    this.issues = issues;
  }
}

/**
 * Deliberately the only two things code can prove without editorial judgment:
 * every storyId the writer references is a real researched story, and every
 * source it cites belongs to those stories' own verified sources. Which
 * stories become a development, a worth-watching mention, or nothing at all
 * is the writer's call — there is no coverage requirement.
 */
export function validateDraftAgainstStories(
  draft: BriefDraft,
  stories: readonly DeepResearchedStory[],
): void {
  const storiesById = new Map(stories.map((story) => [story.id, story]));
  const issues: string[] = [];

  draft.developments.forEach((development, index) => {
    checkItem(`development ${index + 1}`, development, storiesById, issues);
  });
  draft.worthWatching.forEach((item, index) => {
    checkItem(`worth-watching item ${index + 1}`, item, storiesById, issues);
  });

  if (issues.length > 0) throw new DraftResearchBoundaryError(issues);
}

function checkItem(
  label: string,
  item: DraftDevelopment | DraftWorthWatchingItem,
  storiesById: ReadonlyMap<string, DeepResearchedStory>,
  issues: string[],
): void {
  const referencedStories: DeepResearchedStory[] = [];
  for (const storyId of item.storyIds) {
    const story = storiesById.get(storyId);
    if (story === undefined) {
      issues.push(`${label} references an unknown story id: ${storyId}`);
      continue;
    }
    referencedStories.push(story);
  }

  const allowedUrls = new Set(
    referencedStories.flatMap(({ sources }) => sources.map(({ url }) => canonicalizeUrl(url))),
  );
  for (const source of item.sources) {
    try {
      if (!allowedUrls.has(canonicalizeUrl(source.url))) {
        issues.push(`${label} cites a source absent from its stories: ${source.url}`);
      }
    } catch {
      issues.push(`${label} cites an invalid source URL: ${source.url}`);
    }
  }
}

export function createQuietDayDraft(): BriefDraft {
  const summary = "לא נמצאו התפתחויות טכנולוגיות משמעותיות בחלון הזמן שנבדק.";
  return {
    dayOverview: summary,
    developments: [],
    worthWatching: [],
    bottomLine: summary,
    metadata: {
      summary,
      significant_items: 0,
      worth_watching_items: 0,
      day_intensity: "minimal",
      companies: [],
      topics: [],
      developments: [],
    },
  };
}
