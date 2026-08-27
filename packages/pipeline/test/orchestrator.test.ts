import { describe, expect, it, vi } from "vitest";

import {
  ArtifactValidationError,
  DailyBriefPipeline,
  PipelineRunError,
  RevisionLimitExceededError,
  type DailyBriefPipelineDependencies,
  type PipelineFailure,
  type PipelineLogEvent,
} from "../src/index.js";
import {
  firstCandidate,
  oneItemDraft,
  secondCandidate,
  stageResult,
  twoItemDraft,
} from "./fixtures.js";

const runAt = new Date("2026-08-28T01:00:00.000Z");

function createDependencies(): DailyBriefPipelineDependencies & {
  readonly events: PipelineLogEvent[];
  readonly failures: PipelineFailure[];
} {
  const events: PipelineLogEvent[] = [];
  const failures: PipelineFailure[] = [];
  return {
    researcher: {
      collect: vi.fn().mockResolvedValue(
        stageResult([firstCandidate]),
      ),
    },
    filter: {
      select: vi.fn().mockResolvedValue(stageResult([firstCandidate])),
    },
    writer: {
      write: vi.fn().mockResolvedValue(stageResult(oneItemDraft)),
      revise: vi.fn().mockResolvedValue(stageResult(oneItemDraft)),
    },
    reviewer: {
      review: vi.fn().mockResolvedValue(
        stageResult({ approved: true, feedback: [] }),
      ),
    },
    missingNewsChecker: {
      check: vi.fn().mockResolvedValue(
        stageResult({ missing: [], notes: [] }),
      ),
    },
    sink: { saveReady: vi.fn().mockResolvedValue(undefined) },
    failureReporter: {
      report: vi.fn(async (failure: PipelineFailure) => {
        failures.push(failure);
      }),
    },
    logger: {
      log: vi.fn((event: PipelineLogEvent) => {
        events.push(event);
      }),
    },
    clock: { now: () => runAt },
    createRunId: () => "run-2026-08-27",
    events,
    failures,
  };
}

