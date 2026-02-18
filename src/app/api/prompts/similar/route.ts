import { NextRequest, NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { computeSimilarity } from "@/lib/prompt-diff";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "5", 10), 20);

    if (!id) {
      return NextResponse.json(
        { error: "Prompt 'id' is required" },
        { status: 400 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 }
      );
    }

    const client = postgres(connectionString);
    const db = drizzle(client, { schema });

    // Fetch the source prompt
    const ownershipCondition = session.isAdmin
      ? eq(schema.prompts.id, id)
      : and(eq(schema.prompts.id, id), eq(schema.prompts.userId, session.userId));

    const [sourcePrompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        projectName: schema.prompts.projectName,
        sessionId: schema.prompts.sessionId,
        userId: schema.prompts.userId,
        searchVector: schema.prompts.searchVector,
      })
      .from(schema.prompts)
      .where(ownershipCondition)
      .limit(1);

    if (!sourcePrompt) {
      await client.end();
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    // Use PostgreSQL ts_rank with search_vector for fast similarity search.
    // We extract significant words from the prompt to build a tsquery,
    // then rank matching prompts by relevance.
    const words = sourcePrompt.promptText
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 15);

    if (words.length === 0) {
      await client.end();
      return NextResponse.json({ prompts: [] });
    }

    const tsquery = words.map((w) => w.replace(/'/g, "")).join(" | ");

    // Build ownership filter for candidates
    const userFilter = session.isAdmin
      ? sql`TRUE`
      : sql`${schema.prompts.userId} = ${session.userId}`;

    const candidates = await db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptText: schema.prompts.promptText,
        rank: sql<number>`ts_rank(${schema.prompts.searchVector}, to_tsquery('english', ${tsquery}))`,
      })
      .from(schema.prompts)
      .where(
        and(
          ne(schema.prompts.id, id),
          sql`${schema.prompts.searchVector} @@ to_tsquery('english', ${tsquery})`,
          sql`${userFilter}`
        )
      )
      .orderBy(
        sql`ts_rank(${schema.prompts.searchVector}, to_tsquery('english', ${tsquery})) DESC`
      )
      .limit(limit * 3); // Fetch extra to re-rank with Jaccard

    await client.end();

    // Re-rank candidates using Jaccard similarity for better accuracy
    const ranked = candidates
      .map((c) => ({
        id: c.id,
        timestamp: c.timestamp,
        projectName: c.projectName,
        similarity: computeSimilarity(sourcePrompt.promptText, c.promptText),
        firstLine: c.promptText.split("\n")[0].slice(0, 120),
      }))
      .filter((c) => c.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return NextResponse.json({ prompts: ranked });
  } catch (error) {
    console.error("Similar prompts API error:", error);
    return NextResponse.json(
      { error: "Failed to find similar prompts" },
      { status: 500 }
    );
  }
}
