import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/with-auth";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();

    const redisStatus = redis.status === "ready" ? "connected" : "disconnected";

    return NextResponse.json({
      redis: redisStatus,
      presets: [
        { name: "auth", maxRequests: 10, windowMs: 60000 },
        { name: "search", maxRequests: 30, windowMs: 60000 },
        { name: "webhookTest", maxRequests: 5, windowMs: 60000 },
        { name: "api", maxRequests: 100, windowMs: 60000 },
        { name: "llm", maxRequests: 10, windowMs: 60000 },
      ],
    });
  } catch (error) {
    logger.error({ err: error }, "Rate limit monitoring error");
    return NextResponse.json({ error: "Failed to fetch rate limits" }, { status: 500 });
  }
}
