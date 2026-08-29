import { isCalendarDate } from "@daily-tech/core";

import type { PipelineContext } from "../types.js";
import { deduplicateStoryInputs, representedByExistingStory } from "./deduplication.js";
import type {
  GapResearchBatch,
  Importance,
  RejectedResearchStory,
  ResearchedStory,
  ResearchBatch,
  ResearchStoryInput,
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

export interface ProcessedResearchStories {
  readonly stories: readonly ResearchedStory[];
}

export function finalizeResearchBatch(
  batch: ResearchBatch,
  context: PipelineContext,
  minimumImportance: Importance,
  storyIds: StoryIdFactory,
): ProcessedResearchStories {
  const validated = validateStories(batch.stories, context, minimumImportance);
  const deduplicated = deduplicateStoryInputs(validated.stories);
  const rejectedStories = [...batch.rejectedStories, ...validated.rejectedStories];
  assertNotEntirelyRejected(
    batch.stories.length + batch.rejectedStories.length,
    deduplicated.length,
    "research",
    rejectedStories,
  );
  return { stories: assignIds(deduplicated, storyIds) };
}

export function finalizeGapBatch(
  batch: GapResearchBatch,
  existingStories: readonly ResearchedStory[],
  context: PipelineContext,
  minimumImportance: Importance,
  storyIds: StoryIdFactory,
): ProcessedResearchStories {
  const validated = validateStories(batch.missingStories, context, minimumImportance);
  const uniqueMissing = deduplicateStoryInputs(validated.stories).filter(
    (story) => !representedByExistingStory(story, existingStories),
  );
  const rejectedStories = [...batch.rejectedStories, ...validated.rejectedStories];
  assertNotEntirelyRejected(
    batch.missingStories.length + batch.rejectedStories.length,
    uniqueMissing.length,
    "gap research",
    rejectedStories,
    batch.missingStories.length > 0 && uniqueMissing.length === 0,
  );
  return {
    stories: assignIds(
      uniqueMissing,
      storyIds,
      new Set(existingStories.map(({ id }) => id)),
    ),
  };
}

function validateStories(
  stories: readonly ResearchStoryInput[],
  context: PipelineContext,
  minimumImportance: Importance,
): { stories: readonly ResearchStoryInput[]; rejectedStories: readonly RejectedResearchStory[] } {
  const accepted: ResearchStoryInput[] = [];
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
 * research prompt) — `occurredOn`, the calendar day and nothing finer, is the
 * one hard, unambiguous date check the rest of the system relies on.
 */
export function validateStoryEvidence(
  story: ResearchStoryInput,
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
  if (story.keyFacts.length === 0) throw new TypeError("Story must include key facts.");
  if (story.sources.length === 0) throw new TypeError("Story must include sources.");
}

function assignIds(
  stories: readonly ResearchStoryInput[],
  storyIds: StoryIdFactory,
  reservedIds: Set<string> = new Set(),
): readonly ResearchedStory[] {
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
