import { db } from "@/db/client";
import { sharedPrompts, sharedSessions } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * Deactivate all expired shares (sharedPrompts + sharedSessions)
 * where expiresAt < now() and isActive = true.
 * Returns the total count of deactivated rows.
 */
export async function cleanupExpiredShares(): Promise<number> {
  const now = new Date();

  const [promptResult, sessionResult] = await Promise.all([
    db
      .update(sharedPrompts)
      .set({ isActive: false })
      .where(
        and(
          eq(sharedPrompts.isActive, true),
          lt(sharedPrompts.expiresAt, now)
        )
      )
      .returning({ id: sharedPrompts.id }),
    db
      .update(sharedSessions)
      .set({ isActive: false })
      .where(
        and(
          eq(sharedSessions.isActive, true),
          lt(sharedSessions.expiresAt, now)
        )
      )
      .returning({ id: sharedSessions.id }),
  ]);

  const total = promptResult.length + sessionResult.length;

  if (total > 0) {
    logger.info(
      { deactivatedPrompts: promptResult.length, deactivatedSessions: sessionResult.length },
      "Cleaned up expired shares"
    );
  }

  return total;
}

// ---- Throttled cleanup (at most once per hour) ----

const ONE_HOUR_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

/**
 * Run cleanup at most once per hour. Safe to call on every request —
 * fires only when enough time has elapsed since the last run.
 * Runs in the background (does not block the caller).
 */
export function maybeCleanupExpiredShares(): void {
  const now = Date.now();
  if (now - lastCleanupAt < ONE_HOUR_MS) return;
  lastCleanupAt = now;

  cleanupExpiredShares().catch((err) => {
    logger.error({ err }, "Background share cleanup failed");
  });
}
