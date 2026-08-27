import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expectedBriefRelativePath, type DayMetadata } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];

function runWebBuild(contentRoot: string): Promise<void> {
  const astroCli = join(webRoot, "..", "..", "node_modules", "astro", "bin", "astro.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [astroCli, "build"], {
      cwd: webRoot,
      env: {
        ...process.env,
        ASTRO_TELEMETRY_DISABLED: "1",
        SITE_URL: "https://daily-tech.example",
        TECH_BRIEFS_ROOT: contentRoot,
      },
      stdio: "pipe",
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Astro fixture build exited with ${code}.\n${output}`));
    });
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("static site build", () => {
  it("prerenders daily and monthly routes from a published artifact", async () => {
    const contentRoot = await mkdtemp(join(tmpdir(), "daily-tech-site-build-"));
    temporaryRoots.push(contentRoot);
    const databasePath = join(contentRoot, "meta", "tech_briefs.db");
    await mkdir(dirname(databasePath), { recursive: true });

    const day: DayMetadata = {
      date: "2026-08-26",
      summary: "מהדורת אינטגרציה בטוחה",
      significant_items: 1,
      worth_watching_items: 0,
      day_intensity: "medium",
      companies: ["Example"],
      topics: ["בדיקות"],
      developments: ["פיתוח שנבדק"],
      status: "published",
      source_count: 3,
      created_at: "2026-08-26T04:00:00.000Z",
      published_at: "2026-08-27T04:00:00.000Z",
      updated_at: null,
    };
    const database = DailyTechDatabase.open({ filename: databasePath });
    database.saveDay(day);
    database.close();

    const relativePath = expectedBriefRelativePath(day.date);
    if (relativePath === null) throw new Error("Expected a valid fixture date.");
    const markdownPath = join(contentRoot, "daily", ...relativePath.split("/"));
    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(
      markdownPath,
      "# מהדורה\n\n## מה באמת חשוב\n\n[מקור](https://example.com)\n\n<script>alert('bad')</script>",
      "utf8",
    );

    await runWebBuild(contentRoot);

    const dailyHtml = await readFile(join(webRoot, "dist", "daily", day.date, "index.html"), "utf8");
    const monthHtml = await readFile(join(webRoot, "dist", "calendar", "2026-08", "index.html"), "utf8");
    expect(dailyHtml).toContain("מהדורת אינטגרציה בטוחה");
    expect(dailyHtml).toContain("noopener noreferrer");
    expect(dailyHtml).not.toContain("alert('bad')");
    expect(monthHtml).toContain(`/daily/${day.date}`);
    expect(monthHtml).toContain('data-level="medium"');
  }, 30_000);
});
