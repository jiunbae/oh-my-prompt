import { SessionCard } from "@/components/session-card";

interface TimelineSession {
  session_id: string;
  display_name: string | null;
  first_prompt: string;
  started_at: string;
  ended_at: string;
  prompt_count: number;
  response_count: number;
  project_name: string | null;
  source: string | null;
  device_name: string | null;
  total_tokens: number;
}

interface SessionTimelineViewProps {
  sessions: TimelineSession[];
}

function formatGroupDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today.getTime() - sessionDate.getTime();
  const daysDiff = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (daysDiff === 0) return "Today";
  if (daysDiff === 1) return "Yesterday";
  if (daysDiff < 7) {
    return d.toLocaleDateString("en-US", { weekday: "long" });
  }
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: now.getFullYear() !== d.getFullYear() ? "numeric" : undefined,
  });
}

function groupByDate(sessions: TimelineSession[]): Map<string, TimelineSession[]> {
  const groups = new Map<string, TimelineSession[]>();
  for (const session of sessions) {
    const date = new Date(session.started_at).toISOString().split("T")[0];
    const existing = groups.get(date);
    if (existing) {
      existing.push(session);
    } else {
      groups.set(date, [session]);
    }
  }
  return groups;
}

export function SessionTimelineView({ sessions }: SessionTimelineViewProps) {
  const groups = groupByDate(sessions);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No sessions found.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {Array.from(groups.entries()).map(([date, dateSessions]) => (
        <div key={date} className="relative">
          {/* Date separator */}
          <div className="flex items-center gap-3 mb-4 mt-6 first:mt-0">
            <div className="h-3 w-3 rounded-full bg-primary border-2 border-background shrink-0 z-10" />
            <h3 className="text-sm font-semibold text-foreground">
              {formatGroupDate(date)}
            </h3>
            <span className="text-xs text-muted-foreground">
              {dateSessions.length} session{dateSessions.length !== 1 ? "s" : ""}
            </span>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>

          {/* Sessions under this date */}
          <div className="relative ml-1.5 pl-6 border-l border-border-subtle space-y-3 pb-4">
            {dateSessions.map((s) => (
              <div key={s.session_id} className="relative">
                {/* Timeline dot */}
                <div className="absolute -left-[29px] top-4 h-2 w-2 rounded-full bg-primary/60" />
                <SessionCard
                  sessionId={s.session_id}
                  displayName={s.display_name}
                  firstPrompt={s.first_prompt}
                  startedAt={String(s.started_at)}
                  endedAt={String(s.ended_at)}
                  promptCount={s.prompt_count}
                  responseCount={s.response_count}
                  projectName={s.project_name}
                  source={s.source}
                  deviceName={s.device_name}
                  totalTokens={s.total_tokens}
                  variant="list"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
