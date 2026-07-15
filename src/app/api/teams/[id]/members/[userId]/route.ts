import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and, sql } from "drizzle-orm";

const VALID_ROLES = ["owner", "admin", "member"] as const;
type Role = (typeof VALID_ROLES)[number];

class TeamMemberMutationError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
  }
}

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

    await db.transaction(async (tx) => {
      // Serialize owner mutations per team. Without this row lock, two owners
      // can both observe ownerCount=2 and concurrently leave an orphaned team.
      await tx.execute(sql`SELECT id FROM ${schema.teams} WHERE id = ${id} FOR UPDATE`);

      const [actorMembership] = await tx
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, session.userId),
          ),
        )
        .limit(1);
      if (actorMembership?.role !== "owner" && actorMembership?.role !== "admin") {
        throw new TeamMemberMutationError("Team not found or access denied", 403);
      }

      const [targetMembership] = await tx
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!targetMembership) {
        throw new TeamMemberMutationError("Member not found", 404);
      }

      if (actorMembership.role !== "owner") {
        if (role === "owner" || targetUserId === session.userId) {
          throw new TeamMemberMutationError("Only team owner can perform this action", 403);
        }
        if (targetMembership.role === "owner") {
          throw new TeamMemberMutationError("Only team owner can modify the owner", 403);
        }
      }

      if (targetMembership.role === "owner" && role !== "owner") {
        const owners = await tx
          .select({ userId: schema.teamMembers.userId })
          .from(schema.teamMembers)
          .where(
            and(
              eq(schema.teamMembers.teamId, id),
              eq(schema.teamMembers.role, "owner"),
            ),
          );
        if (owners.length <= 1) {
          throw new TeamMemberMutationError(
            "Cannot demote the only owner. Transfer ownership first.",
            400,
          );
        }
      }

      await tx
        .update(schema.teamMembers)
        .set({ role })
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, targetUserId),
          ),
        );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TeamMemberMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${schema.teams} WHERE id = ${id} FOR UPDATE`);

      const [actorMembership] = await tx
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, session.userId),
          ),
        )
        .limit(1);
      if (!actorMembership) {
        throw new TeamMemberMutationError("Team not found or access denied", 403);
      }

      const [targetMembership] = await tx
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!targetMembership) {
        throw new TeamMemberMutationError("Member not found", 404);
      }

      const isSelfRemoval = targetUserId === session.userId;
      if (
        !isSelfRemoval &&
        actorMembership.role !== "owner" &&
        actorMembership.role !== "admin"
      ) {
        throw new TeamMemberMutationError("Admin access required", 403);
      }
      if (actorMembership.role === "admin" && targetMembership.role === "owner") {
        throw new TeamMemberMutationError("Cannot remove team owner", 403);
      }

      if (targetMembership.role === "owner") {
        const owners = await tx
          .select({ userId: schema.teamMembers.userId })
          .from(schema.teamMembers)
          .where(
            and(
              eq(schema.teamMembers.teamId, id),
              eq(schema.teamMembers.role, "owner"),
            ),
          );
        if (owners.length <= 1) {
          throw new TeamMemberMutationError(
            "Cannot remove the only owner. Transfer ownership first.",
            400,
          );
        }
      }

      await tx
        .delete(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, targetUserId),
          ),
        );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TeamMemberMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Remove member error");
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
