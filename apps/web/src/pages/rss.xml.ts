import type { APIRoute } from "astro";

import { getSiteSnapshot } from "../lib/content.js";
import { escapeXml } from "../lib/xml.js";

export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL("http://localhost:4321");
  const snapshot = await getSiteSnapshot();
  const items = snapshot.published.slice(0, 30).map(({ metadata }) => {
    const url = new URL(`/daily/${metadata.date}`, origin).toString();
    const publishedAt = metadata.published_at ?? metadata.created_at;
    return `
      <item>
        <title>${escapeXml(`Daily Tech — ${metadata.date}`)}</title>
        <link>${escapeXml(url)}</link>
        <guid isPermaLink="true">${escapeXml(url)}</guid>
        <pubDate>${new Date(publishedAt).toUTCString()}</pubDate>
        <description>${escapeXml(metadata.summary)}</description>
      </item>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Daily Tech</title>
    <link>${escapeXml(origin.toString())}</link>
    <description>תמצית יומית בעברית של ההתפתחויות החשובות בטכנולוגיה.</description>
    <language>he-IL</language>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
