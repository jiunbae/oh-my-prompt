import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

// GET /api/share/sessions/[token] - Public endpoint, no auth required
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Find the shared session
    const [shared] = await db
      .select()
      .from(schema.sharedSessions)
      .where(
        and(
          eq(schema.sharedSessions.shareToken, token),
          eq(schema.sharedSessions.isActive, true)
        )
      )
      .limit(1);

    if (!shared) {
      return NextResponse.json(
        { error: "Share link not found or has been revoked" },
        { status: 404 }
      );
    }

    // Check expiry
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 410 }
      );
    }

    // Fetch all prompts in the session
    const prompts = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.sessionId, shared.sessionId),
          eq(schema.prompts.userId, shared.userId)
        )
      )
      .orderBy(asc(schema.prompts.timestamp));

    if (prompts.length === 0) {
      return NextResponse.json(
        { error: "The shared session no longer exists" },
        { status: 404 }
      );
    }

    // Increment view count
    await db
      .update(schema.sharedSessions)
      .set({ viewCount: sql`${schema.sharedSessions.viewCount} + 1` })
      .where(eq(schema.sharedSessions.id, shared.id));

    const first = prompts[0];
    const last = prompts[prompts.length - 1];

    return NextResponse.json({
      session: {
        projectName: first.projectName,
        source: first.source,
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        promptCount: prompts.length,
        sharedAt: shared.createdAt,
        prompts,
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
