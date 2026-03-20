import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FavoriteSessionButton } from "@/components/favorite-session-button";

interface SessionCardProps {
  sessionId: string;
  displayName?: string | null;
  firstPrompt: string;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  responseCount: number;
  projectName?: string | null;
  source?: string | null;
  deviceName?: string | null;
  totalTokens?: number;
  variant?: "list" | "grid";
  isFavorited?: boolean;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatDuration(startStr: string, endStr: string): string {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
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

export function SessionCard({
  sessionId,
  displayName,
  firstPrompt,
  startedAt,
  endedAt,
  promptCount,
  responseCount,
  projectName,
  source,
  totalTokens,
  variant = "list",
  isFavorited = false,
}: SessionCardProps) {
  if (variant === "grid") {
    return (
      <Link href={`/sessions/${sessionId}`} className="block h-full">
        <Card className="h-full transition-all duration-200 hover:border-border-strong/30 hover:shadow-[0_0_20px_var(--glow)] hover:translate-y-[-1px] cursor-pointer overflow-hidden">
          {/* Top gradient bar */}
          <div className="h-1 bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)]" />
          <CardContent className="p-4">
            {/* Title */}
            <div className="flex items-start justify-between gap-1 mb-1">
              <h3 className="text-sm font-semibold text-foreground line-clamp-1 min-w-0">
                {displayName || "Untitled Session"}
              </h3>
              <FavoriteSessionButton sessionId={sessionId} initialFavorited={isFavorited} />
            </div>
            {/* Preview */}
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line mb-3">
              {firstPrompt || "Empty prompt"}
            </p>

            {/* Time */}
            <div className="text-xs text-muted-foreground mb-3">
              {formatDate(startedAt)}
              <span className="mx-1 text-muted-foreground/50">&middot;</span>
              {formatDuration(startedAt, endedAt)}
            </div>

            {/* Meta icons */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
              <span className="inline-flex items-center gap-1">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                {promptCount}
              </span>
              {totalTokens != null && totalTokens > 0 && (
                <span className="inline-flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {formatTokens(totalTokens)}
                </span>
              )}
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              {projectName && (
                <Badge variant="secondary" className="text-[10px]">{projectName}</Badge>
              )}
              {source && (
                <Badge variant="outline" className="text-[10px]">{source}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  // List variant (default)
  return (
    <Link href={`/sessions/${sessionId}`} className="block">
      <Card className="transition-all duration-200 hover:border-border-strong/30 hover:shadow-[0_0_20px_var(--glow)] hover:translate-y-[-1px] cursor-pointer overflow-hidden">
        <div className="flex">
          {/* Left color indicator bar */}
          <div className="w-[2px] shrink-0 bg-primary/60" />
          <CardContent className="p-4 flex-1 min-w-0">
            {/* Top section: name + time */}
            <div className="flex items-start justify-between gap-4 mb-1">
              <div className="flex items-center gap-1 min-w-0">
                <FavoriteSessionButton sessionId={sessionId} initialFavorited={isFavorited} />
                <h3 className="text-sm font-semibold text-foreground line-clamp-1 min-w-0">
                  {displayName || firstPrompt || "Empty prompt"}
                </h3>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {formatDate(startedAt)}
              </span>
            </div>

            {/* First prompt preview (only when displayName exists) */}
            {displayName && (
              <p className="text-xs text-muted-foreground line-clamp-1 whitespace-pre-line mb-2">
                {firstPrompt || "Empty prompt"}
              </p>
            )}

            {/* Bottom section: badges + meta icons */}
            <div className="flex items-center justify-between gap-4 mt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {projectName && (
                  <Badge variant="secondary" className="text-[10px]">{projectName}</Badge>
                )}
                {source && (
                  <Badge variant="outline" className="text-[10px]">{source}</Badge>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                <span className="inline-flex items-center gap-1" title="Duration">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatDuration(startedAt, endedAt)}
                </span>
                <span className="inline-flex items-center gap-1" title="Prompts">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  {promptCount}
                </span>
                {totalTokens != null && totalTokens > 0 && (
                  <span className="inline-flex items-center gap-1" title="Tokens">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    {formatTokens(totalTokens)}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}
