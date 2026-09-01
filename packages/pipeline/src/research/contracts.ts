import type { PipelineContext } from "../types.js";

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

export interface RejectedResearchStory {
  readonly index: number;
  readonly title: string | null;
  readonly reason: string;
}

// ---- Discovery (light, gap, and admin-keyword-focused) ----

/**
 * Trusted only after provider citation matching; still has no internal identity.
 * Deliberately light: enough to judge whether something is worth deep research,
 * not a finished account of it. Deep Research produces the full dossier later,
 * only for the candidates that survive this stage.
 */
export interface CandidateStoryInput {
  readonly title: string;
  /** One or two factual sentences — a headline-level account, not analysis. */
  readonly shortSummary: string;
  readonly category: ResearchCategory;
  readonly importance: Importance;
  /** The calendar date (YYYY-MM-DD) the event belongs to. No time of day is tracked. */
  readonly occurredOn: string;
  readonly eventDateEvidence: EventDateEvidence;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly sources: readonly ResearchSource[];
}

export interface CandidateStory extends CandidateStoryInput {
  readonly id: string;
}

export interface DiscoveryBatch {
  readonly stories: readonly CandidateStoryInput[];
  readonly rejectedStories: readonly RejectedResearchStory[];
}

export interface NewsDiscoveryScope {
  readonly categories: readonly ResearchCategory[];
  readonly minimumImportance: Importance;
  /** Safety cap on one discovery call's own output size — an API-shape guard, not
   *  an editorial setting. */
  readonly maximumCandidatesPerCall: number;
  readonly preferredSourceTypes: readonly SourceType[];
}

export interface LightDiscoveryRequest {
  readonly context: PipelineContext;
  readonly scope: NewsDiscoveryScope;
}

export interface FocusedDiscoveryRequest {
  readonly context: PipelineContext;
  readonly existingStories: readonly CandidateStory[];
  readonly minimumImportance: Importance;
  readonly maximumCandidatesPerCall: number;
  /**
   * When present and non-empty, narrows the question from a general "what did we
   * miss" gap check to "what did we miss around these companies/products/
   * technologies/topics specifically" — attention only, never an inclusion
   * requirement. Omitted or empty runs a general gap check instead.
   */
  readonly focusKeywords?: readonly string[];
}

// ---- Deep research ----

/**
 * The full dossier produced once a candidate is judged worth deep research.
 * `candidateId` ties it back to the `CandidateStory` it investigated; every
 * nullable field is set to null, not omitted or invented, when the research
 * turned up nothing relevant for it.
 */
export interface DeepResearchedStoryInput {
  readonly candidateId: string;
  readonly title: string;
  readonly whatHappened: string;
  readonly whatChangedFromBefore: string | null;
  readonly technicalDetails: string | null;
  readonly capabilities: string | null;
  readonly pricing: string | null;
  readonly availability: string | null;
  readonly rollout: string | null;
  readonly supportedUsersOrPlatforms: string | null;
  readonly limitations: string | null;
  readonly whoIsAffected: string | null;
  readonly whyItMatters: string;
  readonly whatToDoWithItNow: string | null;
  readonly category: ResearchCategory;
  readonly importance: Importance;
  readonly occurredOn: string;
  readonly eventDateEvidence: EventDateEvidence;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly sources: readonly ResearchSource[];
}

export interface DeepResearchedStory extends DeepResearchedStoryInput {
  readonly id: string;
}

export interface DeepResearchBatch {
  readonly stories: readonly DeepResearchedStoryInput[];
}

export interface DeepResearchRequest {
  readonly context: PipelineContext;
  readonly candidates: readonly CandidateStory[];
  /**
   * Guidance ceiling on how many candidates are worth a place in the edition.
   * The model chooses which ones, up to this many; code only refuses a response
   * that exceeds it. Never used to pre-select candidates in code.
   */
  readonly maximumStories: number;
  /** "" when the operator has not set any editorial guidance. */
  readonly editorialInstructions: string;
}

export interface NewsResearchProvider {
  discover(request: LightDiscoveryRequest): Promise<DiscoveryBatch>;
  findGaps(request: FocusedDiscoveryRequest): Promise<DiscoveryBatch>;
  deepResearch(request: DeepResearchRequest): Promise<DeepResearchBatch>;
}

export interface StoryIdFactory {
  create(): string;
}
