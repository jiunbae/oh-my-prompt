import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

const sessionNoteSchema = z.object({
  content: z.string().max(10000),
});

/**
 * GET /api/sessions/[sessionId]/notes
 * Get notes for a session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { sessionId } = await params;

    const [note] = await db
      .select({
        id: schema.sessionNotes.id,
        content: schema.sessionNotes.content,
        createdAt: schema.sessionNotes.createdAt,
        updatedAt: schema.sessionNotes.updatedAt,
      })
      .from(schema.sessionNotes)
      .where(
        and(
          eq(schema.sessionNotes.userId, session.userId),
          eq(schema.sessionNotes.sessionId, sessionId)
        )
      )
      .limit(1);

    return NextResponse.json({ note: note ?? null });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session notes GET error");
    return NextResponse.json(
      { error: "Failed to load session notes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sessions/[sessionId]/notes
 * Create or update notes for a session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { sessionId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = sessionNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const content = parsed.data.content.trim();

    // Upsert: insert or update on conflict
    await db
      .insert(schema.sessionNotes)
      .values({
        userId: session.userId,
        sessionId,
        content,
      })
      .onConflictDoUpdate({
        target: [schema.sessionNotes.userId, schema.sessionNotes.sessionId],
        set: {
          content,
          updatedAt: new Date(),
        },
      });

    const [note] = await db
      .select({
        id: schema.sessionNotes.id,
        content: schema.sessionNotes.content,
        createdAt: schema.sessionNotes.createdAt,
        updatedAt: schema.sessionNotes.updatedAt,
      })
      .from(schema.sessionNotes)
      .where(
        and(
          eq(schema.sessionNotes.userId, session.userId),
          eq(schema.sessionNotes.sessionId, sessionId)
        )
      )
      .limit(1);

    return NextResponse.json({ note });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session notes POST error");
    return NextResponse.json(
      { error: "Failed to save session notes" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sessions/[sessionId]/notes
 * Delete notes for a session.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { sessionId } = await params;

    await db
      .delete(schema.sessionNotes)
      .where(
        and(
          eq(schema.sessionNotes.userId, session.userId),
          eq(schema.sessionNotes.sessionId, sessionId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session notes DELETE error");
    return NextResponse.json(
      { error: "Failed to delete session notes" },
      { status: 500 }
    );
  }
}
