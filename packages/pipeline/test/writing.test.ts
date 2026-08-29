import { describe, expect, it, vi } from "vitest";

import {
  DraftResponseValidationError,
  DraftResearchBoundaryError,
  ModelBriefWriter,
  createQuietDayDraft,
  validateDraftAgainstStories,
  type AiCompletionClient,
  type BriefDraft,
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

    await writer.write(context, [firstStory]);

    const prompt = complete.mock.calls[0]?.[0].messages[0]?.content ?? "";
    expect(prompt).toContain("only factual source of truth");
    expect(prompt).toContain("numbers, dates, quotations, product names");
    expect(prompt).toContain("Every source you cite must be one of the sources belonging to the stories you reference");
    // Metadata must scope to the returned edition, not every story the writer reviewed —
    // this is what keeps daily_brief_companies/topics matching the actual rendered content.
    expect(prompt).toContain("never a company, topic, or story you reviewed and chose to leave out");
    // Companies/topics must be the actual subject of an item, not anything mentioned
    // in passing — including a source's own publisher name.
    expect(prompt).toContain("never a name mentioned only in passing, as background context, as a comparison, or solely because it published one of the sources");
    expect(prompt).toContain("metadata.companies and metadata.topics are English, not Hebrew");
    expect(prompt).toContain("metadata.developments stays in the brief's own language (Hebrew)");
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
              significant_items: { type: "integer", minimum: 0 },
              worth_watching_items: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    });
  });

  it("allows temperature only through an explicit writer opt-in", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft)),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete }, temperature: 0.2 });

    await writer.write(context, [firstStory]);

    expect(complete.mock.calls[0]?.[0]).toMatchObject({ temperature: 0.2 });
  });

  it("reports the exact path, value, type, and expectation for draft validation", async () => {
    const complete = vi.fn<AiCompletionClient["complete"]>().mockResolvedValue({
      content: JSON.stringify(draftResponseJson(oneItemDraft, { significant_items: "1" })),
      model: "writer",
    });
    const writer = new ModelBriefWriter({ client: { complete } });

    const promise = writer.write(context, [firstStory]);

    await expect(promise).rejects.toBeInstanceOf(DraftResponseValidationError);
    await expect(promise).rejects.toMatchObject({
      path: "metadata.significant_items",
      receivedValue: "1",
      receivedType: "string",
      expected: "non-negative integer",
    });
    await expect(promise).rejects.toThrow(
      'path=metadata.significant_items; value="1"; type=string; expected=non-negative integer',
    );
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
    }, [firstStory]);

    expect(attempt).toThrow(DraftResearchBoundaryError);
    // The failure message is what reaches the run_failed log and the System
    // ticket, so it must name the actual problem, not just a count of issues.
    expect(attempt).toThrow("development 1 references an unknown story id: story-unknown");
    expect(attempt).toThrow("development 2 cites a source absent from its stories: https://invented.example");
  });

  it("does not require every researched story to appear — the writer chooses what makes the edition", () => {
    // firstStory is accepted research but never referenced by the draft; that is a
    // legitimate editorial choice, not a boundary violation.
    expect(() => validateDraftAgainstStories(
      { ...oneItemDraft, developments: [], worthWatching: [] },
      [firstStory],
    )).not.toThrow();
  });

  it("creates a deterministic quiet-day draft without a model", () => {
    const draft = createQuietDayDraft();
    expect(draft.developments).toEqual([]);
    expect(draft.worthWatching).toEqual([]);
    expect(draft.metadata).toMatchObject({
      significant_items: 0,
      worth_watching_items: 0,
      day_intensity: "minimal",
    });
    expect(() => validateDraftAgainstStories(draft, [])).not.toThrow();
  });
});
