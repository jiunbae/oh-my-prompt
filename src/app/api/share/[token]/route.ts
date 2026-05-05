import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { logger } from "@/lib/logger";

// GET /api/share/[token] - Public endpoint, no auth required
// Supports both legacy shared_prompts (shareToken, 64-char hex) and
// new prompt_shares (token, 16-char alphanumeric).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Try legacy sharedPrompts first (64-char hex tokens)
    const [legacyShared] = await db
      .select()
      .from(schema.sharedPrompts)
      .where(
        and(
          eq(schema.sharedPrompts.shareToken, token),
          eq(schema.sharedPrompts.isActive, true)
        )
      )
      .limit(1);

    if (legacyShared) {
      // Check expiry
      if (legacyShared.expiresAt && new Date(legacyShared.expiresAt) < new Date()) {
        return NextResponse.json(
          { error: "This share link has expired" },
          { status: 410 }
        );
      }

      const [prompt] = await db
        .select({
          id: schema.prompts.id,
          promptText: schema.prompts.promptText,
          responseText: schema.prompts.responseText,
          timestamp: schema.prompts.timestamp,
          projectName: schema.prompts.projectName,
          source: schema.prompts.source,
          promptType: schema.prompts.promptType,
          qualityScore: schema.prompts.qualityScore,
          tokenEstimate: schema.prompts.tokenEstimate,
          tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
        })
        .from(schema.prompts)
        .where(and(eq(schema.prompts.id, legacyShared.promptId), isNull(schema.prompts.deletedAt)))
        .limit(1);

      if (!prompt) {
        return NextResponse.json(
          { error: "The shared prompt no longer exists" },
          { status: 404 }
        );
      }

      await db
        .update(schema.sharedPrompts)
        .set({ viewCount: sql`${schema.sharedPrompts.viewCount} + 1` })
        .where(eq(schema.sharedPrompts.id, legacyShared.id));

      return NextResponse.json({
        prompt: {
          ...prompt,
          sharedAt: legacyShared.createdAt,
        },
      });
    }

    // Fall back to new promptShares (16-char alphanumeric tokens)
    const [share] = await db
      .select()
      .from(schema.promptShares)
      .where(eq(schema.promptShares.token, token))
      .limit(1);

    if (!share) {
      return NextResponse.json(
        { error: "Share link not found or has been revoked" },
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

    const [prompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        qualityScore: schema.prompts.qualityScore,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
      })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.id, share.promptId), isNull(schema.prompts.deletedAt)))
      .limit(1);

    if (!prompt) {
      return NextResponse.json(
        { error: "The shared prompt no longer exists" },
        { status: 404 }
      );
    }

    // Increment view count
    await db
      .update(schema.promptShares)
      .set({ viewCount: sql`${schema.promptShares.viewCount} + 1` })
      .where(eq(schema.promptShares.id, share.id));

    return NextResponse.json({
      prompt: {
        ...prompt,
        sharedAt: share.createdAt,
      },
      access: share.access,
    });
  } catch (error) {
    logger.error({ err: error }, "Share [token] GET error");
    return NextResponse.json(
      { error: "Failed to fetch shared prompt" },
      { status: 500 }
    );
  }
}
