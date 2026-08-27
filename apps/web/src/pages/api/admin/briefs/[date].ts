import type { APIRoute } from "astro";
import { isBriefStatus, isCalendarDate, isDayIntensity } from "@daily-tech/core";
import { deleteAdminBrief, saveAdminBrief, stringList } from "../../../../server/admin-content.js";
import { field, integerField, protectedForm, redirectWith } from "../../../../server/http.js";
export const prerender = false;
export const POST: APIRoute = async (context) => {
  const form = await protectedForm(context); if (form instanceof Response) return form;
  const date = context.params.date ?? ""; if (!isCalendarDate(date)) return new Response("Invalid date", { status: 400 });
  const target = `/admin/briefs/${date}`;
  try {
    if (form.get("action") === "delete") { await deleteAdminBrief(date); return context.redirect("/admin", 303); }
    const intensity = field(form, "day_intensity", 20); const status = field(form, "status", 20);
    if (!isDayIntensity(intensity) || !isBriefStatus(status)) throw new TypeError("Invalid status or intensity.");
    await saveAdminBrief({ date, markdown: field(form, "markdown", 250_000), summary: field(form, "summary", 2_000), significantItems: integerField(form, "significant_items"), worthWatchingItems: integerField(form, "worth_watching_items"), sourceCount: integerField(form, "source_count"), dayIntensity: intensity, status, companies: stringList(field(form, "companies", 20_000)), topics: stringList(field(form, "topics", 20_000)), developments: stringList(field(form, "developments", 100_000)) });
    return redirectWith(target, "success", "השינויים נשמרו.");
  } catch (error) { return redirectWith(target, "error", error instanceof Error ? error.message.slice(0, 500) : "השמירה נכשלה."); }
};
