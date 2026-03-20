import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { cleanupExpiredShares } from "@/lib/share-cleanup";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/cleanup-shares
 * Manually trigger deactivation of all expired shares.
 */
export async function POST() {
  try {
    await requireAdmin();

    const deactivated = await cleanupExpiredShares();

    return NextResponse.json({ success: true, deactivated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Admin cleanup-shares error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
