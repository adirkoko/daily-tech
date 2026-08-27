import type { APIRoute } from "astro";
import { LATEST_SCHEMA_VERSION } from "@daily-tech/db";

import { openServerDatabase } from "../server/database.js";
import { schedulerSnapshot } from "../server/scheduler.js";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const database = await openServerDatabase();
    let schemaVersion: number;
    try { schemaVersion = database.schemaVersion; } finally { database.close(); }
    if (schemaVersion !== LATEST_SCHEMA_VERSION) {
      throw new Error("Database schema is not current.");
    }
    const scheduler = schedulerSnapshot();
    return json({
      status: "ready",
      database: "ready",
      scheduler: scheduler.enabled ? "enabled" : "disabled",
    });
  } catch {
    return json({ status: "not_ready" }, 503);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
