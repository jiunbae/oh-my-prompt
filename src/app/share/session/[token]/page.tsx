import { notFound } from "next/navigation";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { SharedSessionView } from "@/components/shared-session-view";

export const dynamic = "force-dynamic";

interface SharedSessionData {
  sessionId: string;
  projectName: string | null;
  source: string | null;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  prompts: {
    id: string;
    promptText: string;
    responseText: string | null;
    timestamp: string;
    tokenEstimate: number | null;
    tokenEstimateResponse: number | null;
  }[];
}

async function getSharedSessionReadOnly(token: string): Promise<SharedSessionData | null> {
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

    const first = prompts[0];
    const last = prompts[prompts.length - 1];

    return {
      sessionId: shared.sessionId,
      projectName: first.projectName,
      source: first.source,
      startedAt: first.timestamp.toISOString(),
      endedAt: last.timestamp.toISOString(),
      promptCount: prompts.length,
      prompts: prompts.map((p) => ({
        id: p.id,
        promptText: p.promptText,
        responseText: p.responseText,
        timestamp: p.timestamp.toISOString(),
        tokenEstimate: p.tokenEstimate,
        tokenEstimateResponse: p.tokenEstimateResponse,
      })),
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching shared session (read-only)");
    return null;
  }
}

async function getSharedSessionAndIncrement(token: string): Promise<SharedSessionData | null> {
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

    // Increment view count
    await db
      .update(schema.sharedSessions)
      .set({ viewCount: sql`${schema.sharedSessions.viewCount} + 1` })
      .where(eq(schema.sharedSessions.id, shared.id));

    const first = prompts[0];
    const last = prompts[prompts.length - 1];

    return {
      sessionId: shared.sessionId,
      projectName: first.projectName,
      source: first.source,
      startedAt: first.timestamp.toISOString(),
      endedAt: last.timestamp.toISOString(),
      promptCount: prompts.length,
      prompts: prompts.map((p) => ({
        id: p.id,
        promptText: p.promptText,
        responseText: p.responseText,
        timestamp: p.timestamp.toISOString(),
        tokenEstimate: p.tokenEstimate,
        tokenEstimateResponse: p.tokenEstimateResponse,
      })),
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching shared session");
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSharedSessionReadOnly(token);

  if (!session) {
    return { title: "Shared Session - Oh My Prompt" };
  }

  return {
    title: `Shared Session${session.projectName ? ` - ${session.projectName}` : ""} (${session.promptCount} prompts) | Oh My Prompt`,
    description: `A shared coding session with ${session.promptCount} prompts${session.projectName ? ` in ${session.projectName}` : ""}`,
  };
}

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSharedSessionAndIncrement(token);

  if (!session) {
    notFound();
  }

  return (
    <SharedSessionView
      sessionId={session.sessionId}
      projectName={session.projectName}
      source={session.source}
      startedAt={session.startedAt}
      endedAt={session.endedAt}
      promptCount={session.promptCount}
      prompts={session.prompts}
    />
  );
}
