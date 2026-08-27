import { isCalendarDate } from "@daily-tech/core";

const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

export function previousIsraelCalendarDate(runAt = new Date()): string {
  if (Number.isNaN(runAt.getTime())) {
    throw new TypeError("runAt must be a valid Date.");
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ISRAEL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(runAt)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const currentDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (!isCalendarDate(currentDate)) {
    throw new Error("Could not derive the current Israel calendar date.");
  }
  const [year, month, day] = currentDate.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1))
    .toISOString()
    .slice(0, 10);
}
