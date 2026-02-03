import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, getDb } from "@/lib/auth";

/**
 * GET /api/admin/sync-settings - Get global sync settings
 *
 * Requires admin privileges.
 * Returns the global sync settings (settings with null user_id).
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

    const { db } = await getDb();
    const { isNull } = await import("drizzle-orm");
    const { syncSettings } = await import("@/db/schema");

    // Get global settings (where userId is null)
    const [settings] = await db
      .select()
      .from(syncSettings)
      .where(isNull(syncSettings.userId))
      .limit(1);

    // Return defaults if no settings exist
    return NextResponse.json({
      autoSyncEnabled: settings?.autoSyncEnabled ?? false,
      syncIntervalMinutes: settings?.syncIntervalMinutes ?? 10,
    });
  } catch (error) {
    console.error("Get sync settings API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/sync-settings - Update global sync settings
 *
 * Requires admin privileges.
 * Request body:
 * - autoSyncEnabled?: boolean
 * - syncIntervalMinutes?: number (minimum: 1)
 */
export async function PUT(request: NextRequest) {
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

    // Parse request body
    let body: {
      autoSyncEnabled?: boolean;
      syncIntervalMinutes?: number;
    } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Validate syncIntervalMinutes if provided
    if (
      body.syncIntervalMinutes !== undefined &&
      (typeof body.syncIntervalMinutes !== "number" ||
        body.syncIntervalMinutes < 1)
    ) {
      return NextResponse.json(
        { error: "syncIntervalMinutes must be a positive number" },
        { status: 400 }
      );
    }

    const { db } = await getDb();
    const { isNull, eq } = await import("drizzle-orm");
    const { syncSettings } = await import("@/db/schema");

    // Check if global settings exist
    const [existingSettings] = await db
      .select()
      .from(syncSettings)
      .where(isNull(syncSettings.userId))
      .limit(1);

    const updateData: {
      autoSyncEnabled?: boolean;
      syncIntervalMinutes?: number;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (body.autoSyncEnabled !== undefined) {
      updateData.autoSyncEnabled = body.autoSyncEnabled;
    }
    if (body.syncIntervalMinutes !== undefined) {
      updateData.syncIntervalMinutes = body.syncIntervalMinutes;
    }

    let result;
    if (existingSettings) {
      // Update existing settings
      [result] = await db
        .update(syncSettings)
        .set(updateData)
        .where(eq(syncSettings.id, existingSettings.id))
        .returning();
    } else {
      // Create new global settings
      [result] = await db
        .insert(syncSettings)
        .values({
          userId: null,
          autoSyncEnabled: body.autoSyncEnabled ?? false,
          syncIntervalMinutes: body.syncIntervalMinutes ?? 10,
        })
        .returning();
    }

    return NextResponse.json({
      autoSyncEnabled: result.autoSyncEnabled ?? false,
      syncIntervalMinutes: result.syncIntervalMinutes ?? 10,
    });
  } catch (error) {
    console.error("Update sync settings API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
