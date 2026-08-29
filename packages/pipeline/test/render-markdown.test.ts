import { describe, expect, it } from "vitest";

import { renderBriefMarkdown } from "../src/index.js";
import { oneItemDraft, twoItemDraft } from "./fixtures.js";

describe("renderBriefMarkdown", () => {
  it("renders dayOverview under תמצית היום, not metadata.summary", () => {
    const markdown = renderBriefMarkdown("2026-08-27", oneItemDraft);
    expect(markdown).toContain(oneItemDraft.dayOverview);
    expect(markdown).not.toContain(oneItemDraft.metadata.summary);
  });

  it("numbers developments by array position, independent of story order", () => {
    const markdown = renderBriefMarkdown("2026-08-27", twoItemDraft);
    expect(markdown).toContain("## 1. מודל חדש הושק");
    expect(markdown).toContain("## 2. כלי פיתוח קיבל עדכון");
  });

  it("omits a sub-section whose field is null", () => {
    const draft = {
      ...oneItemDraft,
      developments: [{ ...oneItemDraft.developments[0]!, whatToDoWithIt: null, availability: null }],
    };
    const markdown = renderBriefMarkdown("2026-08-27", draft);
    expect(markdown).not.toContain("### מה אפשר לעשות עם זה");
    expect(markdown).not.toContain("### זמינות");
  });
});
