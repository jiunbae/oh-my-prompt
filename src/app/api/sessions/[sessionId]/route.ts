import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { teamPromptViewConditionForMember } from "@/lib/team-access";

export const dynamic = "force-dynamic";

const sessionDisplayNameSchema = z.object({
  displayName: z.string().max(120).nullable(),
});
const teamSessionScopeSchema = z.object({
  teamId: z.string().uuid(),
  ownerId: z.string().uuid(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();

    const { sessionId } = await params;
    const teamIdParam = request.nextUrl.searchParams.get("teamId")?.trim() || null;
    const ownerIdParam = request.nextUrl.searchParams.get("ownerId")?.trim() || null;

    if ((teamIdParam && !ownerIdParam) || (!teamIdParam && ownerIdParam)) {
      return NextResponse.json(
        { error: "teamId and ownerId must be provided together" },
        { status: 400 },
      );
    }

    const parsedTeamScope = teamIdParam && ownerIdParam
      ? teamSessionScopeSchema.safeParse({ teamId: teamIdParam, ownerId: ownerIdParam })
      : null;
    if (parsedTeamScope && !parsedTeamScope.success) {
      return NextResponse.json({ error: "Invalid team session scope" }, { status: 400 });
    }
    const teamId = parsedTeamScope?.success ? parsedTeamScope.data.teamId : null;
    const ownerId = parsedTeamScope?.success ? parsedTeamScope.data.ownerId : null;

    if (teamId) {
      const [membership] = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, teamId),
            eq(schema.teamMembers.userId, session.userId),
          ),
        )
        .limit(1);
      if (!membership) {
        return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
      }
    }

    const promptScope = teamId && ownerId
      ? and(
          eq(schema.prompts.teamId, teamId),
          eq(schema.prompts.userId, ownerId),
          teamPromptViewConditionForMember(session.userId),
        )
      : eq(schema.prompts.userId, session.userId);

    const prompts = await db.query.prompts.findMany({
      where: and(
        eq(schema.prompts.sessionId, sessionId),
        promptScope,
        isNull(schema.prompts.deletedAt)
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
    const canRename = newest.userId === session.userId;
    const [displayName] = canRename
      ? await db
          .select({ displayName: schema.sessionDisplayNames.displayName })
          .from(schema.sessionDisplayNames)
          .where(
            and(
              eq(schema.sessionDisplayNames.userId, session.userId),
              eq(schema.sessionDisplayNames.sessionId, sessionId)
            )
          )
          .limit(1)
      : [];

    return NextResponse.json({
      sessionId,
      ownerId: newest.userId,
      teamId: newest.teamId,
      canRename,
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
          eq(schema.prompts.sessionId, sessionId),
          eq(schema.prompts.userId, session.userId),
          isNull(schema.prompts.deletedAt)
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
