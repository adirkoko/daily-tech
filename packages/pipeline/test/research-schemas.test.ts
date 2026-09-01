import { describe, expect, it } from "vitest";

import { WEB_DEEP_RESEARCH_PROMPT, WEB_FOCUSED_DISCOVERY_PROMPT, WEB_LIGHT_DISCOVERY_PROMPT } from "../src/research/prompts.js";
import {
  buildDeepResearchResponseSchema,
  DISCOVERY_RESPONSE_SCHEMA,
  FOCUSED_DISCOVERY_RESPONSE_SCHEMA,
} from "../src/research/schemas.js";

describe("discovery date contract", () => {
  it("uses the same date-only source schema for light and focused discovery", () => {
    const lightSource = DISCOVERY_RESPONSE_SCHEMA.properties.stories
      .items.properties.sources.items;
    const focusedSource = FOCUSED_DISCOVERY_RESPONSE_SCHEMA.properties.missingStories
      .items.properties.sources.items;

    expect(focusedSource).toEqual(lightSource);
    expect(lightSource.required).toEqual([
      "url",
      "title",
      "publisher",
      "publishedOn",
      "type",
    ]);
    expect(lightSource.properties.publishedOn).toMatchObject({
      anyOf: [
        {
          type: "string",
          format: "date",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        { type: "null" },
      ],
    });
  });

  it("keeps the candidate shape light — no occurredAt, no deep-research fields", () => {
    const story = DISCOVERY_RESPONSE_SCHEMA.properties.stories.items;
    expect(story.required).toEqual([
      "title", "shortSummary", "category", "importance",
      "occurredOn", "eventDateEvidence", "companies", "topics", "sources",
    ]);
    expect(story.properties).not.toHaveProperty("occurredAt");
    expect(story.properties).not.toHaveProperty("pricing");
    expect(story.properties).not.toHaveProperty("technicalDetails");
    const source = story.properties.sources.items;
    expect(source.required).not.toContain("publishedAt");
    expect(source.properties).not.toHaveProperty("publishedAt");
  });

  it("gives light and focused discovery the same date-only, no-conversion instructions", () => {
    for (const prompt of [WEB_LIGHT_DISCOVERY_PROMPT, WEB_FOCUSED_DISCOVERY_PROMPT]) {
      expect(prompt).toContain("occurredOn must be the exact calendar date of the supplied research window");
      expect(prompt).toContain("not converted or guessed from a different time zone");
      expect(prompt).toContain("If you cannot confidently place the event on that exact date, do not return the story at all");
      expect(prompt).toContain("publishedOn describes the source, not the event, and cannot replace eventDateEvidence");
    }
  });

  it("gives light and focused discovery the same source priority, tracked areas, and importance rubric", () => {
    for (const prompt of [WEB_LIGHT_DISCOVERY_PROMPT, WEB_FOCUSED_DISCOVERY_PROMPT]) {
      expect(prompt).toContain("official company blogs and newsrooms");
      expect(prompt).toContain("official documentation");
      expect(prompt).toContain("GitHub and release-notes pages");
      expect(prompt).toContain("This is guidance, not an exhaustive whitelist");
      expect(prompt).toContain("OpenAI, Google, Anthropic, Microsoft, Apple, Meta, NVIDIA, Amazon, xAI, Hugging Face");
      expect(prompt).toContain("something available now ranks higher than something only announced or promised");
    }
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("run at least one dedicated search per supplied category");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("Search broadly before concluding nothing is missing");
  });

  it("tells light discovery to return full coverage, not a pre-curated brief-sized subset", () => {
    // Curating final size is later work (selection stays with the model during deep
    // research, then the writer) — discovery pre-narrowing to a guessed brief size was
    // the original cause of the model converging on a small, inconsistent story count.
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain('Do not stop early because you feel you already have "enough for a brief."');
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("Deciding the edition's final size and composition happens later, downstream");
  });

  it("keeps light discovery shallow: a short factual summary, not full analysis", () => {
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("a shortSummary of one or two factual sentences");
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("Do not write extended analysis");
  });

  it("makes focus keywords attention, never an inclusion requirement", () => {
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("a keyword only earns your attention, never a requirement to return something for it");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("do not invent, pad, or lower your bar to produce an entry just because a keyword is being watched");
  });

  it("rejects unconfirmed third-party reports in both light and focused discovery", () => {
    for (const prompt of [WEB_LIGHT_DISCOVERY_PROMPT, WEB_FOCUSED_DISCOVERY_PROMPT]) {
      expect(prompt).toContain("Do not include a deal, acquisition, partnership, or other claim whose only basis is an unconfirmed third-party report");
      expect(prompt).toContain("If none of the parties directly involved have confirmed it, it does not qualify");
    }
  });
});

/** `buildDeepResearchResponseSchema` deliberately returns a widened
 *  `Readonly<Record<string, unknown>>` (it crosses into the AI client as a plain
 *  JSON Schema object) — this local shape is only for introspecting it in tests. */
interface JsonSchemaObjectShape {
  readonly properties: {
    readonly stories: {
      readonly maxItems: number;
      readonly items: { readonly required: readonly string[]; readonly properties: Record<string, unknown> };
    };
  };
}

function asSchemaShape(schema: Readonly<Record<string, unknown>>): JsonSchemaObjectShape {
  return schema as unknown as JsonSchemaObjectShape;
}

describe("deep research response schema", () => {
  it("bakes the operator's maximumStories in as the schema-level ceiling", () => {
    const schema = asSchemaShape(buildDeepResearchResponseSchema(8));
    expect(schema.properties.stories.maxItems).toBe(8);
  });

  it("produces an independent ceiling per call — building again does not mutate the previous schema", () => {
    const narrow = asSchemaShape(buildDeepResearchResponseSchema(3));
    const wide = asSchemaShape(buildDeepResearchResponseSchema(12));

    expect(narrow.properties.stories.maxItems).toBe(3);
    expect(wide.properties.stories.maxItems).toBe(12);
  });

  it("requires the full dossier shape, not the light candidate shape", () => {
    const schema = asSchemaShape(buildDeepResearchResponseSchema(8));
    const story = schema.properties.stories.items;
    expect(story.required).toEqual([
      "candidateId", "title", "whatHappened", "whatChangedFromBefore", "technicalDetails",
      "capabilities", "pricing", "availability", "rollout", "supportedUsersOrPlatforms",
      "limitations", "whoIsAffected", "whyItMatters", "whatToDoWithItNow",
      "category", "importance", "occurredOn", "eventDateEvidence",
      "companies", "topics", "sources",
    ]);
    expect(story.properties).not.toHaveProperty("shortSummary");
  });

  it("tells the model the ceiling is guidance for selection, never a quota to pad toward", () => {
    expect(WEB_DEEP_RESEARCH_PROMPT).toContain("a guidance ceiling, maximumStories, on how many candidates are worth a place");
    expect(WEB_DEEP_RESEARCH_PROMPT).toContain("Never pad the list to reach maximumStories when fewer candidates actually deserve full research");
  });
});
