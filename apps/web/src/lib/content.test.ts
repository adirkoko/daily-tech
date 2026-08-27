import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expectedBriefRelativePath, type DayMetadata } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, describe, expect, it } from "vitest";

import { loadSiteSnapshot, renderBrief, type PublishedBrief } from "./content.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "daily-tech-web-"));
  temporaryRoots.push(root);
  return root;
}

function metadata(overrides: Partial<DayMetadata> = {}): DayMetadata {
  return {
    date: "2026-08-26",
    summary: "היום החשוב בקצרה",
    significant_items: 1,
    worth_watching_items: 1,
    day_intensity: "high",
    companies: ["Example"],
    topics: ["בדיקות"],
    developments: ["התפתחות ראשונה", "התפתחות שנייה"],
    status: "published",
    source_count: 4,
    created_at: "2026-08-26T04:00:00.000Z",
    published_at: "2026-08-27T04:00:00.000Z",
    updated_at: null,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("site content loading", () => {
  it("returns a valid empty snapshot before the first database exists", async () => {
    const root = await temporaryRoot();
    const snapshot = await loadSiteSnapshot({
      contentRoot: root,
      now: new Date("2026-08-27T12:00:00Z"),
    });

    expect(snapshot.currentDate).toBe("2026-08-27");
    expect(snapshot.targetDate).toBe("2026-08-26");
    expect(snapshot.published).toEqual([]);
    expect(snapshot.latestPublished).toBeNull();
  });

  it("loads published days and identifies the pipeline target day", async () => {
    const root = await temporaryRoot();
    const databasePath = join(root, "meta", "tech_briefs.db");
    await mkdir(join(root, "meta"), { recursive: true });
    const database = DailyTechDatabase.open({ filename: databasePath });
    const day = database.saveDay(metadata());
    database.close();

    const relativePath = expectedBriefRelativePath(day.date);
    if (relativePath === null) throw new Error("Expected a valid fixture path.");
    const filePath = join(root, "daily", ...relativePath.split("/"));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "# כותרת\n\n## מה באמת חשוב\n\nתוכן", "utf8");

    const snapshot = await loadSiteSnapshot({
      contentRoot: root,
      now: new Date("2026-08-27T12:00:00Z"),
    });
    expect(snapshot.latestPublished?.metadata.date).toBe("2026-08-26");
    expect(snapshot.targetDay?.status).toBe("published");
  });

  it("fails the build contract when published metadata has no Markdown artifact", async () => {
    const root = await temporaryRoot();
    const databasePath = join(root, "meta", "tech_briefs.db");
    await mkdir(join(root, "meta"), { recursive: true });
    const database = DailyTechDatabase.open({ filename: databasePath });
    database.saveDay(metadata());
    database.close();

    await expect(loadSiteSnapshot({ contentRoot: root })).rejects.toThrow("missing its Markdown file");
  });

  it("sanitizes raw HTML and hardens source links", async () => {
    const root = await temporaryRoot();
    const filePath = join(root, "brief.md");
    await writeFile(filePath, "[מקור](https://example.com)\n\n<script>alert(1)</script>", "utf8");
    const brief: PublishedBrief = { metadata: metadata(), filePath };

    const html = await renderBrief(brief);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("<script>");
  });
});
