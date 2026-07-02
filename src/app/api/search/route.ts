import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { db } from "@/db/client";
import { sql, and, eq } from "drizzle-orm";
import { teamMembers } from "@/db/schema";
import { extractRows } from "@/lib/drizzle-utils";
import { generateEmbedding } from "@/lib/embedding";

export const dynamic = "force-dynamic";

type SearchMode = "keyword" | "semantic" | "hybrid" | "vector";

interface SearchResult {
  id: string;
  timestamp: string;
  projectName: string | null;
  promptText: string;
  source: string | null;
  sessionId: string | null;
  score: number;
  matchType: SearchMode;
}

/**
 * GET /api/search?q=<query>&mode=keyword|semantic|hybrid|vector&limit=20&page=1&project=<name>&source=<name>&from=<date>&to=<date>
 *
 * mode=keyword: existing tsvector full-text search (websearch_to_tsquery)
 * mode=semantic: vector-based cosine similarity via pgvector (falls back to pg_trgm if unavailable)
 * mode=hybrid: combine both with weighted scores (0.4 * keyword + 0.6 * trigram)
 * mode=vector: explicit vector search only
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const rateCheck = await rateLimiters.search(session.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const mode = (searchParams.get("mode") || "hybrid") as SearchMode;
    const parsedLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    const parsedPage = parseInt(searchParams.get("page") ?? "1", 10);
    const projectFilter = searchParams.get("project")?.trim() || null;
    const sourceFilter = searchParams.get("source")?.trim() || null;
    const fromDate = searchParams.get("from")?.trim() || null;
    const toDate = searchParams.get("to")?.trim() || null;
    const teamId = searchParams.get("teamId")?.trim() || null;

    if (!query) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    if (!["keyword", "semantic", "hybrid", "vector"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode. Use: keyword, semantic, hybrid, or vector" }, { status: 400 });
    }

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return NextResponse.json({ error: "Invalid limit. Must be between 1 and 100" }, { status: 400 });
    }

    const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const pageSize = Math.min(parsedLimit, 50);
    const offset = (page - 1) * pageSize;

    // Verify team membership if teamId provided
    if (teamId) {
      const [membership] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, session.userId)
          )
        )
        .limit(1);
      if (!membership) {
        return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
      }
    }

    // Build filter conditions
    const filterConditions: ReturnType<typeof sql>[] = [
      teamId ? sql`team_id = ${teamId}` : sql`user_id = ${session.userId}`,
      sql`deleted_at IS NULL`,
    ];

    if (projectFilter) {
      filterConditions.push(sql`project_name = ${projectFilter}`);
    }
    if (sourceFilter) {
      filterConditions.push(sql`source = ${sourceFilter}`);
    }
    if (fromDate) {
      filterConditions.push(sql`timestamp >= ${fromDate}::timestamptz`);
    }
    if (toDate) {
      const toEnd = toDate + "T23:59:59.999Z";
      filterConditions.push(sql`timestamp <= ${toEnd}::timestamptz`);
    }

    // Vector search path: semantic or vector mode
    if (mode === "semantic" || mode === "vector") {
      const queryEmbedding = await generateEmbedding(query);

      if (queryEmbedding) {
        const vectorLiteral = `[${queryEmbedding.join(",")}]`;
        filterConditions.push(sql`embedding IS NOT NULL`);
        const whereClause = sql.join(filterConditions, sql` AND `);

        const [rowsResult, countResult] = await Promise.all([
          db.execute(sql`
            SELECT
              id,
              timestamp,
              project_name,
              LEFT(prompt_text, 300) as prompt_text,
              source,
              session_id,
              1 - (embedding <-> ${vectorLiteral}::vector) as score
            FROM prompts
            WHERE ${whereClause}
            ORDER BY embedding <-> ${vectorLiteral}::vector
            LIMIT ${pageSize} OFFSET ${offset}
          `),
          db.execute(sql`
            SELECT COUNT(*)::int as count
            FROM prompts
            WHERE ${whereClause}
          `),
        ]);

        const rows = extractRows(rowsResult) as unknown as Record<string, unknown>[];
        const countRows = extractRows(countResult) as unknown as Record<string, unknown>[];
        const total = Number(countRows[0]?.count ?? 0);

        const results: SearchResult[] = rows.map((row) => ({
          id: row.id as string,
          timestamp: String(row.timestamp),
          projectName: row.project_name as string | null,
          promptText: row.prompt_text as string,
          source: row.source as string | null,
          sessionId: row.session_id as string | null,
          score: Number(row.score),
          matchType: mode,
        }));

        return NextResponse.json({
          results,
          total,
          page,
          pageSize,
          mode,
          query,
        });
      }

      // Fallback to pg_trgm when embeddings unavailable
      if (mode === "semantic") {
        logger.info("Embedding provider unavailable, falling back to pg_trgm semantic search");
      } else if (mode === "vector") {
        return NextResponse.json(
          { error: "Embedding service not configured or unavailable" },
          { status: 503 }
        );
      }
    }

    // Build search condition based on mode (keyword, hybrid, or semantic fallback)
    let searchCondition: ReturnType<typeof sql>;
    let scoreExpression: ReturnType<typeof sql>;

    if (mode === "keyword") {
      searchCondition = sql`search_vector @@ websearch_to_tsquery('english', ${query})`;
      scoreExpression = sql`ts_rank(search_vector, websearch_to_tsquery('english', ${query}))`;
    } else {
      // semantic (fallback) or hybrid
      searchCondition = sql`(
        search_vector @@ websearch_to_tsquery('english', ${query})
        OR (prompt_text % ${query} AND similarity(prompt_text, ${query}) > 0.1)
      )`;
      scoreExpression = sql`(
        0.4 * (ts_rank(search_vector, websearch_to_tsquery('english', ${query})) / (1.0 + ts_rank(search_vector, websearch_to_tsquery('english', ${query})))) +
        0.6 * COALESCE(similarity(prompt_text, ${query}), 0)
      )`;
    }

    filterConditions.push(searchCondition);
    const whereClause = sql.join(filterConditions, sql` AND `);

    const [rowsResult, countResult] = await Promise.all([
      db.execute(sql`
        SELECT
          id,
          timestamp,
          project_name,
          LEFT(prompt_text, 300) as prompt_text,
          source,
          session_id,
          ${scoreExpression} as score
        FROM prompts
        WHERE ${whereClause}
        ORDER BY score DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int as count
        FROM prompts
        WHERE ${whereClause}
      `),
    ]);

    const rows = extractRows(rowsResult) as unknown as Record<string, unknown>[];
    const countRows = extractRows(countResult) as unknown as Record<string, unknown>[];
    const total = Number(countRows[0]?.count ?? 0);

    const results: SearchResult[] = rows.map((row) => ({
      id: row.id as string,
      timestamp: String(row.timestamp),
      projectName: row.project_name as string | null,
      promptText: row.prompt_text as string,
      source: row.source as string | null,
      sessionId: row.session_id as string | null,
      score: Number(row.score),
      matchType: mode,
    }));

    return NextResponse.json({
      results,
      total,
      page,
      pageSize,
      mode,
      query,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Search API error");
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
