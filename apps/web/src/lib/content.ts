import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { expectedBriefRelativePath, type DayMetadata } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { addCalendarDays, toIsraelDate } from "./dates.js";

export interface PublishedBrief {
  readonly metadata: DayMetadata;
  readonly filePath: string;
}

export interface SiteSnapshot {
  readonly contentRoot: string;
  readonly currentDate: string;
  readonly targetDate: string;
  readonly days: readonly DayMetadata[];
  readonly published: readonly PublishedBrief[];
  readonly latestPublished: PublishedBrief | null;
  readonly targetDay: DayMetadata | null;
}

export interface LoadSiteSnapshotOptions {
  readonly contentRoot?: string;
  readonly now?: Date;
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
let cachedSnapshot: Promise<SiteSnapshot> | undefined;

function defaultContentRoot(): string {
  const configured = process.env.TECH_BRIEFS_ROOT?.trim();
  return configured ? resolve(repositoryRoot, configured) : join(repositoryRoot, "tech_briefs");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function listAllDays(database: DailyTechDatabase): readonly DayMetadata[] {
  const days: DayMetadata[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = database.listDays({ order: "desc", limit: pageSize, offset });
    days.push(...page);
    if (page.length < pageSize) {
      return days;
    }
  }
}

function briefFilePath(contentRoot: string, date: string): string {
  const relativePath = expectedBriefRelativePath(date);
  if (relativePath === null) {
    throw new Error(`Cannot resolve Markdown path for invalid brief date: ${date}`);
  }
  return join(contentRoot, "daily", ...relativePath.split("/"));
}

export async function loadSiteSnapshot(
  options: LoadSiteSnapshotOptions = {},
): Promise<SiteSnapshot> {
  const contentRoot = resolve(options.contentRoot ?? defaultContentRoot());
  const databasePath = join(contentRoot, "meta", "tech_briefs.db");
  const currentDate = toIsraelDate(options.now);
  const targetDate = addCalendarDays(currentDate, -1);

  if (!(await pathExists(databasePath))) {
    return {
      contentRoot,
      currentDate,
      targetDate,
      days: [],
      published: [],
      latestPublished: null,
      targetDay: null,
    };
  }

  const database = DailyTechDatabase.open({
    filename: databasePath,
    readOnly: true,
    migrate: false,
  });
  let days: readonly DayMetadata[];
  try {
    days = listAllDays(database);
  } finally {
    database.close();
  }

  const published = await Promise.all(
    days
      .filter((day) => day.status === "published")
      .map(async (metadata): Promise<PublishedBrief> => {
        const filePath = briefFilePath(contentRoot, metadata.date);
        if (!(await pathExists(filePath))) {
          throw new Error(
            `Published brief ${metadata.date} is missing its Markdown file: ${filePath}`,
          );
        }
        return { metadata, filePath };
      }),
  );

  return {
    contentRoot,
    currentDate,
    targetDate,
    days,
    published,
    latestPublished: published[0] ?? null,
    targetDay: days.find((day) => day.date === targetDate) ?? null,
  };
}

export function getSiteSnapshot(): Promise<SiteSnapshot> {
  cachedSnapshot ??= loadSiteSnapshot();
  return cachedSnapshot;
}

export async function renderBrief(brief: PublishedBrief): Promise<string> {
  const markdown = await readFile(brief.filePath, "utf8");
  const rendered = await marked.parse(markdown, {
    gfm: true,
    breaks: false,
  });

  return sanitizeHtml(rendered, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "a", "ul", "ol", "li", "blockquote",
      "strong", "em", "code", "pre", "hr", "br", "table", "thead", "tbody",
      "tr", "th", "td",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      code: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}
