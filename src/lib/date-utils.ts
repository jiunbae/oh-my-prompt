export const APP_TIME_ZONE = process.env.OMP_TIME_ZONE || process.env.TZ || "UTC";

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const d = new Date(value + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  // Verify the parsed components match the input to catch rollover (e.g. Feb 31 -> Mar 3)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * Validate a YYYY-MM-DD string and return a Date (UTC midnight) or null.
 * Checks calendar validity — rejects impossible dates like 2026-02-31
 * that JavaScript silently rolls forward.
 */
export function parseDate(value: string): Date | null {
  if (!parseDateParts(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  return d;
}

export function isDateOnly(value: string): boolean {
  return parseDateParts(value) !== null;
}

export function dateTimePartsInTimeZone(date: Date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );

  const weekday = new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay();

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    weekday,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone = APP_TIME_ZONE): number {
  const values = dateTimePartsInTimeZone(date, timeZone);

  const localAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = APP_TIME_ZONE,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  let result = new Date(utcGuess.getTime() - getTimeZoneOffsetMs(utcGuess, timeZone));
  const correctedOffset = getTimeZoneOffsetMs(result, timeZone);
  result = new Date(utcGuess.getTime() - correctedOffset);
  return result;
}

export function dateKeyInTimeZone(date: Date, timeZone = APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const parts = parseDateParts(dateKey);
  if (!parts) throw new Error(`Invalid date key: ${dateKey}`);
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateKeysBetween(fromKey: string, toKey: string): string[] {
  const result: string[] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    result.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return result;
}

export function startOfDateKeyInTimeZone(dateKey: string, timeZone = APP_TIME_ZONE): Date | null {
  const parts = parseDateParts(dateKey);
  if (!parts) return null;
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

export function endExclusiveOfDateKeyInTimeZone(dateKey: string, timeZone = APP_TIME_ZONE): Date | null {
  return startOfDateKeyInTimeZone(addDaysToDateKey(dateKey, 1), timeZone);
}

export function getLastNDaysRange(
  days: number,
  now = new Date(),
  timeZone = APP_TIME_ZONE,
): { from: Date; to: Date; fromKey: string; toKey: string; dayKeys: string[] } {
  const safeDays = Math.max(1, Math.floor(days));
  const toKey = dateKeyInTimeZone(now, timeZone);
  const fromKey = addDaysToDateKey(toKey, -(safeDays - 1));
  const from = startOfDateKeyInTimeZone(fromKey, timeZone)!;
  const to = endExclusiveOfDateKeyInTimeZone(toKey, timeZone)!;
  return {
    from,
    to,
    fromKey,
    toKey,
    dayKeys: dateKeysBetween(fromKey, toKey),
  };
}

export function parseDateTimeOrDateInTimeZone(
  value: string | undefined,
  boundary: "start" | "end-exclusive",
  timeZone = APP_TIME_ZONE,
): Date | null {
  if (!value) return null;
  if (isDateOnly(value)) {
    return boundary === "start"
      ? startOfDateKeyInTimeZone(value, timeZone)
      : endExclusiveOfDateKeyInTimeZone(value, timeZone);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveDateRange(
  input?: { from?: string; to?: string },
  defaultDays = 30,
  now = new Date(),
  timeZone = APP_TIME_ZONE,
): { from: Date; to: Date; fromKey: string; toKey: string; dayKeys: string[] } {
  const fallback = getLastNDaysRange(defaultDays, now, timeZone);
  const from = parseDateTimeOrDateInTimeZone(input?.from, "start", timeZone) ?? fallback.from;
  const to = parseDateTimeOrDateInTimeZone(input?.to, "end-exclusive", timeZone) ?? fallback.to;

  if (from >= to) return fallback;

  const fromKey = dateKeyInTimeZone(from, timeZone);
  const toKey = dateKeyInTimeZone(new Date(to.getTime() - 1), timeZone);
  return {
    from,
    to,
    fromKey,
    toKey,
    dayKeys: dateKeysBetween(fromKey, toKey),
  };
}
