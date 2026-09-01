import { canonicalizeUrl } from "./citation-validation.js";
import type { CandidateStory, CandidateStoryInput, ResearchSource } from "./contracts.js";

export function deduplicateStoryInputs(
  stories: readonly CandidateStoryInput[],
): readonly CandidateStoryInput[] {
  const result: CandidateStoryInput[] = [];
  for (const story of stories) {
    const duplicateIndex = result.findIndex((existing) => sameHighConfidenceEvent(existing, story));
    if (duplicateIndex === -1) result.push(story);
    else result[duplicateIndex] = mergeStories(result[duplicateIndex]!, story);
  }
  return result;
}

export function representedByExistingStory(
  candidate: CandidateStoryInput,
  existingStories: readonly CandidateStory[],
): boolean {
  return existingStories.some((existing) => sameHighConfidenceEvent(existing, candidate));
}

/**
 * Deliberately the only "clear duplicate" code can prove without judgment: the
 * same cited source. Matching by title/company/category similarity is semantic
 * deduplication, which the research prompts already ask the model to do.
 */
export function sameHighConfidenceEvent(
  first: CandidateStoryInput,
  second: CandidateStoryInput,
): boolean {
  const firstUrls = new Set(first.sources.map(({ url }) => canonicalizeUrl(url)));
  return second.sources.some(({ url }) => firstUrls.has(canonicalizeUrl(url)));
}

function mergeStories(
  first: CandidateStoryInput,
  second: CandidateStoryInput,
): CandidateStoryInput {
  const primary = selectPrimary(first, second);
  return {
    ...primary,
    importance: Math.max(first.importance, second.importance) as CandidateStoryInput["importance"],
    companies: uniqueStrings([...first.companies, ...second.companies]),
    topics: uniqueStrings([...first.topics, ...second.topics]),
    sources: uniqueSources([...first.sources, ...second.sources]),
  };
}

function selectPrimary(first: CandidateStoryInput, second: CandidateStoryInput): CandidateStoryInput {
  if (first.importance !== second.importance) {
    return first.importance > second.importance ? first : second;
  }
  if (first.sources.length !== second.sources.length) {
    return first.sources.length > second.sources.length ? first : second;
  }
  return first.shortSummary.length >= second.shortSummary.length ? first : second;
}

function uniqueSources(sources: readonly ResearchSource[]): readonly ResearchSource[] {
  const byUrl = new Map<string, ResearchSource>();
  sources.forEach((source) => byUrl.set(canonicalizeUrl(source.url), source));
  return [...byUrl.values()];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const byNormalized = new Map<string, string>();
  values.forEach((value) => byNormalized.set(normalize(value), value));
  return [...byNormalized.values()];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}
