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
  PromptedBriefWriter,
  PromptedEditorialReviewer,
  PromptedNewsFilter,
  SearchBackedMissingNewsChecker,
  SearchBackedNewsResearcher,
  type AiCompletion,
  type AiCompletionClient,
  type NewsSearchProvider,
} from "../src/index.js";
import { firstCandidate, oneItemDraft } from "./fixtures.js";

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function completion(content: unknown): AiCompletion {
  return {
    content: JSON.stringify(content),
    model: "integration-model",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

describe("daily pipeline end to end", () => {
  it("turns search results into a validated Markdown file, metadata, and logs", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "daily-tech-e2e-"));
    createdPaths.push(storageRoot);
    const database = DailyTechDatabase.open({ filename: ":memory:" });
    const complete = vi.fn<AiCompletionClient["complete"]>();
    [
      completion({ candidates: [firstCandidate] }),
      completion({ selected_ids: [firstCandidate.id] }),
      completion(oneItemDraft),
      completion({ approved: true, feedback: [] }),
      completion({ missing: [], notes: [] }),
    ].forEach((value) => complete.mockResolvedValueOnce(value));
    const client: AiCompletionClient = { complete };
    const search: NewsSearchProvider = {
      search: vi.fn().mockResolvedValue([
        {
          url: "https://example.com/model",
          title: "Model announcement",
          snippet: "A new model is available.",
          publisher: "OpenAI",
          publishedAt: "2026-08-27T10:00:00.000Z",
        },
      ]),
    };

    const pipeline = new DailyBriefPipeline(
      {
        researcher: new SearchBackedNewsResearcher({
          client,
          search,
          queries: ["research angle"],
        }),
        filter: new PromptedNewsFilter(client),
        writer: new PromptedBriefWriter(client),
        reviewer: new PromptedEditorialReviewer(client),
        missingNewsChecker: new SearchBackedMissingNewsChecker({
          client,
          search,
          queries: ["missing-news angle"],
        }),
        sink: new FileSystemDatabaseArtifactSink({
          storageRoot,
          metadataStore: database,
        }),
        logger: new DatabasePipelineLogger(database),
        failureReporter: new DatabaseFailureReporter(database),
        clock: { now: () => new Date("2026-08-28T01:00:00.000Z") },
        createRunId: () => "integration-run",
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

      expect(result.artifact.metadata.status).toBe("ready");
      expect(result.usage.totalTokens).toBe(75);
      expect(await readFile(storedPath, "utf8")).toBe(oneItemDraft.markdown);
      expect(database.getDay("2026-08-27")).toEqual(result.artifact.metadata);
      expect(database.operations.listLogs({ runId: "integration-run" })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: "run_started" }),
          expect.objectContaining({ eventType: "run_completed" }),
        ]),
      );
      expect(database.operations.listTickets()).toHaveLength(0);
      expect(search.search).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(5);
    } finally {
      database.close();
    }
  });
});
