import type { BriefWindow } from "./types.js";

const ISRAEL_TIME_ZONE = "Asia/Jerusalem" as const;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ISRAEL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface DateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function previousIsraelDayWindow(runAt: Date): BriefWindow {
  if (Number.isNaN(runAt.getTime())) {
    throw new TypeError("runAt must be a valid Date.");
  }

  const localRunDate = partsAt(runAt);
  const target = shiftCalendarDate(localRunDate, -1);
  const next = shiftCalendarDate(target, 1);
  const start = localDateTimeToUtc({ ...target, hour: 0, minute: 0, second: 0 });
  const endExclusive = localDateTimeToUtc({
    ...next,
    hour: 0,
    minute: 0,
    second: 0,
  });

  return {
    date: formatDate(target),
    timeZone: ISRAEL_TIME_ZONE,
    start,
    endExclusive,
  };
}

function partsAt(value: Date): DateTimeParts {
  const parts = new Map(
    formatter
      .formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, Number(partValue)]),
  );

  return {
    year: requiredPart(parts, "year"),
    month: requiredPart(parts, "month"),
    day: requiredPart(parts, "day"),
    hour: requiredPart(parts, "hour"),
    minute: requiredPart(parts, "minute"),
    second: requiredPart(parts, "second"),
  };
}

function requiredPart(parts: ReadonlyMap<string, number>, name: string): number {
  const value = parts.get(name);
  if (value === undefined) {
    throw new Error(`Intl did not return the ${name} date part.`);
  }
  return value;
}

function shiftCalendarDate(
  value: Pick<DateTimeParts, "year" | "month" | "day">,
  days: number,
): Pick<DateTimeParts, "year" | "month" | "day"> {
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localDateTimeToUtc(value: DateTimeParts): Date {
  const desiredAsUtc = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
  );
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsAt(new Date(candidate));
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const difference = desiredAsUtc - observedAsUtc;
    candidate += difference;
    if (difference === 0) {
      return new Date(candidate);
    }
  }

  throw new Error(`Could not resolve local time ${formatDate(value)} in Israel.`);
}

function formatDate(value: Pick<DateTimeParts, "year" | "month" | "day">): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}
