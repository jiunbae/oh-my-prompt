import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { runRetentionCleanup } from "@/lib/data-retention";

/**
 * POST /api/admin/retention/cleanup
 * Manually trigger the data retention cleanup process (admin only).
 */
export async function POST() {
  try {
    await requireAdmin();

    const result = await runRetentionCleanup();

    return NextResponse.json({
      success: true,
      totalSoftDeleted: result.totalSoftDeleted,
      usersProcessed: result.usersProcessed,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Admin retention cleanup error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
