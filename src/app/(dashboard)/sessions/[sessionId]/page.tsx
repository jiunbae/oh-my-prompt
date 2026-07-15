import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/with-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SessionThread } from "@/components/session-thread";
import { SessionNotes } from "@/components/session-notes";
import { SessionStoryButton } from "@/components/insights/session-story-button";
import { SessionNameEditor } from "@/components/session-name-editor";
import { ShareSessionButton } from "@/components/share-session-button";
import { FavoriteSessionButton } from "@/components/favorite-session-button";
import { teamPromptViewConditionForMember } from "@/lib/team-access";
import { z } from "zod";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

interface SessionDetailPageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ teamId?: string; ownerId?: string }>;
}

const teamSessionScopeSchema = z.object({
  teamId: z.string().uuid(),
  ownerId: z.string().uuid(),
});

function buildSessionFallbackName(
  sessionId: string,
  projectName: string | null,
  firstPrompt: string,
): string {
  if (projectName?.trim()) return projectName.trim();
  const firstLine = firstPrompt
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) {
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }
  return `Session ${sessionId.slice(0, 12)}`;
}

export default async function SessionDetailPage({ params, searchParams }: SessionDetailPageProps) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const hasTeamScope = Boolean(query.teamId || query.ownerId);
  const parsedTeamScope = hasTeamScope
    ? teamSessionScopeSchema.safeParse({ teamId: query.teamId, ownerId: query.ownerId })
    : null;
  if (parsedTeamScope && !parsedTeamScope.success) notFound();

  const teamScope = parsedTeamScope?.success ? parsedTeamScope.data : null;
  if (teamScope) {
    const [membership] = await db
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamScope.teamId),
          eq(schema.teamMembers.userId, user.userId),
        ),
      )
      .limit(1);
    if (!membership) notFound();
  }

  const sessionConditions = and(
    eq(schema.prompts.sessionId, sessionId),
    teamScope
      ? and(
          eq(schema.prompts.teamId, teamScope.teamId),
          eq(schema.prompts.userId, teamScope.ownerId),
          teamPromptViewConditionForMember(user.userId),
        )
      : eq(schema.prompts.userId, user.userId),
    isNull(schema.prompts.deletedAt)
  );

  const prompts = await db.query.prompts.findMany({
    where: sessionConditions,
    orderBy: [desc(schema.prompts.timestamp)],
    with: {
      promptTags: {
        with: {
          tag: true,
        },
      },
    },
  });

  if (prompts.length === 0) {
    notFound();
  }

  const first = prompts[prompts.length - 1]; // oldest (query is DESC)
  const last = prompts[0]; // newest
  const sessionOwnerId = first.userId;
  const canRename = sessionOwnerId === user.userId;
  const [displayName] = canRename
    ? await db
        .select({ displayName: schema.sessionDisplayNames.displayName })
        .from(schema.sessionDisplayNames)
        .where(
          and(
            eq(schema.sessionDisplayNames.userId, sessionOwnerId),
            eq(schema.sessionDisplayNames.sessionId, sessionId)
          )
        )
        .limit(1)
    : [];
  // Check if session is favorited
  const [favoriteRow] = canRename
    ? await db
        .select({ id: schema.favoriteSessions.id })
        .from(schema.favoriteSessions)
        .where(
          and(
            eq(schema.favoriteSessions.userId, user.userId),
            eq(schema.favoriteSessions.sessionId, sessionId)
          )
        )
        .limit(1)
    : [];
  const isFavorited = !!favoriteRow;

  // Check if session has notes
  const [noteRow] = canRename
    ? await db
        .select({
          id: schema.sessionNotes.id,
          content: schema.sessionNotes.content,
          createdAt: schema.sessionNotes.createdAt,
          updatedAt: schema.sessionNotes.updatedAt,
        })
        .from(schema.sessionNotes)
        .where(
          and(
            eq(schema.sessionNotes.userId, user.userId),
            eq(schema.sessionNotes.sessionId, sessionId)
          )
        )
        .limit(1)
    : [];

  const fallbackName = buildSessionFallbackName(sessionId, first.projectName, first.promptText);
  const totalInputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimate ?? Math.ceil(p.promptLength / 4)), 0);
  const totalOutputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimateResponse ?? 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const inputPct = totalTokens > 0 ? Math.round((totalInputTokens / totalTokens) * 100) : 0;
  const outputPct = totalTokens > 0 ? 100 - inputPct : 0;
  const responseCount = prompts.filter(p => p.responseText).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={teamScope ? `/sessions?teamId=${encodeURIComponent(teamScope.teamId)}` : "/sessions"}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Sessions
        </Link>
      </div>

      {/* Unified session header */}
      <Card className="overflow-hidden">
        {/* Gradient bar at top */}
        <div className="h-1 bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)]" />
        <CardContent className="p-6">
          {/* Header row: name + actions */}
          <div className="mb-2 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <SessionNameEditor
              key={`${sessionId}:${displayName?.displayName ?? ""}`}
              sessionId={sessionId}
              initialDisplayName={displayName?.displayName ?? null}
              fallbackName={fallbackName}
              editable={canRename}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canRename && <FavoriteSessionButton sessionId={sessionId} initialFavorited={isFavorited} />}
              {canRename && <ShareSessionButton sessionId={sessionId} />}
            </div>
          </div>

          {/* First prompt preview */}
          <div className="mb-4 line-clamp-2 break-words whitespace-pre-line text-sm text-muted-foreground">
            {first.promptText || "Empty prompt"}
          </div>

          {/* Time + badges row */}
          <div className="flex flex-wrap items-center gap-4 text-sm mb-4">
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="min-w-0 break-words">
                {formatDate(first.timestamp)} — {formatDuration(first.timestamp, last.timestamp)}
              </span>
            </div>
            {first.projectName && (
              <Badge variant="secondary" className="max-w-full truncate">{first.projectName}</Badge>
            )}
            {first.source && (
              <Badge variant="outline" className="max-w-full truncate">{first.source}</Badge>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 p-3 bg-surface-sunken rounded-lg mb-4">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Prompts</div>
              <div className="text-sm font-semibold text-foreground">{prompts.length}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Responses</div>
              <div className="text-sm font-semibold text-foreground">{responseCount}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Input</div>
              <div className="text-sm font-semibold text-foreground">{formatTokens(totalInputTokens)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Output</div>
              <div className="text-sm font-semibold text-foreground">{formatTokens(totalOutputTokens)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5">Total</div>
              <div className="text-sm font-bold text-foreground">{formatTokens(totalTokens)}</div>
            </div>
          </div>

          {/* Token ratio bar */}
          {totalTokens > 0 && (
            <div className="mb-4">
              <div className="flex h-2 rounded-full overflow-hidden bg-surface-sunken">
                <div
                  className="bg-user-message transition-all"
                  style={{ width: `${inputPct}%` }}
                  title={`Input: ${inputPct}%`}
                />
                <div
                  className="bg-assistant-message transition-all"
                  style={{ width: `${outputPct}%` }}
                  title={`Output: ${outputPct}%`}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-user-message" />
                  Input {inputPct}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-assistant-message" />
                  Output {outputPct}%
                </span>
              </div>
            </div>
          )}

          {/* Technical details (collapsible) */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors select-none">
              Technical details
            </summary>
            <div className="mt-2 space-y-1 font-mono pl-4">
              <div className="break-all">{sessionId}</div>
              {first.workingDirectory && (
                <div className="truncate" title={first.workingDirectory}>
                  {first.workingDirectory}
                </div>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      {canRename && <SessionStoryButton sessionId={sessionId} allowUseAsSessionName />}

      {/* Conversation thread */}
      <SessionThread
        sessionId={sessionId}
        prompts={prompts.map((p) => ({
          id: p.id,
          timestamp: p.timestamp.toISOString(),
          promptText: p.promptText,
          responseText: p.responseText,
          tokenEstimate: p.tokenEstimate,
          tokenEstimateResponse: p.tokenEstimateResponse,
          promptTags: p.promptTags.map((pt) => ({
            tag: { id: pt.tag.id, name: pt.tag.name, color: pt.tag.color },
          })),
        }))}
        responseCount={responseCount}
        selectable
      />

      {/* Session notes */}
      {canRename && (
        <SessionNotes
          sessionId={sessionId}
          initialNote={noteRow ?? null}
        />
      )}
    </div>
  );
}
