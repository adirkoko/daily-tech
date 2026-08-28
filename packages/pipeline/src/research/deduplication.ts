import { canonicalizeUrl } from "./citation-validation.js";
import type { ResearchedStory, ResearchSource, ResearchStoryInput } from "./contracts.js";

export function deduplicateStoryInputs(
  stories: readonly ResearchStoryInput[],
): readonly ResearchStoryInput[] {
  const result: ResearchStoryInput[] = [];
  for (const story of stories) {
    const duplicateIndex = result.findIndex((existing) => sameHighConfidenceEvent(existing, story));
    if (duplicateIndex === -1) result.push(story);
    else result[duplicateIndex] = mergeStories(result[duplicateIndex]!, story);
  }
  return result;
}

export function representedByExistingStory(
  candidate: ResearchStoryInput,
  existingStories: readonly ResearchedStory[],
): boolean {
  return existingStories.some((existing) => sameHighConfidenceEvent(existing, candidate));
}

export function sameHighConfidenceEvent(
  first: ResearchStoryInput,
  second: ResearchStoryInput,
): boolean {
  const firstUrls = new Set(first.sources.map(({ url }) => canonicalizeUrl(url)));
  if (second.sources.some(({ url }) => firstUrls.has(canonicalizeUrl(url)))) return true;
  if (first.occurredOn !== second.occurredOn || first.category !== second.category) return false;
  const firstCompanies = normalizedSet(first.companies);
  const secondCompanies = normalizedSet(second.companies);
  if (firstCompanies.size === 0 || !setsEqual(firstCompanies, secondCompanies)) return false;
  return tokenSimilarity(first.title, second.title) >= 0.9;
}

function mergeStories(
  first: ResearchStoryInput,
  second: ResearchStoryInput,
): ResearchStoryInput {
  const primary = selectPrimary(first, second);
  return {
    ...primary,
    importance: Math.max(first.importance, second.importance) as ResearchStoryInput["importance"],
    keyFacts: uniqueStrings([...first.keyFacts, ...second.keyFacts]),
    companies: uniqueStrings([...first.companies, ...second.companies]),
    topics: uniqueStrings([...first.topics, ...second.topics]),
    sources: uniqueSources([...first.sources, ...second.sources]),
  };
}

function selectPrimary(first: ResearchStoryInput, second: ResearchStoryInput): ResearchStoryInput {
  if (first.importance !== second.importance) {
    return first.importance > second.importance ? first : second;
  }
  if (first.sources.length !== second.sources.length) {
    return first.sources.length > second.sources.length ? first : second;
  }
  return first.factualSummary.length >= second.factualSummary.length ? first : second;
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

function normalizedSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map(normalize).filter(Boolean));
}

function setsEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  return first.size === second.size && [...first].every((value) => second.has(value));
}

function tokenSimilarity(first: string, second: string): number {
  const firstTokens = normalizedSet(first.split(/\s+/u));
  const secondTokens = normalizedSet(second.split(/\s+/u));
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0;
  const intersection = [...firstTokens].filter((token) => secondTokens.has(token)).length;
  const union = new Set([...firstTokens, ...secondTokens]).size;
  return intersection / union;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}
