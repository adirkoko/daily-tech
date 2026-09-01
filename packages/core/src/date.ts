const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function expectedBriefRelativePath(date: string): string | null {
  if (!isCalendarDate(date)) {
    return null;
  }

  const year = date.slice(0, 4);
  const monthNumber = Number(date.slice(5, 7));
  const month = MONTH_NAMES[monthNumber - 1];

  if (month === undefined) {
    return null;
  }

  return `${year}/${month}/${date}/${date}-tech_briefs.md`;
}

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A 24-hour "HH:MM" time of day, e.g. "01:00". No seconds, no time zone. */
export function isClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value);
}

export function isUtcTimestamp(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (match === null || !isCalendarDate(value.slice(0, 10))) {
    return false;
  }

  const milliseconds = (match[2] ?? "0").padEnd(3, "0");
  const normalized = `${match[1]}.${milliseconds}Z`;
  const parsed = new Date(value);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === normalized;
}
