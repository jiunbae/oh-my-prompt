import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { rateLimiters } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { manualRetry } from "@/lib/webhook-retry";
import { z } from "zod";

const retrySchema = z.object({
  logId: z.string().uuid("logId must be a valid UUID"),
});

/**
 * POST /api/webhooks/[id]/retry - Manually retry a failed webhook delivery
 *
 * Takes a webhookLog ID in the request body and re-delivers the original payload.
 * If the retry fails, a new retry is automatically scheduled with exponential backoff.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: webhookId } = await params;
    const session = await requireAuth();

    // Rate limit manual retry requests
    const rateLimit = rateLimiters.webhookTest(session.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
          },
        }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON in request body" },
        { status: 400 }
      );
    }

    const parseResult = retrySchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { logId } = parseResult.data;

    const result = await manualRetry(webhookId, logId, session.userId);

    if (result.error === "Webhook log not found" || result.error === "Webhook not found") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    if (result.success) {
      return NextResponse.json({ success: true, message: "Retry delivered successfully" });
    }

    return NextResponse.json({
      success: false,
      message: result.error,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Webhook retry error");
    return NextResponse.json(
      { error: "Failed to retry webhook" },
      { status: 500 }
    );
  }
}