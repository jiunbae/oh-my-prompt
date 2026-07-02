import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { runDueScheduledJobs, runScheduledJob } from "@/lib/scheduler";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

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
 * Authorize a scheduled-jobs trigger. Allows either:
 *  - a valid SCHEDULER_TOKEN bearer/header token (for system cron / k8s
 *    CronJob), OR
 *  - an authenticated admin session (for manual triggering).
 * Throws AuthError if neither path succeeds.
 */
async function authorizeTrigger(request: NextRequest): Promise<void> {
  const expected = process.env.SCHEDULER_TOKEN;
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

const runJobSchema = z.object({
  jobName: z.string().min(1),
  userId: z.string().uuid().optional(),
});

/**
 * POST /api/admin/scheduled-jobs/run
 *
 * Trigger scheduled extension jobs. Supports two modes:
 *
 * 1. Body: { jobName: string, userId?: string }
 *    Runs a specific scheduled job by name.
 *
 * 2. Empty body (or no jobName):
 *    Evaluates all registered scheduled extensions against the current time
 *    and runs any whose cron expression matches now.
 *
 * Designed to be called by an external cron trigger (e.g. Vercel Cron,
 * system cron via curl) once per minute.
 */
export async function POST(request: NextRequest) {
  try {
    await authorizeTrigger(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parseResult = runJobSchema.safeParse(body);

    if (parseResult.success) {
      // Mode 1: Run a specific job
      const { jobName, userId } = parseResult.data;
      logger.info({ jobName, userId }, "Manually triggering scheduled job");

      const result = await runScheduledJob(jobName, userId ? { userId } : undefined);

      if (result.ran) {
        return NextResponse.json({ success: true, result });
      }

      return NextResponse.json(
        { error: result.error, result },
        { status: 400 }
      );
    }

    // Mode 2: Run all due jobs based on current time
    const results = await runDueScheduledJobs();

    return NextResponse.json({
      success: true,
      evaluatedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Scheduled jobs run API error");
    return NextResponse.json(
      { error: "Failed to run scheduled jobs" },
      { status: 500 }
    );
  }
}
