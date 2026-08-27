import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expectedBriefRelativePath, type DayMetadata } from "@daily-tech/core";

export const validMarkdown = `# Daily Tech — 27 באוגוסט 2026

יום עם התפתחות חשובה אחת.

## ההתפתחויות המשמעותיות

### מודל חדש הושק

המודל זמין למפתחים. [מקור](https://example.com/model)
`;

export function readyMetadata(overrides: Partial<DayMetadata> = {}): DayMetadata {
  return {
    date: "2026-08-27",
    summary: "יום עם התפתחות חשובה אחת.",
    significant_items: 1,
    worth_watching_items: 0,
    day_intensity: "medium",
    companies: ["Example"],
    topics: ["AI models"],
    developments: ["מודל חדש הושק"],
    status: "ready",
    source_count: 1,
    created_at: "2026-08-28T01:00:00.000Z",
    published_at: null,
    updated_at: null,
    ...overrides,
  };
}

export async function writeBrief(
  dailyStorageRoot: string,
  date = "2026-08-27",
  content = validMarkdown,
): Promise<string> {
  const relativePath = expectedBriefRelativePath(date);
  if (relativePath === null) throw new Error("Fixture date must be valid.");
  const filePath = join(dailyStorageRoot, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}
