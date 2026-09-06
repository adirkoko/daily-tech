import { describe, expect, it, vi } from "vitest";

import {
  DraftResponseValidationError,
  DraftResearchBoundaryError,
  ModelBriefWriter,
  createQuietDayDraft,
  deriveFinalEditionMetadata,
  validateDraftAgainstStories,
  type AiCompletionClient,
  type BriefDraft,
  type PipelineContext,
} from "../src/index.js";
import { firstDeepStory, oneItemDraft, secondDeepStory } from "./fixtures.js";

const context: PipelineContext = {
  runId: "run-1",
  window: {
    date: "2026-08-27",
    timeZone: "Asia/Jerusalem",
    start: new Date("2026-08-26T21:00:00.000Z"),
    endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  },
};

function draftResponseJson(draft: BriefDraft, metadataOverrides: Record<string, unknown> = {}) {
  return {
    day_overview: draft.dayOverview,
    developments: draft.developments,
    worth_watching: draft.worthWatching,
    bottom_line: draft.bottomLine,
    metadata: { ...draft.metadata, ...metadataOverrides },
  };
}

describe("writing boundary", () => {
  it("tells the writer that researched stories are the only factual source", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft)),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete } });

    await writer.write(context, [firstDeepStory], "");

    const prompt = complete.mock.calls[0]?.[0].messages[0]?.content ?? "";
    expect(prompt).toContain("only factual source of truth");
    expect(prompt).toContain("numbers, dates, quotations, product names");
    expect(prompt).toContain("Every source you cite must be one of the sources belonging to the stories you reference");
    expect(prompt).toContain("summary only");
    expect(prompt).toContain("never a story you reviewed and left out");
    expect(prompt).toContain("Code derives those fields deterministically");
    // day_overview (rendered as "תמצית היום") and metadata.summary (the short site
    // teaser) must stay distinct fields with distinct jobs.
    expect(prompt).toContain('shown to the reader as "תמצית היום"');
    expect(prompt).toContain("distinct from day_overview and never shown inside the brief itself");
    // worth_watching is for pending/forward-looking matters, not a dumping ground for a
    // smaller-but-already-happened story.
    expect(prompt).toContain("genuinely pending or forward-looking matters");
    expect(prompt).toContain("never demoted here just because it feels minor");
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
    expect(complete.mock.calls[0]?.[0].responseFormat).toMatchObject({
      type: "json_schema",
      name: "daily_tech_brief_draft",
      schema: {
        properties: {
          metadata: {
            properties: {
              summary: { type: "string", minLength: 1 },
            },
            required: ["summary"],
          },
        },
      },
    });
  });

  it("treats editorial instructions as guidance, passed through the input rather than the prompt", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft)),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete } });

    await writer.write(context, [firstDeepStory], "Give more weight to developer tools this week.");

    const prompt = complete.mock.calls[0]?.[0].messages[0]?.content ?? "";
    expect(prompt).toContain("never overrides the factual boundary above");
    expect(prompt).toContain("when it is empty you simply have no additional guidance");
    const input = JSON.parse(complete.mock.calls[0]?.[0].messages[1]?.content ?? "{}") as {
      editorialInstructions: string;
    };
    expect(input.editorialInstructions).toBe("Give more weight to developer tools this week.");
  });

  it("allows temperature only through an explicit writer opt-in", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft)),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete }, temperature: 0.2 });

    await writer.write(context, [firstDeepStory], "");

    expect(complete.mock.calls[0]?.[0]).toMatchObject({ temperature: 0.2 });
  });

  it("reports the exact path, value, type, and expectation for draft validation", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft, { summary: 1 })),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete } });

    const promise = writer.write(context, [firstDeepStory], "");

    await expect(promise).rejects.toBeInstanceOf(DraftResponseValidationError);
    await expect(promise).rejects.toMatchObject({
      path: "metadata.summary",
      receivedValue: 1,
      receivedType: "number",
      expected: "non-empty string",
    });
    await expect(promise).rejects.toThrow(
      "path=metadata.summary; value=1; type=number; expected=non-empty string",
    );
  });

  it("rejects legacy model-authored metadata fields outside the current schema", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft, { significant_items: 1 })),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete } });

    await expect(writer.write(context, [firstDeepStory], "")).rejects.toMatchObject({
      path: "metadata.significant_items",
      receivedValue: 1,
      receivedType: "number",
      expected: "no additional properties",
    });
  });

  it("rejects an unknown story id and a source outside the referenced stories, naming each issue", () => {
    const attempt = (): unknown => validateDraftAgainstStories({
      ...oneItemDraft,
      developments: [
        { ...oneItemDraft.developments[0]!, storyIds: ["story-unknown"] },
        {
          ...oneItemDraft.developments[0]!,
          sources: [{ url: "https://invented.example", label: "Invented" }],
        },
      ],
    }, [firstDeepStory]);

    expect(attempt).toThrow(DraftResearchBoundaryError);
    // The failure message is what reaches the run_failed log and the System
    // ticket, so it must name the actual problem, not just a count of issues.
    expect(attempt).toThrow("development 1 references an unknown story id: story-unknown");
    expect(attempt).toThrow("development 2 cites a source absent from its stories: https://invented.example");
  });

  it("does not require every researched story to appear — the writer chooses what makes the edition", () => {
    // firstDeepStory is accepted research but never referenced by the draft; that is
    // a legitimate editorial choice, not a boundary violation.
    expect(() => validateDraftAgainstStories(
      { ...oneItemDraft, developments: [], worthWatching: [] },
      [firstDeepStory],
    )).not.toThrow();
  });

  it("creates a deterministic quiet-day draft without a model", () => {
    const draft = createQuietDayDraft();
    expect(draft.developments).toEqual([]);
    expect(draft.worthWatching).toEqual([]);
    expect(deriveFinalEditionMetadata(draft, [])).toMatchObject({
      significant_items: 0,
      worth_watching_items: 0,
      day_intensity: "minimal",
    });
    expect(() => validateDraftAgainstStories(draft, [])).not.toThrow();
  });

  it("derives persisted metadata only from final items and their cited stories", () => {
    const draft: BriefDraft = {
      ...oneItemDraft,
      developments: [{
        ...oneItemDraft.developments[0]!,
        sources: [
          { url: "https://example.com/model/", label: "OpenAI" },
          { url: "https://example.com/model#details", label: "OpenAI duplicate" },
        ],
      }],
    };

    expect(deriveFinalEditionMetadata(draft, [firstDeepStory, {
      ...firstDeepStory,
      id: "unused-story",
      companies: ["Excluded Company"],
      topics: ["Excluded topic"],
      sources: [{ ...firstDeepStory.sources[0]!, url: "https://example.com/unused" }],
    }])).toEqual({
      summary: oneItemDraft.metadata.summary,
      significant_items: 1,
      worth_watching_items: 0,
      day_intensity: "low",
      companies: ["OpenAI"],
      topics: ["AI models"],
      developments: [oneItemDraft.developments[0]!.title],
      source_count: 1,
    });
  });

  it("includes worth-watching references in entity and displayed-source metadata", () => {
    const draft: BriefDraft = {
      ...oneItemDraft,
      worthWatching: [{
        storyIds: [secondDeepStory.id],
        title: "עדכון שכדאי לעקוב אחריו",
        note: "השלב הבא עדיין תלוי בהשלמת ההשקה.",
        sources: [{ url: secondDeepStory.sources[0]!.url, label: "Google" }],
      }],
    };

    expect(deriveFinalEditionMetadata(draft, [firstDeepStory, secondDeepStory])).toMatchObject({
      significant_items: 1,
      worth_watching_items: 1,
      day_intensity: "low",
      companies: ["OpenAI", "Google"],
      topics: ["AI models", "Developer tools"],
      developments: [oneItemDraft.developments[0]!.title],
      source_count: 2,
    });
  });
});
