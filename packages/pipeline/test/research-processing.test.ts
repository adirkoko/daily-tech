import { describe, expect, it, vi } from "vitest";

import {
  ResearchProcessingError,
  finalizeDeepResearchBatch,
  finalizeDiscoveryBatch,
  finalizeFocusedDiscoveryBatch,
  type PipelineContext,
  type StoryIdFactory,
} from "../src/index.js";
import {
  firstCandidate,
  firstCandidateInput,
  firstDeepStoryInput,
  secondCandidate,
  secondCandidateInput,
  secondDeepStoryInput,
} from "./fixtures.js";

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

describe("deterministic discovery processing", () => {
  it("assigns IDs only after evidence validation and conservative deduplication", () => {
    const duplicate = {
      ...firstCandidateInput,
      title: `${firstCandidateInput.title} `,
      shortSummary: `${firstCandidateInput.shortSummary} פרט נוסף שנמצא במקור השני.`,
    };
    const storyIds = ids("story-generated");

    const result = finalizeDiscoveryBatch(
      { stories: [firstCandidateInput, duplicate], rejectedStories: [] },
      context,
      3,
      storyIds,
    );

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]).toMatchObject({ id: "story-generated" });
    expect(result.stories[0]?.shortSummary).toContain("פרט נוסף שנמצא במקור השני");
    expect(storyIds.create).toHaveBeenCalledOnce();
  });

  it("rejects a story whose event-date evidence does not match the target day", () => {
    const wrongDay = {
      ...firstCandidateInput,
      eventDateEvidence: {
        ...firstCandidateInput.eventDateEvidence,
        eventDate: "2026-08-26",
      },
    };

    expect(() => finalizeDiscoveryBatch(
      { stories: [wrongDay], rejectedStories: [] },
      context,
      3,
      ids("unused"),
    )).toThrow(ResearchProcessingError);
  });

  it("rejects invalid event-date evidence per story while preserving valid siblings", () => {
    const wrongDay = {
      ...secondCandidateInput,
      eventDateEvidence: {
        ...secondCandidateInput.eventDateEvidence,
        eventDate: "2026-08-26",
      },
    };

    const result = finalizeDiscoveryBatch(
      { stories: [firstCandidateInput, wrongDay], rejectedStories: [] },
      context,
      3,
      ids("story-valid"),
    );

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]?.id).toBe("story-valid");
  });

  it("reports index, title, and reason for every story when the whole batch is rejected", () => {
    const wrongDay = {
      ...firstCandidateInput,
      eventDateEvidence: {
        ...firstCandidateInput.eventDateEvidence,
        eventDate: "2026-08-26",
      },
    };
    const tooMinor = { ...secondCandidateInput, importance: 1 as const };
    const attempt = (): unknown => finalizeDiscoveryBatch(
      { stories: [wrongDay, tooMinor], rejectedStories: [] },
      context,
      3,
      ids("unused", "unused"),
    );

    expect(attempt).toThrow(ResearchProcessingError);
    expect(attempt).toThrow(/index=0; title=.*index=1; title=/su);
    try {
      attempt();
      throw new Error("finalizeDiscoveryBatch should have thrown ResearchProcessingError.");
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchProcessingError);
      expect((error as InstanceType<typeof ResearchProcessingError>).rejectedStories).toEqual([
        { index: 0, title: wrongDay.title, reason: expect.any(String) },
        { index: 1, title: tooMinor.title, reason: expect.any(String) },
      ]);
    }
  });

  it("fails closed when code-generated story IDs collide", () => {
    expect(() => finalizeDiscoveryBatch(
      { stories: [firstCandidateInput, secondCandidateInput], rejectedStories: [] },
      context,
      3,
      ids("story-duplicate", "story-duplicate"),
    )).toThrow(ResearchProcessingError);
  });

  it("preserves semantically ambiguous stories when high-confidence signals differ", () => {
    const relatedButDistinct = {
      ...secondCandidateInput,
      title: "כלי פיתוח חדש הוכרז עבור צוותים",
      companies: ["Google"],
    };
    const result = finalizeDiscoveryBatch(
      { stories: [firstCandidateInput, relatedButDistinct], rejectedStories: [] },
      context,
      3,
      ids("story-1", "story-2"),
    );

    expect(result.stories).toHaveLength(2);
  });

  it("does not treat an already represented gap as a reason to continue", () => {
    const result = finalizeFocusedDiscoveryBatch(
      { stories: [firstCandidateInput], rejectedStories: [] },
      [firstCandidate],
      context,
      3,
      ids("unused"),
    );

    expect(result.stories).toEqual([]);
  });
});

describe("deterministic deep-research processing", () => {
  const candidates = [firstCandidate, secondCandidate];

  it("reuses the candidate's own id as the final story id — never a new one", () => {
    const result = finalizeDeepResearchBatch(
      { stories: [firstDeepStoryInput] },
      candidates,
      context,
      8,
    );

    expect(result.stories).toEqual([{ ...firstDeepStoryInput, id: "story-1" }]);
  });

  it("never sorts or truncates to a target count — a response under maximumStories is accepted as-is", () => {
    const result = finalizeDeepResearchBatch(
      { stories: [firstDeepStoryInput] },
      candidates,
      context,
      8,
    );

    expect(result.stories).toHaveLength(1);
  });

  it("refuses a response that exceeds maximumStories rather than truncating it", () => {
    expect(() => finalizeDeepResearchBatch(
      { stories: [firstDeepStoryInput, secondDeepStoryInput] },
      candidates,
      context,
      1,
    )).toThrow(ResearchProcessingError);
  });

  it("rejects a dossier whose candidateId does not match any supplied candidate, keeping valid siblings", () => {
    const unknownCandidateId = { ...secondDeepStoryInput, candidateId: "story-does-not-exist" };

    const result = finalizeDeepResearchBatch(
      { stories: [firstDeepStoryInput, unknownCandidateId] },
      candidates,
      context,
      8,
    );

    expect(result.stories).toEqual([{ ...firstDeepStoryInput, id: "story-1" }]);
  });

  it("rejects a candidateId reused across two dossiers, keeping only the first", () => {
    const duplicateCandidateId = { ...secondDeepStoryInput, candidateId: firstDeepStoryInput.candidateId };

    const result = finalizeDeepResearchBatch(
      { stories: [firstDeepStoryInput, duplicateCandidateId] },
      candidates,
      context,
      8,
    );

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]?.candidateId).toBe(firstDeepStoryInput.candidateId);
  });

  it("rejects a dossier whose event-date evidence does not match the target day, keeping valid siblings", () => {
    const wrongDay = {
      ...secondDeepStoryInput,
      eventDateEvidence: { ...secondDeepStoryInput.eventDateEvidence, eventDate: "2026-08-26" },
    };

    const result = finalizeDeepResearchBatch(
      { stories: [firstDeepStoryInput, wrongDay] },
      candidates,
      context,
      8,
    );

    expect(result.stories).toEqual([{ ...firstDeepStoryInput, id: "story-1" }]);
  });

  it("fails closed when every dossier in a non-empty batch is rejected", () => {
    const unknownCandidateId = { ...firstDeepStoryInput, candidateId: "story-does-not-exist" };

    expect(() => finalizeDeepResearchBatch(
      { stories: [unknownCandidateId] },
      candidates,
      context,
      8,
    )).toThrow(ResearchProcessingError);
  });

  it("accepts an empty batch as a valid quiet result — no candidate was worth a dossier", () => {
    const result = finalizeDeepResearchBatch({ stories: [] }, candidates, context, 8);

    expect(result.stories).toEqual([]);
  });
});
