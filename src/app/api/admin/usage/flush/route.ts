import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/with-auth";
import { authorizeSchedulerTrigger } from "@/lib/scheduler-auth";
import { countPendingUsageEvents, flushUsageOutbox, getUsageConfig } from "@/lib/usage/report";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/usage/flush
 *
 * Retry delivery of LLM usage events that are still sitting in the outbox.
 *
 * Every provider call already tries to deliver its own event, so this is the
 * safety net for the case the contract calls out: the provider request
 * succeeded but the report did not. Those events stay durable and are resent
 * with the same `eventId`, which the endpoint treats as idempotent, so running
 * this more often than necessary is harmless.
 *
 * Call it from the same cron that drives /api/admin/scheduled-jobs/run — a few
 * times an hour is enough, since the backoff caps at one hour.
 */
export async function POST(request: NextRequest) {
  try {
    await authorizeSchedulerTrigger(request);

    if (!getUsageConfig()) {
      return NextResponse.json({
        success: true,
        enabled: false,
        message: "LLM usage reporting is not configured.",
      });
    }

    const result = await flushUsageOutbox();
    const pending = await countPendingUsageEvents();

    // `pending` is the number to watch: it should return to 0. A backlog that
    // only grows means delivery is failing — check the logs for a rejected key.
    return NextResponse.json({ success: true, enabled: true, ...result, pending });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Usage flush API error");
    return NextResponse.json({ error: "Failed to flush usage outbox" }, { status: 500 });
  }
}
