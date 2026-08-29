const nonEmptyString = { type: "string", minLength: 1 } as const;
const nonEmptyStringArray = {
  type: "array",
  items: nonEmptyString,
} as const;
const nullableNonEmptyString = {
  anyOf: [nonEmptyString, { type: "null" }],
} as const;

const sourceCitationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url", "label"],
  properties: {
    url: nonEmptyString,
    label: nonEmptyString,
  },
} as const;

const sourceCitationArray = {
  type: "array",
  items: sourceCitationSchema,
} as const;

const storyIdArray = {
  type: "array",
  items: nonEmptyString,
  minItems: 1,
} as const;

const developmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "storyIds", "title", "whatChanged", "whyItMatters",
    "whatToDoWithIt", "availability", "sources",
  ],
  properties: {
    storyIds: storyIdArray,
    title: nonEmptyString,
    whatChanged: nonEmptyString,
    whyItMatters: nonEmptyString,
    whatToDoWithIt: nullableNonEmptyString,
    availability: nullableNonEmptyString,
    sources: sourceCitationArray,
  },
} as const;

const worthWatchingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["storyIds", "title", "note", "sources"],
  properties: {
    storyIds: storyIdArray,
    title: nonEmptyString,
    note: nonEmptyString,
    sources: sourceCitationArray,
  },
} as const;

export const BRIEF_DRAFT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["day_overview", "developments", "worth_watching", "bottom_line", "metadata"],
  properties: {
    day_overview: nonEmptyString,
    developments: { type: "array", items: developmentSchema },
    worth_watching: { type: "array", items: worthWatchingSchema },
    bottom_line: nonEmptyString,
    metadata: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "significant_items",
        "worth_watching_items",
        "day_intensity",
        "companies",
        "topics",
        "developments",
      ],
      properties: {
        summary: nonEmptyString,
        significant_items: { type: "integer", minimum: 0 },
        worth_watching_items: { type: "integer", minimum: 0 },
        day_intensity: {
          type: "string",
          enum: ["minimal", "low", "medium", "high", "extreme"],
        },
        companies: nonEmptyStringArray,
        topics: nonEmptyStringArray,
        developments: nonEmptyStringArray,
      },
    },
  },
} as const;
