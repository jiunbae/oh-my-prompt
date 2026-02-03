import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, getDb } from "@/lib/auth";

/**
 * GET /api/sync/status - Get last sync status for current user
 *
 * Returns the most recent sync operation status for the authenticated user.
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

    const { db } = await getDb();
    const { desc, eq, or, isNull } = await import("drizzle-orm");
    const { minioSyncLog } = await import("@/db/schema");

    // Get the last sync for this user (or global syncs with no user_id)
    const [lastSync] = await db
      .select()
      .from(minioSyncLog)
      .where(
        or(
          eq(minioSyncLog.userId, session.userId),
          isNull(minioSyncLog.userId)
        )
      )
      .orderBy(desc(minioSyncLog.startedAt))
      .limit(1);

    // Check if any sync is currently running
    const [runningSync] = await db
      .select()
      .from(minioSyncLog)
      .where(eq(minioSyncLog.status, "running"))
      .limit(1);

    const isRunning = !!runningSync;

    if (!lastSync) {
      return NextResponse.json({
        lastSync: null,
        isRunning,
      });
    }

    return NextResponse.json({
      lastSync: {
        id: lastSync.id,
        startedAt: lastSync.startedAt?.toISOString() ?? null,
        completedAt: lastSync.completedAt?.toISOString() ?? null,
        status: lastSync.status as "running" | "completed" | "failed",
        filesProcessed: lastSync.filesProcessed ?? 0,
        filesAdded: lastSync.filesAdded ?? 0,
        filesSkipped: lastSync.filesSkipped ?? 0,
        syncType: (lastSync.syncType as "manual" | "auto" | "cron") ?? "manual",
        errorMessage: lastSync.errorMessage,
      },
      isRunning,
    });
  } catch (error) {
    console.error("Sync status API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
