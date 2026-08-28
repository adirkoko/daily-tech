import { isCalendarDate, isUtcTimestamp } from "@daily-tech/core";

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
  constructor(message: string) {
    super(message);
    this.name = "ResearchProcessingError";
  }
}

export interface ProcessedResearchStories {
  readonly stories: readonly ResearchedStory[];
  readonly rejectedStories: readonly RejectedResearchStory[];
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
  );
  return {
    stories: assignIds(deduplicated, storyIds),
    rejectedStories,
  };
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
    batch.missingStories.length > 0 && uniqueMissing.length === 0,
  );
  return {
    stories: assignIds(
      uniqueMissing,
      storyIds,
      new Set(existingStories.map(({ id }) => id)),
    ),
    rejectedStories,
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
  if (story.eventDateEvidence.explanation.trim().length < 12) {
    throw new TypeError("Event-date evidence explanation is too weak.");
  }
  if (story.occurredAt !== null) {
    if (!isUtcTimestamp(story.occurredAt)) {
      throw new TypeError("Story occurredAt must be an ISO UTC timestamp.");
    }
    const time = Date.parse(story.occurredAt);
    if (time < context.window.start.getTime() || time >= context.window.endExclusive.getTime()) {
      throw new TypeError("Story occurredAt is outside the exact Israel-time window.");
    }
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

function assertNotEntirelyRejected(
  attempted: number,
  accepted: number,
  stage: string,
  allowDeduplicatedToZero = false,
): void {
  if (attempted > 0 && accepted === 0 && !allowDeduplicatedToZero) {
    throw new ResearchProcessingError(`Every story from ${stage} was rejected.`);
  }
}
