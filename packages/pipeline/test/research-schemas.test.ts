import { describe, expect, it } from "vitest";

import {
  WEB_DEEP_RESEARCH_PROMPT,
  WEB_FOCUSED_DISCOVERY_PROMPT,
  WEB_LIGHT_DISCOVERY_PROMPT,
} from "../src/research/prompts.js";
import {
  buildDeepResearchResponseSchema,
  buildDiscoveryResponseSchema,
  buildFocusedDiscoveryResponseSchema,
} from "../src/research/schemas.js";

interface ArraySchema {
  readonly maxItems?: number;
  readonly items: ObjectSchema;
}

interface ObjectSchema {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

interface ResponseSchema {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, ArraySchema>>;
}

function asResponseSchema(schema: Readonly<Record<string, unknown>>): ResponseSchema {
  return schema as unknown as ResponseSchema;
}

function candidateStorySchema(property: "stories" | "missingStories"): ObjectSchema {
  const schema = property === "stories"
    ? buildDiscoveryResponseSchema(20)
    : buildFocusedDiscoveryResponseSchema(20);
  return asResponseSchema(schema).properties[property]!.items;
}

describe("web-research contracts", () => {
  it("uses provider-backed URLs and permits source-level rejection only when evidence survives", () => {
    for (const prompt of [
      WEB_LIGHT_DISCOVERY_PROMPT,
      WEB_FOCUSED_DISCOVERY_PROMPT,
      WEB_DEEP_RESEARCH_PROMPT,
    ]) {
      expect(prompt).toContain("machine-readable provider citations/sources");
      expect(prompt).toContain("never return a URL from memory, prior knowledge");
      expect(prompt).toContain("Omit any sources[] entry whose URL is not eligible");
      expect(prompt).toContain("eventDateEvidence.sourceUrl points to an eligible source that remains");
      expect(prompt).toContain("Otherwise omit the entire story");
    }
  });

  it("uses the same date-only source schema for light and focused discovery", () => {
    const lightSource = candidateStorySchema("stories").properties.sources as ArraySchema;
    const focusedSource = candidateStorySchema("missingStories").properties.sources as ArraySchema;

    expect(focusedSource).toEqual(lightSource);
    expect(lightSource.items.required).toEqual([
      "url",
      "title",
      "publisher",
      "publishedOn",
      "type",
    ]);
    expect(lightSource.items.properties.publishedOn).toMatchObject({
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

  it("keeps discovery candidates shallow and enforces each call's hard limit in JSON Schema", () => {
    const narrow = asResponseSchema(buildDiscoveryResponseSchema(4));
    const wide = asResponseSchema(buildFocusedDiscoveryResponseSchema(11));
    const story = narrow.properties.stories!.items;

    expect(narrow.properties.stories!.maxItems).toBe(4);
    expect(wide.properties.missingStories!.maxItems).toBe(11);
    expect(story.required).toEqual([
      "title", "shortSummary", "category", "importance",
      "occurredOn", "eventDateEvidence", "companies", "topics", "sources",
    ]);
    expect(story.properties).not.toHaveProperty("occurredAt");
    expect(story.properties).not.toHaveProperty("pricing");
    expect(story.properties).not.toHaveProperty("technicalDetails");
  });

  it("defines event dates in Israel time and allows reliable time-zone conversion", () => {
    for (const prompt of [
      WEB_LIGHT_DISCOVERY_PROMPT,
      WEB_FOCUSED_DISCOVERY_PROMPT,
      WEB_DEEP_RESEARCH_PROMPT,
    ]) {
      expect(prompt).toContain("event's calendar date in Asia/Jerusalem");
      expect(prompt).toContain("reliably converting an explicit source timestamp from another time zone");
      expect(prompt).toContain("never substitute an article's publication date");
      expect(prompt).toContain("publishedOn is source metadata, not event-date evidence");
    }
  });

  it("uses broad primary-source authority rather than requiring company confirmation", () => {
    for (const prompt of [WEB_LIGHT_DISCOVERY_PROMPT, WEB_DEEP_RESEARCH_PROMPT]) {
      expect(prompt).toContain("regulatory notices and filings");
      expect(prompt).toContain("court records");
      expect(prompt).toContain("research papers");
      expect(prompt).toContain("security advisories");
      expect(prompt).toContain("standards-body publications");
      expect(prompt).toContain("can establish a fact even when a company has not published its own announcement");
      expect(prompt).toContain('anonymous "sources say" reports');
    }
  });

  it("defines a concrete 1-5 importance rubric in all research stages", () => {
    for (const prompt of [
      WEB_LIGHT_DISCOVERY_PROMPT,
      WEB_FOCUSED_DISCOVERY_PROMPT,
      WEB_DEEP_RESEARCH_PROMPT,
    ]) {
      expect(prompt).toContain("1 — routine, narrow, incremental");
      expect(prompt).toContain("3 — meaningful to a defined technology audience");
      expect(prompt).toContain("5 — exceptional, field-shaping development");
      expect(prompt).toContain("Return only items at or above minimumImportance");
    }
  });

  it("keeps company and topic metadata scoped to each event across all research passes", () => {
    for (const prompt of [
      WEB_LIGHT_DISCOVERY_PROMPT,
      WEB_FOCUSED_DISCOVERY_PROMPT,
      WEB_DEEP_RESEARCH_PROMPT,
    ]) {
      expect(prompt).toContain("classification metadata for the event itself");
      expect(prompt).toContain("never names mentioned only in passing");
      expect(prompt).toContain("merely because they published a source");
      expect(prompt).toContain("Prefer the parent company");
      expect(prompt).toContain("short, established English topic categories");
    }
  });

  it("keeps light discovery broad but shallow and makes Techmeme optional", () => {
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("Be broad across the landscape, but shallow per candidate");
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("not as a requirement to issue one mechanical query per category");
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("Techmeme may be used as an optional discovery aid");
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("maximumCandidatesPerCall is a hard upper limit");
    expect(WEB_LIGHT_DISCOVERY_PROMPT).toContain("preserving sensible coverage across materially different areas");
  });

  it("keeps focused discovery narrow and keywords attention-only", () => {
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("answer only this question");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("A keyword is never an inclusion requirement");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("perform an adaptive cross-domain scan broad enough to detect significant omissions");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("do not reduce the general gap check to one narrow follow-up query");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain("Do not critique the existing stories, draft, wording, structure, metadata, or editorial choices");
    expect(WEB_FOCUSED_DISCOVERY_PROMPT).toContain('{"missingStories":[]}');
  });
});

describe("deep research response schema", () => {
  it("enforces maximumStories and requires explicit exclusions", () => {
    const schema = asResponseSchema(buildDeepResearchResponseSchema(8));
    expect(schema.required).toEqual(["stories", "excludedCandidates"]);
    expect(schema.properties.stories!.maxItems).toBe(8);
    expect(schema.properties.excludedCandidates!.items.required).toEqual(["candidateId", "reason"]);
    expect(
      (schema.properties.excludedCandidates!.items.properties.reason as { readonly enum: readonly string[] }).enum,
    ).toEqual([
      "insufficient_evidence",
      "outside_window",
      "duplicate",
      "below_importance_threshold",
      "lower_priority_than_selected",
      "no_eligible_citation",
      "other",
    ]);
  });

  it("produces independent limits without mutating an earlier schema", () => {
    const narrow = asResponseSchema(buildDeepResearchResponseSchema(3));
    const wide = asResponseSchema(buildDeepResearchResponseSchema(12));
    expect(narrow.properties.stories!.maxItems).toBe(3);
    expect(wide.properties.stories!.maxItems).toBe(12);
  });

  it("requires the full dossier shape", () => {
    const story = asResponseSchema(buildDeepResearchResponseSchema(8)).properties.stories!.items;
    expect(story.required).toEqual([
      "candidateId", "title", "whatHappened", "whatChangedFromBefore", "technicalDetails",
      "capabilities", "pricing", "availability", "rollout", "supportedUsersOrPlatforms",
      "limitations", "whoIsAffected", "whyItMatters", "whatToDoWithItNow",
      "category", "importance", "occurredOn", "eventDateEvidence",
      "companies", "topics", "sources",
    ]);
    expect(story.properties).not.toHaveProperty("shortSummary");
  });

  it("makes the story ceiling hard and accounts for every candidate exactly once", () => {
    expect(WEB_DEEP_RESEARCH_PROMPT).toContain("maximumStories is a hard upper limit, not a target");
    expect(WEB_DEEP_RESEARCH_PROMPT).toContain("Every supplied candidateId must appear exactly once");
    expect(WEB_DEEP_RESEARCH_PROMPT).toContain("either in stories or in excludedCandidates");
    expect(WEB_DEEP_RESEARCH_PROMPT).toContain("Stop researching a candidate once its event, event date, central claims, and necessary context are adequately verified");
  });
});
