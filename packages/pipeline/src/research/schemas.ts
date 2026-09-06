const nullableString = { type: ["string", "null"] } as const;

const nullableCalendarDate = {
  anyOf: [
    {
      type: "string",
      format: "date",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    },
    { type: "null" },
  ],
} as const;

const sourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url", "title", "publisher", "publishedOn", "type"],
  properties: {
    url: { type: "string" },
    title: { type: "string" },
    publisher: { type: "string" },
    publishedOn: nullableCalendarDate,
    type: {
      type: "string",
      enum: ["official_blog", "official_docs", "github", "release_notes", "journalism", "other"],
    },
  },
} as const;

const eventDateEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["eventDate", "kind", "sourceUrl", "explanation"],
  properties: {
    eventDate: { type: "string" },
    kind: {
      type: "string",
      enum: ["explicit_event_date", "official_announcement_date", "release_effective_date"],
    },
    sourceUrl: { type: "string" },
    explanation: { type: "string" },
  },
} as const;

const categorySchema = {
  type: "string",
  enum: ["ai", "developer_tools", "cloud", "open_source", "hardware", "robotics", "consumer_tech", "other"],
} as const;

const exclusionReasonSchema = {
  type: "string",
  enum: [
    "insufficient_evidence",
    "outside_window",
    "duplicate",
    "below_importance_threshold",
    "lower_priority_than_selected",
    "no_eligible_citation",
    "other",
  ],
} as const;

/** The light shape used by discovery, gap, and admin-keyword-focused research. */
const candidateStorySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "shortSummary", "category", "importance",
    "occurredOn", "eventDateEvidence", "companies", "topics", "sources",
  ],
  properties: {
    title: { type: "string" },
    shortSummary: { type: "string" },
    category: categorySchema,
    importance: { type: "integer", minimum: 1, maximum: 5 },
    occurredOn: { type: "string" },
    eventDateEvidence: eventDateEvidenceSchema,
    companies: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    sources: { type: "array", minItems: 1, items: sourceSchema },
  },
} as const;

export function buildDiscoveryResponseSchema(
  maximumCandidates: number,
): Readonly<Record<string, unknown>> {
  return buildCandidateResponseSchema("stories", maximumCandidates);
}

export function buildFocusedDiscoveryResponseSchema(
  maximumCandidates: number,
): Readonly<Record<string, unknown>> {
  return buildCandidateResponseSchema("missingStories", maximumCandidates);
}

/** The rich dossier Deep Research produces for each candidate it keeps. */
const deepResearchedStorySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidateId", "title", "whatHappened", "whatChangedFromBefore", "technicalDetails",
    "capabilities", "pricing", "availability", "rollout", "supportedUsersOrPlatforms",
    "limitations", "whoIsAffected", "whyItMatters", "whatToDoWithItNow",
    "category", "importance", "occurredOn", "eventDateEvidence",
    "companies", "topics", "sources",
  ],
  properties: {
    candidateId: { type: "string" },
    title: { type: "string" },
    whatHappened: { type: "string" },
    whatChangedFromBefore: nullableString,
    technicalDetails: nullableString,
    capabilities: nullableString,
    pricing: nullableString,
    availability: nullableString,
    rollout: nullableString,
    supportedUsersOrPlatforms: nullableString,
    limitations: nullableString,
    whoIsAffected: nullableString,
    whyItMatters: { type: "string" },
    whatToDoWithItNow: nullableString,
    category: categorySchema,
    importance: { type: "integer", minimum: 1, maximum: 5 },
    occurredOn: { type: "string" },
    eventDateEvidence: eventDateEvidenceSchema,
    companies: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    sources: { type: "array", minItems: 1, items: sourceSchema },
  },
} as const;

/**
 * Built per request because the response's own `maxItems` enforces the operator's
 * `maximumStories` ceiling at the schema level — the strongest guarantee available,
 * ahead of the defensive code-level check in story-validation.ts.
 */
export function buildDeepResearchResponseSchema(
  maximumStories: number,
): Readonly<Record<string, unknown>> {
  assertNonNegativeInteger(maximumStories, "maximumStories");
  return {
    type: "object",
    additionalProperties: false,
    required: ["stories", "excludedCandidates"],
    properties: {
      stories: { type: "array", maxItems: maximumStories, items: deepResearchedStorySchema },
      excludedCandidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["candidateId", "reason"],
          properties: {
            candidateId: { type: "string" },
            reason: exclusionReasonSchema,
          },
        },
      },
    },
  } as const;
}

function buildCandidateResponseSchema(
  property: "stories" | "missingStories",
  maximumCandidates: number,
): Readonly<Record<string, unknown>> {
  assertNonNegativeInteger(maximumCandidates, "maximumCandidates");
  return {
    type: "object",
    additionalProperties: false,
    required: [property],
    properties: {
      [property]: {
        type: "array",
        maxItems: maximumCandidates,
        items: candidateStorySchema,
      },
    },
  } as const;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}
