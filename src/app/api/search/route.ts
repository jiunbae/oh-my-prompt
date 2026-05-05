import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";

export const dynamic = "force-dynamic";

type SearchMode = "keyword" | "semantic" | "hybrid";

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
 * GET /api/search?q=<query>&mode=keyword|semantic|hybrid&limit=20&page=1&project=<name>&source=<name>&from=<date>&to=<date>
 *
 * mode=keyword: existing tsvector full-text search (websearch_to_tsquery)
 * mode=semantic: pg_trgm trigram similarity (similarity(prompt_text, query) > 0.1)
 * mode=hybrid: combine both with weighted scores (0.4 * keyword + 0.6 * trigram)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const rateCheck = rateLimiters.search(session.userId);
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

    if (!query) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    if (!["keyword", "semantic", "hybrid"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode. Use: keyword, semantic, or hybrid" }, { status: 400 });
    }

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return NextResponse.json({ error: "Invalid limit. Must be between 1 and 100" }, { status: 400 });
    }

    const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const pageSize = Math.min(parsedLimit, 50);
    const offset = (page - 1) * pageSize;

    // Build filter conditions
    const filterConditions: ReturnType<typeof sql>[] = [
      sql`user_id = ${session.userId}`,
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

    // Build search condition based on mode
    let searchCondition: ReturnType<typeof sql>;
    let scoreExpression: ReturnType<typeof sql>;

    if (mode === "keyword") {
      searchCondition = sql`search_vector @@ websearch_to_tsquery('english', ${query})`;
      scoreExpression = sql`ts_rank(search_vector, websearch_to_tsquery('english', ${query}))`;
    } else if (mode === "semantic") {
      searchCondition = sql`prompt_text % ${query} AND similarity(prompt_text, ${query}) > 0.1`;
      scoreExpression = sql`similarity(prompt_text, ${query})`;
    } else {
      // hybrid
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
