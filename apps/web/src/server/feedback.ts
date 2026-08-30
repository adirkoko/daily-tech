export const FEEDBACK_FORM_LIMITS = {
  titleCharacters: 50,
  nameCharacters: 24,
  bodyCharacters: 1_500,
  bodyLines: 20,
} as const;

const FEEDBACK_CATEGORIES = ["general", "correction", "suggestion"] as const;
const LINE_BREAK_PATTERN = /[\r\n\u0085\u2028\u2029]/u;
const LINE_SPLIT_PATTERN = /\r\n|[\r\n\u0085\u2028\u2029]/u;

export type PublicFeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface PublicFeedbackSubmission {
  readonly title: string;
  readonly name: string | null;
  readonly category: PublicFeedbackCategory;
  readonly body: string;
}

export function parsePublicFeedback(form: FormData): PublicFeedbackSubmission {
  const rawTitle = textField(form, "title");
  const rawName = textField(form, "name");
  const rawBody = textField(form, "body");
  const category = textField(form, "category");

  assertMaximumLength(rawTitle, FEEDBACK_FORM_LIMITS.titleCharacters, `הכותרת יכולה להכיל עד ${FEEDBACK_FORM_LIMITS.titleCharacters} תווים.`);
  assertMaximumLength(rawName, FEEDBACK_FORM_LIMITS.nameCharacters, `השם יכול להכיל עד ${FEEDBACK_FORM_LIMITS.nameCharacters} תווים.`);
  assertMaximumLength(rawBody, FEEDBACK_FORM_LIMITS.bodyCharacters, `ההודעה יכולה להכיל עד ${FEEDBACK_FORM_LIMITS.bodyCharacters} תווים.`);
  assertSingleLine(rawTitle, "הכותרת חייבת להיות בשורה אחת.");
  assertSingleLine(rawName, "השם חייב להיות בשורה אחת.");

  const title = rawTitle.trim();
  const name = rawName.trim();
  const body = rawBody.trim();
  if (title.length === 0 || body.length === 0) {
    throw new TypeError("יש למלא את כל שדות החובה.");
  }
  if (!isFeedbackCategory(category)) {
    throw new TypeError("קטגוריית הפידבק אינה תקינה.");
  }
  if (countLines(body) > FEEDBACK_FORM_LIMITS.bodyLines) {
    throw new TypeError(`ההודעה יכולה להכיל עד ${FEEDBACK_FORM_LIMITS.bodyLines} שורות.`);
  }

  return { title, name: name.length === 0 ? null : name, category, body };
}

export function countFeedbackLines(value: string): number {
  return countLines(value);
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new TypeError("טופס יצירת הקשר אינו תקין.");
  return value;
}

function assertMaximumLength(value: string, maximum: number, message: string): void {
  if (value.length > maximum) throw new TypeError(message);
}

function assertSingleLine(value: string, message: string): void {
  if (LINE_BREAK_PATTERN.test(value)) throw new TypeError(message);
}

function countLines(value: string): number {
  return value.split(LINE_SPLIT_PATTERN).length;
}

function isFeedbackCategory(value: string): value is PublicFeedbackCategory {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}
