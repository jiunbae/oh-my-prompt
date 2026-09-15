import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/with-auth";
import { authorizeSchedulerTrigger } from "@/lib/scheduler-auth";
import { runDueScheduledJobs, runScheduledJob } from "@/lib/scheduler";
import { QUEUE_ENABLED, enqueueDispatch, enqueueRun, firingBucket } from "@/lib/queue";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

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
    await authorizeSchedulerTrigger(request);

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

      // With a worker running, enqueue instead of executing inline so the work
      // runs off the request thread with idempotency and retries.
      if (QUEUE_ENABLED) {
        if (userId) {
          await enqueueRun({ jobName, userId }, firingBucket());
        } else {
          await enqueueDispatch(jobName);
        }
        return NextResponse.json({ success: true, enqueued: true, jobName });
      }

      const result = await runScheduledJob(jobName, userId ? { userId } : undefined);

      if (result.ran) {
        return NextResponse.json({ success: true, result });
      }

      return NextResponse.json(
        { error: result.error, result },
        { status: 400 }
      );
    }

    // Mode 2: Run all due jobs based on current time. When a worker is running
    // it self-schedules via BullMQ repeatables, so this manual sweep is only
    // used in the inline (no-worker) fallback.
    if (QUEUE_ENABLED) {
      return NextResponse.json({
        success: true,
        enqueued: false,
        message: "Worker is enabled; scheduled jobs run via BullMQ repeatables.",
      });
    }

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
