import type { APIRoute } from "astro";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("/sitemap.xml", site ?? new URL("http://localhost:4321"));
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${sitemap.toString()}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
