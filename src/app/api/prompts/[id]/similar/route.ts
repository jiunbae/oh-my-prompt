import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { findSimilarPrompts } from "@/lib/suggestions";
import { checkIsAdmin } from "@/lib/with-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/prompts/[id]/similar?limit=5
 *
 * Find prompts most similar to the given prompt using pgvector cosine distance.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const userId = session.userId;

    const rateCheck = rateLimiters.search(userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : 5;
    const limit = Math.max(1, Math.min(parsedLimit, 50));

    const isAdmin = await checkIsAdmin(userId);
    const results = await findSimilarPrompts(id, limit, userId, isAdmin);

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      if (error.message === "Prompt not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message === "Access denied") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message === "Embedding not generated yet") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    logger.error({ err: error }, "Similar prompts API error");
    return NextResponse.json(
      { error: "Failed to find similar prompts" },
      { status: 500 }
    );
  }
}
