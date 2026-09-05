const ISRAEL_TIME_ZONE = "Asia/Jerusalem";
const israelClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ISRAEL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface CalendarCell {
  readonly date: string;
  readonly day: number;
  readonly inMonth: boolean;
}

function dateParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function toIsraelDate(date = new Date()): string {
  const parts = dateParts(date, ISRAEL_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsraelTimeAtOrAfter(clockTime: string, date = new Date()): boolean {
  const match = /^(\d{2}):(\d{2})$/u.exec(clockTime);
  const targetHour = Number(match?.[1]);
  const targetMinute = Number(match?.[2]);
  if (
    match === null
    || !Number.isInteger(targetHour)
    || targetHour > 23
    || !Number.isInteger(targetMinute)
    || targetMinute > 59
  ) {
    throw new TypeError("clockTime must use 24-hour HH:MM format.");
  }
  const parts = Object.fromEntries(
    israelClockFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Could not resolve the current Israel time.");
  }
  return hour * 60 + minute >= targetHour * 60 + targetMinute;
}

export function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function formatHebrewDate(date: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatIsraelDateTime(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: ISRAEL_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatHebrewMonth(month: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-15T12:00:00Z`));
}

export function buildCalendar(month: string): readonly CalendarCell[] {
  const first = `${month}-01`;
  const firstDate = new Date(`${first}T12:00:00Z`);
  const sundayOffset = firstDate.getUTCDay();
  const start = addCalendarDays(first, -sundayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addCalendarDays(start, index);
    return {
      date,
      day: Number(date.slice(8, 10)),
      inMonth: date.startsWith(`${month}-`),
    };
  });
}
