import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const READINESS_TIMEOUT_MS = 2_500;

async function withTimeout<T>(operation: Promise<T>, name: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${name} readiness check timed out`)),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    await withTimeout(db.execute(sql`select 1`), "database");

    if (process.env.QUEUE_ENABLED === "true") {
      await withTimeout(redis.ping(), "redis");
    }

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error({ err: error }, "Readiness check failed");
    return NextResponse.json(
      { ok: false, error: "Service dependencies are unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
