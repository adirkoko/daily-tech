import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: process.env.SITE_URL ?? "http://localhost:4321",
  trailingSlash: "never",
  vite: {
    plugins: [tailwindcss()],
  },
});
