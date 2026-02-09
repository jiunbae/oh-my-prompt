import { NextRequest, NextResponse } from "next/server";
import { syncAll, findUserByToken } from "@/services/sync";
import { isMinioConfigured, testMinioConnection } from "@/lib/minio";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const tokenHeader = request.headers.get("X-User-Token") || request.headers.get("x-user-token");
    if (!tokenHeader) {
      return NextResponse.json({ success: false, error: "Missing X-User-Token" }, { status: 401 });
    }

    const user = await findUserByToken(tokenHeader);
    if (!user) {
      return NextResponse.json({ success: false, error: "Invalid user token" }, { status: 401 });
    }

    if (!isMinioConfigured()) {
      return NextResponse.json({ success: false, error: "MinIO not configured" }, { status: 503 });
    }

    const connected = await testMinioConnection();
    if (!connected) {
      return NextResponse.json({ success: false, error: "Cannot connect to MinIO" }, { status: 503 });
    }

    logger.info({ userId: user.id }, "Starting direct backfill sync");

    const result = await syncAll({
      userId: user.id,
      userToken: user.token,
      syncType: "manual",
    });

    logger.info({ userId: user.id, result }, "Backfill sync completed");

    return NextResponse.json({
      success: result.success,
      filesProcessed: result.filesProcessed,
      filesAdded: result.filesAdded,
      filesSkipped: result.filesSkipped,
      errors: result.errors?.slice(0, 10),
    });
  } catch (error) {
    logger.error({ error }, "Backfill sync error");
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
