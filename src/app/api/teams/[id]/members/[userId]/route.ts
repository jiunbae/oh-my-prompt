import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and } from "drizzle-orm";
import { canManageTeam } from "@/lib/team-access";

const VALID_ROLES = ["owner", "admin", "member"] as const;
type Role = (typeof VALID_ROLES)[number];

/**
 * POST /api/teams/:id/members/:userId - Update member role (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, userId: targetUserId } = await params;
    const body = await request.json().catch(() => ({}));
    const { role } = body;

    if (!role || !VALID_ROLES.includes(role as Role)) {
      return NextResponse.json(
        { error: "Valid role is required: owner, admin, or member" },
        { status: 400 }
      );
    }

    // Check actor can manage the team
    const canManage = await canManageTeam(session.userId, id);
    if (!canManage) {
      return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
    }

    // Get actor's specific role for fine-grained checks
    const [actorMembership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, session.userId)
        )
      )
      .limit(1);

    // Only owner can assign owner role or change owner role
    // Admin can change member roles to admin/member
    if (actorMembership?.role !== "owner") {
      if (role === "owner" || targetUserId === session.userId) {
        return NextResponse.json(
          { error: "Only team owner can perform this action" },
          { status: 403 }
        );
      }
      // Check target is not owner (admins can't modify owners)
      const [targetMembership] = await db
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, targetUserId)
          )
        )
        .limit(1);
      if (targetMembership?.role === "owner") {
        return NextResponse.json(
          { error: "Only team owner can modify the owner" },
          { status: 403 }
        );
      }
    }

    // Prevent removing the last owner
    if (targetUserId === session.userId && role !== "owner") {
      const [otherOwner] = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.role, "owner")
          )
        )
        .limit(2);
      // If this is the only owner, they can't demote themselves
      const owners = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.role, "owner")
          )
        );
      if (owners.length === 1 && owners[0].userId === session.userId) {
        return NextResponse.json(
          { error: "Cannot demote the only owner. Transfer ownership first." },
          { status: 400 }
        );
      }
    }

    await db
      .update(schema.teamMembers)
      .set({ role })
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, targetUserId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Update member role error");
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/:id/members/:userId - Remove member
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, userId: targetUserId } = await params;

    const isSelfRemoval = targetUserId === session.userId;

    // Users can remove themselves; managers can remove others
    if (!isSelfRemoval) {
      const canManage = await canManageTeam(session.userId, id);
      if (!canManage) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
    }

    // Get actor's membership for fine-grained owner checks
    const [actorMembership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, session.userId)
        )
      )
      .limit(1);

    if (!actorMembership && !isSelfRemoval) {
      return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
    }

    // Check target membership
    const [targetMembership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, targetUserId)
        )
      )
      .limit(1);

    if (!targetMembership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Admins can't remove owners
    if (actorMembership.role === "admin" && targetMembership.role === "owner") {
      return NextResponse.json({ error: "Cannot remove team owner" }, { status: 403 });
    }

    // Prevent removing the last owner
    if (targetMembership.role === "owner") {
      const owners = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.role, "owner")
          )
        );
      if (owners.length === 1) {
        return NextResponse.json(
          { error: "Cannot remove the only owner. Transfer ownership first." },
          { status: 400 }
        );
      }
    }

    await db
      .delete(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, targetUserId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Remove member error");
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
