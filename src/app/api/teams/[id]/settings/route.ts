import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { canManageTeam } from "@/lib/team-access";

const VALID_VISIBILITIES = ["private", "team", "public"] as const;
type Visibility = (typeof VALID_VISIBILITIES)[number];

/**
 * GET /api/teams/:id/settings - Get team settings
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    // Verify team membership
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

    const [settings] = await db
      .select()
      .from(schema.teamSettings)
      .where(eq(schema.teamSettings.teamId, id))
      .limit(1);

    if (!settings) {
      return NextResponse.json({
        teamId: id,
        inviteOnly: false,
        defaultPromptVisibility: "team",
        allowMemberInvites: false,
        requireApprovalForJoin: false,
      });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Get team settings error");
    return NextResponse.json({ error: "Failed to get team settings" }, { status: 500 });
  }
}

/**
 * PATCH /api/teams/:id/settings - Update team settings (owner/admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const canManage = await canManageTeam(session.userId, id);
    if (!canManage) {
      return NextResponse.json({ error: "Only team owners and admins can manage settings" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { inviteOnly, defaultPromptVisibility, allowMemberInvites, requireApprovalForJoin } = body;

    const updateData: Partial<typeof schema.teamSettings.$inferInsert> = {};

    if (inviteOnly !== undefined) {
      if (typeof inviteOnly !== "boolean") {
        return NextResponse.json({ error: "inviteOnly must be a boolean" }, { status: 400 });
      }
      updateData.inviteOnly = inviteOnly;
    }

    if (defaultPromptVisibility !== undefined) {
      if (!VALID_VISIBILITIES.includes(defaultPromptVisibility as Visibility)) {
        return NextResponse.json(
          { error: "defaultPromptVisibility must be private, team, or public" },
          { status: 400 }
        );
      }
      updateData.defaultPromptVisibility = defaultPromptVisibility;
    }

    if (allowMemberInvites !== undefined) {
      if (typeof allowMemberInvites !== "boolean") {
        return NextResponse.json({ error: "allowMemberInvites must be a boolean" }, { status: 400 });
      }
      updateData.allowMemberInvites = allowMemberInvites;
    }

    if (requireApprovalForJoin !== undefined) {
      if (typeof requireApprovalForJoin !== "boolean") {
        return NextResponse.json({ error: "requireApprovalForJoin must be a boolean" }, { status: 400 });
      }
      updateData.requireApprovalForJoin = requireApprovalForJoin;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updateData.updatedAt = new Date();

    // Upsert settings
    const [existing] = await db
      .select({ teamId: schema.teamSettings.teamId })
      .from(schema.teamSettings)
      .where(eq(schema.teamSettings.teamId, id))
      .limit(1);

    let settings;
    if (existing) {
      [settings] = await db
        .update(schema.teamSettings)
        .set(updateData)
        .where(eq(schema.teamSettings.teamId, id))
        .returning();
    } else {
      [settings] = await db
        .insert(schema.teamSettings)
        .values({
          teamId: id,
          ...updateData,
        })
        .returning();
    }

    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Update team settings error");
    return NextResponse.json({ error: "Failed to update team settings" }, { status: 500 });
  }
}
