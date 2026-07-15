import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { canManagePromptAccess } from "@/lib/team-access";

/**
 * DELETE /api/prompts/:id/permissions/:permissionId - Revoke a permission
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; permissionId: string }> }
) {
  try {
    const { id, permissionId } = await params;
    const session = await requireAuth();

    const canManage = await canManagePromptAccess(session.userId, id);
    if (!canManage) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Verify the permission belongs to this prompt
    const [permission] = await db
      .select({ promptId: schema.promptPermissions.promptId })
      .from(schema.promptPermissions)
      .where(eq(schema.promptPermissions.id, permissionId))
      .limit(1);

    if (!permission) {
      return NextResponse.json({ error: "Permission not found" }, { status: 404 });
    }

    if (permission.promptId !== id) {
      return NextResponse.json({ error: "Permission does not belong to this prompt" }, { status: 400 });
    }

    await db
      .delete(schema.promptPermissions)
      .where(eq(schema.promptPermissions.id, permissionId));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Revoke prompt permission error");
    return NextResponse.json({ error: "Failed to revoke permission" }, { status: 500 });
  }
}
