import { NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { count, desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();

    const totalUsers = await db.select({ count: count() }).from(schema.users);
    const totalPrompts = await db.select({ count: count() }).from(schema.prompts);

    const recentSyncs = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.lastLoginAt))
      .limit(10);

    return NextResponse.json({
      users: totalUsers[0].count,
      prompts: totalPrompts[0].count,
      recentActivity: recentSyncs,
    });
  } catch (error) {
    logger.error({ err: error }, "Sync monitoring error");
    return NextResponse.json({ error: "Failed to fetch sync status" }, { status: 500 });
  }
}
