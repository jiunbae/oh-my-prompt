import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { requireAdmin } from "@/lib/with-auth";
import { env } from "@/env";

/**
 * Constant-time comparison of two strings. Returns false on any length
 * mismatch without leaking timing information.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Authorize a background-maintenance trigger. Allows either:
 *  - a valid SCHEDULER_TOKEN bearer/header token (for system cron / k8s
 *    CronJob), OR
 *  - an authenticated admin session (for manual triggering).
 * Throws AuthError if neither path succeeds.
 */
export async function authorizeSchedulerTrigger(request: NextRequest): Promise<void> {
  const expected = env.SCHEDULER_TOKEN;
  if (expected) {
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    const headerToken = request.headers.get("x-scheduler-token") ?? undefined;
    const provided = bearer || headerToken;

    if (provided && safeEqual(provided, expected)) {
      return; // Authorized via scheduler token
    }
  }

  // Fall back to admin session auth.
  await requireAdmin();
}
