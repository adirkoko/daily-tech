import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

const siteUrl = new URL(process.env.SITE_URL ?? "http://localhost:4321");
if (!["http:", "https:"].includes(siteUrl.protocol)
  || siteUrl.username !== ""
  || siteUrl.password !== ""
  || siteUrl.pathname !== "/"
  || siteUrl.search !== ""
  || siteUrl.hash !== "") {
  throw new Error("SITE_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.");
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone", bodySizeLimit: 300 * 1024 }),
  session: false,
  site: siteUrl.origin,
  security: {
    checkOrigin: true,
    allowedDomains: [
      {
        protocol: siteUrl.protocol.slice(0, -1),
        hostname: siteUrl.hostname,
        ...(siteUrl.port ? { port: siteUrl.port } : {}),
      },
    ],
  },
  trailingSlash: "never",
  vite: {
    plugins: [tailwindcss()],
  },
});
