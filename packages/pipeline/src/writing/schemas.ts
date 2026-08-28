const nonEmptyString = { type: "string", minLength: 1 } as const;
const nonEmptyStringArray = {
  type: "array",
  items: nonEmptyString,
} as const;

export const BRIEF_DRAFT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["markdown", "included_story_ids", "metadata"],
  properties: {
    markdown: nonEmptyString,
    included_story_ids: nonEmptyStringArray,
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
