import { isDayIntensity } from "@daily-tech/core";

import { parseJsonResult, type AiCompletion } from "../ai/contracts.js";
import type { DeepResearchedStory } from "../research/contracts.js";
import type { PipelineContext } from "../types.js";
import type {
  BriefDraft,
  BriefWriter,
  DraftDevelopment,
  DraftSourceCitation,
  DraftWorthWatchingItem,
  GeneratedDayMetadata,
  ModelBriefWriterOptions,
} from "./contracts.js";
import { DRAFT_PROMPT } from "./prompts.js";
import { BRIEF_DRAFT_RESPONSE_SCHEMA } from "./schemas.js";

export class DraftResponseValidationError extends TypeError {
  readonly path: string;
  readonly receivedValue: unknown;
  readonly receivedType: string;
  readonly expected: string;

  constructor(path: string, receivedValue: unknown, expected: string) {
    const receivedType = valueType(receivedValue);
    super(
      `Draft response validation failed: path=${path}; `
      + `value=${formatReceivedValue(receivedValue)}; `
      + `type=${receivedType}; expected=${expected}.`,
    );
    this.name = "DraftResponseValidationError";
    this.path = path;
    this.receivedValue = receivedValue;
    this.receivedType = receivedType;
    this.expected = expected;
  }
}

export class ModelBriefWriter implements BriefWriter {
  readonly #client: ModelBriefWriterOptions["client"];
  readonly #temperature: ModelBriefWriterOptions["temperature"];

  constructor(options: ModelBriefWriterOptions) {
    this.#client = options.client;
    this.#temperature = options.temperature;
  }

  async write(
    context: PipelineContext,
    stories: readonly DeepResearchedStory[],
    editorialInstructions: string,
  ): Promise<BriefDraft> {
    if (stories.length === 0) throw new TypeError("ModelBriefWriter requires at least one story.");
    return this.#complete({
      window: serializeWindow(context),
      stories,
      editorialInstructions,
    });
  }

  async #complete(input: unknown): Promise<BriefDraft> {
    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: DRAFT_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
      responseFormat: {
        type: "json_schema",
        name: "daily_tech_brief_draft",
        schema: BRIEF_DRAFT_RESPONSE_SCHEMA,
      },
      ...(this.#temperature === undefined ? {} : { temperature: this.#temperature }),
    });
    return parseDraft(completion);
  }
}

function parseDraft(completion: AiCompletion): BriefDraft {
  return parseJsonResult(completion.content, (value): BriefDraft => {
    const record = asRecord(value, "brief response");
    const metadata = asRecord(record.metadata, "metadata");
    if (!isDayIntensity(metadata.day_intensity)) {
      throw validationError(
        "metadata.day_intensity",
        metadata.day_intensity,
        "one of minimal|low|medium|high|extreme",
      );
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
      dayOverview: asString(record.day_overview, "day_overview"),
      developments: asArray(record.developments, "developments").map((item, index) =>
        asDevelopment(item, `developments[${index}]`),
      ),
      worthWatching: asArray(record.worth_watching, "worth_watching").map((item, index) =>
        asWorthWatchingItem(item, `worth_watching[${index}]`),
      ),
      bottomLine: asString(record.bottom_line, "bottom_line"),
      metadata: parsedMetadata,
    };
  });
}

function asDevelopment(value: unknown, path: string): DraftDevelopment {
  const record = asRecord(value, path);
  return {
    storyIds: asStringArray(record.storyIds, `${path}.storyIds`),
    title: asString(record.title, `${path}.title`),
    whatChanged: asString(record.whatChanged, `${path}.whatChanged`),
    whyItMatters: asString(record.whyItMatters, `${path}.whyItMatters`),
    whatToDoWithIt: asNullableString(record.whatToDoWithIt, `${path}.whatToDoWithIt`),
    availability: asNullableString(record.availability, `${path}.availability`),
    sources: asArray(record.sources, `${path}.sources`).map((source, index) =>
      asSourceCitation(source, `${path}.sources[${index}]`),
    ),
  };
}

function asWorthWatchingItem(value: unknown, path: string): DraftWorthWatchingItem {
  const record = asRecord(value, path);
  return {
    storyIds: asStringArray(record.storyIds, `${path}.storyIds`),
    title: asString(record.title, `${path}.title`),
    note: asString(record.note, `${path}.note`),
    sources: asArray(record.sources, `${path}.sources`).map((source, index) =>
      asSourceCitation(source, `${path}.sources[${index}]`),
    ),
  };
}

function asSourceCitation(value: unknown, path: string): DraftSourceCitation {
  const record = asRecord(value, path);
  return {
    url: asString(record.url, `${path}.url`),
    label: asString(record.label, `${path}.label`),
  };
}

function asNullableString(value: unknown, path: string): string | null {
  return value === null ? null : asString(value, path);
}

function serializeWindow(context: PipelineContext): Record<string, string> {
  return {
    date: context.window.date,
    timeZone: context.window.timeZone,
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(path, value, "object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(path, value, "non-empty string");
  }
  return value;
}

function asStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw validationError(path, value, "array of non-empty strings");
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw validationError(path, value, "array");
  return value;
}

function asNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw validationError(path, value, "non-negative integer");
  }
  return value as number;
}

function validationError(
  path: string,
  value: unknown,
  expected: string,
): DraftResponseValidationError {
  return new DraftResponseValidationError(path, value, expected);
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function formatReceivedValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return String(value);
    const maximumLength = 500;
    return serialized.length <= maximumLength
      ? serialized
      : `${serialized.slice(0, maximumLength)}…`;
  } catch {
    return String(value);
  }
}
