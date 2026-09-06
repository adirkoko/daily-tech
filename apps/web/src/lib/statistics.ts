import type { DayMetadata, DayIntensity } from "@daily-tech/core";

import { addCalendarDays } from "./dates.js";

export type StatisticsRange = "month" | "year";

export const STATISTICS_RANGE_DAYS: Readonly<Record<StatisticsRange, number>> = {
  month: 30,
  year: 365,
};

export interface NamedCount {
  readonly name: string;
  readonly count: number;
}

export interface ArchiveStatistics {
  readonly briefCount: number;
  readonly developmentCount: number;
  readonly topCompanies: readonly NamedCount[];
  readonly topTopics: readonly NamedCount[];
  readonly intensityCounts: Readonly<Record<DayIntensity, number>>;
}

export function parseStatisticsRange(value: string | null): StatisticsRange {
  return value === "year" ? "year" : "month";
}

export function selectTrailingDays(
  days: readonly DayMetadata[],
  currentDate: string,
  range: StatisticsRange,
): readonly DayMetadata[] {
  const startDate = addCalendarDays(currentDate, -STATISTICS_RANGE_DAYS[range]);
  return days.filter(
    (day) => day.status === "published" && day.date >= startDate && day.date < currentDate,
  );
}

function topValues(
  days: readonly DayMetadata[],
  field: "companies" | "topics",
): readonly NamedCount[] {
  const counts = new Map<string, NamedCount>();
  for (const day of days) {
    const dayValues = new Map(
      day[field].map((value) => [normalizeLabel(value), value.trim()] as const),
    );
    for (const [key, name] of dayValues) {
      const current = counts.get(key);
      counts.set(key, { name: current?.name ?? name, count: (current?.count ?? 0) + 1 });
    }
  }

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "he"))
    .slice(0, 10);
}

function normalizeLabel(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function calculateStatistics(days: readonly DayMetadata[]): ArchiveStatistics {
  return {
    briefCount: days.length,
    developmentCount: days.reduce(
      (total, day) => total + day.significant_items + day.worth_watching_items,
      0,
    ),
    topCompanies: topValues(days, "companies"),
    topTopics: topValues(days, "topics"),
    intensityCounts: {
      minimal: days.filter((day) => day.day_intensity === "minimal").length,
      low: days.filter((day) => day.day_intensity === "low").length,
      medium: days.filter((day) => day.day_intensity === "medium").length,
      high: days.filter((day) => day.day_intensity === "high").length,
      extreme: days.filter((day) => day.day_intensity === "extreme").length,
    },
  };
}
