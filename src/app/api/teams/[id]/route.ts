import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and } from "drizzle-orm";
import { canManageTeam } from "@/lib/team-access";

/**
 * GET /api/teams/:id - Get team details with members
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check membership
    const [membership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, session.userId)
        )
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
    }

    // Get team details
    const [team] = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, id))
      .limit(1);

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Get team settings
    const [settings] = await db
      .select()
      .from(schema.teamSettings)
      .where(eq(schema.teamSettings.teamId, id))
      .limit(1);

    // Get members with user details
    const members = await db
      .select({
        userId: schema.teamMembers.userId,
        role: schema.teamMembers.role,
        joinedAt: schema.teamMembers.joinedAt,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id))
      .where(eq(schema.teamMembers.teamId, id));

    return NextResponse.json({
      team,
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        name: m.userName,
        email: m.userEmail,
      })),
      myRole: membership.role,
      settings: settings ?? {
        teamId: id,
        inviteOnly: false,
        defaultPromptVisibility: "team",
        allowMemberInvites: false,
        requireApprovalForJoin: false,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Get team error");
    return NextResponse.json({ error: "Failed to get team" }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/:id - Delete team (owner only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Only team owner can delete
    const isOwner = await canManageTeam(session.userId, id);
    if (!isOwner) {
      return NextResponse.json({ error: "Only team owner can delete the team" }, { status: 403 });
    }

    // Delete team (cascade handles members, invites, prompts)
    await db.delete(schema.teams).where(eq(schema.teams.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Delete team error");
    return NextResponse.json({ error: "Failed to delete team" }, { status: 500 });
  }
}
