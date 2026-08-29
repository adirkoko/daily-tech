import type { BriefDraft, DraftSourceCitation } from "./contracts.js";

/**
 * Purely mechanical: numbering, fixed Hebrew sub-headings, and omitting a
 * section when its field is null or its list is empty. Every word of actual
 * content — including which sources to cite — is the writer's, already
 * decided before this function ever runs.
 */
export function renderBriefMarkdown(date: string, draft: BriefDraft): string {
  const lines: string[] = [];

  lines.push(`# עדכון טכנולוגי יומי — ${formatHebrewDate(date)}`, "");
  lines.push("## תמצית היום", "", draft.dayOverview, "");

  draft.developments.forEach((development, index) => {
    lines.push(`## ${index + 1}. ${development.title}`, "");
    lines.push("### מה השתנה", "", development.whatChanged, "");
    lines.push("### למה זה חשוב", "", development.whyItMatters, "");
    if (development.whatToDoWithIt !== null) {
      lines.push("### מה אפשר לעשות עם זה", "", development.whatToDoWithIt, "");
    }
    if (development.availability !== null) {
      lines.push("### זמינות", "", development.availability, "");
    }
    if (development.sources.length > 0) {
      lines.push("### מקורות", "", ...sourceList(development.sources), "");
    }
  });

  if (draft.worthWatching.length > 0) {
    lines.push("## שווה לעקוב", "");
    for (const item of draft.worthWatching) {
      lines.push(`### ${item.title}`, "", item.note, "");
      if (item.sources.length > 0) {
        lines.push(...sourceList(item.sources), "");
      }
    }
  }

  lines.push("## שורה תחתונה", "", draft.bottomLine, "");

  return `${lines.join("\n").trimEnd()}\n`;
}

function sourceList(sources: readonly DraftSourceCitation[]): readonly string[] {
  return sources.map(({ label, url }) => `- [${label}](${url})`);
}

function formatHebrewDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
