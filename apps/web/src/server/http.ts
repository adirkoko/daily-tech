import type { APIContext } from "astro";

import { verifyCsrf } from "./auth.js";

export function sameOrigin(context: APIContext): boolean {
  const origin = context.request.headers.get("origin");
  return origin !== null && origin === context.url.origin;
}

export async function protectedForm(context: APIContext): Promise<FormData | Response> {
  if (!sameOrigin(context)) return new Response("Forbidden", { status: 403 });
  const form = await context.request.formData();
  if (!verifyCsrf(context.locals.adminSession, form.get("csrf_token"))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  return form;
}

export function redirectWith(path: string, key: "error" | "success", message: string): Response {
  const url = new URL(path, "http://internal");
  url.searchParams.set(key, message);
  return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}` } });
}

export function field(form: FormData, name: string, maximum = 10_000): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.length > maximum) throw new TypeError(`${name} is invalid.`);
  return value;
}

export function integerField(form: FormData, name: string): number {
  const value = Number(field(form, name, 20));
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer.`);
  return value;
}
