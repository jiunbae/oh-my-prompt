import { extensions } from "@/extensions/registry";
import type { ExtensionProcessor } from "@/extensions/types";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { isNull } from "drizzle-orm";
import { dateTimePartsInTimeZone, getLastNDaysRange } from "@/lib/date-utils";

/**
 * Extension NAMES whose processors operate on a single user's data. Scheduled
 * runs for these must fan out over every real user; on-demand/manual runs may
 * target a specific user. Everything else (email-digest, slack-daily,
 * alert-evaluator, ...) is a global processor invoked exactly once.
 */
const PER_USER_EXTENSION_NAMES = new Set<string>([
  "daily-summary",
  "weekly-trends",
  "prompt-quality",
  "session-story",
]);

/**
 * Minimal cron expression parser supporting the standard 5-field format:
 *   minute hour day-of-month month day-of-week
 *
 * Supports exact values ("0", "9"), wildcards ("*"), step values ("*\/6",
 * "10-30/5"), comma lists ("1,15,30"), and ranges ("1-5"). Returns null on a
 * genuinely unparseable field so callers can warn and skip.
 */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const result = new Set<number>();

  // Comma-separated list — each part parsed independently and unioned.
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") return null;

    // Split off an optional step: "<range>/<step>"
    const [rangePart, stepPart, ...rest] = trimmed.split("/");
    if (rest.length > 0) return null;

    let step = 1;
    if (stepPart !== undefined) {
      step = parseInt(stepPart, 10);
      if (Number.isNaN(step) || step <= 0) return null;
    }

    let rangeStart: number;
    let rangeEnd: number;

    if (rangePart === "*") {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes("-")) {
      const [a, b, ...extra] = rangePart.split("-");
      if (extra.length > 0) return null;
      rangeStart = parseInt(a, 10);
      rangeEnd = parseInt(b, 10);
      if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) return null;
    } else {
      const n = parseInt(rangePart, 10);
      if (Number.isNaN(n)) return null;
      // A bare number with a step (e.g. "5/2") means "from 5 to max".
      rangeStart = n;
      rangeEnd = stepPart !== undefined ? max : n;
    }

    if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) return null;

    for (let i = rangeStart; i <= rangeEnd; i += step) {
      result.add(i);
    }
  }

  return result.size > 0 ? result : null;
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

  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const daysOfMonth = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const daysOfWeek = parseCronField(parts[4], 0, 6); // 0 = Sunday

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return null;
  }

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
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

/** True when the extension for `jobName` operates on a single user's data. */
export function isPerUserJob(jobName: string): boolean {
  const ext = extensions.find((e) => e.processor?.jobName === jobName);
  return !!ext && PER_USER_EXTENSION_NAMES.has(ext.name);
}

/**
 * Run exactly one processor invocation (no fan-out) — the unit of work the
 * BullMQ `run` job executes, and the single-invocation branch of the inline
 * scheduler. For a per-user processor `userId` targets that user; for a global
 * processor `userId` is ignored (pass "").
 */
export async function runSingleProcessor(
  jobName: string,
  input?: { userId?: string; dateRange?: { from: string; to: string } },
): Promise<ScheduledJobResult> {
  const ext = extensions.find((e) => e.processor?.jobName === jobName);
  if (!ext || !ext.processor) {
    return { jobName, ran: false, error: "Extension or processor not found" };
  }
  const processor = ext.processor as ExtensionProcessor;
  const defaultRange = getLastNDaysRange(processor.defaultRangeDays ?? 7);
  const dateRange = input?.dateRange || {
    from: defaultRange.fromKey,
    to: defaultRange.toKey,
  };
  await processor.handler({
    userId: input?.userId ?? "",
    dateRange,
    parameters: {},
  });
  return { jobName, ran: true };
}

/**
 * Query the distinct set of real user IDs that have prompt data. Used to fan a
 * per-user scheduled processor out across the whole user base.
 */
export async function getDistinctUserIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: schema.prompts.userId })
    .from(schema.prompts)
    .where(isNull(schema.prompts.deletedAt));
  return rows
    .map((r) => r.userId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Run a single scheduled extension processor by job name.
 *
 * For per-user processors (daily-summary, weekly-trends, prompt-quality,
 * session-story) with no explicit userId, this fans out over every real user
 * and runs the processor once per user. When an explicit userId is supplied
 * (manual trigger), only that user is processed. Global processors
 * (email-digest, slack-daily, alert-evaluator) are invoked exactly once.
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

  // Default date range: last N app-timezone days (processor-specific default).
  const defaultRange = getLastNDaysRange(processor.defaultRangeDays ?? 7);
  const dateRange = input?.dateRange || {
    from: defaultRange.fromKey,
    to: defaultRange.toKey,
  };

  const isPerUser = PER_USER_EXTENSION_NAMES.has(ext.name);

  try {
    if (isPerUser && !input?.userId) {
      // Fan out over all real users.
      const userIds = await getDistinctUserIds();
      let ok = 0;
      let failed = 0;
      for (const userId of userIds) {
        try {
          await processor.handler({ userId, dateRange, parameters: {} });
          ok++;
        } catch (error) {
          failed++;
          logger.error({ err: error, jobName, userId }, "Per-user scheduled job failed for user");
        }
      }
      logger.info({ jobName, users: userIds.length, ok, failed }, "Per-user scheduled job completed");
      return { jobName, ran: true };
    }

    // Single invocation: either a per-user processor targeting one user, or a
    // global processor. Global processors ignore userId; pass an empty string
    // rather than a fake "system" id that would break uuid queries.
    await processor.handler({
      userId: input?.userId ?? "",
      dateRange,
      parameters: {},
    });
    logger.info({ jobName, userId: input?.userId }, "Scheduled job completed");
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
