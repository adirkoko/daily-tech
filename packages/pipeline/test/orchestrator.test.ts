import { DEFAULT_PIPELINE_SETTINGS, type PipelineSettings } from "@daily-tech/core";
import { describe, expect, it, vi } from "vitest";

import {
  DailyBriefPipeline,
  PipelineRunError,
  type BriefWriter,
  type DailyBriefPipelineDependencies,
  type FailureReporter,
  type NewsResearchProvider,
  type PipelineFailure,
  type PipelineLogEvent,
  type PipelineLogger,
  type StoryIdFactory,
} from "../src/index.js";
import {
  firstCandidateInput,
  firstDeepStoryInput,
  oneItemDraft,
  secondCandidateInput,
  secondDeepStoryInput,
  twoItemDraft,
} from "./fixtures.js";

function dependencies(): DailyBriefPipelineDependencies & {
  readonly researchProvider: NewsResearchProvider;
  readonly writer: BriefWriter;
  readonly events: PipelineLogEvent[];
  readonly failures: PipelineFailure[];
} {
  const events: PipelineLogEvent[] = [];
  const failures: PipelineFailure[] = [];
  let id = 0;
  const storyIds: StoryIdFactory = { create: () => `story-${++id}` };
  const researchProvider: NewsResearchProvider = {
    discover: vi.fn().mockResolvedValue({ stories: [firstCandidateInput], rejectedStories: [] }),
    findGaps: vi.fn().mockResolvedValue({ stories: [], rejectedStories: [] }),
    deepResearch: vi.fn().mockResolvedValue({ stories: [firstDeepStoryInput] }),
  };
  const writer: BriefWriter = {
    write: vi.fn().mockResolvedValue(oneItemDraft),
  };
  const logger: PipelineLogger = { log: (event) => { events.push(event); } };
  const failureReporter: FailureReporter = {
    report: async (failure) => { failures.push(failure); },
  };
  return {
    researchProvider,
    writer,
    sink: { saveReady: vi.fn().mockResolvedValue(undefined) },
    failureReporter,
    logger,
    clock: { now: () => new Date("2026-08-28T01:00:00.000Z") },
    createRunId: () => "run-1",
    storyIds,
    events,
    failures,
  };
}

const runAt = new Date("2026-08-28T01:00:00.000Z");

