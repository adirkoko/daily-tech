import type { DayIntensity } from "@daily-tech/core";

import { canonicalizeUrl } from "../research/citation-validation.js";
import type { DeepResearchedStory } from "../research/contracts.js";
import type { BriefDraft } from "./contracts.js";
import { validateDraftAgainstStories } from "./draft-validation.js";

export interface FinalEditionMetadata {
  readonly summary: string;
  readonly significant_items: number;
  readonly worth_watching_items: number;
  readonly day_intensity: DayIntensity;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly developments: readonly string[];
  readonly source_count: number;
}

/**
 * Builds every mechanically derivable metadata field from the final edition.
 * Unreferenced research stories and sources the writer did not cite cannot enter
 * the persisted row through this boundary.
 */
export function deriveFinalEditionMetadata(
  draft: BriefDraft,
  stories: readonly DeepResearchedStory[],
): FinalEditionMetadata {
  validateDraftAgainstStories(draft, stories);

  const storiesById = new Map(stories.map((story) => [story.id, story]));
  const referencedStoryIds = uniqueIds([
    ...draft.developments.flatMap(({ storyIds }) => storyIds),
    ...draft.worthWatching.flatMap(({ storyIds }) => storyIds),
  ]);
  const referencedStories = referencedStoryIds.map((id) => storiesById.get(id)!);
  const citedUrls = uniqueCanonicalUrls([
    ...draft.developments.flatMap(({ sources }) => sources.map(({ url }) => url)),
    ...draft.worthWatching.flatMap(({ sources }) => sources.map(({ url }) => url)),
  ]);
  const itemCount = draft.developments.length + draft.worthWatching.length;

  return {
    summary: draft.metadata.summary,
    significant_items: draft.developments.length,
    worth_watching_items: draft.worthWatching.length,
    day_intensity: intensityForItemCount(itemCount),
    companies: uniqueLabels(referencedStories.flatMap(({ companies }) => companies)),
    topics: uniqueLabels(referencedStories.flatMap(({ topics }) => topics)),
    developments: draft.developments.map(({ title }) => title),
    source_count: citedUrls.length,
  };
}

function intensityForItemCount(itemCount: number): DayIntensity {
  if (itemCount === 0) return "minimal";
  if (itemCount <= 2) return "low";
  if (itemCount <= 5) return "medium";
  if (itemCount <= 8) return "high";
  return "extreme";
}

function uniqueIds(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function uniqueLabels(values: readonly string[]): readonly string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.normalize("NFKC").toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, trimmed);
  }
  return [...unique.values()];
}

function uniqueCanonicalUrls(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((url) => canonicalizeUrl(url)))];
}
