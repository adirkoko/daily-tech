import { describe, expect, it } from "vitest";

import {
  FEEDBACK_FORM_LIMITS,
  countFeedbackLines,
  parsePublicFeedback,
} from "./feedback.js";

function form(overrides: Readonly<Record<string, string>> = {}): FormData {
  const data = new FormData();
  const values = {
    title: "הצעה קצרה",
    name: "ישראל ישראלי",
    category: "suggestion",
    body: "שורה ראשונה\nשורה שנייה",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

describe("public feedback validation", () => {
  it("normalizes and accepts a valid submission", () => {
    expect(parsePublicFeedback(form({ title: "  כותרת  ", name: "  שם  " }))).toEqual({
      title: "כותרת",
      name: "שם",
      category: "suggestion",
      body: "שורה ראשונה\nשורה שנייה",
    });
  });

  it.each([
    ["title", "כותרת\nנוספת", "הכותרת חייבת להיות בשורה אחת."],
    ["name", "שם\u2028נוסף", "השם חייב להיות בשורה אחת."],
  ])("rejects line breaks in %s", (field, value, message) => {
    expect(() => parsePublicFeedback(form({ [field]: value }))).toThrow(message);
  });

  it.each([
    ["title", FEEDBACK_FORM_LIMITS.titleCharacters, "הכותרת יכולה"],
    ["name", FEEDBACK_FORM_LIMITS.nameCharacters, "השם יכול"],
    ["body", FEEDBACK_FORM_LIMITS.bodyCharacters, "ההודעה יכולה"],
  ])("enforces the %s character limit", (field, maximum, prefix) => {
    expect(() => parsePublicFeedback(form({ [field]: "א".repeat(maximum) }))).not.toThrow();
    expect(() => parsePublicFeedback(form({ [field]: "א".repeat(maximum + 1) }))).toThrow(
      `${prefix} להכיל עד ${maximum} תווים.`,
    );
  });

  it("counts common and Unicode line separators and rejects too many body lines", () => {
    expect(countFeedbackLines("א\r\nב\u2028ג\u2029ד\u0085ה")).toBe(5);
    const validBody = Array.from({ length: FEEDBACK_FORM_LIMITS.bodyLines }, () => "שורה").join("\n");
    expect(() => parsePublicFeedback(form({ body: validBody }))).not.toThrow();
    expect(() => parsePublicFeedback(form({ body: `${validBody}\nחריגה` }))).toThrow(
      `ההודעה יכולה להכיל עד ${FEEDBACK_FORM_LIMITS.bodyLines} שורות.`,
    );
  });

  it("keeps the name optional", () => {
    expect(parsePublicFeedback(form({ name: "   " })).name).toBeNull();
  });
});
