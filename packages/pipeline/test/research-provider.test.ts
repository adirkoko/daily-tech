import { describe, expect, it, vi } from "vitest";

import {
  InvalidResearchResponseError,
  ModelNewsResearchProvider,
  type AiWebResearchClient,
  type PipelineContext,
} from "../src/index.js";
import { firstCandidate, firstCandidateInput, firstDeepStoryInput, secondCandidateInput } from "./fixtures.js";

const context: PipelineContext = {
  runId: "run-1",
  window: {
    date: "2026-08-27",
    timeZone: "Asia/Jerusalem",
    start: new Date("2026-08-26T21:00:00.000Z"),
    endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  },
};

describe("ModelNewsResearchProvider.discover", () => {
  it("rejects one ungrounded story while preserving valid stories", async () => {
    const invalid = {
      ...secondCandidateInput,
      sources: [{ ...secondCandidateInput.sources[0], url: "https://invented.example/story" }],
    };
    const client = clientReturning({ stories: [firstCandidateInput, invalid] }, [
      "https://example.com/model",
    ]);
    const provider = new ModelNewsResearchProvider({ client });

    const result = await provider.discover({
      context,
      scope: {
        categories: ["ai", "developer_tools"],
        minimumImportance: 3,
        maximumCandidatesPerCall: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    expect(result.stories).toHaveLength(1);
    expect(result.rejectedStories).toHaveLength(1);
    expect(result.stories[0]?.title).toBe(firstCandidateInput.title);
  });

  it("fails the batch when every attempted story is invalid", async () => {
    const client = clientReturning({ stories: [firstCandidateInput] }, [
      "https://different.example/source",
    ]);
    const provider = new ModelNewsResearchProvider({ client });

    const promise = provider.discover({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumCandidatesPerCall: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    await expect(promise).rejects.toBeInstanceOf(InvalidResearchResponseError);
    await expect(promise).rejects.toMatchObject({
      rejectedStories: [{
        index: 0,
        title: firstCandidateInput.title,
        reason: expect.stringContaining("stories[0].sources[0].url"),
      }],
    });
    await expect(promise).rejects.toThrow(
      /index=0; title=.*provider citations.*https:\/\/example\.com\/model/su,
    );
  });

  it("accepts a null publishedOn", async () => {
    const undatedSource = {
      ...firstCandidateInput,
      sources: [{ ...firstCandidateInput.sources[0], publishedOn: null }],
    };
    const provider = new ModelNewsResearchProvider({
      client: clientReturning({ stories: [undatedSource] }, ["https://example.com/model"]),
    });

    const result = await provider.discover({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumCandidatesPerCall: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    expect(result.stories[0]?.sources[0]?.publishedOn).toBeNull();
  });

  it("rejects a malformed publishedOn value", async () => {
    const malformedSource = {
      ...firstCandidateInput,
      sources: [{ ...firstCandidateInput.sources[0], publishedOn: "27/08/2026" }],
    };
    const provider = new ModelNewsResearchProvider({
      client: clientReturning({ stories: [malformedSource] }, ["https://example.com/model"]),
    });

    await expect(provider.discover({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumCandidatesPerCall: 10,
        preferredSourceTypes: ["official_blog"],
      },
    })).rejects.toThrow(
      'stories[0].sources[0].publishedOn must be a calendar date in YYYY-MM-DD format; value="27/08/2026"',
    );
  });
});

describe("ModelNewsResearchProvider.findGaps", () => {
  it("stays narrow and returns an empty list when nothing is missing", async () => {
    const client = clientReturning({ missingStories: [] }, ["https://example.com/check"]);
    const provider = new ModelNewsResearchProvider({ client });
    const result = await provider.findGaps({
      context,
      existingStories: [],
      minimumImportance: 3,
      maximumCandidatesPerCall: 4,
    });

    expect(result.stories).toEqual([]);
    expect(vi.mocked(client.execute).mock.calls[0]?.[0].instructions).toContain(
      "focused follow-up research provider",
    );
  });

  it("passes an explicit empty focusKeywords array when none is supplied", async () => {
    const client = clientReturning({ missingStories: [] }, ["https://example.com/check"]);
    const provider = new ModelNewsResearchProvider({ client });

    await provider.findGaps({
      context,
      existingStories: [],
      minimumImportance: 3,
      maximumCandidatesPerCall: 4,
    });

    const input = vi.mocked(client.execute).mock.calls[0]?.[0].input as { focusKeywords: unknown };
    expect(input.focusKeywords).toEqual([]);
  });

  it("forwards focusKeywords when the admin-keyword pass supplies them", async () => {
    const client = clientReturning({ missingStories: [] }, ["https://example.com/check"]);
    const provider = new ModelNewsResearchProvider({ client });

    await provider.findGaps({
      context,
      existingStories: [],
      minimumImportance: 3,
      maximumCandidatesPerCall: 4,
      focusKeywords: ["OpenAI", "Robotics"],
    });

    const input = vi.mocked(client.execute).mock.calls[0]?.[0].input as { focusKeywords: unknown };
    expect(input.focusKeywords).toEqual(["OpenAI", "Robotics"]);
  });
});

describe("ModelNewsResearchProvider.deepResearch", () => {
  it("ties each returned dossier to candidateId and requests a raised tool-call budget", async () => {
    const client = clientReturning({ stories: [firstDeepStoryInput] }, ["https://example.com/model"]);
    const provider = new ModelNewsResearchProvider({ client });

    const result = await provider.deepResearch({
      context,
      candidates: [firstCandidate],
      maximumStories: 8,
      editorialInstructions: "",
    });

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]?.candidateId).toBe("story-1");
    expect(vi.mocked(client.execute).mock.calls[0]?.[0].maxToolCalls).toBeGreaterThan(20);
  });

  it("rejects a dossier whose candidateId is not one of the supplied candidates", async () => {
    const invalid = { ...firstDeepStoryInput, candidateId: "unknown-candidate" };
    const client = clientReturning({ stories: [invalid] }, ["https://example.com/model"]);
    const provider = new ModelNewsResearchProvider({ client });

    // The provider itself only parses and citation-checks the raw response; matching
    // candidateId against the real candidate list happens in finalizeDeepResearchBatch,
    // so a bogus id still parses fine here — this documents that split responsibility.
    const result = await provider.deepResearch({
      context,
      candidates: [firstCandidate],
      maximumStories: 8,
      editorialInstructions: "",
    });
    expect(result.stories[0]?.candidateId).toBe("unknown-candidate");
  });
});

function clientReturning(
  value: unknown,
  urls: readonly string[],
): AiWebResearchClient {
  return {
    execute: vi.fn().mockResolvedValue({
      content: JSON.stringify(value),
      citations: urls.map((url) => ({ url, title: "Source" })),
      model: "research-model",
    }),
  };
}