describe("DailyBriefPipeline", () => {
  it("runs every stage and persists only a validated ready artifact", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.researcher.collect).mockResolvedValue({
      value: [firstCandidate],
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 0.03,
      },
    });
    const pipeline = new DailyBriefPipeline(dependencies);

    const result = await pipeline.run(runAt);

    expect(result.window.date).toBe("2026-08-27");
    expect(result.artifact.filePath).toBe(
      "tech_briefs/daily/2026/august/2026-08-27/2026-08-27-tech_briefs.md",
    );
    expect(result.artifact.metadata).toEqual(
      expect.objectContaining({
        date: "2026-08-27",
        status: "ready",
        source_count: 1,
        created_at: runAt.toISOString(),
        published_at: null,
      }),
    );
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      costUsd: 0.03,
    });
    expect(dependencies.sink.saveReady).toHaveBeenCalledOnce();
    expect(dependencies.failures).toHaveLength(0);
    expect(dependencies.events.at(0)?.type).toBe("run_started");
    expect(dependencies.events.at(-1)?.type).toBe("run_completed");
  });

  it("revises the brief and merges newly discovered missing news", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.reviewer.review)
      .mockResolvedValueOnce(
        stageResult({ approved: false, feedback: ["חסר הקשר"] }),
      )
      .mockResolvedValueOnce(stageResult({ approved: true, feedback: [] }));
    vi.mocked(dependencies.missingNewsChecker.check)
      .mockResolvedValueOnce(
        stageResult({ missing: [secondCandidate], notes: ["נמצא עדכון נוסף"] }),
      )
      .mockResolvedValueOnce(stageResult({ missing: [], notes: [] }));
    vi.mocked(dependencies.writer.revise).mockResolvedValue(
      stageResult(twoItemDraft),
    );
    const pipeline = new DailyBriefPipeline(dependencies);

    const result = await pipeline.run(runAt);

    expect(result.revisionRounds).toBe(1);
    expect(result.missingItemsAdded).toBe(1);
    expect(result.selectedDevelopments).toBe(2);
    expect(result.artifact.metadata.source_count).toBe(2);
    expect(dependencies.writer.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        developments: [firstCandidate, secondCandidate],
        editorialFeedback: ["חסר הקשר"],
      }),
    );
  });

  it("reports deterministic validation failures without persisting", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.writer.write).mockResolvedValue(
      stageResult({
        ...oneItemDraft,
        metadata: { ...oneItemDraft.metadata, significant_items: 2 },
      }),
    );
    const pipeline = new DailyBriefPipeline(dependencies);

    const error = await pipeline.run(runAt).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PipelineRunError);
    expect((error as PipelineRunError).stage).toBe("validate");
    expect((error as PipelineRunError).cause).toBeInstanceOf(ArtifactValidationError);
    expect(dependencies.sink.saveReady).not.toHaveBeenCalled();
    expect(dependencies.failures).toEqual([
      expect.objectContaining({
        stage: "validate",
        validationIssues: expect.arrayContaining([
          expect.objectContaining({ code: "item_count_mismatch" }),
        ]),
      }),
    ]);
  });

  it("reports upstream failures and never writes a partial artifact", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.researcher.collect).mockRejectedValue(
      new Error("search unavailable"),
    );
    const pipeline = new DailyBriefPipeline(dependencies);

    await expect(pipeline.run(runAt)).rejects.toMatchObject({
      name: "PipelineRunError",
      stage: "research",
    });
    expect(dependencies.failures).toEqual([
      expect.objectContaining({
        stage: "research",
        message: "search unavailable",
      }),
    ]);
    expect(dependencies.sink.saveReady).not.toHaveBeenCalled();
  });

  it("preserves the original failure when failure reporting also fails", async () => {
    const dependencies = createDependencies();
    const researchError = new Error("search unavailable");
    const reportingError = new Error("ticket database unavailable");
    vi.mocked(dependencies.researcher.collect).mockRejectedValue(researchError);
    vi.mocked(dependencies.failureReporter.report).mockRejectedValue(reportingError);
    const pipeline = new DailyBriefPipeline(dependencies);

    const error = await pipeline.run(runAt).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PipelineRunError);
    expect((error as PipelineRunError).cause).toBe(researchError);
    expect((error as PipelineRunError).reportingError).toBe(reportingError);
  });

  it("accepts a quiet-day brief without inventing developments", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.researcher.collect).mockResolvedValue(stageResult([]));
    vi.mocked(dependencies.filter.select).mockResolvedValue(stageResult([]));
    vi.mocked(dependencies.writer.write).mockResolvedValue(
      stageResult({
        markdown: "# Daily Tech — 27 באוגוסט 2026\n\nהיום היה שקט.",
        metadata: {
          summary: "היום היה שקט.",
          significant_items: 0,
          worth_watching_items: 0,
          day_intensity: "minimal",
          companies: [],
          topics: [],
          developments: [],
        },
      }),
    );
    const pipeline = new DailyBriefPipeline(dependencies);

    const result = await pipeline.run(runAt);

    expect(result.selectedDevelopments).toBe(0);
    expect(result.artifact.metadata.source_count).toBe(0);
    expect(result.artifact.metadata.day_intensity).toBe("minimal");
    expect(dependencies.sink.saveReady).toHaveBeenCalledOnce();
  });

  it("stops after the configured revision limit", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.reviewer.review).mockResolvedValue(
      stageResult({ approved: false, feedback: ["עדיין לא תקין"] }),
    );
    const pipeline = new DailyBriefPipeline(dependencies, {
      maxRevisionRounds: 1,
    });

    const error = await pipeline.run(runAt).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PipelineRunError);
    expect((error as PipelineRunError).cause).toBeInstanceOf(
      RevisionLimitExceededError,
    );
    expect(dependencies.writer.revise).toHaveBeenCalledOnce();
    expect(dependencies.sink.saveReady).not.toHaveBeenCalled();
  });

  it("deduplicates selected candidates by stable ID", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.filter.select).mockResolvedValue(
      stageResult([firstCandidate, firstCandidate]),
    );
    const pipeline = new DailyBriefPipeline(dependencies);

    const result = await pipeline.run(runAt);

    expect(result.selectedDevelopments).toBe(1);
    expect(dependencies.writer.write).toHaveBeenCalledWith(
      expect.anything(),
      [firstCandidate],
    );
  });

  it("validates configuration eagerly", () => {
    const dependencies = createDependencies();
    expect(
      () => new DailyBriefPipeline(dependencies, { maxRevisionRounds: 0 }),
    ).toThrow(RangeError);
    expect(
      () => new DailyBriefPipeline(dependencies, { storageRoot: "///" }),
    ).toThrow(TypeError);
  });
});
