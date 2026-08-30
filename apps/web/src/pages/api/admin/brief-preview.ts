import type { APIRoute } from "astro";

import { renderMarkdown } from "../../../lib/content.js";
import { field, protectedForm } from "../../../server/http.js";

export const prerender = false;

/** Server-side Markdown preview for the brief editor. Reuses the exact sanitize
 * pipeline the public site uses, so the editor sees precisely what readers get. */
export const POST: APIRoute = async (context) => {
  const form = await protectedForm(context);
  if (form instanceof Response) return form;

  const html = await renderMarkdown(field(form, "markdown", 250_000));
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
