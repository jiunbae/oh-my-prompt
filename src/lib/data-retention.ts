import { db } from "@/db/client";
import { users, prompts } from "@/db/schema";
import { and, eq, lt, isNull, isNotNull, sql, count, gte } from "drizzle-orm";
import { logger } from "@/lib/logger";

interface RetentionCleanupResult {
  totalSoftDeleted: number;
  usersProcessed: number;
}

/**
 * Soft-delete prompts older than each user's configured retention period.
 * Skips users with dataRetentionDays = 0 (unlimited).
 * Skips prompts already soft-deleted (deletedAt IS NOT NULL).
 * Returns total soft-deleted count and number of users processed.
 */
export async function runRetentionCleanup(): Promise<RetentionCleanupResult> {
  const now = new Date();

  // Find all users with a finite retention policy
  const usersWithRetention = await db
    .select({
      id: users.id,
      dataRetentionDays: users.dataRetentionDays,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.dataRetentionDays),
        gte(users.dataRetentionDays, 1)
      )
    );

  let totalSoftDeleted = 0;

  for (const user of usersWithRetention) {
    if (!user.dataRetentionDays) continue;
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - user.dataRetentionDays);

    const result = await db
      .update(prompts)
      .set({ deletedAt: now })
      .where(
        and(
          eq(prompts.userId, user.id),
          isNull(prompts.deletedAt),
          lt(prompts.timestamp, cutoffDate)
        )
      )
      .returning({ id: prompts.id });

    if (result.length > 0) {
      logger.info(
        { userId: user.id, softDeleted: result.length, retentionDays: user.dataRetentionDays },
        "Retention cleanup soft-deleted prompts"
      );
      totalSoftDeleted += result.length;
    }
  }

  logger.info(
    { totalSoftDeleted, usersProcessed: usersWithRetention.length },
    "Retention cleanup completed"
  );

  return {
    totalSoftDeleted,
    usersProcessed: usersWithRetention.length,
  };
}

/**
 * Count how many prompts would be soft-deleted for a given user
 * if the retention policy were applied with the specified number of days.
 * Returns 0 for unlimited (days = 0 or null).
 */
export async function estimatePromptsToDelete(
  userId: string,
  retentionDays: number
): Promise<number> {
  if (retentionDays <= 0) return 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const [row] = await db
    .select({ total: count() })
    .from(prompts)
    .where(
      and(
        eq(prompts.userId, userId),
        isNull(prompts.deletedAt),
        lt(prompts.timestamp, cutoffDate)
      )
    );

  return Number(row?.total ?? 0);
}

// ---- Throttled cleanup (at most once per day) ----

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let lastRetentionCleanupAt = 0;

/**
 * Run retention cleanup at most once per day. Safe to call on every request.
 * Fires only when enough time has elapsed since the last run.
 * Runs in the background (does not block the caller).
 */
export function maybeRunRetentionCleanup(): void {
  const now = Date.now();
  if (now - lastRetentionCleanupAt < ONE_DAY_MS) return;
  lastRetentionCleanupAt = now;

  runRetentionCleanup().catch((err) => {
    logger.error({ err }, "Background retention cleanup failed");
  });
}
