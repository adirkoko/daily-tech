import type { APIRoute } from "astro";
import { isCalendarDate } from "@daily-tech/core";

import {
  adminGenerationService,
} from "../../../../../server/admin-generation.js";
import { field, protectedForm, redirectWith } from "../../../../../server/http.js";

export const POST: APIRoute = async (context) => {
  const date = context.params.date ?? "";
  const target = isCalendarDate(date) ? `/admin/briefs/${date}` : "/admin";
  const form = await protectedForm(context);
  if (form instanceof Response) return form;

  try {
    if (!isCalendarDate(date)) throw new TypeError("תאריך התדריך אינו תקין.");
    const mode = field(form, "mode", 20);
    if (mode !== "retry" && mode !== "regenerate") {
      throw new TypeError("פעולת היצירה אינה תקינה.");
    }
    const result = await adminGenerationService().start({
      date,
      mode,
    });
    if (result.outcome === "busy") {
      return redirectWith(target, "error", "כבר מתבצעת יצירה עבור היום הזה.");
    }
    if (result.outcome === "not_found") {
      return redirectWith("/admin", "error", "התדריך לא נמצא.");
    }
    if (result.outcome === "invalid_state") {
      return redirectWith(target, "error", "ניסיון חוזר זמין רק לתדריך שנכשל.");
    }
    const verb = mode === "retry" ? "הניסיון החוזר" : "היצירה מחדש";
    return redirectWith(
      target,
      "success",
      `${verb} התחיל ברקע. אפשר לרענן את הדף כדי לראות את ההתקדמות.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectWith(target, "error", message.slice(0, 500));
  }
};
