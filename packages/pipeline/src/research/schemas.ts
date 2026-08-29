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

const storySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "factualSummary", "whyItMatters", "keyFacts", "availability",
    "category", "importance", "occurredOn", "eventDateEvidence",
    "companies", "topics", "sources",
  ],
  properties: {
    title: { type: "string" },
    factualSummary: { type: "string" },
    whyItMatters: { type: "string" },
    keyFacts: { type: "array", items: { type: "string" } },
    availability: nullableString,
    category: {
      type: "string",
      enum: ["ai", "developer_tools", "cloud", "open_source", "hardware", "robotics", "consumer_tech", "other"],
    },
    importance: { type: "integer", minimum: 1, maximum: 5 },
    occurredOn: { type: "string" },
    eventDateEvidence: {
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
    },
    companies: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    sources: { type: "array", minItems: 1, items: sourceSchema },
  },
} as const;

export const RESEARCH_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stories"],
  properties: {
    stories: { type: "array", items: storySchema },
  },
} as const;

export const GAP_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["missingStories"],
  properties: {
    missingStories: { type: "array", items: storySchema },
  },
} as const;
