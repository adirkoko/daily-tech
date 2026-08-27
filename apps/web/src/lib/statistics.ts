import type { DayMetadata, DayIntensity } from "@daily-tech/core";

export interface NamedCount {
  readonly name: string;
  readonly count: number;
}

export interface ArchiveStatistics {
  readonly briefCount: number;
  readonly developmentCount: number;
  readonly averageSources: number;
  readonly activeDayCount: number;
  readonly topCompanies: readonly NamedCount[];
  readonly topTopics: readonly NamedCount[];
  readonly intensityCounts: Readonly<Record<DayIntensity, number>>;
}

function topValues(days: readonly DayMetadata[], field: "companies" | "topics"): readonly NamedCount[] {
  const counts = new Map<string, number>();
  for (const day of days) {
    for (const value of day[field]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "he"))
    .slice(0, 8);
}

export function calculateStatistics(days: readonly DayMetadata[]): ArchiveStatistics {
  const sourceCount = days.reduce((total, day) => total + day.source_count, 0);
  return {
    briefCount: days.length,
    developmentCount: days.reduce(
      (total, day) => total + day.significant_items + day.worth_watching_items,
      0,
    ),
    averageSources: days.length === 0 ? 0 : Math.round((sourceCount / days.length) * 10) / 10,
    activeDayCount: days.filter((day) => day.day_intensity === "high" || day.day_intensity === "extreme").length,
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
