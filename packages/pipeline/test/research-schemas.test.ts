import { describe, expect, it } from "vitest";

import { WEB_GAP_RESEARCH_PROMPT, WEB_RESEARCH_PROMPT } from "../src/research/prompts.js";
import { GAP_RESPONSE_SCHEMA, RESEARCH_RESPONSE_SCHEMA } from "../src/research/schemas.js";

describe("research source publication contract", () => {
  it("uses the same precision-aware source schema for research and gap check", () => {
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
      "publishedAt",
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
    expect(researchSource.properties.publishedAt).toMatchObject({
      anyOf: [
        {
          type: "string",
          format: "date-time",
          pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$",
        },
        { type: "null" },
      ],
    });
  });

  it("gives research and gap check the same no-invented-time instructions", () => {
    for (const prompt of [WEB_RESEARCH_PROMPT, WEB_GAP_RESEARCH_PROMPT]) {
      expect(prompt).toContain("If only a publication date is known");
      expect(prompt).toContain("publishedOn to YYYY-MM-DD and publishedAt to null");
      expect(prompt).toContain("Never infer or invent a publication time");
      expect(prompt).toContain("cannot replace eventDateEvidence");
    }
  });
});
