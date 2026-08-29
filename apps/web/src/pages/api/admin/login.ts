import type { APIRoute } from "astro";

import { ADMIN_COOKIE_NAME, callerHash, cookieOptions, createAdminSession, fixedWindowStart, verifyAdminPassword } from "../../../server/auth.js";
import { getServerConfig } from "../../../server/config.js";
import { openServerDatabase } from "../../../server/database.js";
import { callerAddress, field, redirectWith, sameOrigin } from "../../../server/http.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!sameOrigin(context)) return new Response("Forbidden", { status: 403 });
  const form = await context.request.formData();
  const password = field(form, "password", 1_024);
  const now = new Date();
  const config = getServerConfig();
  const address = callerAddress(context);
  const db = await openServerDatabase();
  let rate;
  try {
    rate = db.operations.consumeRateLimit({ scope: "admin_login", keyHash: callerHash(address), windowStartedAt: fixedWindowStart(now, config.loginWindowMs), occurredAt: now.toISOString(), limit: 3 });
  } finally { db.close(); }
  const valid = rate.allowed && verifyAdminPassword(password);
  const logDb = await openServerDatabase();
  try {
    logDb.operations.appendLog({ eventType: valid ? "admin_login_succeeded" : "admin_login_failed", level: valid ? "info" : "warning", message: null, details: { rateLimited: !rate.allowed }, occurredAt: new Date().toISOString() });
  } finally { logDb.close(); }
  if (!valid) return redirectWith("/admin/login", "error", "הסיסמה שגויה או שמספר הניסיונות הוגבל.");
  const session = await createAdminSession();
  context.cookies.set(ADMIN_COOKIE_NAME, session.cookieValue, cookieOptions());
  return context.redirect("/admin", 303);
};
