import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DailyTechDatabase } from "@daily-tech/db";

import {
  DailyBriefPipeline,
  DatabaseFailureReporter,
  DatabasePipelineLogger,
  FileSystemDatabaseArtifactSink,
  renderBriefMarkdown,
  type BriefWriter,
  type NewsResearchProvider,
} from "../src/index.js";
import { firstStoryInput, oneItemDraft } from "./fixtures.js";

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("daily pipeline end to end", () => {
  it("turns researched stories into a validated Markdown file, metadata, and logs", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "daily-tech-e2e-"));
    createdPaths.push(storageRoot);
    const database = DailyTechDatabase.open({ filename: ":memory:" });
    const researchProvider: NewsResearchProvider = {
      research: vi.fn().mockResolvedValue({ stories: [firstStoryInput], rejectedStories: [] }),
      findGaps: vi.fn().mockResolvedValue({ missingStories: [], rejectedStories: [] }),
    };
    const writer: BriefWriter = {
      write: vi.fn().mockResolvedValue(oneItemDraft),
      revise: vi.fn(),
    };
    const pipeline = new DailyBriefPipeline(
      {
        researchProvider,
        writer,
        sink: new FileSystemDatabaseArtifactSink({ storageRoot, metadataStore: database }),
        logger: new DatabasePipelineLogger(database),
        failureReporter: new DatabaseFailureReporter(database),
        clock: { now: () => new Date("2026-08-28T01:00:00.000Z") },
        createRunId: () => "integration-run",
        storyIds: { create: () => "story-1" },
      },
      { storageRoot },
    );

    try {
      const result = await pipeline.run(new Date("2026-08-28T01:00:00.000Z"));
      const storedPath = join(
        storageRoot,
        "2026",
        "august",
        "2026-08-27",
        "2026-08-27-tech_briefs.md",
      );
      expect(await readFile(storedPath, "utf8")).toBe(
        renderBriefMarkdown("2026-08-27", oneItemDraft),
      );
      expect(database.getDay("2026-08-27")).toMatchObject({
        status: "ready",
        source_count: 1,
      });
      expect(result.artifact.metadata.status).toBe("ready");
      const logs = database.operations.listLogs({ runId: "integration-run" });
      expect(logs).toEqual([
        expect.objectContaining({ eventType: "run_completed" }),
      ]);
      expect(database.operations.listTickets({ category: "system" })).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
