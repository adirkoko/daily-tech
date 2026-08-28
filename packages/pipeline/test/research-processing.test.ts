import { describe, expect, it, vi } from "vitest";

import {
  ResearchProcessingError,
  finalizeGapBatch,
  finalizeResearchBatch,
  type PipelineContext,
  type StoryIdFactory,
} from "../src/index.js";
import { firstStory, firstStoryInput, secondStoryInput } from "./fixtures.js";

const context: PipelineContext = {
  runId: "run-1",
  window: {
    date: "2026-08-27",
    timeZone: "Asia/Jerusalem",
    start: new Date("2026-08-26T21:00:00.000Z"),
    endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  },
};

function ids(...values: readonly string[]): StoryIdFactory {
  const create = vi.fn<StoryIdFactory["create"]>();
  values.forEach((value) => create.mockReturnValueOnce(value));
  return { create };
}

describe("deterministic research processing", () => {
  it("assigns IDs only after evidence validation and conservative deduplication", () => {
    const duplicate = {
      ...firstStoryInput,
      title: `${firstStoryInput.title} `,
      keyFacts: [...firstStoryInput.keyFacts, "עובדה נוספת"],
    };
    const storyIds = ids("story-generated");

    const result = finalizeResearchBatch(
      { stories: [firstStoryInput, duplicate], rejectedStories: [] },
      context,
      3,
      storyIds,
    );

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]).toMatchObject({ id: "story-generated" });
    expect(result.stories[0]?.keyFacts).toContain("עובדה נוספת");
    expect(storyIds.create).toHaveBeenCalledOnce();
  });

  it("rejects a story whose event-date evidence does not match the target day", () => {
    const wrongDay = {
      ...firstStoryInput,
      eventDateEvidence: {
        ...firstStoryInput.eventDateEvidence,
        eventDate: "2026-08-26",
      },
    };

    expect(() => finalizeResearchBatch(
      { stories: [wrongDay], rejectedStories: [] },
      context,
      3,
      ids("unused"),
    )).toThrow(ResearchProcessingError);
  });

  it("rejects invalid event-date evidence per story while preserving valid siblings", () => {
    const wrongDay = {
      ...secondStoryInput,
      eventDateEvidence: {
        ...secondStoryInput.eventDateEvidence,
        eventDate: "2026-08-26",
      },
    };

    const result = finalizeResearchBatch(
      { stories: [firstStoryInput, wrongDay], rejectedStories: [] },
      context,
      3,
      ids("story-valid"),
    );

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]?.id).toBe("story-valid");
    expect(result.rejectedStories).toHaveLength(1);
    expect(result.rejectedStories[0]?.title).toBe(wrongDay.title);
  });

  it("fails closed when code-generated story IDs collide", () => {
    expect(() => finalizeResearchBatch(
      { stories: [firstStoryInput, secondStoryInput], rejectedStories: [] },
      context,
      3,
      ids("story-duplicate", "story-duplicate"),
    )).toThrow(ResearchProcessingError);
  });

  it("preserves semantically ambiguous stories when high-confidence signals differ", () => {
    const relatedButDistinct = {
      ...secondStoryInput,
      title: "כלי פיתוח חדש הוכרז עבור צוותים",
      companies: ["Google"],
    };
    const result = finalizeResearchBatch(
      { stories: [firstStoryInput, relatedButDistinct], rejectedStories: [] },
      context,
      3,
      ids("story-1", "story-2"),
    );

    expect(result.stories).toHaveLength(2);
  });

  it("does not treat an already represented gap as a reason to revise", () => {
    const result = finalizeGapBatch(
      { missingStories: [firstStoryInput], rejectedStories: [] },
      [firstStory],
      context,
      3,
      ids("unused"),
    );

    expect(result.stories).toEqual([]);
  });
});
