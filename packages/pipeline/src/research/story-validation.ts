import { isCalendarDate } from "@daily-tech/core";

import type { PipelineContext } from "../types.js";
import {
  deduplicateStoryInputs,
  representedByExistingStory,
  sameHighConfidenceEvent,
} from "./deduplication.js";
import { canonicalizeUrl } from "./citation-validation.js";
import type {
  CandidateStory,
  CandidateStoryInput,
  DeepResearchBatch,
  DeepResearchExclusionReason,
  DeepResearchedStory,
  DeepResearchedStoryInput,
  DiscoveryBatch,
  Importance,
  RejectedResearchStory,
  StoryIdFactory,
} from "./contracts.js";

export class ResearchProcessingError extends Error {
  /** Populated only when every story in the batch was rejected; empty otherwise. */
  readonly rejectedStories: readonly RejectedResearchStory[];

  constructor(message: string, rejectedStories: readonly RejectedResearchStory[] = []) {
    super(message);
    this.name = "ResearchProcessingError";
    this.rejectedStories = rejectedStories;
  }
}

export interface ProcessedCandidates {
  readonly stories: readonly CandidateStory[];
  readonly rejectedStories: readonly RejectedResearchStory[];
  readonly filteredStories: readonly RejectedResearchStory[];
}

export function finalizeDiscoveryBatch(
  batch: DiscoveryBatch,
  context: PipelineContext,
  minimumImportance: Importance,
  storyIds: StoryIdFactory,
): ProcessedCandidates {
  const validated = validateCandidates(batch.stories, context, minimumImportance);
  const deduplicated = deduplicateStoryInputs(validated.stories);
  const rejectedStories = [...batch.rejectedStories, ...validated.rejectedStories];
  const filteredStories = duplicateDiagnostics(validated.stories, batch.stories);
  assertNotEntirelyRejected(
    batch.stories.length + batch.rejectedStories.length,
    deduplicated.length,
    "discovery",
    rejectedStories,
  );
  return {
    stories: assignIds(deduplicated, storyIds),
    rejectedStories,
    filteredStories,
  };
}

/** Used for both the general gap check and admin-keyword-focused research — they
 *  share the same "here's what we have, what's missing" shape. */
export function finalizeFocusedDiscoveryBatch(
  batch: DiscoveryBatch,
  existingStories: readonly CandidateStory[],
  context: PipelineContext,
  minimumImportance: Importance,
  storyIds: StoryIdFactory,
): ProcessedCandidates {
  const validated = validateCandidates(batch.stories, context, minimumImportance);
  const deduplicated = deduplicateStoryInputs(validated.stories);
  const uniqueMissing = deduplicated.filter(
    (story) => !representedByExistingStory(story, existingStories),
  );
  const rejectedStories = [...batch.rejectedStories, ...validated.rejectedStories];
  const filteredStories = [
    ...duplicateDiagnostics(validated.stories, batch.stories),
    ...deduplicated
      .filter((story) => representedByExistingStory(story, existingStories))
      .map((story) => ({
        index: batch.stories.indexOf(story),
        title: story.title,
        reason: "Already represented by an earlier discovery stage.",
      })),
  ];
  assertNotEntirelyRejected(
    batch.stories.length + batch.rejectedStories.length,
    uniqueMissing.length,
    "focused discovery",
    rejectedStories,
    batch.stories.length > 0 && uniqueMissing.length === 0,
  );
  return {
    stories: assignIds(
      uniqueMissing,
      storyIds,
      new Set(existingStories.map(({ id }) => id)),
    ),
    rejectedStories,
    filteredStories,
  };
}

function duplicateDiagnostics(
  stories: readonly CandidateStoryInput[],
  originalStories: readonly CandidateStoryInput[],
): readonly RejectedResearchStory[] {
  const seen: CandidateStoryInput[] = [];
  const filtered: RejectedResearchStory[] = [];
  for (const story of stories) {
    if (seen.some((existing) => sameHighConfidenceEvent(existing, story))) {
      filtered.push({
        index: originalStories.indexOf(story),
        title: story.title,
        reason: "Merged as a high-confidence duplicate.",
      });
    } else {
      seen.push(story);
    }
  }
  return filtered;
}

