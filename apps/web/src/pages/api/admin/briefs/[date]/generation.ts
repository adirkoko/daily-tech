import type { APIRoute } from "astro";
import { isCalendarDate } from "@daily-tech/core";

import { loadAdminBriefGenerationInfo } from "../../../../../server/admin-research-trace.js";

export const GET: APIRoute = async ({ params }) => {
  const date = params.date ?? "";
  if (!isCalendarDate(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  const { generation } = await loadAdminBriefGenerationInfo(date);
  return Response.json(generation, {
    headers: { "Cache-Control": "no-store" },
  });
};
