import { describe, expect, it, vi } from "vitest";

import {
  InvalidAiResponseError,
  PromptedBriefWriter,
  PromptedEditorialReviewer,
  PromptedNewsFilter,
  SearchBackedMissingNewsChecker,
  SearchBackedNewsResearcher,
  type AiCompletion,
  type AiCompletionClient,
  type NewsSearchProvider,
  type PipelineContext,
  type SearchHit,
} from "../src/index.js";
import { firstCandidate, oneItemDraft } from "./fixtures.js";

const context: PipelineContext = {
  runId: "run-1",
  window: {
    date: "2026-08-27",
    timeZone: "Asia/Jerusalem",
    start: new Date("2026-08-26T21:00:00.000Z"),
    endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  },
};

const searchHit: SearchHit = {
  url: "https://example.com/model",
  title: "Model announcement",
  snippet: "A new model is now available.",
  publisher: "OpenAI",
  publishedAt: "2026-08-27T10:00:00.000Z",
};

function completion(content: unknown): AiCompletion {
  return {
    content: JSON.stringify(content),
    model: "test-model",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

function clientReturning(...values: readonly AiCompletion[]): AiCompletionClient {
  const complete = vi.fn<AiCompletionClient["complete"]>();
  values.forEach((value) => complete.mockResolvedValueOnce(value));
  return { complete };
}

function searchReturning(hits: readonly SearchHit[]): NewsSearchProvider {
  return { search: vi.fn().mockResolvedValue(hits) };
}

describe("prompted pipeline agents", () => {
  it("normalizes search results into source-bound research candidates", async () => {
    const client = clientReturning(
      completion({ candidates: [firstCandidate] }),
    );
    const search = searchReturning([searchHit]);
    const researcher = new SearchBackedNewsResearcher({
      client,
      search,
      queries: ["models"],
      resultsPerQuery: 5,
    });

    const result = await researcher.collect(context);

    expect(result.value).toEqual([firstCandidate]);
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "models",
        start: context.window.start,
        endExclusive: context.window.endExclusive,
        limit: 5,
      }),
    );
  });

  it("rejects source URLs invented by the research model", async () => {
    const fabricated = {
      ...firstCandidate,
      sources: [
        { ...firstCandidate.sources[0], url: "https://fabricated.example/story" },
      ],
    };
    const researcher = new SearchBackedNewsResearcher({
      client: clientReturning(completion({ candidates: [fabricated] })),
      search: searchReturning([searchHit]),
      queries: ["models"],
    });

    await expect(researcher.collect(context)).rejects.toBeInstanceOf(
      InvalidAiResponseError,
    );
  });

  it("drops candidates outside the exact Israel-time window", async () => {
    const outside = {
      ...firstCandidate,
      occurredAt: "2026-08-27T22:00:00.000Z",
    };
    const researcher = new SearchBackedNewsResearcher({
      client: clientReturning(completion({ candidates: [outside] })),
      search: searchReturning([searchHit]),
      queries: ["models"],
    });

    expect((await researcher.collect(context)).value).toEqual([]);
  });

  it("maps filter IDs back to original candidates and rejects unknown IDs", async () => {
    const filter = new PromptedNewsFilter(
      clientReturning(completion({ selected_ids: [firstCandidate.id] })),
    );
    expect((await filter.select(context, [firstCandidate])).value).toEqual([
      firstCandidate,
    ]);

    const invalidFilter = new PromptedNewsFilter(
      clientReturning(completion({ selected_ids: ["invented-id"] })),
    );
    await expect(
      invalidFilter.select(context, [firstCandidate]),
    ).rejects.toBeInstanceOf(InvalidAiResponseError);
  });

  it("parses a complete Hebrew brief and its generated metadata", async () => {
    const writer = new PromptedBriefWriter(
      clientReturning(completion(oneItemDraft)),
    );

    expect((await writer.write(context, [firstCandidate])).value).toEqual(
      oneItemDraft,
    );
  });

  it("parses editorial decisions with actionable feedback", async () => {
    const reviewer = new PromptedEditorialReviewer(
      clientReturning(
        completion({ approved: false, feedback: ["יש לתקן את הכותרת"] }),
      ),
    );

    expect(
      (await reviewer.review(context, [firstCandidate], oneItemDraft)).value,
    ).toEqual({ approved: false, feedback: ["יש לתקן את הכותרת"] });
  });

  it("uses a separate search pass for the missing-news review", async () => {
    const search = searchReturning([searchHit]);
    const checker = new SearchBackedMissingNewsChecker({
      client: clientReturning(completion({ missing: [], notes: ["לא נמצא חוסר"] })),
      search,
      queries: ["independent angle"],
    });

    expect((await checker.check(context, oneItemDraft)).value).toEqual({
      missing: [],
      notes: ["לא נמצא חוסר"],
    });
    expect(search.search).toHaveBeenCalledOnce();
  });

  it("skips the model when search returns no material", async () => {
    const client = clientReturning();
    const researcher = new SearchBackedNewsResearcher({
      client,
      search: searchReturning([]),
      queries: ["models"],
    });

    expect((await researcher.collect(context)).value).toEqual([]);
    expect(client.complete).not.toHaveBeenCalled();
  });
});
