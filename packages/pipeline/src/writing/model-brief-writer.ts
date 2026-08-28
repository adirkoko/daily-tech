import { isDayIntensity } from "@daily-tech/core";

import { parseJsonResult, type AiCompletion } from "../ai/contracts.js";
import type { ResearchedStory } from "../research/contracts.js";
import type { ModelUsage, PipelineContext, StageResult } from "../types.js";
import type {
  BriefDraft,
  BriefWriter,
  GeneratedDayMetadata,
  ModelBriefWriterOptions,
  RevisionRequest,
} from "./contracts.js";
import { DRAFT_PROMPT, REVISION_PROMPT } from "./prompts.js";

export class ModelBriefWriter implements BriefWriter {
  readonly #client: ModelBriefWriterOptions["client"];

  constructor(options: ModelBriefWriterOptions) {
    this.#client = options.client;
  }

  async write(
    context: PipelineContext,
    stories: readonly ResearchedStory[],
  ): Promise<StageResult<BriefDraft>> {
    if (stories.length === 0) throw new TypeError("ModelBriefWriter requires at least one story.");
    return this.#complete(DRAFT_PROMPT, {
      window: serializeWindow(context),
      stories,
    });
  }

  async revise(request: RevisionRequest): Promise<StageResult<BriefDraft>> {
    if (request.missingStories.length === 0) {
      throw new TypeError("Revision requires at least one missing story.");
    }
    return this.#complete(REVISION_PROMPT, {
      window: serializeWindow(request.context),
      stories: request.stories,
      currentDraft: request.draft,
      missingStories: request.missingStories,
    });
  }

  async #complete(prompt: string, input: unknown): Promise<StageResult<BriefDraft>> {
    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(input) },
      ],
      responseFormat: "json",
      temperature: 0.2,
    });
    return { value: parseDraft(completion), usage: completionUsage(completion) };
  }
}

function parseDraft(completion: AiCompletion): BriefDraft {
  return parseJsonResult(completion.content, (value): BriefDraft => {
    const record = asRecord(value, "brief response");
    const metadata = asRecord(record.metadata, "metadata");
    if (!isDayIntensity(metadata.day_intensity)) {
      throw new TypeError("metadata.day_intensity is invalid.");
    }
    const parsedMetadata: GeneratedDayMetadata = {
      summary: asString(metadata.summary, "metadata.summary"),
      significant_items: asNonNegativeInteger(
        metadata.significant_items,
        "metadata.significant_items",
      ),
      worth_watching_items: asNonNegativeInteger(
        metadata.worth_watching_items,
        "metadata.worth_watching_items",
      ),
      day_intensity: metadata.day_intensity,
      companies: asStringArray(metadata.companies, "metadata.companies"),
      topics: asStringArray(metadata.topics, "metadata.topics"),
      developments: asStringArray(metadata.developments, "metadata.developments"),
    };
    return {
      markdown: asString(record.markdown, "markdown"),
      includedStoryIds: asStringArray(record.included_story_ids, "included_story_ids"),
      metadata: parsedMetadata,
    };
  });
}

function completionUsage(completion: AiCompletion): ModelUsage {
  return completion.usage;
}

function serializeWindow(context: PipelineContext): Record<string, string> {
  return {
    date: context.window.date,
    timeZone: context.window.timeZone,
    start: context.window.start.toISOString(),
    endExclusive: context.window.endExclusive.toISOString(),
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function asStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

function asNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return value as number;
}
