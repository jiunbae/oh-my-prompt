"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface ActivityItem {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  promptText: string;
  projectName: string | null;
  createdAt: string;
  type: "prompt";
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface TeamActivityFeedProps {
  teamId: string;
  preview?: boolean;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function getInitials(name: string | null, email: string): string {
  if (name && name.length > 0) {
    return name[0].toUpperCase();
  }
  if (email && email.length > 0) {
    return email[0].toUpperCase();
  }
  return "?";
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function TeamActivityFeed({ teamId, preview = false }: TeamActivityFeedProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxItems = preview ? 5 : 500;

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    setStatus("connecting");
    setError(null);

    const es = new EventSource(`/api/teams/${teamId}/activity/stream`);
    esRef.current = es;

    es.onopen = () => {
      setStatus("connected");
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && data.type === "prompt") {
          setItems((prev) => {
            // Avoid duplicates
            if (prev.some((i) => i.id === data.id)) return prev;
            const next = [...prev, data];
            if (next.length > maxItems) {
              return next.slice(next.length - maxItems);
            }
            return next;
          });
        }
      } catch {
        // ignore non-JSON messages like pings
      }
    };

    es.onerror = () => {
      setStatus("disconnected");
      es.close();
      esRef.current = null;

      if (!preview) {
        // Auto-reconnect after 3s
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [teamId, preview, maxItems]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  // Auto-scroll to bottom for full feed
  useEffect(() => {
    if (!preview && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, preview]);

  const statusColor: Record<ConnectionStatus, string> = {
    connecting: "bg-chart-4",
    connected: "bg-chart-2",
    disconnected: "bg-destructive",
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    connecting: "Connecting",
    connected: "Live",
    disconnected: "Disconnected",
  };

  const displayedItems = preview ? items.slice(-5) : items;

  return (
    <div className={`flex flex-col ${preview ? "" : "h-[600px]"}`}>
      {/* Header / Status */}
      {!preview && (
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColor[status]} animate-pulse`} />
            <span className="text-xs font-medium text-muted-foreground">
              {statusLabel[status]}
            </span>
          </div>
          {status === "disconnected" && (
            <button
              onClick={connect}
              className="text-xs text-primary hover:underline"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Feed */}
      <div
        ref={scrollRef}
        className={`flex flex-col gap-3 ${preview ? "" : "overflow-y-auto pr-1"}`}
      >
        {status === "connecting" && displayedItems.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No activity yet. Prompts created by team members will appear here.
          </div>
        ) : (
          displayedItems.map((item) => (
            <div
              key={item.id}
              className="flex gap-3 p-3 rounded-lg border border-border bg-card/50 hover:bg-card transition-colors"
            >
              {/* Avatar placeholder */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                {getInitials(item.userName, item.userEmail)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-foreground">
                    {item.userName || item.userEmail.split("@")[0]}
                  </span>
                  {item.projectName && (
                    <Badge variant="info" className="text-[10px] px-1.5 py-0">
                      {item.projectName}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                    {formatTimeAgo(item.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {truncate(item.promptText, preview ? 120 : 300)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
