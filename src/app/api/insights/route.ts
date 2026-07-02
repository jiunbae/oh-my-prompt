import { NextRequest, NextResponse } from "next/server";
import { requireAuth, checkIsAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import {
  getCachedInsight,
  getUserInsights,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";
import { getExtension } from "@/extensions/registry";
import type { InsightResult } from "@/extensions/types";
import { getLastNDaysRange } from "@/lib/date-utils";
import { getRequestLocale } from "@/i18n/server-locale";

/**
 * Insight types that operate ONLY on the calling user's own data and have no
 * global side effects. These are safe to generate on-demand for any
 * authenticated user.
 *
 * Everything NOT in this set (email-digest, slack-daily, alert-evaluator, ...)
 * fans out over ALL users and/or sends outbound notifications, so on-demand
 * generation must be restricted to admins.
 */
const PER_USER_INSIGHT_TYPES = new Set<string>([
  "daily-summary",
  "weekly-trends",
  "session-story",
  "prompt-quality",
]);

/**
 * GET /api/insights
 * Returns all cached insights for the authenticated user.
 * Optional query param: ?type=daily-summary to get a specific insight.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const locale = await getRequestLocale(request.headers);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (type) {
      const insight = await getCachedInsight(session.userId, type, locale);
      return NextResponse.json({ insight });
    }

    const insights = await getUserInsights(session.userId, locale);
    return NextResponse.json({ insights });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Insights GET error");
    return NextResponse.json(
      { error: "Failed to load insights" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/insights
 * Generates a new insight on-demand.
 * Body: { type: string, dateRange?: { from: string, to: string } }
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { type, dateRange } = body as {
      type?: string;
      dateRange?: { from: string; to: string };
    };

    if (!type || typeof type !== "string") {
      return NextResponse.json(
        { error: "Missing required field: type" },
        { status: 400 },
      );
    }

    // Global-side-effect job types (email-digest, slack-daily, alert-evaluator)
    // must never be triggerable by ordinary users. Only per-user insight
    // processors that read the caller's OWN data may run on demand.
    if (!PER_USER_INSIGHT_TYPES.has(type)) {
      const isAdmin = await checkIsAdmin(session.userId);
      if (!isAdmin) {
        return NextResponse.json(
          { error: "Admin access required to run this insight type" },
          { status: 403 },
        );
      }
    }

    const ext = getExtension(type);
    if (!ext?.processor) {
      return NextResponse.json(
        { error: `Extension "${type}" not found or has no processor` },
        { status: 404 },
      );
    }

    const defaultRange = getLastNDaysRange(ext.processor.defaultRangeDays ?? 7);

    const resolvedRange = dateRange || {
      from: defaultRange.fromKey,
      to: defaultRange.toKey,
    };

    const processorInput = {
      userId: session.userId,
      dateRange: resolvedRange,
      locale,
    };

    const result: InsightResult = await ext.processor.handler(processorInput);

    await cacheInsight(session.userId, type, result, {
      dataHash: hashData(processorInput),
      ttlHours: ext.cacheTtlHours ?? 24,
      locale,
    });

    return NextResponse.json({ insight: result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Insights POST error");
    return NextResponse.json(
      { error: "Failed to generate insight" },
      { status: 500 },
    );
  }
}
