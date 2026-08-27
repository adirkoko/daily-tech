import type { DayMetadata } from "@daily-tech/core";

export function createMetadata(
  overrides: Partial<DayMetadata> = {},
): DayMetadata {
  return {
    date: "2026-08-27",
    summary: "יום פעיל עם מספר התפתחויות חשובות.",
    significant_items: 2,
    worth_watching_items: 1,
    day_intensity: "high",
    companies: ["OpenAI", "Google"],
    topics: ["AI models", "Developer tools"],
    developments: ["מודל חדש הושק", "כלי פיתוח קיבל עדכון"],
    status: "ready",
    source_count: 8,
    created_at: "2026-08-28T01:42:10.000Z",
    published_at: null,
    updated_at: null,
    ...overrides,
  };
}
