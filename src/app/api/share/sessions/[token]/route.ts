import { NextRequest, NextResponse } from "next/server";
import { getSharedSession } from "@/lib/shared-session";
import { logger } from "@/lib/logger";

// GET /api/share/sessions/[token] - Public endpoint, no auth required
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const session = await getSharedSession(token, { incrementViewCount: true });

    if (!session) {
      return NextResponse.json(
        { error: "Share link not found, expired, or has been revoked" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      session: {
        projectName: session.projectName,
        source: session.source,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        promptCount: session.promptCount,
        sharedAt: session.sharedAt,
        prompts: session.prompts.map((p) => ({
          id: p.id,
          promptText: p.promptText,
          responseText: p.responseText,
          timestamp: p.timestamp,
          promptType: p.promptType,
          tokenEstimate: p.tokenEstimate,
          tokenEstimateResponse: p.tokenEstimateResponse,
        })),
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Share session [token] GET error");
    return NextResponse.json(
      { error: "Failed to fetch shared session" },
      { status: 500 }
    );
  }
}
