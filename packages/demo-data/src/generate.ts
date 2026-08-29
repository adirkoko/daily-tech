import {
  expectedBriefRelativePath,
  validateBriefArtifact,
  type BriefStatus,
  type DayIntensity,
  type DayMetadata,
} from "@daily-tech/core";
import { DailyTechDatabase, type FeedbackCategory } from "@daily-tech/db";
import {
  renderBriefMarkdown,
  type BriefDraft,
  type DraftDevelopment,
  type DraftSourceCitation,
  type DraftWorthWatchingItem,
} from "@daily-tech/pipeline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { clearApplicationData, type DemoDataPaths } from "./clear.js";
import {
  COMPANIES,
  DEVELOPMENT_TITLES,
  FEEDBACK_BODIES,
  FEEDBACK_TITLES,
  PARAGRAPHS,
  SOURCE_LABELS,
  SUMMARIES,
  SYSTEM_BODIES,
  SYSTEM_TITLES,
  TOPICS,
  WATCH_TITLES,
} from "./fixtures.js";

const ISRAEL_TIME_ZONE = "Asia/Jerusalem";
export const DEFAULT_DEMO_DATA_SEED = 20_260_829;

export interface GenerateDemoDataOptions {
  readonly paths: DemoDataPaths;
  readonly months: number;
  readonly seed: number;
  readonly now: Date;
}

export interface GenerateDemoDataSummary {
  readonly months: number;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly dailyBriefs: number;
  readonly published: number;
  readonly ready: number;
  readonly draft: number;
  readonly failed: number;
  readonly developments: number;
  readonly worthWatching: number;
  readonly feedbackTickets: number;
  readonly systemTickets: number;
}

interface PreparedDay {
  readonly metadata: DayMetadata;
  readonly markdown: string;
  readonly filePath: string;
}

type Random = () => number;

export async function generateDemoData(
  options: GenerateDemoDataOptions,
): Promise<GenerateDemoDataSummary> {
  await clearApplicationData(options.paths);

  const random = mulberry32(options.seed);
  const period = resolvePeriod(options.months, options.now);
  const dates = enumerateDates(period.firstDate, period.lastDate);
  const preparedDays = dates.map((date, index) =>
    prepareDay(date, dates.length - 1 - index, random, options.paths),
  );

  await mkdir(options.paths.dailyContentPath, { recursive: true });
  await mkdir(resolve(options.paths.contentRoot, "meta"), { recursive: true });

  const database = DailyTechDatabase.open({ filename: options.paths.databasePath });
  try {
    for (const day of preparedDays) {
      await mkdir(dirname(day.filePath), { recursive: true });
      await writeFile(day.filePath, day.markdown, "utf8");
      database.saveDay(day.metadata);
      appendRunLog(database, day.metadata);
    }

    const feedbackTickets = randomInteger(random, options.months * 10, options.months * 25);
    createFeedbackTickets(database, feedbackTickets, period, random);

    const systemTickets = randomInteger(random, options.months, options.months * 5);
    createSystemTickets(database, systemTickets, period, random);

    return summarize(options.months, period, preparedDays, feedbackTickets, systemTickets);
  } finally {
    database.close();
  }
}

