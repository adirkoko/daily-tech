import type { APIRoute } from "astro";

import { getSiteSnapshot } from "../lib/content.js";
import { escapeXml } from "../lib/xml.js";

export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL("http://localhost:4321");
  const snapshot = await getSiteSnapshot();
  const months = [...new Set(snapshot.published.map(({ metadata }) => metadata.date.slice(0, 7)))];
  const paths = [
    "/",
    "/calendar",
    "/statistics",
    ...months.map((month) => `/calendar/${month}`),
    ...snapshot.published.map(({ metadata }) => `/daily/${metadata.date}`),
  ];
  const urls = paths.map((path) => `<url><loc>${escapeXml(new URL(path, origin).toString())}</loc></url>`).join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
