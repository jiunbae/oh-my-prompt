import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { z } from "zod";

const createShareSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  expiresIn: z
    .number()
    .int()
    .positive()
    .max(8760) // max 1 year in hours
    .nullable()
    .optional()
    .default(null),
});

// POST /api/share/sessions - Create a share link for a session
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await request.json();
    const parsed = createShareSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { sessionId, expiresIn } = parsed.data;

    // Verify the session belongs to the user (at least one prompt with this sessionId)
    const [prompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.sessionId, sessionId),
          eq(schema.prompts.userId, session.userId)
        )
      )
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const shareToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 60 * 60 * 1000)
      : null;

    const [shared] = await db
      .insert(schema.sharedSessions)
      .values({
        sessionId,
        userId: session.userId,
        shareToken,
        expiresAt,
      })
      .returning();

    return NextResponse.json({ shared }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share session POST error");
    return NextResponse.json({ error: "Failed to create session share link" }, { status: 500 });
  }
}

// GET /api/share/sessions - List user's shared session links
export async function GET() {
  try {
    const session = await requireAuth();

    const shares = await db
      .select({
        id: schema.sharedSessions.id,
        sessionId: schema.sharedSessions.sessionId,
        shareToken: schema.sharedSessions.shareToken,
        expiresAt: schema.sharedSessions.expiresAt,
        viewCount: schema.sharedSessions.viewCount,
        isActive: schema.sharedSessions.isActive,
        createdAt: schema.sharedSessions.createdAt,
      })
      .from(schema.sharedSessions)
      .where(eq(schema.sharedSessions.userId, session.userId))
      .orderBy(sql`${schema.sharedSessions.createdAt} DESC`);

    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share sessions GET error");
    return NextResponse.json({ error: "Failed to fetch shared sessions" }, { status: 500 });
  }
}

const deleteShareSchema = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

// DELETE /api/share/sessions - Revoke a session share link
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();

    const url = new URL(request.url);
    const parsed = deleteShareSchema.safeParse({ id: url.searchParams.get("id") });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid id parameter", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { id } = parsed.data;

    const rows = await db
      .update(schema.sharedSessions)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.sharedSessions.id, id),
          eq(schema.sharedSessions.userId, session.userId)
        )
      )
      .returning({ id: schema.sharedSessions.id });

    if (rows.length === 0) {
      return NextResponse.json({ error: "Shared session not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Share session DELETE error");
    return NextResponse.json({ error: "Failed to revoke session share" }, { status: 500 });
  }
}