function prepareDay(
  date: string,
  daysFromEnd: number,
  random: Random,
  paths: DemoDataPaths,
): PreparedDay {
  const significantCount = randomInteger(random, 0, 8);
  const worthWatchingCount = randomInteger(random, 0, 3);
  const companies = pickUnique(COMPANIES, randomInteger(random, 2, 5), random);
  const topics = pickUnique(TOPICS, randomInteger(random, 2, 4), random);
  const developmentTitles = pickUnique(DEVELOPMENT_TITLES, significantCount, random);
  const developments = developmentTitles.map((title, index) =>
    createDevelopment(date, index, title, random),
  );
  const worthWatching = Array.from({ length: worthWatchingCount }, (_, index) =>
    createWorthWatching(date, index, random),
  );
  const status = statusForDay(daysFromEnd);
  const sourceCount = new Set(
    [...developments, ...worthWatching].flatMap((item) => item.sources.map((source) => source.url)),
  ).size;
  const totalItems = significantCount + worthWatchingCount;
  const draft: BriefDraft = {
    dayOverview: pick(SUMMARIES, random),
    developments,
    worthWatching,
    bottomLine: pick(PARAGRAPHS, random),
    metadata: {
      summary: pick(SUMMARIES, random),
      significant_items: significantCount,
      worth_watching_items: worthWatchingCount,
      day_intensity: intensityFor(totalItems),
      companies,
      topics,
      developments: developments.map((development) => development.title),
    },
  };
  const metadata: DayMetadata = {
    date,
    ...draft.metadata,
    status,
    source_count: sourceCount,
    created_at: israelLocalTimeToUtc(date, 1),
    published_at: status === "published" ? israelLocalTimeToUtc(date, 7) : null,
    updated_at: null,
  };
  const relativePath = expectedBriefRelativePath(date);
  if (relativePath === null) throw new Error(`Cannot resolve brief path for ${date}.`);
  const filePath = resolve(paths.dailyContentPath, relativePath);
  const markdown = renderBriefMarkdown(date, draft);
  const validation = validateBriefArtifact({ filePath, content: markdown, metadata });
  if (!validation.valid) {
    const details = validation.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(`Generated brief for ${date} failed validation: ${details}`);
  }

  return { metadata, markdown, filePath };
}

function createDevelopment(
  date: string,
  index: number,
  title: string,
  random: Random,
): DraftDevelopment {
  return {
    storyIds: [`story-${date}-${index + 1}`],
    title,
    whatChanged: pick(PARAGRAPHS, random),
    whyItMatters: pick(PARAGRAPHS, random),
    whatToDoWithIt: random() < 0.55 ? pick(PARAGRAPHS, random) : null,
    availability: random() < 0.45 ? "היכולת זמינה בהדרגה למשתמשים בתוכניות הנתמכות." : null,
    sources: [createSource(date, "development", index, random)],
  };
}

function createWorthWatching(
  date: string,
  index: number,
  random: Random,
): DraftWorthWatchingItem {
  return {
    storyIds: [`watch-${date}-${index + 1}`],
    title: pick(WATCH_TITLES, random),
    note: pick(PARAGRAPHS, random),
    sources: [createSource(date, "watch", index, random)],
  };
}

function createSource(
  date: string,
  kind: "development" | "watch",
  index: number,
  random: Random,
): DraftSourceCitation {
  return {
    label: pick(SOURCE_LABELS, random),
    url: `https://example.com/tech/${date}/${kind}-${index + 1}`,
  };
}

function appendRunLog(database: DailyTechDatabase, metadata: DayMetadata): void {
  const failed = metadata.status === "failed";
  database.operations.appendLog({
    runId: `run-${metadata.date}`,
    briefDate: metadata.date,
    eventType: failed ? "run_failed" : "run_completed",
    level: failed ? "error" : "info",
    message: failed ? "Daily brief generation failed." : "Daily brief generation completed.",
    details: { status: metadata.status, sourceCount: metadata.source_count },
    occurredAt: israelLocalTimeToUtc(metadata.date, 2),
  });
}

function createFeedbackTickets(
  database: DailyTechDatabase,
  count: number,
  period: { readonly firstDate: string; readonly lastDate: string },
  random: Random,
): void {
  const categories: readonly FeedbackCategory[] = ["general", "correction", "suggestion"];
  const periodDates = enumerateDates(period.firstDate, period.lastDate);

  for (let index = 0; index < count; index += 1) {
    const date = pick(periodDates, random);
    const createdAt = israelLocalTimeToUtc(date, randomInteger(random, 9, 20));
    const ticket = database.operations.createTicket({
      title: pick(FEEDBACK_TITLES, random),
      submitterName: random() < 0.7 ? `קורא ${index + 1}` : null,
      category: pick(categories, random),
      body: pick(FEEDBACK_BODIES, random),
      createdAt,
    });
    if (random() < 0.25) {
      database.operations.resolveTicket(
        ticket.id,
        earlierTimestamp(
          addHours(createdAt, randomInteger(random, 1, 48)),
          israelLocalTimeToUtc(period.lastDate, 23),
        ),
      );
    }
  }
}

