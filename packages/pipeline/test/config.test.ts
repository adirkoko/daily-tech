import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadPipelineEnvironment } from "../src/index.js";

describe("loadPipelineEnvironment", () => {
  it("loads required secrets and derives storage paths", () => {
    expect(
      loadPipelineEnvironment({
        AI_API_KEY: "ai-key",
        AI_MODEL: "model-name",
        TECH_BRIEFS_ROOT: "custom-content",
        PIPELINE_MAX_REVISION_ROUNDS: "2",
      }),
    ).toEqual({
      aiApiKey: "ai-key",
      aiModel: "model-name",
      aiBaseUrl: "https://api.openai.com/v1",
      contentRoot: resolve("custom-content"),
      dailyStorageRoot: resolve("custom-content", "daily"),
      databaseFile: resolve("custom-content", "meta", "tech_briefs.db"),
      maxRevisionRounds: 2,
    });
  });

  it("rejects missing secrets and invalid safety limits", () => {
    expect(() => loadPipelineEnvironment({})).toThrow(/AI_API_KEY/u);
    expect(() =>
      loadPipelineEnvironment({
        AI_API_KEY: "key",
        AI_MODEL: "model",
        PIPELINE_MAX_REVISION_ROUNDS: "4",
      }),
    ).toThrow(RangeError);
  });
});
