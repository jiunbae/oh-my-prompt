import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { handler as sessionStoryHandler } from "@/extensions/session-story/processor";
import {
  getCachedInsight,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";
import { getLastNDaysRange } from "@/lib/date-utils";
import { getRequestLocale } from "@/i18n/server-locale";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const session = await requireAuth();
    const locale = await getRequestLocale(request.headers);

    const rl = await rateLimiters.llm(session.userId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
    }
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";

    // Check cache first (scoped to the user's locale)
    const cacheKey = `session-story:${sessionId}`;
    if (!refresh) {
      const cached = await getCachedInsight(session.userId, cacheKey, locale);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true });
      }
    }

    // Generate fresh session story
    const last30Days = getLastNDaysRange(30);

    const result = await sessionStoryHandler({
      userId: session.userId,
      dateRange: {
        from: last30Days.fromKey,
        to: last30Days.toKey,
      },
      parameters: { sessionId },
      locale,
    });

    // Cache the result (24 hours)
    await cacheInsight(session.userId, cacheKey, result, {
      parameters: { sessionId },
      dataHash: hashData({ sessionId, userId: session.userId, locale }),
      ttlHours: 24,
      locale,
    });

    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Session story API error");
    return NextResponse.json(
      { error: "Failed to generate session story" },
      { status: 500 },
    );
  }
}
