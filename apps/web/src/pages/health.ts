import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () => json({ status: "ok" });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
