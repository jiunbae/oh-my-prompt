import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/with-auth";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();

    const redisStatus = redis.status === "ready" ? "connected" : "disconnected";

    let dbStatus = "unknown";
    try {
      await db.execute(sql`SELECT 1`);
      dbStatus = "connected";
    } catch {
      dbStatus = "error";
    }

    return NextResponse.json({
      database: dbStatus,
      redis: redisStatus,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    logger.error({ err: error }, "System monitoring error");
    return NextResponse.json({ error: "Failed to fetch system status" }, { status: 500 });
  }
}
