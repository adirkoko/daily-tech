import { describe, expect, it, vi } from "vitest";

import {
  DraftResearchBoundaryError,
  ModelBriefWriter,
  createQuietDayDraft,
  validateDraftAgainstStories,
  type AiCompletionClient,
  type PipelineContext,
} from "../src/index.js";
import { firstStory, oneItemDraft } from "./fixtures.js";

const context: PipelineContext = {
  runId: "run-1",
  window: {
    date: "2026-08-27",
    timeZone: "Asia/Jerusalem",
    start: new Date("2026-08-26T21:00:00.000Z"),
    endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  },
};

describe("writing boundary", () => {
  it("tells the writer that researched stories are the only factual source", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({
        markdown: oneItemDraft.markdown,
        included_story_ids: oneItemDraft.includedStoryIds,
        metadata: oneItemDraft.metadata,
      }),
      model: "writer",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
    const writer = new ModelBriefWriter({ client: { complete } });

    await writer.write(context, [firstStory]);

    const prompt = complete.mock.calls[0]?.[0].messages[0]?.content ?? "";
    expect(prompt).toContain("only factual source of truth");
    expect(prompt).toContain("numbers, dates, quotations, product names");
    expect(prompt).toContain("Every Markdown URL must be copied exactly");
  });

  it("rejects invented URLs and incomplete story coverage", () => {
    expect(() => validateDraftAgainstStories({
      ...oneItemDraft,
      markdown: `${oneItemDraft.markdown}\n[Invented](https://invented.example)`,
      includedStoryIds: [],
    }, [firstStory])).toThrow(DraftResearchBoundaryError);
  });

  it("creates a deterministic quiet-day draft without a model", () => {
    const draft = createQuietDayDraft(context);
    expect(draft.includedStoryIds).toEqual([]);
    expect(draft.metadata).toMatchObject({
      significant_items: 0,
      worth_watching_items: 0,
      day_intensity: "minimal",
    });
    expect(() => validateDraftAgainstStories(draft, [])).not.toThrow();
  });
});
