import { describe, expect, it, vi } from "vitest";

import {
  InvalidResearchResponseError,
  ModelNewsResearchProvider,
  type AiWebResearchClient,
  type PipelineContext,
} from "../src/index.js";
import { firstStoryInput, secondStoryInput } from "./fixtures.js";

const context: PipelineContext = {
  runId: "run-1",
  window: {
    date: "2026-08-27",
    timeZone: "Asia/Jerusalem",
    start: new Date("2026-08-26T21:00:00.000Z"),
    endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  },
};

describe("ModelNewsResearchProvider", () => {
  it("rejects one ungrounded story while preserving valid stories", async () => {
    const invalid = {
      ...secondStoryInput,
      sources: [{ ...secondStoryInput.sources[0], url: "https://invented.example/story" }],
    };
    const client = clientReturning({ stories: [firstStoryInput, invalid] }, [
      "https://example.com/model",
    ]);
    const provider = new ModelNewsResearchProvider({ client });

    const result = await provider.research({
      context,
      scope: {
        categories: ["ai", "developer_tools"],
        minimumImportance: 3,
        maximumStories: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    expect(result.value.stories).toHaveLength(1);
    expect(result.value.rejectedStories).toHaveLength(1);
    expect(result.value.stories[0]?.title).toBe(firstStoryInput.title);
  });

  it("fails the batch when every attempted story is invalid", async () => {
    const client = clientReturning({ stories: [firstStoryInput] }, [
      "https://different.example/source",
    ]);
    const provider = new ModelNewsResearchProvider({ client });

    const promise = provider.research({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumStories: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    await expect(promise).rejects.toBeInstanceOf(InvalidResearchResponseError);
    await expect(promise).rejects.toMatchObject({
      rejectedStories: [{
        index: 0,
        title: firstStoryInput.title,
        reason: expect.stringContaining("stories[0].sources[0].url"),
      }],
    });
    await expect(promise).rejects.toThrow(
      /index=0; title=.*provider citations.*https:\/\/example\.com\/model/su,
    );
  });

  it("accepts source publication metadata with date-only precision", async () => {
    const dateOnlySource = {
      ...firstStoryInput,
      sources: [{
        ...firstStoryInput.sources[0],
        publishedOn: "2026-08-27",
        publishedAt: null,
      }],
    };
    const provider = new ModelNewsResearchProvider({
      client: clientReturning({ stories: [dateOnlySource] }, ["https://example.com/model"]),
    });

    const result = await provider.research({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumStories: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    expect(result.value.stories[0]?.sources[0]).toMatchObject({
      publishedOn: "2026-08-27",
      publishedAt: null,
    });
  });

  it("derives publishedOn from an exact UTC publishedAt", async () => {
    const exactTimestampSource = {
      ...firstStoryInput,
      sources: [{ ...firstStoryInput.sources[0], publishedOn: null }],
    };
    const provider = new ModelNewsResearchProvider({
      client: clientReturning(
        { stories: [exactTimestampSource] },
        ["https://example.com/model"],
      ),
    });

    const result = await provider.research({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumStories: 10,
        preferredSourceTypes: ["official_blog"],
      },
    });

    expect(result.value.stories[0]?.sources[0]?.publishedOn).toBe("2026-08-27");
  });

  it("rejects inconsistent source publication date precision", async () => {
    const inconsistentSource = {
      ...firstStoryInput,
      sources: [{ ...firstStoryInput.sources[0], publishedOn: "2026-08-26" }],
    };
    const provider = new ModelNewsResearchProvider({
      client: clientReturning({ stories: [inconsistentSource] }, ["https://example.com/model"]),
    });

    await expect(provider.research({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumStories: 10,
        preferredSourceTypes: ["official_blog"],
      },
    })).rejects.toThrow(
      'publishedOn="2026-08-26"; publishedAt="2026-08-27T10:00:00.000Z"',
    );
  });

  it("still rejects a date-only value placed in publishedAt", async () => {
    const dateOnlySource = {
      ...firstStoryInput,
      sources: [{ ...firstStoryInput.sources[0], publishedAt: "2026-08-27" }],
    };
    const provider = new ModelNewsResearchProvider({
      client: clientReturning({ stories: [dateOnlySource] }, ["https://example.com/model"]),
    });

    await expect(provider.research({
      context,
      scope: {
        categories: ["ai"],
        minimumImportance: 3,
        maximumStories: 10,
        preferredSourceTypes: ["official_blog"],
      },
    })).rejects.toThrow(
      'stories[0].sources[0].publishedAt must be an ISO UTC timestamp; value="2026-08-27"',
    );
  });

  it("keeps gap research narrow and returns an empty list when nothing is missing", async () => {
    const client = clientReturning({ missingStories: [] }, ["https://example.com/check"]);
    const provider = new ModelNewsResearchProvider({ client });
    const result = await provider.findGaps({
      context,
      existingStories: [],
      draft: {
        markdown: "# Daily Tech",
        includedStoryIds: [],
        metadata: {
          summary: "quiet",
          significant_items: 0,
          worth_watching_items: 0,
          day_intensity: "minimal",
          companies: [],
          topics: [],
          developments: [],
        },
      },
      minimumImportance: 3,
      maximumMissingStories: 4,
    });

    expect(result.value.missingStories).toEqual([]);
    expect(vi.mocked(client.execute).mock.calls[0]?.[0].instructions).toContain(
      "Do not critique wording",
    );
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
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      webSearchCalls: 1,
    }),
  };
}
