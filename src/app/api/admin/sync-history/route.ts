import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, getDb } from "@/lib/auth";

/**
 * GET /api/admin/sync-history - Get global sync history (all users)
 *
 * Requires admin privileges.
 * Returns the sync logs for all users (admin view).
 *
 * Query parameters:
 * - limit: number (default: 50, max: 100)
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 }
      );
    }

    // Check admin privileges
    if (!session.isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100);
      }
    }

    const { db } = await getDb();
    const { desc, eq } = await import("drizzle-orm");
    const { minioSyncLog, users } = await import("@/db/schema");

    // Get sync logs with user info
    const logs = await db
      .select({
        id: minioSyncLog.id,
        startedAt: minioSyncLog.startedAt,
        completedAt: minioSyncLog.completedAt,
        status: minioSyncLog.status,
        filesProcessed: minioSyncLog.filesProcessed,
        filesAdded: minioSyncLog.filesAdded,
        filesSkipped: minioSyncLog.filesSkipped,
        errorMessage: minioSyncLog.errorMessage,
        syncType: minioSyncLog.syncType,
        userId: minioSyncLog.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(minioSyncLog)
      .leftJoin(users, eq(minioSyncLog.userId, users.id))
      .orderBy(desc(minioSyncLog.startedAt))
      .limit(limit);

    // Transform the result to include user object
    const transformedLogs = logs.map((log) => ({
      id: log.id,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      status: log.status,
      filesProcessed: log.filesProcessed,
      filesAdded: log.filesAdded,
      filesSkipped: log.filesSkipped,
      errorMessage: log.errorMessage,
      syncType: log.syncType,
      user: log.userId
        ? {
            id: log.userId,
            name: log.userName,
            email: log.userEmail,
          }
        : null,
    }));

    return NextResponse.json({ logs: transformedLogs });
  } catch (error) {
    console.error("Get sync history API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
