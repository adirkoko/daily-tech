import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone", bodySizeLimit: 300 * 1024 }),
  session: false,
  site: process.env.SITE_URL ?? "http://localhost:4321",
  trailingSlash: "never",
  vite: {
    plugins: [tailwindcss()],
  },
});
