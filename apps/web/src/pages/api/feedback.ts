import type { APIRoute } from "astro";
import { callerHash, fixedWindowStart } from "../../server/auth.js";
import { getServerConfig } from "../../server/config.js";
import { openServerDatabase } from "../../server/database.js";
import { callerAddress, field, redirectWith, sameOrigin } from "../../server/http.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return new Response("Forbidden", { status: 403 });
  try {
    const form = await context.request.formData();
    const title = field(form, "title", 120).trim();
    const name = field(form, "name", 80).trim();
    const body = field(form, "body", 4_000).trim();
    const category = field(form, "category", 20);
    if (!title || !body || !["general", "correction", "suggestion"].includes(category)) {
      throw new TypeError("יש למלא את כל שדות החובה.");
    }
    if (body.split(/\r?\n/u).length > 80) throw new TypeError("ההודעה ארוכה מדי.");

    const now = new Date();
    const occurredAt = now.toISOString();
    const config = getServerConfig();
    const db = await openServerDatabase();
    try {
      const rate = db.operations.consumeRateLimit({
        scope: "feedback",
        keyHash: callerHash(callerAddress(context)),
        windowStartedAt: fixedWindowStart(now, config.feedbackWindowMs),
        occurredAt,
        limit: 3,
      });
      if (!rate.allowed) {
        return redirectWith("/feedback", "error", "הגעת למגבלת השליחות. אפשר לנסות שוב מאוחר יותר.");
      }
      db.operations.createTicket({
        title,
        submitterName: name || null,
        category: category as "general" | "correction" | "suggestion",
        body,
        createdAt: occurredAt,
      });
      db.operations.appendLog({
        eventType: "feedback_submitted",
        level: "info",
        message: null,
        details: { category },
        occurredAt,
      });
    } finally { db.close(); }
    return redirectWith("/feedback", "success", "הפידבק התקבל. תודה!");
  } catch (error) {
    return redirectWith("/feedback", "error", error instanceof Error ? error.message : "השליחה נכשלה.");
  }
};
