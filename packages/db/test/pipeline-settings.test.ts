import { DEFAULT_PIPELINE_SETTINGS } from "@daily-tech/core";
import { afterEach, describe, expect, it } from "vitest";

import { DailyTechDatabase, PipelineSettingsValidationError } from "../src/index.js";

describe("PipelineSettingsStore", () => {
  let database: DailyTechDatabase | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("returns the seeded defaults before anything is saved", () => {
    database = DailyTechDatabase.open({ filename: ":memory:" });

    expect(database.pipelineSettings.get()).toEqual(DEFAULT_PIPELINE_SETTINGS);
  });

  it("persists a saved settings object and returns it on the next read", () => {
    database = DailyTechDatabase.open({ filename: ":memory:" });

    const saved = database.pipelineSettings.save({
      adminKeywords: ["OpenAI", "Robotics"],
      maximumStories: 10,
      gapDiscoveryEnabled: false,
      adminKeywordsResearchEnabled: true,
      editorialInstructions: "Give more weight to developer tools this week.",
      generateTime: "02:30",
      publishTime: "08:00",
      updatedAt: "2026-08-29T05:00:00.000Z",
    });

    expect(saved).toEqual({
      adminKeywords: ["OpenAI", "Robotics"],
      maximumStories: 10,
      gapDiscoveryEnabled: false,
      adminKeywordsResearchEnabled: true,
      editorialInstructions: "Give more weight to developer tools this week.",
      generateTime: "02:30",
      publishTime: "08:00",
      updatedAt: "2026-08-29T05:00:00.000Z",
    });
    expect(database.pipelineSettings.get()).toEqual(saved);
  });

  it("rejects an invalid save and leaves the stored row untouched", () => {
    database = DailyTechDatabase.open({ filename: ":memory:" });

    expect(() =>
      database!.pipelineSettings.save({
        adminKeywords: [],
        maximumStories: 99,
        gapDiscoveryEnabled: true,
        adminKeywordsResearchEnabled: true,
        editorialInstructions: "",
        generateTime: "01:00",
        publishTime: "07:00",
        updatedAt: "2026-08-29T05:00:00.000Z",
      }),
    ).toThrow(PipelineSettingsValidationError);
    expect(database.pipelineSettings.get()).toEqual(DEFAULT_PIPELINE_SETTINGS);
  });

  it("rejects duplicate admin keywords", () => {
    database = DailyTechDatabase.open({ filename: ":memory:" });

    expect(() =>
      database!.pipelineSettings.save({
        adminKeywords: ["Apple", "apple"],
        maximumStories: 8,
        gapDiscoveryEnabled: true,
        adminKeywordsResearchEnabled: true,
        editorialInstructions: "",
        generateTime: "01:00",
        publishTime: "07:00",
        updatedAt: "2026-08-29T05:00:00.000Z",
      }),
    ).toThrow(PipelineSettingsValidationError);
  });
});
