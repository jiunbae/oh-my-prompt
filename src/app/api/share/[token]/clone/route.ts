import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import crypto from "crypto";

// POST /api/share/[token]/clone — Clone the prompt into current user's account
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const session = await requireAuth();

    const [share] = await db
      .select()
      .from(schema.promptShares)
      .where(eq(schema.promptShares.token, token))
      .limit(1);

    if (!share) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Check expiry
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 410 }
      );
    }

    // Check access level
    if (share.access !== "clone") {
      return NextResponse.json(
        { error: "This share link does not allow cloning" },
        { status: 403 }
      );
    }

    // Fetch the original prompt
    const [original] = await db
      .select({
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        promptLength: schema.prompts.promptLength,
        responseLength: schema.prompts.responseLength,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
        wordCount: schema.prompts.wordCount,
        wordCountResponse: schema.prompts.wordCountResponse,
        workingDirectory: schema.prompts.workingDirectory,
        sessionId: schema.prompts.sessionId,
        deviceName: schema.prompts.deviceName,
      })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.id, share.promptId), isNull(schema.prompts.deletedAt)))
      .limit(1);

    if (!original) {
      return NextResponse.json(
        { error: "The shared prompt no longer exists" },
        { status: 404 }
      );
    }

    // Create a new prompt for the current user with same content
    const [newPrompt] = await db
      .insert(schema.prompts)
      .values({
        eventKey: `cloned-${Date.now()}-${crypto.randomUUID()}`,
        timestamp: new Date(),
        promptText: original.promptText,
        responseText: original.responseText,
        promptLength: original.promptLength,
        responseLength: original.responseLength,
        projectName: original.projectName,
        source: original.source,
        promptType: original.promptType,
        tokenEstimate: original.tokenEstimate,
        tokenEstimateResponse: original.tokenEstimateResponse,
        wordCount: original.wordCount,
        wordCountResponse: original.wordCountResponse,
        workingDirectory: original.workingDirectory,
        sessionId: original.sessionId,
        deviceName: original.deviceName,
        userId: session.userId,
      })
      .returning({ id: schema.prompts.id });

    return NextResponse.json({
      success: true,
      promptId: newPrompt.id,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share clone POST error");
    return NextResponse.json(
      { error: "Failed to clone prompt" },
      { status: 500 }
    );
  }
}
