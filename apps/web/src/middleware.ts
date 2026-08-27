import { defineMiddleware } from "astro:middleware";

import { ADMIN_COOKIE_NAME, authenticateCookie } from "./server/auth.js";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const adminRelated = path.startsWith("/admin") || path.startsWith("/api/admin");
  context.locals.adminSession = adminRelated
    ? await authenticateCookie(context.cookies.get(ADMIN_COOKIE_NAME)?.value)
    : null;

  const protectedPage = path.startsWith("/admin") && path !== "/admin/login";
  const protectedApi = path.startsWith("/api/admin") && path !== "/api/admin/login";
  if ((protectedPage || protectedApi) && context.locals.adminSession === null) {
    const response = protectedApi
      ? new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } })
      : context.redirect("/admin/login", 303);
    return applySecurityHeaders(response, adminRelated);
  }

  const response = await next();
  return applySecurityHeaders(response, adminRelated);
});

function applySecurityHeaders(response: Response, adminRelated: boolean): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (adminRelated) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    );
  }
  return response;
}
