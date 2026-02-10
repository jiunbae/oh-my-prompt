import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/markdown-content";

export const dynamic = "force-dynamic";

async function getCurrentUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return parseSessionToken(sessionToken);
}

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
}

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  const prompts = await db.query.prompts.findMany({
    where: and(
      eq(schema.prompts.userId, user.userId),
      eq(schema.prompts.sessionId, sessionId)
    ),
    orderBy: [asc(schema.prompts.timestamp)],
    with: {
      promptTags: {
        with: {
          tag: true,
        },
      },
    },
  });

  await client.end();

  if (prompts.length === 0) {
    notFound();
  }

  const first = prompts[0];
  const last = prompts[prompts.length - 1];
  const totalInputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimate ?? Math.ceil(p.promptLength / 4)), 0);
  const totalOutputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimateResponse ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Sessions
        </Link>
      </div>

      {/* Session metadata header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-zinc-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatDate(first.timestamp)} — {formatDuration(first.timestamp, last.timestamp)}
            </div>
            {first.projectName && (
              <Badge variant="secondary">{first.projectName}</Badge>
            )}
            {first.source && (
              <Badge variant="outline">{first.source}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Prompts:</span>
              <span className="text-zinc-300">{prompts.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Responses:</span>
              <span className="text-zinc-300">{prompts.filter(p => p.responseText).length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Input:</span>
              <span className="text-zinc-300">{formatTokens(totalInputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Output:</span>
              <span className="text-zinc-300">{formatTokens(totalOutputTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Total:</span>
              <span className="font-medium text-zinc-100">{formatTokens(totalInputTokens + totalOutputTokens)} tokens</span>
            </div>
          </div>
          {first.workingDirectory && (
            <div className="mt-2 text-xs text-zinc-500 font-mono truncate" title={first.workingDirectory}>
              {first.workingDirectory}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversation thread */}
      <div className="space-y-4">
        {prompts.map((prompt) => (
          <div key={prompt.id} className="space-y-0">
            {/* User message */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-medium text-blue-400">You</span>
                  <span className="text-xs text-zinc-500">{formatDate(prompt.timestamp)}</span>
                  {prompt.tokenEstimate && (
                    <span className="text-xs text-zinc-500">
                      {formatTokens(prompt.tokenEstimate)} tokens
                    </span>
                  )}
                  <Link
                    href={`/prompts/${prompt.id}`}
                    className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    View detail
                  </Link>
                </div>
                <div className="prose prose-invert max-w-none">
                  <MarkdownContent content={prompt.promptText} />
                </div>
                {prompt.promptTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {prompt.promptTags.map((pt) => (
                      <Badge
                        key={pt.tag.id}
                        variant="secondary"
                        style={pt.tag.color ? { backgroundColor: `${pt.tag.color}22`, color: pt.tag.color, borderColor: pt.tag.color } : undefined}
                      >
                        {pt.tag.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Assistant response */}
            {prompt.responseText && (
              <Card className="border-l-2 border-l-green-800 ml-4">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium text-green-400">Assistant</span>
                    {prompt.tokenEstimateResponse && (
                      <span className="text-xs text-zinc-500">
                        {formatTokens(prompt.tokenEstimateResponse)} tokens
                      </span>
                    )}
                  </div>
                  <div className="prose prose-invert max-w-none">
                    <MarkdownContent content={prompt.responseText} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
