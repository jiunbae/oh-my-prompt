import { NextRequest, NextResponse } from "next/server";
import {
  getLastSyncStatus,
  isSyncRunning,
  findUserByToken,
} from "@/services/sync";
import { isMinioConfigured, testMinioConnection } from "@/lib/minio";
import { syncQueue } from "@/lib/queue";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    if (!isMinioConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: "MinIO client is not properly configured. Check environment variables.",
        },
        { status: 503 }
      );
    }

    let userId: string | undefined;
    let userToken: string | undefined;

    const tokenHeader = request.headers.get("X-User-Token");
    if (tokenHeader) {
      const user = await findUserByToken(tokenHeader);
      if (!user) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid user token",
          },
          { status: 401 }
        );
      }
      userId = user.id;
      userToken = user.token;
      logger.info({ email: user.email }, "Sync requested by user (token auth)");
    } else {
      const headerUserId = request.headers.get("x-user-id");
      const headerUserToken = request.headers.get("x-user-token");

      if (headerUserId && headerUserToken) {
        userId = headerUserId;
        userToken = headerUserToken;
        logger.info({ userId: headerUserId }, "Sync requested by user (session auth)");
      }
    }

    if (!userId || !userToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required",
        },
        { status: 401 }
      );
    }

    const running = await isSyncRunning();
    if (running) {
      return NextResponse.json(
        {
          success: false,
          error: "A sync operation is already in progress",
        },
        { status: 409 }
      );
    }

    const connected = await testMinioConnection();
    if (!connected) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to connect to MinIO. Check credentials and endpoint.",
        },
        { status: 503 }
      );
    }

    let body: { type?: string; since?: string; syncType?: string } = {};
    try {
      body = await request.json();
    } catch {
    }

    const operationType = body.type || "full";
    const syncPurpose = (body.syncType as "manual" | "auto" | "cron") || "manual";

    const job = await syncQueue.add(`sync-${userId}`, {
      userId,
      userToken,
      syncType: syncPurpose,
      incremental: operationType === "incremental",
      since: body.since,
    });

    logger.info(
      { jobId: job.id, userId, operationType },
      "Enqueued sync job"
    );

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: "Sync job enqueued successfully",
      type: operationType,
      syncType: syncPurpose,
    });
  } catch (error) {
    logger.error({ error }, "Sync API error");
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync - Get sync status
 *
 * Query parameters:
 * - check: "connection" - Test MinIO connection only
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const check = searchParams.get("check");

    // If checking connection only
    if (check === "connection") {
      if (!isMinioConfigured()) {
        return NextResponse.json({
          configured: false,
          connected: false,
          message: "MinIO environment variables are not set",
        });
      }

      const connected = await testMinioConnection();
      return NextResponse.json({
        configured: true,
        connected,
        message: connected
          ? "Successfully connected to MinIO"
          : "Failed to connect to MinIO",
      });
    }

    // Get sync status
    const lastSync = await getLastSyncStatus();
    const running = await isSyncRunning();

    return NextResponse.json({
      lastSync,
      isRunning: running,
      minioConfigured: isMinioConfigured(),
    });
  } catch (error) {
    console.error("Sync status API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