function validateCandidates(
  stories: readonly CandidateStoryInput[],
  context: PipelineContext,
  minimumImportance: Importance,
): { stories: readonly CandidateStoryInput[]; rejectedStories: readonly RejectedResearchStory[] } {
  const accepted: CandidateStoryInput[] = [];
  const rejected: RejectedResearchStory[] = [];
  stories.forEach((story, index) => {
    try {
      validateStoryEvidence(story, context, minimumImportance);
      accepted.push(story);
    } catch (error) {
      rejected.push({
        index,
        title: story.title,
        reason: error instanceof Error ? error.message : "Unknown evidence validation failure.",
      });
    }
  });
  return { stories: accepted, rejectedStories: rejected };
}

/**
 * Deliberately narrow: only what code can check without judgment. Evidence
 * wording quality and not inventing precision are the model's job (see the
 * research prompts) — `occurredOn`, the calendar day and nothing finer, is the
 * one hard, unambiguous date check the rest of the system relies on.
 */
export function validateStoryEvidence(
  story: CandidateStoryInput,
  context: PipelineContext,
  minimumImportance: Importance,
): void {
  if (story.importance < minimumImportance) {
    throw new TypeError("Story did not meet the configured importance threshold.");
  }
  if (!isCalendarDate(story.occurredOn) || story.occurredOn !== context.window.date) {
    throw new TypeError("Story occurredOn is outside the research calendar date.");
  }
  if (story.eventDateEvidence.eventDate !== story.occurredOn) {
    throw new TypeError("Event-date evidence does not match occurredOn.");
  }
  if (story.sources.length === 0) throw new TypeError("Story must include sources.");
  validateEvidenceSourceIsRetained(story);
}

function assignIds(
  stories: readonly CandidateStoryInput[],
  storyIds: StoryIdFactory,
  reservedIds: Set<string> = new Set(),
): readonly CandidateStory[] {
  return stories.map((story) => {
    const id = storyIds.create().trim();
    if (id.length === 0) {
      throw new ResearchProcessingError("Story ID factory returned an empty ID.");
    }
    if (reservedIds.has(id)) {
      throw new ResearchProcessingError(`Story ID factory returned duplicate ID: ${id}`);
    }
    reservedIds.add(id);
    return { id, ...story };
  });
}

// ---- Deep research ----

export interface ProcessedDeepResearch {
  readonly stories: readonly DeepResearchedStory[];
  readonly rejectedStories: readonly RejectedResearchStory[];
  readonly excludedCandidates: readonly {
    readonly candidate: CandidateStory;
    readonly reason: DeepResearchExclusionReason;
  }[];
}

/**
 * Ties each returned dossier back to the candidate it investigated. A candidateId
 * that does not match a supplied candidate, or is reused across two dossiers, is a
 * contract violation code can catch objectively. Every supplied candidate must be
 * accounted for exactly once as selected, rejected during parsing/validation, or
 * explicitly excluded by the model.
 */
