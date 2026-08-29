import type { PipelineContext } from "../types.js";
import type { BriefDraft } from "../writing/contracts.js";

export const RESEARCH_CATEGORIES = [
  "ai",
  "developer_tools",
  "cloud",
  "open_source",
  "hardware",
  "robotics",
  "consumer_tech",
  "other",
] as const;

export const SOURCE_TYPES = [
  "official_blog",
  "official_docs",
  "github",
  "release_notes",
  "journalism",
  "other",
] as const;

export const EVENT_DATE_EVIDENCE_KINDS = [
  "explicit_event_date",
  "official_announcement_date",
  "release_effective_date",
] as const;

export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
export type EventDateEvidenceKind = (typeof EVENT_DATE_EVIDENCE_KINDS)[number];
export type Importance = 1 | 2 | 3 | 4 | 5;

export interface ResearchSource {
  readonly url: string;
  readonly title: string;
  readonly publisher: string;
  /** The source's own publication date; null when none is reliably known. */
  readonly publishedOn: string | null;
  readonly type: SourceType;
}

export interface EventDateEvidence {
  readonly eventDate: string;
  readonly kind: EventDateEvidenceKind;
  readonly sourceUrl: string;
  readonly explanation: string;
}

/** Trusted only after provider citation matching; still has no internal identity. */
export interface ResearchStoryInput {
  readonly title: string;
  readonly factualSummary: string;
  readonly whyItMatters: string;
  readonly keyFacts: readonly string[];
  readonly availability: string | null;
  readonly category: ResearchCategory;
  readonly importance: Importance;
  /** The calendar date (YYYY-MM-DD) the event belongs to. No time of day is tracked. */
  readonly occurredOn: string;
  readonly eventDateEvidence: EventDateEvidence;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly sources: readonly ResearchSource[];
}

export interface ResearchedStory extends ResearchStoryInput {
  readonly id: string;
}

export interface RejectedResearchStory {
  readonly index: number;
  readonly title: string | null;
  readonly reason: string;
}

export interface ResearchBatch {
  readonly stories: readonly ResearchStoryInput[];
  readonly rejectedStories: readonly RejectedResearchStory[];
}

export interface GapResearchBatch {
  readonly missingStories: readonly ResearchStoryInput[];
  readonly rejectedStories: readonly RejectedResearchStory[];
}

export interface NewsResearchScope {
  readonly categories: readonly ResearchCategory[];
  readonly minimumImportance: Importance;
  readonly maximumStories: number;
  readonly preferredSourceTypes: readonly SourceType[];
}

export interface NewsResearchRequest {
  readonly context: PipelineContext;
  readonly scope: NewsResearchScope;
}

export interface GapResearchRequest {
  readonly context: PipelineContext;
  readonly existingStories: readonly ResearchedStory[];
  readonly draft: BriefDraft;
  readonly minimumImportance: Importance;
  readonly maximumMissingStories: number;
}

export interface NewsResearchProvider {
  research(request: NewsResearchRequest): Promise<ResearchBatch>;
  findGaps(request: GapResearchRequest): Promise<GapResearchBatch>;
}

export interface StoryIdFactory {
  create(): string;
}