describe("DailyBriefPipeline", () => {
  it("runs light discovery, a gap check, deep research, and one draft on a normal run", async () => {
    const deps = dependencies();
    const pipeline = new DailyBriefPipeline(deps, { storageRoot: "tech_briefs/daily" });

    const result = await pipeline.run({ runAt });

    expect(result.artifact.metadata).toMatchObject({ status: "ready", significant_items: 1 });
    expect(deps.researchProvider.discover).toHaveBeenCalledOnce();
    expect(deps.researchProvider.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ maximumCandidatesPerCall: 20 }),
      }),
    );
    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
    expect(deps.researchProvider.deepResearch).toHaveBeenCalledOnce();
    expect(deps.researchProvider.deepResearch).toHaveBeenCalledWith(
      expect.objectContaining({ maximumStories: DEFAULT_PIPELINE_SETTINGS.maximumStories, editorialInstructions: "" }),
    );
    expect(deps.writer.write).toHaveBeenCalledOnce();
    expect(deps.writer.write).toHaveBeenCalledWith(expect.anything(), expect.anything(), "");
    expect(deps.sink.saveReady).toHaveBeenCalledOnce();
    expect(deps.failures).toEqual([]);
    expect(deps.events).toEqual([
      expect.objectContaining({ type: "run_completed", stage: "persist" }),
    ]);
  });

  it("merges a gap-discovered story into deep research and the final edition", async () => {
    const deps = dependencies();
    vi.mocked(deps.researchProvider.findGaps).mockResolvedValue({
      stories: [secondCandidateInput],
      rejectedStories: [],
    });
    vi.mocked(deps.researchProvider.deepResearch).mockResolvedValue({
      stories: [firstDeepStoryInput, secondDeepStoryInput],
    });
    vi.mocked(deps.writer.write).mockResolvedValue(twoItemDraft);
    const pipeline = new DailyBriefPipeline(deps);

    const result = await pipeline.run({ runAt });

    expect(result.artifact.metadata.significant_items).toBe(2);
    expect(deps.researchProvider.discover).toHaveBeenCalledOnce();
    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
    const deepResearchCall = vi.mocked(deps.researchProvider.deepResearch).mock.calls[0]![0];
    expect(deepResearchCall.candidates.map((candidate) => candidate.id)).toEqual(["story-1", "story-2"]);
  });

  it("runs admin-keyword-focused discovery only when keywords are configured and enabled", async () => {
    const deps = dependencies();
    const settings: PipelineSettings = {
      ...DEFAULT_PIPELINE_SETTINGS,
      adminKeywords: ["OpenAI", "Robotics"],
    };
    const pipeline = new DailyBriefPipeline(deps);

    await pipeline.run({ runAt, settings });

    expect(deps.researchProvider.findGaps).toHaveBeenCalledTimes(2);
    expect(deps.researchProvider.findGaps).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ focusKeywords: ["OpenAI", "Robotics"] }),
    );
  });

  it("skips admin-keyword discovery entirely when the keyword list is empty, even if enabled", async () => {
    const deps = dependencies();
    const pipeline = new DailyBriefPipeline(deps);

    await pipeline.run({ runAt, settings: DEFAULT_PIPELINE_SETTINGS });

    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
  });

  it("skips admin-keyword discovery when disabled, even with keywords configured", async () => {
    const deps = dependencies();
    const settings: PipelineSettings = {
      ...DEFAULT_PIPELINE_SETTINGS,
      adminKeywords: ["OpenAI"],
      adminKeywordsResearchEnabled: false,
    };
    const pipeline = new DailyBriefPipeline(deps);

    await pipeline.run({ runAt, settings });

    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
  });

  it("skips gap discovery entirely when disabled", async () => {
    const deps = dependencies();
    const settings: PipelineSettings = { ...DEFAULT_PIPELINE_SETTINGS, gapDiscoveryEnabled: false };
    const pipeline = new DailyBriefPipeline(deps);

    await pipeline.run({ runAt, settings });

    expect(deps.researchProvider.findGaps).not.toHaveBeenCalled();
  });

  it("does not call deep research or the writer for a genuine quiet day", async () => {
    const deps = dependencies();
    vi.mocked(deps.researchProvider.discover).mockResolvedValue({ stories: [], rejectedStories: [] });
    const pipeline = new DailyBriefPipeline(deps);

    const result = await pipeline.run({ runAt });

    expect(result.artifact.metadata.day_intensity).toBe("minimal");
    expect(result.artifact.metadata.significant_items).toBe(0);
    expect(deps.researchProvider.deepResearch).not.toHaveBeenCalled();
    expect(deps.writer.write).not.toHaveBeenCalled();
  });

  it("bounds a pathological candidate count before deep research, keeping the most important ones", async () => {
    const deps = dependencies();
    const manyCandidates = Array.from({ length: 45 }, (_, index) => ({
      ...firstCandidateInput,
      title: `Candidate ${index}`,
      importance: (index < 15 ? 5 : 2) as 1 | 2 | 3 | 4 | 5,
      sources: [{ ...firstCandidateInput.sources[0]!, url: `https://example.com/story-${index}` }],
    }));
    vi.mocked(deps.researchProvider.discover).mockResolvedValue({
      stories: manyCandidates,
      rejectedStories: [],
    });
    const pipeline = new DailyBriefPipeline(deps, { maximumDiscoveryCandidates: 10 });

    await pipeline.run({ runAt });

    const deepResearchCall = vi.mocked(deps.researchProvider.deepResearch).mock.calls[0]![0];
    expect(deepResearchCall.candidates).toHaveLength(10);
    expect(deepResearchCall.candidates.every((candidate) => candidate.importance === 5)).toBe(true);
  });

  it("fails before persistence when the draft crosses the research boundary", async () => {
    const deps = dependencies();
    vi.mocked(deps.writer.write).mockResolvedValue({
      ...oneItemDraft,
      developments: [{
        ...oneItemDraft.developments[0]!,
        sources: [{ url: "https://invented.example/fact", label: "Invented" }],
      }],
    });
    const pipeline = new DailyBriefPipeline(deps);

    await expect(
      pipeline.run({ runAt }),
    ).rejects.toMatchObject({
      name: "PipelineRunError",
      stage: "draft_validation",
    } satisfies Partial<PipelineRunError>);
    expect(deps.sink.saveReady).not.toHaveBeenCalled();
    expect(deps.failures).toHaveLength(1);
    expect(deps.events).toEqual([
      expect.objectContaining({ type: "run_failed", stage: "draft_validation" }),
    ]);
  });
});