export function finalizeDeepResearchBatch(
  batch: DeepResearchBatch,
  candidates: readonly CandidateStory[],
  context: PipelineContext,
  minimumImportance: Importance,
  maximumStories: number,
): ProcessedDeepResearch {
  if (batch.stories.length > maximumStories) {
    throw new ResearchProcessingError(
      `Deep research returned ${batch.stories.length} stories, exceeding the configured maximum of ${maximumStories}.`,
    );
  }

  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const accountedCandidateIds = new Set<string>();
  const accepted: DeepResearchedStory[] = [];
  const rejected: RejectedResearchStory[] = [...(batch.rejectedStories ?? [])];

  for (const rejectedStory of batch.rejectedStories ?? []) {
    const candidateId = rejectedStory.candidateId;
    if (candidateId === undefined || candidateId === null || !candidatesById.has(candidateId)) continue;
    if (accountedCandidateIds.has(candidateId)) {
      throw new ResearchProcessingError(
        `Deep research returned candidateId more than once: ${candidateId}.`,
        rejected,
      );
    }
    accountedCandidateIds.add(candidateId);
  }

  batch.stories.forEach((story, index) => {
    try {
      const candidate = candidatesById.get(story.candidateId);
      if (candidate === undefined) {
        throw new TypeError(`candidateId does not match a supplied candidate: ${story.candidateId}`);
      }
      if (accountedCandidateIds.has(story.candidateId)) {
        throw new TypeError(`candidateId was returned more than once: ${story.candidateId}`);
      }
      validateDeepStoryEvidence(story, context, minimumImportance);
      accountedCandidateIds.add(story.candidateId);
      accepted.push({ ...story, id: candidate.id });
    } catch (error) {
      if (candidatesById.has(story.candidateId)) accountedCandidateIds.add(story.candidateId);
      rejected.push({
        index,
        title: typeof story.title === "string" ? story.title : null,
        candidateId: story.candidateId,
        reason: error instanceof Error ? error.message : "Unknown evidence validation failure.",
      });
    }
  });

  const excludedCandidates = batch.excludedCandidates.map((excluded) => {
    const candidate = candidatesById.get(excluded.candidateId);
    if (candidate === undefined) {
      throw new ResearchProcessingError(
        `Deep research excluded unknown candidateId: ${excluded.candidateId}.`,
        rejected,
      );
    }
    if (accountedCandidateIds.has(excluded.candidateId)) {
      throw new ResearchProcessingError(
        `Deep research returned candidateId more than once: ${excluded.candidateId}.`,
        rejected,
      );
    }
    accountedCandidateIds.add(excluded.candidateId);
    return { candidate, reason: excluded.reason };
  });

  const unaccounted = candidates.filter(({ id }) => !accountedCandidateIds.has(id));
  if (unaccounted.length > 0) {
    throw new ResearchProcessingError(
      `Deep research did not account for candidateIds: ${unaccounted.map(({ id }) => id).join(", ")}.`,
      rejected,
    );
  }

  assertNotEntirelyRejected(
    batch.stories.length + (batch.rejectedStories?.length ?? 0),
    accepted.length,
    "deep research",
    rejected,
  );
  return {
    stories: accepted,
    rejectedStories: rejected,
    excludedCandidates,
  };
}

function validateDeepStoryEvidence(
  story: DeepResearchedStoryInput,
  context: PipelineContext,
  minimumImportance: Importance,
): void {
  if (story.importance < minimumImportance) {
    throw new TypeError("Deep-researched story did not meet the configured importance threshold.");
  }
  if (!isCalendarDate(story.occurredOn) || story.occurredOn !== context.window.date) {
    throw new TypeError("Story occurredOn is outside the research calendar date.");
  }
  if (story.eventDateEvidence.eventDate !== story.occurredOn) {
    throw new TypeError("Event-date evidence does not match occurredOn.");
  }
  if (story.sources.length === 0) throw new TypeError("Story must include sources.");
  validateEvidenceSourceIsRetained(story);
}

function validateEvidenceSourceIsRetained(
  story: Pick<CandidateStoryInput, "sources" | "eventDateEvidence">,
): void {
  const retainedSourceUrls = new Set(story.sources.map(({ url }) => canonicalizeUrl(url)));
  const evidenceSourceUrl = canonicalizeUrl(story.eventDateEvidence.sourceUrl);
  if (!retainedSourceUrls.has(evidenceSourceUrl)) {
    throw new TypeError("Event-date evidence must reference a retained story source.");
  }
}

/**
 * Trips only when every story attempted in this batch was rejected. The success path
 * (some valid stories remain) never sees `rejectedStories` beyond this check — only a
 * total loss needs the per-story diagnostic, to explain the resulting failure.
 */
function assertNotEntirelyRejected(
  attempted: number,
  accepted: number,
  stage: string,
  rejectedStories: readonly RejectedResearchStory[],
  allowDeduplicatedToZero = false,
): void {
  if (attempted > 0 && accepted === 0 && !allowDeduplicatedToZero) {
    throw new ResearchProcessingError(
      formatAllRejectedMessage(stage, rejectedStories),
      rejectedStories,
    );
  }
}

function formatAllRejectedMessage(
  stage: string,
  rejectedStories: readonly RejectedResearchStory[],
): string {
  const details = rejectedStories.map(({ index, title, reason }) =>
    `  - index=${index}; title=${title === null ? "<missing>" : JSON.stringify(title)}; reason=${reason}`
  );
  return [`Every story from ${stage} was rejected:`, ...details].join("\n");
}
