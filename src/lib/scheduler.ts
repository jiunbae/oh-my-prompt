import { extensions } from "@/extensions/registry";
import type { ExtensionProcessor } from "@/extensions/types";
import { logger } from "@/lib/logger";
import { dateTimePartsInTimeZone, getLastNDaysRange } from "@/lib/date-utils";

/**
 * Minimal cron expression parser supporting the standard 5-field format:
 *   minute hour day-of-month month day-of-week
 *
 * Only supports exact values (e.g. "0", "9") and wildcards ("*").
 * Does NOT support ranges, lists, steps, or names.
 */
function parseCronField(field: string, max: number): Set<number> {
  const result = new Set<number>();
  if (field === "*") {
    for (let i = 0; i <= max; i++) result.add(i);
    return result;
  }
  const n = parseInt(field, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= max) {
    result.add(n);
  }
  return result;
}

interface CronExpr {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseCron(expr: string): CronExpr | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return {
    minutes: parseCronField(parts[0], 59),
    hours: parseCronField(parts[1], 23),
    daysOfMonth: parseCronField(parts[2], 31),
    months: parseCronField(parts[3], 12),
    daysOfWeek: parseCronField(parts[4], 6), // 0 = Sunday
  };
}

/**
 * Check whether a cron expression matches the given date.
 */
export function shouldRun(cronExpr: string, date: Date = new Date()): boolean {
  const parsed = parseCron(cronExpr);
  if (!parsed) {
    logger.warn({ cronExpr }, "Invalid cron expression");
    return false;
  }

  const local = dateTimePartsInTimeZone(date);

  return (
    parsed.minutes.has(local.minute) &&
    parsed.hours.has(local.hour) &&
    parsed.daysOfMonth.has(local.day) &&
    parsed.months.has(local.month) &&
    parsed.daysOfWeek.has(local.weekday)
  );
}

export interface ScheduledJobResult {
  jobName: string;
  ran: boolean;
  error?: string;
}

/**
 * Run a single scheduled extension processor by job name.
 */
export async function runScheduledJob(
  jobName: string,
  input?: { userId?: string; dateRange?: { from: string; to: string } }
): Promise<ScheduledJobResult> {
  const ext = extensions.find((e) => e.processor?.jobName === jobName);
  if (!ext || !ext.processor) {
    return { jobName, ran: false, error: "Extension or processor not found" };
  }

  const processor = ext.processor as ExtensionProcessor;

  // Default date range: last 7 app-timezone days
  const defaultRange = getLastNDaysRange(7);

  const processorInput = {
    userId: input?.userId || "system",
    dateRange: input?.dateRange || {
      from: defaultRange.fromKey,
      to: defaultRange.toKey,
    },
    parameters: {},
  };

  try {
    await processor.handler(processorInput);
    logger.info({ jobName }, "Scheduled job completed");
    return { jobName, ran: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error({ err: error, jobName }, "Scheduled job failed");
    return { jobName, ran: false, error: errMsg };
  }
}

/**
 * Evaluate all registered scheduled extensions and run those whose cron
 * expression matches the current time.
 *
 * This is designed to be called from an external cron trigger (e.g. Vercel
 * Cron, system cron hitting an admin endpoint) once per minute.
 */
export async function runDueScheduledJobs(
  date: Date = new Date()
): Promise<ScheduledJobResult[]> {
  const results: ScheduledJobResult[] = [];

  for (const ext of extensions) {
    if (!ext.processor?.schedule) continue;

    if (shouldRun(ext.processor.schedule, date)) {
      logger.info({ jobName: ext.processor.jobName }, "Scheduled job is due");
      const result = await runScheduledJob(ext.processor.jobName);
      results.push(result);
    }
  }

  return results;
}
