import { access, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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

interface SnapshotCacheEntry {
  readonly promise: Promise<SiteSnapshot>;
  readonly storedAt: number;
}

const DEFAULT_SNAPSHOT_CACHE_TTL_SECONDS = 10;
let snapshotCache: SnapshotCacheEntry | undefined;

function defaultContentRoot(): string {
  const cwd = process.cwd();
  const repositoryRoot = basename(cwd) === "web" && basename(dirname(cwd)) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
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

  // Only the daily brief page reads Markdown, and it does so on demand. The other
  // pages (home, calendar, statistics) use metadata only, so the snapshot no longer
  // stats every published file on every request.
  const published: readonly PublishedBrief[] = days
    .filter((day) => day.status === "published")
    .map((metadata) => ({
      metadata,
      filePath: briefFilePath(contentRoot, metadata.date),
    }));

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

function snapshotCacheTtlMs(): number {
  const raw = process.env.SITE_SNAPSHOT_CACHE_TTL_SECONDS;
  const parsed = Number(raw);
  const seconds =
    raw !== undefined && raw.trim() !== "" && Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SNAPSHOT_CACHE_TTL_SECONDS;
  return seconds * 1_000;
}

/**
 * Process-wide site snapshot, rebuilt at most once per
 * SITE_SNAPSHOT_CACHE_TTL_SECONDS (default 10). Real content changes call
 * invalidateSiteSnapshot() so they appear immediately; the TTL only bounds
 * repeated work under load and covers the daily date rollover.
 */
export function getSiteSnapshot(): Promise<SiteSnapshot> {
  const now = Date.now();
  if (snapshotCache !== undefined && now - snapshotCache.storedAt < snapshotCacheTtlMs()) {
    return snapshotCache.promise;
  }
  const entry: SnapshotCacheEntry = { promise: loadSiteSnapshot(), storedAt: now };
  snapshotCache = entry;
  entry.promise.catch(() => {
    if (snapshotCache === entry) snapshotCache = undefined;
  });
  return entry.promise;
}

export function invalidateSiteSnapshot(): void {
  snapshotCache = undefined;
}

export async function renderBrief(brief: PublishedBrief): Promise<string> {
  return renderMarkdown(await readFile(brief.filePath, "utf8"));
}

/** Parses Markdown and returns sanitized HTML with hardened links. */
export async function renderMarkdown(markdown: string): Promise<string> {
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
