import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { findUserByToken } from "@/services/sync";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import { generateEmbedding } from "@/lib/embedding";

export const dynamic = "force-dynamic";

interface SemanticSearchResult {
  id: string;
  timestamp: string;
  projectName: string | null;
  promptText: string;
  source: string | null;
  sessionId: string | null;
  similarity: number;
}

async function resolveUserId(request: NextRequest): Promise<string> {
  // Try cookie-based session auth first
  try {
    const session = await requireAuth();
    return session.userId;
  } catch {
    // Fall back to X-User-Token header (CLI auth)
    const token = request.headers.get("X-User-Token");
    if (!token) {
      throw new AuthError("Authentication required", 401);
    }
    const user = await findUserByToken(token);
    if (!user) {
      throw new AuthError("Invalid user token", 401);
    }
    return user.id;
  }
}

/**
 * POST /api/search/semantic
 * Body: { query: string, limit?: number }
 *
 * Vector-based semantic search using pgvector cosine similarity.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);

    const rateCheck = await rateLimiters.search(userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    let body: { query?: string; limit?: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const query = body.query?.trim();
    const parsedLimit = typeof body.limit === "number" ? body.limit : 20;
    const limit = Math.max(1, Math.min(parsedLimit, 100));

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "Embedding service not configured or unavailable" },
        { status: 503 }
      );
    }

    const vectorLiteral = `[${queryEmbedding.join(",")}]`;

    // pgvector cosine distance: embedding <-> query_vector (lower is more similar)
    // We return 1 - distance as a similarity score for readability
    const rowsResult = await db.execute(sql`
      SELECT
        id,
        timestamp,
        project_name,
        LEFT(prompt_text, 300) as prompt_text,
        source,
        session_id,
        1 - (embedding <-> ${vectorLiteral}::vector) as similarity
      FROM prompts
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <-> ${vectorLiteral}::vector
      LIMIT ${limit}
    `);

    const rows = extractRows(rowsResult) as unknown as Record<string, unknown>[];

    const results: SemanticSearchResult[] = rows.map((row) => ({
      id: row.id as string,
      timestamp: String(row.timestamp),
      projectName: row.project_name as string | null,
      promptText: row.prompt_text as string,
      source: row.source as string | null,
      sessionId: row.session_id as string | null,
      similarity: Number(row.similarity),
    }));

    return NextResponse.json({
      results,
      mode: "semantic",
      query,
      limit,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Semantic search API error");
    return NextResponse.json(
      { error: "Semantic search failed" },
      { status: 500 }
    );
  }
}
