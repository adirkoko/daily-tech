import type { APIRoute } from "astro";
import { openServerDatabase } from "../../../../server/database.js";
import { protectedForm } from "../../../../server/http.js";
export const prerender = false;
export const POST: APIRoute = async (context) => {
  const form = await protectedForm(context); if (form instanceof Response) return form;
  const rawId = context.params.id ?? "";
  const id = Number(rawId);
  if (!/^\d+$/u.test(rawId) || !Number.isSafeInteger(id) || id < 1) {
    return new Response("Invalid id", { status: 400 });
  }
  const db = await openServerDatabase();
  try {
    const occurredAt = new Date().toISOString();
    const resolved = db.operations.resolveTicket(id, occurredAt);
    if (resolved !== null) db.operations.appendLog({ eventType: "admin_feedback_resolved", level: "info", message: null, details: { ticketId: id }, occurredAt });
  } finally { db.close(); }
  return context.redirect(context.request.headers.get("referer")?.includes("/admin/alerts") ? "/admin/alerts" : "/admin/feedback", 303);
};
