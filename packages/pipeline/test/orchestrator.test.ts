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
  firstStoryInput,
  oneItemDraft,
  secondStoryInput,
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
    research: vi.fn().mockResolvedValue({ stories: [firstStoryInput], rejectedStories: [] }),
    findGaps: vi.fn().mockResolvedValue({ missingStories: [], rejectedStories: [] }),
  };
  const writer: BriefWriter = {
    write: vi.fn().mockResolvedValue(oneItemDraft),
    revise: vi.fn().mockResolvedValue(twoItemDraft),
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

describe("DailyBriefPipeline", () => {
  it("runs Research, Draft, and one Gap Check on a normal run", async () => {
    const deps = dependencies();
    const pipeline = new DailyBriefPipeline(deps, { storageRoot: "tech_briefs/daily" });

    const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));

    expect(result.artifact.metadata).toMatchObject({ status: "ready", significant_items: 1 });
    expect(deps.researchProvider.research).toHaveBeenCalledOnce();
    expect(deps.researchProvider.research).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ maximumStories: 20 }),
      }),
    );
    expect(deps.writer.write).toHaveBeenCalledOnce();
    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
    expect(deps.writer.revise).not.toHaveBeenCalled();
    expect(deps.sink.saveReady).toHaveBeenCalledOnce();
    expect(deps.failures).toEqual([]);
    expect(deps.events).toEqual([
      expect.objectContaining({ type: "run_completed", stage: "persist" }),
    ]);
  });

  it("revises exactly once when the one Gap Check finds a missing story, with no second check", async () => {
    const deps = dependencies();
    vi.mocked(deps.researchProvider.findGaps).mockResolvedValue({
      missingStories: [secondStoryInput],
      rejectedStories: [],
    });
    const pipeline = new DailyBriefPipeline(deps);

    const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));

    expect(result.artifact.metadata.significant_items).toBe(2);
    expect(deps.researchProvider.research).toHaveBeenCalledOnce();
    expect(deps.writer.write).toHaveBeenCalledOnce();
    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
    expect(deps.writer.revise).toHaveBeenCalledOnce();
  });

  it("does not call the writer for a genuine quiet day", async () => {
    const deps = dependencies();
    vi.mocked(deps.researchProvider.research).mockResolvedValue({
      stories: [],
      rejectedStories: [],
    });
    const pipeline = new DailyBriefPipeline(deps);

    const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));

    expect(result.artifact.metadata.day_intensity).toBe("minimal");
    expect(result.artifact.metadata.significant_items).toBe(0);
    expect(deps.writer.write).not.toHaveBeenCalled();
    expect(deps.writer.revise).not.toHaveBeenCalled();
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
      pipeline.run(new Date("2026-08-28T01:00:00.000Z")),
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
