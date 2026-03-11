import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const sessionDisplayNameSchema = z.object({
  displayName: z.string().max(120).nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();

    const { sessionId } = await params;

    const prompts = await db.query.prompts.findMany({
      where: and(
        eq(schema.prompts.userId, session.userId),
        eq(schema.prompts.sessionId, sessionId)
      ),
      orderBy: [desc(schema.prompts.timestamp)],
      with: {
        promptTags: {
          with: {
            tag: true,
          },
        },
      },
    });

    if (prompts.length === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const newest = prompts[0];
    const oldest = prompts[prompts.length - 1];
    const [displayName] = await db
      .select({ displayName: schema.sessionDisplayNames.displayName })
      .from(schema.sessionDisplayNames)
      .where(
        and(
          eq(schema.sessionDisplayNames.userId, session.userId),
          eq(schema.sessionDisplayNames.sessionId, sessionId)
        )
      )
      .limit(1);

    return NextResponse.json({
      sessionId,
      displayName: displayName?.displayName ?? null,
      projectName: oldest.projectName,
      source: oldest.source,
      deviceName: newest.deviceName,
      workingDirectory: newest.workingDirectory,
      startedAt: oldest.timestamp,
      endedAt: newest.timestamp,
      prompts: prompts.map((p) => ({
        id: p.id,
        timestamp: p.timestamp,
        promptText: p.promptText,
        responseText: p.responseText,
        promptLength: p.promptLength,
        responseLength: p.responseLength,
        tokenEstimate: p.tokenEstimate,
        tokenEstimateResponse: p.tokenEstimateResponse,
        promptType: p.promptType,
        tags: p.promptTags.map((pt) => pt.tag),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session detail API error");
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { sessionId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = sessionDisplayNameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const [existingSession] = await db
      .select({ sessionId: schema.prompts.sessionId })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, session.userId),
          eq(schema.prompts.sessionId, sessionId)
        )
      )
      .limit(1);

    if (!existingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const nextDisplayName = parsed.data.displayName?.trim() ?? "";

    if (!nextDisplayName) {
      await db
        .delete(schema.sessionDisplayNames)
        .where(
          and(
            eq(schema.sessionDisplayNames.userId, session.userId),
            eq(schema.sessionDisplayNames.sessionId, sessionId)
          )
        );

      return NextResponse.json({ success: true, displayName: null });
    }

    await db
      .insert(schema.sessionDisplayNames)
      .values({
        userId: session.userId,
        sessionId,
        displayName: nextDisplayName,
      })
      .onConflictDoUpdate({
        target: [schema.sessionDisplayNames.userId, schema.sessionDisplayNames.sessionId],
        set: {
          displayName: nextDisplayName,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true, displayName: nextDisplayName });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session rename API error");
    return NextResponse.json(
      { error: "Failed to update session name" },
      { status: 500 }
    );
  }
}
