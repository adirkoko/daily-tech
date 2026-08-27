import type { APIRoute } from "astro";
import { ADMIN_COOKIE_NAME, cookieOptions, revokeAdminSession } from "../../../server/auth.js";
import { protectedForm } from "../../../server/http.js";
export const prerender = false;
export const POST: APIRoute = async (context) => {
  const form = await protectedForm(context); if (form instanceof Response) return form;
  if (context.locals.adminSession) await revokeAdminSession(context.locals.adminSession);
  context.cookies.delete(ADMIN_COOKIE_NAME, cookieOptions());
  return context.redirect("/admin/login", 303);
};
