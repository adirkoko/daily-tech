import { isCalendarDate } from "@daily-tech/core";
import type { FeedbackTicket } from "@daily-tech/db";

const STAGES: Record<string, string> = {
  initialize: "הכנה", light_discovery: "איתור חדשות", gap_discovery: "השלמת מחקר",
  admin_keywords: "מחקר לפי מילות מפתח", keyword_research: "מחקר לפי מילות מפתח",
  keyword_discovery: "מחקר לפי מילות מפתח", draft_validation: "אימות הטיוטה",
  deep_research: "מחקר מעמיק", draft: "כתיבת התקציר", write: "כתיבת התקציר",
  validate: "אימות התוכן", persist: "שמירת התקציר",
};

/** Keep compatibility with existing tickets and preserve their raw diagnostics. */
export function presentAlert(ticket: FeedbackTicket) {
  const body = ticket.body;
  const parsedRunId = /^Run: ([^\r\n]+)$/mu.exec(body)?.[1]?.trim();
  const runId = parsedRunId && parsedRunId.length <= 200 ? parsedRunId : undefined;
  const stage = /^(?:Stage|Phase): ([^\r\n]+)$/mu.exec(body)?.[1]?.trim();
  const date = /for (\d{4}-\d{2}-\d{2})$/u.exec(ticket.title)?.[1];
  const briefDate = date && isCalendarDate(date) ? date : undefined;
  const knownTitle = /^(?:Daily brief(?: regeneration)?|Brief publication|Scheduled (?:generate|publish)) failed for /u.test(ticket.title);
  const title = knownTitle
    ? `${/publication|publish/u.test(ticket.title) ? "פרסום התקציר" : "יצירת התקציר"} נכשל${briefDate ? ` · ${briefDate}` : ""}`
    : ticket.title;
  const error = /^(?:Error|Scheduler error): (.*)$/mu.exec(body)?.[1]?.trim();
  let summary = error || body;
  if (error && /aborted or timed out/iu.test(error)) {
    summary = "הבקשה לספק ה־AI בוטלה או חרגה מזמן ההמתנה.";
  } else if (error && /HTTP 429/u.test(error)) {
    summary = "ספק ה־AI הגביל את קצב הבקשות. ההרצה הסתיימה ללא הצלחה.";
  } else if (error && /HTTP 5\d\d/u.test(error)) {
    summary = "ספק ה־AI החזיר שגיאת שרת. ההרצה הסתיימה ללא הצלחה.";
  }
  const params = new URLSearchParams();
  if (runId) params.set("runId", runId);
  else if (briefDate) params.set("date", briefDate);
  return {
    title, summary, briefDate, runId,
    stage: stage ? (Object.hasOwn(STAGES, stage) ? STAGES[stage] : stage) : undefined,
    logsHref: params.size ? `/admin/logs?${params}` : undefined,
  };
}
