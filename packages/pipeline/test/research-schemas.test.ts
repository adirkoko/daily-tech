import { describe, expect, it } from "vitest";

import { WEB_GAP_RESEARCH_PROMPT, WEB_RESEARCH_PROMPT } from "../src/research/prompts.js";
import { GAP_RESPONSE_SCHEMA, RESEARCH_RESPONSE_SCHEMA } from "../src/research/schemas.js";

describe("research date contract", () => {
  it("uses the same date-only source schema for research and gap check", () => {
    const researchSource = RESEARCH_RESPONSE_SCHEMA.properties.stories
      .items.properties.sources.items;
    const gapSource = GAP_RESPONSE_SCHEMA.properties.missingStories
      .items.properties.sources.items;

    expect(gapSource).toEqual(researchSource);
    expect(researchSource.required).toEqual([
      "url",
      "title",
      "publisher",
      "publishedOn",
      "type",
    ]);
    expect(researchSource.properties.publishedOn).toMatchObject({
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

  it("does not include occurredAt or publishedAt in the story schema", () => {
    const researchStory = RESEARCH_RESPONSE_SCHEMA.properties.stories.items;
    expect(researchStory.required).not.toContain("occurredAt");
    expect(researchStory.properties).not.toHaveProperty("occurredAt");
    const source = researchStory.properties.sources.items;
    expect(source.required).not.toContain("publishedAt");
    expect(source.properties).not.toHaveProperty("publishedAt");
  });

  it("gives research and gap check the same date-only, no-conversion instructions", () => {
    for (const prompt of [WEB_RESEARCH_PROMPT, WEB_GAP_RESEARCH_PROMPT]) {
      expect(prompt).toContain("occurredOn must be the exact calendar date of the supplied research window");
      expect(prompt).toContain("not converted or guessed from a different time zone");
      expect(prompt).toContain("If you cannot confidently place the event on that exact date, do not return the story at all");
      expect(prompt).toContain("publishedOn describes the source, not the event, and cannot replace eventDateEvidence");
    }
  });

  it("gives research and gap check the same source priority, tracked areas, and importance rubric", () => {
    for (const prompt of [WEB_RESEARCH_PROMPT, WEB_GAP_RESEARCH_PROMPT]) {
      expect(prompt).toContain("official company blogs and newsrooms");
      expect(prompt).toContain("official documentation");
      expect(prompt).toContain("GitHub and release-notes pages");
      expect(prompt).toContain("This is guidance, not an exhaustive whitelist");
      expect(prompt).toContain("OpenAI, Google, Anthropic, Microsoft, Apple, Meta, NVIDIA, Amazon, xAI, Hugging Face");
      expect(prompt).toContain("something available now ranks higher than something only announced or promised");
    }
    expect(WEB_RESEARCH_PROMPT).toContain("run at least one dedicated search per supplied category");
    expect(WEB_GAP_RESEARCH_PROMPT).toContain("Search broadly before concluding nothing is missing");
  });

  it("tells research to return full coverage, not a pre-curated brief-sized subset", () => {
    // Curating "final brief" size is the writer's job (see writing/prompts.ts); research
    // pre-narrowing to a guessed brief size was the actual cause of the model converging
    // on a small, inconsistent story count regardless of the maximumStories ceiling.
    expect(WEB_RESEARCH_PROMPT).toContain('Do not stop early because you feel you already have "enough for a brief."');
    expect(WEB_RESEARCH_PROMPT).toContain("not guessing how many items a daily brief should have");
  });

  it("rejects unconfirmed third-party reports in both research and gap check", () => {
    for (const prompt of [WEB_RESEARCH_PROMPT, WEB_GAP_RESEARCH_PROMPT]) {
      expect(prompt).toContain("Do not include a deal, acquisition, partnership, or other claim whose only basis is an unconfirmed third-party report");
      expect(prompt).toContain("If none of the parties directly involved have confirmed it, it does not qualify");
    }
  });
});
