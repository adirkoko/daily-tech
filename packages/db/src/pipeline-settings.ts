import type Database from "better-sqlite3";

import { VALIDATION_CODES, validatePipelineSettings, type PipelineSettings } from "@daily-tech/core";

import { PipelineSettingsIntegrityError, PipelineSettingsValidationError } from "./errors.js";

export interface SavePipelineSettingsInput {
  readonly adminKeywords: readonly string[];
  readonly maximumStories: number;
  readonly gapDiscoveryEnabled: boolean;
  readonly adminKeywordsResearchEnabled: boolean;
  readonly editorialInstructions: string;
  readonly generateTime: string;
  readonly publishTime: string;
  /** Caller-supplied so callers stay deterministic and testable, like every other
   *  timestamped write in this package. */
  readonly updatedAt: string;
}

interface PipelineSettingsRow {
  readonly admin_keywords: string;
  readonly maximum_stories: number;
  readonly gap_discovery_enabled: number;
  readonly admin_keywords_research_enabled: number;
  readonly editorial_instructions: string;
  readonly generate_time: string;
  readonly publish_time: string;
  readonly updated_at: string;
}

/**
 * The one settings row a daily generation run reads at its start, and the Admin
 * "Pipeline" screen edits. A single fixed row (id = 1), seeded by migration 6, so
 * every reader always finds a valid, complete settings object — no "not configured
 * yet" branch anywhere else in the system.
 */
export class PipelineSettingsStore {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  get(): PipelineSettings {
    const row = this.#database
      .prepare("SELECT * FROM pipeline_settings WHERE id = 1")
      .get() as PipelineSettingsRow | undefined;
    if (row === undefined) {
      throw new Error("pipeline_settings row is missing; migrations may not have run.");
    }
    return hydrate(row);
  }

  save(input: SavePipelineSettingsInput): PipelineSettings {
    const validation = validatePipelineSettings(input);
    if (!validation.valid) {
      throw new PipelineSettingsValidationError(validation.issues);
    }
    const settings = validation.data;
    this.#database
      .prepare(
        `
          UPDATE pipeline_settings SET
            admin_keywords = ?,
            maximum_stories = ?,
            gap_discovery_enabled = ?,
            admin_keywords_research_enabled = ?,
            editorial_instructions = ?,
            generate_time = ?,
            publish_time = ?,
            updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        JSON.stringify(settings.adminKeywords),
        settings.maximumStories,
        settings.gapDiscoveryEnabled ? 1 : 0,
        settings.adminKeywordsResearchEnabled ? 1 : 0,
        settings.editorialInstructions,
        settings.generateTime,
        settings.publishTime,
        settings.updatedAt,
      );
    return this.get();
  }
}

function hydrate(row: PipelineSettingsRow): PipelineSettings {
  let adminKeywords: unknown;
  try {
    adminKeywords = JSON.parse(row.admin_keywords);
  } catch (error) {
    throw new PipelineSettingsIntegrityError([
      {
        code: VALIDATION_CODES.INVALID_TYPE,
        path: "settings.adminKeywords",
        message: "adminKeywords is not valid JSON.",
      },
    ]);
  }
  const candidate = {
    adminKeywords,
    maximumStories: row.maximum_stories,
    gapDiscoveryEnabled: row.gap_discovery_enabled === 1,
    adminKeywordsResearchEnabled: row.admin_keywords_research_enabled === 1,
    editorialInstructions: row.editorial_instructions,
    generateTime: row.generate_time,
    publishTime: row.publish_time,
    updatedAt: row.updated_at,
  };
  const validation = validatePipelineSettings(candidate);
  if (!validation.valid) {
    throw new PipelineSettingsIntegrityError(validation.issues);
  }
  return validation.data;
}
