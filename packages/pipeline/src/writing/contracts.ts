import type { DayIntensity } from "@daily-tech/core";

import type { AiCompletionClient } from "../ai/contracts.js";
import type { DeepResearchedStory } from "../research/contracts.js";
import type { PipelineContext } from "../types.js";

export interface GeneratedDayMetadata {
  readonly summary: string;
  readonly significant_items: number;
  readonly worth_watching_items: number;
  readonly day_intensity: DayIntensity;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly developments: readonly string[];
}

/** A source the writer chose to cite; both fields are its own editorial choice. */
export interface DraftSourceCitation {
  readonly url: string;
  readonly label: string;
}

export interface DraftDevelopment {
  /** Usually one story; more only when the writer genuinely groups related stories. */
  readonly storyIds: readonly string[];
  readonly title: string;
  readonly whatChanged: string;
  readonly whyItMatters: string;
  /** Rendered only when not null — the writer decides whether there's real practical value. */
  readonly whatToDoWithIt: string | null;
  /** Rendered only when not null — the writer decides whether there's relevant availability info. */
  readonly availability: string | null;
  readonly sources: readonly DraftSourceCitation[];
}

export interface DraftWorthWatchingItem {
  readonly storyIds: readonly string[];
  readonly title: string;
  readonly note: string;
  readonly sources: readonly DraftSourceCitation[];
}

export interface BriefDraft {
  /**
   * The "תמצית היום" section shown inside the brief: a fuller paragraph giving real
   * orientation for the day. Distinct from metadata.summary, which stays a short
   * teaser for the home page, calendar, and SEO and is never rendered in the brief.
   */
  readonly dayOverview: string;
  readonly developments: readonly DraftDevelopment[];
  readonly worthWatching: readonly DraftWorthWatchingItem[];
  readonly bottomLine: string;
  readonly metadata: GeneratedDayMetadata;
}

export interface BriefWriter {
  write(
    context: PipelineContext,
    stories: readonly DeepResearchedStory[],
    /** "" when the operator has not set any editorial guidance. */
    editorialInstructions: string,
  ): Promise<BriefDraft>;
}

export interface ModelBriefWriterOptions {
  readonly client: AiCompletionClient;
  /** Optional explicit provider/model override; omitted by default. */
  readonly temperature?: number;
}
