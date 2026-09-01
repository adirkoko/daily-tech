import type { APIRoute } from "astro";
import { PipelineSettingsValidationError } from "@daily-tech/db";

import { listField } from "../../../server/admin-content.js";
import { field, integerField, protectedForm, redirectWith } from "../../../server/http.js";
import { saveAdminPipelineSettings } from "../../../server/pipeline-settings.js";

export const prerender = false;

const TARGET = "/admin/settings";

function clockField(form: FormData, prefix: "generate" | "publish"): string {
  const hour = field(form, `${prefix}_hour`, 2);
  const minute = field(form, `${prefix}_minute`, 2);
  if (!/^\d{2}$/u.test(hour) || !/^\d{2}$/u.test(minute)) {
    throw new TypeError(`${prefix} time is invalid.`);
  }
  if (Number(hour) > 23 || Number(minute) > 59) {
    throw new TypeError(`${prefix} time is invalid.`);
  }
  return `${hour}:${minute}`;
}

export const POST: APIRoute = async (context) => {
  const form = await protectedForm(context);
  if (form instanceof Response) return form;
  try {
    await saveAdminPipelineSettings({
      adminKeywords: listField(form, "admin_keywords", 5_000),
      maximumStories: integerField(form, "maximum_stories"),
      gapDiscoveryEnabled: field(form, "gap_discovery_enabled", 10) === "true",
      adminKeywordsResearchEnabled: field(form, "admin_keywords_research_enabled", 10) === "true",
      editorialInstructions: field(form, "editorial_instructions", 4_000),
      generateTime: clockField(form, "generate"),
      publishTime: clockField(form, "publish"),
    });
    return redirectWith(TARGET, "success", "ההגדרות נשמרו.");
  } catch (error) {
    return redirectWith(TARGET, "error", errorMessage(error).slice(0, 500));
  }
};

function errorMessage(error: unknown): string {
  if (error instanceof PipelineSettingsValidationError) {
    return error.issues.map((issue) => issue.message).join(" ");
  }
  return error instanceof Error ? error.message : "השמירה נכשלה.";
}
