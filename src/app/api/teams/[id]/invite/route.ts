import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and, gt } from "drizzle-orm";
import crypto from "crypto";
import { canInviteToTeam } from "@/lib/team-access";

/**
 * POST /api/teams/:id/invite - Invite by email (admin or owner)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { email } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user can invite to this team
    const canInvite = await canInviteToTeam(session.userId, id);
    if (!canInvite) {
      return NextResponse.json({ error: "You do not have permission to invite to this team" }, { status: 403 });
    }

    // Check if user is already a member
    const [existingUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail))
      .limit(1);

    if (existingUser) {
      const [existingMember] = await db
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, existingUser.id)
          )
        )
        .limit(1);
      if (existingMember) {
        return NextResponse.json({ error: "User is already a team member" }, { status: 409 });
      }
    }

    // Generate invite token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invite] = await db
      .insert(schema.teamInvites)
      .values({
        teamId: id,
        email: normalizedEmail,
        token,
        expiresAt,
      })
      .returning();

    return NextResponse.json({ invite }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Invite team member error");
    return NextResponse.json({ error: "Failed to send invite" }, { status: 500 });
  }
}
