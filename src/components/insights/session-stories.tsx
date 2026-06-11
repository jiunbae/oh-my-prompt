"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionStoryButton } from "./session-story-button";
import Link from "next/link";

interface SessionSummary {
  sessionId: string;
  displayName: string | null;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  responseCount: number;
  projectName: string | null;
  source: string | null;
  deviceName: string | null;
  firstPrompt: string;
  totalTokens: number;
}

type InsightsT = (key: string, values?: Record<string, string | number>) => string;

function formatDuration(start: string, end: string, t: InsightsT): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60_000) return t("sessionStories.duration.seconds", { count: Math.round(ms / 1000) });
  if (ms < 3_600_000) return t("sessionStories.duration.minutes", { count: Math.round(ms / 60_000) });
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return t("sessionStories.duration.hoursMinutes", { hours, minutes: mins });
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

function SessionRow({ session }: { session: SessionSummary }) {
  const t = useTranslations("insights");
  const locale = useLocale();
  const [showStory, setShowStory] = useState(false);

  return (
    <div className="min-w-0 rounded-lg border border-border p-4 space-y-3 overflow-hidden">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href={`/sessions/${session.sessionId}`}
              className="min-w-0 max-w-full truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {session.displayName || session.projectName || session.sessionId.slice(0, 12) + "..."}
            </Link>
            {session.source && (
              <Badge variant="outline" className="max-w-full truncate text-xs">{session.source}</Badge>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground sm:line-clamp-1">
            {session.firstPrompt}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{new Date(session.startedAt).toLocaleDateString(locale)}</span>
            <span>{formatDuration(session.startedAt, session.endedAt, t)}</span>
            <span>{t("sessionStories.promptsSuffix", { count: session.promptCount })}</span>
            <span>{t("sessionStories.tokensSuffix", { value: formatTokens(session.totalTokens) })}</span>
          </div>
        </div>
        <button
          onClick={() => setShowStory(!showStory)}
          className="h-8 shrink-0 self-start rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {showStory ? t("sessionStories.hide") : t("sessionStories.generateStory")}
        </button>
      </div>

      {showStory && (
        <div className="min-w-0 border-t border-border pt-3">
          <SessionStoryButton sessionId={session.sessionId} />
        </div>
      )}
    </div>
  );
}

export function SessionStories() {
  const t = useTranslations("insights");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions?page=1");
        if (!res.ok) {
          throw new Error("Failed to fetch sessions");
        }
        const data = await res.json();
        // Take only the 10 most recent sessions
        setSessions((data.sessions || []).slice(0, 10));
      } catch {
        setError(t("sessionStories.error"));
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
  }, [t]);

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>{t("sessionStories.title")}</CardTitle>
            <CardDescription className="break-words">{t("sessionStories.description")}</CardDescription>
          </div>
          <Link
            href="/sessions"
            className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("sessionStories.viewAll")}
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-32 animate-pulse rounded bg-skeleton" />
                    <div className="h-3 w-full animate-pulse rounded bg-skeleton" />
                    <div className="h-3 w-48 animate-pulse rounded bg-skeleton" />
                  </div>
                  <div className="h-8 w-28 animate-pulse rounded bg-skeleton" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("sessionStories.empty")}
          </p>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className="min-w-0 space-y-3">
            {sessions.map((session) => (
              <SessionRow key={session.sessionId} session={session} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
