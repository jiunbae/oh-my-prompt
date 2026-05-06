import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { canViewPrompt, canEditPrompt } from "@/lib/team-access";

/**
 * GET /api/prompts/:id/permissions - List permissions for a prompt
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const canView = await canViewPrompt(session.userId, id);
    if (!canView) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const permissions = await db
      .select({
        id: schema.promptPermissions.id,
        promptId: schema.promptPermissions.promptId,
        userId: schema.promptPermissions.userId,
        permission: schema.promptPermissions.permission,
        grantedBy: schema.promptPermissions.grantedBy,
        createdAt: schema.promptPermissions.createdAt,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.promptPermissions)
      .innerJoin(schema.users, eq(schema.promptPermissions.userId, schema.users.id))
      .where(eq(schema.promptPermissions.promptId, id));

    return NextResponse.json({ permissions });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "List prompt permissions error");
    return NextResponse.json({ error: "Failed to list permissions" }, { status: 500 });
  }
}

const VALID_PERMISSIONS = ["view", "edit", "admin"] as const;
type PermissionLevel = (typeof VALID_PERMISSIONS)[number];

/**
 * POST /api/prompts/:id/permissions - Grant permission to a user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const canEdit = await canEditPrompt(session.userId, id);
    if (!canEdit) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { userId, email, permission } = body;

    let targetUserId = userId;
    if (!targetUserId && email) {
      const [foundUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email.toLowerCase().trim()))
        .limit(1);
      if (foundUser) {
        targetUserId = foundUser.id;
      }
    }

    if (!targetUserId || typeof targetUserId !== "string") {
      return NextResponse.json({ error: "userId or valid email is required" }, { status: 400 });
    }

    if (!permission || !VALID_PERMISSIONS.includes(permission as PermissionLevel)) {
      return NextResponse.json(
        { error: "Valid permission is required: view, edit, or admin" },
        { status: 400 }
      );
    }

    // Check target user exists
    const [targetUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Upsert permission
    const [existing] = await db
      .select({ id: schema.promptPermissions.id })
      .from(schema.promptPermissions)
      .where(
        and(
          eq(schema.promptPermissions.promptId, id),
          eq(schema.promptPermissions.userId, targetUserId)
        )
      )
      .limit(1);

    let result;
    if (existing) {
      [result] = await db
        .update(schema.promptPermissions)
        .set({ permission, grantedBy: session.userId })
        .where(eq(schema.promptPermissions.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(schema.promptPermissions)
        .values({
          promptId: id,
          userId: targetUserId,
          permission,
          grantedBy: session.userId,
        })
        .returning();
    }

    return NextResponse.json({ permission: result }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Grant prompt permission error");
    return NextResponse.json({ error: "Failed to grant permission" }, { status: 500 });
  }
}
