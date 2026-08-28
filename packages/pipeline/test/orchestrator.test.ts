import { describe, expect, it, vi } from "vitest";

import {
  DailyBriefPipeline,
  PipelineRunError,
  type BriefWriter,
  type DailyBriefPipelineDependencies,
  type FailureReporter,
  type ModelUsage,
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

const usage: ModelUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const webUsage: ModelUsage = { ...usage, webSearchCalls: 1 };

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
    research: vi.fn().mockResolvedValue({
      value: { stories: [firstStoryInput], rejectedStories: [] },
      usage: webUsage,
    }),
    findGaps: vi.fn().mockResolvedValue({
      value: { missingStories: [], rejectedStories: [] },
      usage: webUsage,
    }),
  };
  const writer: BriefWriter = {
    write: vi.fn().mockResolvedValue({ value: oneItemDraft, usage }),
    revise: vi.fn().mockResolvedValue({ value: twoItemDraft, usage }),
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
  it("uses exactly Research, Draft, and Gap Check model requests on a normal run", async () => {
    const deps = dependencies();
    const pipeline = new DailyBriefPipeline(deps, { storageRoot: "tech_briefs/daily" });

    const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));

    expect(result).toMatchObject({
      researchedStories: 1,
      includedStories: 1,
      revisionRounds: 0,
      gapStoriesAdded: 0,
      modelRequests: 3,
      usage: {
        inputTokens: 30,
        outputTokens: 15,
        totalTokens: 45,
        webSearchCalls: 2,
      },
    });
    expect(deps.researchProvider.research).toHaveBeenCalledOnce();
    expect(deps.writer.write).toHaveBeenCalledOnce();
    expect(deps.researchProvider.findGaps).toHaveBeenCalledOnce();
    expect(deps.writer.revise).not.toHaveBeenCalled();
    expect(deps.sink.saveReady).toHaveBeenCalledOnce();
    expect(deps.failures).toEqual([]);
  });

  it("uses five model requests when one meaningful gap forces revision", async () => {
    const deps = dependencies();
    vi.mocked(deps.researchProvider.findGaps)
      .mockResolvedValueOnce({
        value: { missingStories: [secondStoryInput], rejectedStories: [] },
        usage: webUsage,
      })
      .mockResolvedValueOnce({
        value: { missingStories: [], rejectedStories: [] },
        usage: webUsage,
      });
    const pipeline = new DailyBriefPipeline(deps);

    const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));

    expect(result).toMatchObject({
      includedStories: 2,
      revisionRounds: 1,
      gapStoriesAdded: 1,
      modelRequests: 5,
    });
    expect(deps.writer.revise).toHaveBeenCalledOnce();
    expect(deps.researchProvider.findGaps).toHaveBeenCalledTimes(2);
  });

  it("does not call the writer for a genuine quiet day", async () => {
    const deps = dependencies();
    vi.mocked(deps.researchProvider.research).mockResolvedValue({
      value: { stories: [], rejectedStories: [] },
      usage: webUsage,
    });
    const pipeline = new DailyBriefPipeline(deps);

    const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));

    expect(result.modelRequests).toBe(2);
    expect(result.includedStories).toBe(0);
    expect(result.artifact.metadata.day_intensity).toBe("minimal");
    expect(deps.writer.write).not.toHaveBeenCalled();
    expect(deps.writer.revise).not.toHaveBeenCalled();
  });

  it("fails before persistence when the draft crosses the research boundary", async () => {
    const deps = dependencies();
    vi.mocked(deps.writer.write).mockResolvedValue({
      value: {
        ...oneItemDraft,
        markdown: `${oneItemDraft.markdown}\n[Invented](https://invented.example/fact)`,
      },
      usage,
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
  });
});
