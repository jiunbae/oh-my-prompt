import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

export interface SharedSessionPrompt {
  id: string;
  promptText: string;
  responseText: string | null;
  timestamp: Date;
  projectName: string | null;
  source: string | null;
  promptType: string | null;
  tokenEstimate: number | null;
  tokenEstimateResponse: number | null;
}

export interface SharedSessionData {
  sessionId: string;
  projectName: string | null;
  source: string | null;
  startedAt: Date;
  endedAt: Date;
  promptCount: number;
  sharedAt: Date | null;
  prompts: SharedSessionPrompt[];
}

/**
 * Fetch a shared session by token.
 * Validates token, checks active/expiry status, and fetches all prompts.
 *
 * @param incrementViewCount - When true, increments the view counter.
 *   Use false for metadata prefetches (crawlers, generateMetadata) to avoid inflating counts.
 */
export async function getSharedSession(
  token: string,
  options: { incrementViewCount?: boolean } = {}
): Promise<SharedSessionData | null> {
  try {
    const [shared] = await db
      .select()
      .from(schema.sharedSessions)
      .where(
        and(
          eq(schema.sharedSessions.shareToken, token),
          eq(schema.sharedSessions.isActive, true)
        )
      )
      .limit(1);

    if (!shared) return null;
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) return null;

    const prompts = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        source: schema.prompts.source,
        promptType: schema.prompts.promptType,
        tokenEstimate: schema.prompts.tokenEstimate,
        tokenEstimateResponse: schema.prompts.tokenEstimateResponse,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.sessionId, shared.sessionId),
          eq(schema.prompts.userId, shared.userId)
        )
      )
      .orderBy(asc(schema.prompts.timestamp));

    if (prompts.length === 0) return null;

    if (options.incrementViewCount) {
      await db
        .update(schema.sharedSessions)
        .set({ viewCount: sql`${schema.sharedSessions.viewCount} + 1` })
        .where(eq(schema.sharedSessions.id, shared.id));
    }

    const first = prompts[0];
    const last = prompts[prompts.length - 1];

    return {
      sessionId: shared.sessionId,
      projectName: first.projectName,
      source: first.source,
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      promptCount: prompts.length,
      sharedAt: shared.createdAt,
      prompts,
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching shared session");
    return null;
  }
}
