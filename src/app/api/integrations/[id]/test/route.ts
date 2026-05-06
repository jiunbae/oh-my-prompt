import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { rateLimiters } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { sendTestIntegration } from "@/lib/integration-triggers";

/**
 * POST /api/integrations/[id]/test - Send a test event to an integration
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    // Rate limit integration test requests
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

    const result = await sendTestIntegration(id, session.userId);

    if (result.error === "Integration not found") {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Integration test error");
    return NextResponse.json(
      { error: "Failed to test integration" },
      { status: 500 }
    );
  }
}
