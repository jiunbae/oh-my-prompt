import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { prompts, teamMembers, users } from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { rateLimiters } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { eq, and, isNull, gte, desc } from "drizzle-orm";
import { teamPromptViewConditionForMember } from "@/lib/team-access";

export const dynamic = "force-dynamic";

interface ActivityEvent {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  promptText: string;
  projectName: string | null;
  createdAt: string;
  type: "prompt";
}

/**
 * GET /api/teams/:id/activity/stream - SSE endpoint for real-time team activity
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Rate limit: max 5 concurrent SSE connections per user
    const rateLimit = await rateLimiters.teamActivity(session.userId);
    if (!rateLimit.allowed) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    // Verify team membership
    const [membership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, id),
          eq(teamMembers.userId, session.userId)
        )
      )
      .limit(1);

    if (!membership) {
      return new Response("Team not found or access denied", { status: 403 });
    }

    // Fetch initial burst: last 20 prompts
    const initialPrompts = await db
      .select({
        id: prompts.id,
        userId: prompts.userId,
        promptText: prompts.promptText,
        projectName: prompts.projectName,
        createdAt: prompts.timestamp,
        userName: users.name,
        userEmail: users.email,
      })
      .from(prompts)
      .leftJoin(users, eq(prompts.userId, users.id))
      .where(
        and(
          eq(prompts.teamId, id),
          teamPromptViewConditionForMember(session.userId),
          isNull(prompts.deletedAt)
        )
      )
      .orderBy(desc(prompts.timestamp))
      .limit(20);

    // Reverse so oldest of the burst is first (chronological order for chat feel)
    const initialEvents: ActivityEvent[] = initialPrompts
      .reverse()
      .map((p) => ({
        id: p.id,
        userId: p.userId ?? "",
        userName: p.userName,
        userEmail: p.userEmail ?? "unknown",
        promptText: p.promptText,
        projectName: p.projectName,
        createdAt: p.createdAt?.toISOString() ?? new Date().toISOString(),
        type: "prompt" as const,
      }));

    let lastSentAt = new Date(0);
    if (initialEvents.length > 0) {
      lastSentAt = new Date(initialEvents[initialEvents.length - 1].createdAt);
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Send initial burst
        for (const event of initialEvents) {
          const payload = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }

        // Send a heartbeat/ping immediately after burst
        controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));

        // Polling loop: check for new prompts every 2s
        const intervalMs = 2000;
        let running = true;

        // Handle abort signal
        const abortHandler = () => {
          running = false;
        };
        request.signal.addEventListener("abort", abortHandler);

        while (running) {
          if (request.signal.aborted) {
            break;
          }

          try {
            const newPrompts = await db
              .select({
                id: prompts.id,
                userId: prompts.userId,
                promptText: prompts.promptText,
                projectName: prompts.projectName,
                createdAt: prompts.timestamp,
                userName: users.name,
                userEmail: users.email,
              })
              .from(prompts)
              .leftJoin(users, eq(prompts.userId, users.id))
              .where(
                and(
                  eq(prompts.teamId, id),
                  teamPromptViewConditionForMember(session.userId),
                  isNull(prompts.deletedAt),
                  gte(prompts.timestamp, new Date(lastSentAt.getTime() + 1)) // avoid re-sending exact same
                )
              )
              .orderBy(desc(prompts.timestamp))
              .limit(50);

            // Send in chronological order (oldest first)
            for (const p of newPrompts.reverse()) {
              const event: ActivityEvent = {
                id: p.id,
                userId: p.userId ?? "",
                userName: p.userName,
                userEmail: p.userEmail ?? "unknown",
                promptText: p.promptText,
                projectName: p.projectName,
                createdAt: p.createdAt?.toISOString() ?? new Date().toISOString(),
                type: "prompt",
              };
              const payload = JSON.stringify(event);
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              lastSentAt = new Date(event.createdAt);
            }

            // Periodic heartbeat
            controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
          } catch (err) {
            logger.error({ err }, "SSE poll error");
            controller.enqueue(encoder.encode(`event: error\ndata: {"message":"poll failed"}\n\n`));
          }

          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        request.signal.removeEventListener("abort", abortHandler);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: error.status });
    }
    logger.error({ err: error }, "Team activity SSE error");
    return new Response("Internal server error", { status: 500 });
  }
}