function createSystemTickets(
  database: DailyTechDatabase,
  count: number,
  period: { readonly firstDate: string; readonly lastDate: string },
  random: Random,
): void {
  const periodDates = enumerateDates(period.firstDate, period.lastDate);

  for (let index = 0; index < count; index += 1) {
    const date = pick(periodDates, random);
    const createdAt = israelLocalTimeToUtc(date, randomInteger(random, 2, 22));
    const ticket = database.operations.createTicket({
      title: pick(SYSTEM_TITLES, random),
      category: "system",
      body: pick(SYSTEM_BODIES, random),
      createdAt,
    });
    if (random() < 0.2) {
      database.operations.resolveTicket(
        ticket.id,
        earlierTimestamp(
          addHours(createdAt, randomInteger(random, 1, 24)),
          israelLocalTimeToUtc(period.lastDate, 23),
        ),
      );
    }
  }
}

function summarize(
  months: number,
  period: { readonly firstDate: string; readonly lastDate: string },
  days: readonly PreparedDay[],
  feedbackTickets: number,
  systemTickets: number,
): GenerateDemoDataSummary {
  const countStatus = (status: BriefStatus): number =>
    days.filter((day) => day.metadata.status === status).length;
  return {
    months,
    ...period,
    dailyBriefs: days.length,
    published: countStatus("published"),
    ready: countStatus("ready"),
    draft: countStatus("draft"),
    failed: countStatus("failed"),
    developments: days.reduce((sum, day) => sum + day.metadata.significant_items, 0),
    worthWatching: days.reduce((sum, day) => sum + day.metadata.worth_watching_items, 0),
    feedbackTickets,
    systemTickets,
  };
}

function resolvePeriod(
  months: number,
  now: Date,
): { readonly firstDate: string; readonly lastDate: string } {
  const today = israelDate(now);
  const todayUtc = new Date(`${today}T00:00:00Z`);
  const lastDate = formatUtcDate(new Date(todayUtc.getTime() - 86_400_000));
  const last = new Date(`${lastDate}T00:00:00Z`);
  const first = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - (months - 1), 1));
  return { firstDate: formatUtcDate(first), lastDate };
}

function enumerateDates(firstDate: string, lastDate: string): readonly string[] {
  const dates: string[] = [];
  for (
    let timestamp = Date.parse(`${firstDate}T00:00:00Z`);
    timestamp <= Date.parse(`${lastDate}T00:00:00Z`);
    timestamp += 86_400_000
  ) {
    dates.push(formatUtcDate(new Date(timestamp)));
  }
  return dates;
}

function statusForDay(daysFromEnd: number): BriefStatus {
  if (daysFromEnd === 2) return "ready";
  if (daysFromEnd === 4) return "draft";
  if (daysFromEnd === 6) return "failed";
  return "published";
}

function intensityFor(itemCount: number): DayIntensity {
  if (itemCount === 0) return "minimal";
  if (itemCount <= 2) return "low";
  if (itemCount <= 5) return "medium";
  if (itemCount <= 8) return "high";
  return "extreme";
}

function israelDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function israelLocalTimeToUtc(date: string, hour: number): string {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid date: ${date}`);
  }
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate = desired - (represented - candidate);
  }
  return new Date(candidate).toISOString();
}

function addHours(timestamp: string, hours: number): string {
  return new Date(Date.parse(timestamp) + hours * 3_600_000).toISOString();
}

function earlierTimestamp(first: string, second: string): string {
  return first < second ? first : second;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function randomInteger(random: Random, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function pick<T>(values: readonly T[], random: Random): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error("Cannot select from an empty fixture pool.");
  return value;
}

function pickUnique<T>(values: readonly T[], count: number, random: Random): readonly T[] {
  const available = [...values];
  const selected: T[] = [];
  while (selected.length < count) {
    const index = Math.floor(random() * available.length);
    const [value] = available.splice(index, 1);
    if (value === undefined) throw new Error("Fixture pool is smaller than the requested selection.");
    selected.push(value);
  }
  return selected;
}

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
