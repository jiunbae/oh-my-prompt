import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, getDb } from "@/lib/auth";

/**
 * GET /api/sync/history - Get sync history for current user
 *
 * Query parameters:
 * - limit: Number of records to return (default: 10, max: 100)
 * - offset: Number of records to skip (default: 0)
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

    // Parse pagination parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") || "10", 10)),
      100
    );
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

    const { db } = await getDb();
    const { desc, eq, or, isNull, count, sql } = await import("drizzle-orm");
    const { minioSyncLog } = await import("@/db/schema");

    // Get total count for pagination
    const [countResult] = await db
      .select({ count: count() })
      .from(minioSyncLog)
      .where(
        or(
          eq(minioSyncLog.userId, session.userId),
          isNull(minioSyncLog.userId)
        )
      );

    const total = countResult?.count ?? 0;

    // Get sync history with pagination
    const syncLogs = await db
      .select()
      .from(minioSyncLog)
      .where(
        or(
          eq(minioSyncLog.userId, session.userId),
          isNull(minioSyncLog.userId)
        )
      )
      .orderBy(desc(minioSyncLog.startedAt))
      .limit(limit)
      .offset(offset);

    // Calculate duration for each sync entry
    const history = syncLogs.map((log) => {
      const startedAt = log.startedAt ? new Date(log.startedAt).getTime() : 0;
      const completedAt = log.completedAt
        ? new Date(log.completedAt).getTime()
        : Date.now();
      const duration = log.status === "running" ? 0 : completedAt - startedAt;

      return {
        id: log.id,
        startedAt: log.startedAt?.toISOString() ?? null,
        completedAt: log.completedAt?.toISOString() ?? null,
        status: log.status ?? "unknown",
        filesProcessed: log.filesProcessed ?? 0,
        filesAdded: log.filesAdded ?? 0,
        filesSkipped: log.filesSkipped ?? 0,
        syncType: log.syncType ?? "manual",
        duration,
      };
    });

    return NextResponse.json({
      history,
      total,
    });
  } catch (error) {
    console.error("Sync history API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
