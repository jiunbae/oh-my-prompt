import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { suggestRewrite, getSuggestionProvider } from "@/lib/suggestions";
import { checkIsAdmin } from "@/lib/with-auth";

export const dynamic = "force-dynamic";

const VALID_GOALS = ["clarity", "conciseness", "specificity", "debugging"] as const;
type Goal = typeof VALID_GOALS[number];

function isValidGoal(goal: string): goal is Goal {
  return VALID_GOALS.includes(goal as Goal);
}

/**
 * POST /api/prompts/[id]/suggest
 *
 * Get an AI-powered rewrite suggestion for a prompt.
 * Body: { goal?: "clarity" | "conciseness" | "specificity" | "debugging" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const userId = session.userId;

    const rateCheck = await rateLimiters.llm(userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    if (!getSuggestionProvider()) {
      return NextResponse.json(
        { error: "No LLM provider configured. Set SUGGESTION_PROVIDER or EMBEDDING_API_URL." },
        { status: 503 }
      );
    }

    let body: { goal?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const goal = body.goal ?? "clarity";
    if (!isValidGoal(goal)) {
      return NextResponse.json(
        { error: `Invalid goal. Must be one of: ${VALID_GOALS.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch prompt text from DB
    const isAdmin = await checkIsAdmin(userId);
    const whereCondition = isAdmin
      ? and(eq(schema.prompts.id, id), isNull(schema.prompts.deletedAt))
      : and(
          eq(schema.prompts.id, id),
          eq(schema.prompts.userId, userId),
          isNull(schema.prompts.deletedAt)
        );

    const [prompt] = await db
      .select({ promptText: schema.prompts.promptText })
      .from(schema.prompts)
      .where(whereCondition)
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const result = await suggestRewrite(prompt.promptText, goal);

    if (!result) {
      return NextResponse.json(
        { error: "Suggestion generation failed. The LLM provider may be unavailable." },
        { status: 503 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Suggest rewrite API error");
    return NextResponse.json(
      { error: "Failed to generate suggestion" },
      { status: 500 }
    );
  }
}
