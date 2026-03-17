import { cache } from "react";
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

export type SharedSessionError = "not_found" | "expired";

export type SharedSessionResult =
  | { data: SharedSessionData; error?: never }
  | { data?: never; error: SharedSessionError };

/**
 * Core fetch logic for a shared session. Wrapped with React cache() to
 * deduplicate DB calls within the same server request (e.g., generateMetadata + page render).
 */
const fetchSharedSessionData = cache(async (token: string): Promise<SharedSessionResult> => {
  try {
    const [shared] = await db
      .select({
        id: schema.sharedSessions.id,
        sessionId: schema.sharedSessions.sessionId,
        userId: schema.sharedSessions.userId,
        expiresAt: schema.sharedSessions.expiresAt,
        createdAt: schema.sharedSessions.createdAt,
      })
      .from(schema.sharedSessions)
      .where(
        and(
          eq(schema.sharedSessions.shareToken, token),
          eq(schema.sharedSessions.isActive, true)
        )
      )
      .limit(1);

    if (!shared) return { error: "not_found" };
    if (shared.expiresAt && new Date(shared.expiresAt) < new Date()) return { error: "expired" };

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

    if (prompts.length === 0) return { error: "not_found" };

    const first = prompts[0];
    const last = prompts[prompts.length - 1];

    return {
      data: {
        sessionId: shared.sessionId,
        projectName: first.projectName,
        source: first.source,
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        promptCount: prompts.length,
        sharedAt: shared.createdAt,
        prompts,
      },
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching shared session");
    return { error: "not_found" };
  }
});

/**
 * Fetch a shared session by token.
 * Validates token, checks active/expiry status, and fetches all prompts.
 *
 * Uses React cache() to deduplicate DB calls within the same server request
 * (e.g., generateMetadata + page render share a single fetch).
 *
 * @param incrementViewCount - When true, increments the view counter.
 *   Use false for metadata prefetches (crawlers, generateMetadata) to avoid inflating counts.
 */
export async function getSharedSession(
  token: string,
  options: { incrementViewCount?: boolean } = {}
): Promise<SharedSessionResult> {
  const result = await fetchSharedSessionData(token);

  if (result.data && options.incrementViewCount) {
    // Increment in a separate try/catch so failures don't prevent
    // returning the already-fetched session data
    try {
      await db
        .update(schema.sharedSessions)
        .set({ viewCount: sql`${schema.sharedSessions.viewCount} + 1` })
        .where(
          and(
            eq(schema.sharedSessions.shareToken, token),
            eq(schema.sharedSessions.isActive, true)
          )
        );
    } catch (error) {
      logger.error({ err: error }, "Failed to increment shared session view count");
    }
  }

  return result;
}
