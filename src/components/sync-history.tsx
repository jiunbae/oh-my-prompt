"use client";

import { useState, useEffect } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

interface SyncHistoryEntry {
  id: number;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  filesProcessed: number;
  filesAdded: number;
  filesSkipped: number;
  syncType: string;
  duration: number;
}

interface SyncHistoryData {
  history: SyncHistoryEntry[];
  total: number;
}

interface SyncHistoryProps {
  limit?: number;
  className?: string;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  }
}

function formatDuration(ms: number): string {
  if (ms === 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getSyncTypeBadgeVariant(syncType: string): BadgeVariant {
  switch (syncType) {
    case "manual":
      return "default";
    case "auto":
      return "secondary";
    case "cron":
      return "warning";
    default:
      return "outline";
  }
}

function getStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "running":
      return "warning";
    default:
      return "outline";
  }
}

export function SyncHistory({ limit = 10, className = "" }: SyncHistoryProps) {
  const [data, setData] = useState<SyncHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/sync/history?limit=${limit}`);
        if (!res.ok) {
          throw new Error("Failed to fetch sync history");
        }
        const historyData = await res.json();
        setData(historyData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [limit]);

  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-10 bg-zinc-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-sm text-red-400 ${className}`}>
        Failed to load sync history: {error}
      </div>
    );
  }

  if (!data || data.history.length === 0) {
    return (
      <div className={`text-sm text-zinc-500 ${className}`}>
        No sync history available
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-800">
            <th className="pb-2 font-medium">Time</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium text-right">Added</th>
            <th className="pb-2 font-medium text-right">Skipped</th>
            <th className="pb-2 font-medium text-right">Duration</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {data.history.map((entry) => (
            <tr key={entry.id} className="border-b border-zinc-800/50 last:border-0">
              <td className="py-2.5 text-zinc-400">
                {formatRelativeTime(entry.startedAt)}
              </td>
              <td className="py-2.5">
                <Badge variant={getSyncTypeBadgeVariant(entry.syncType)}>
                  {entry.syncType}
                </Badge>
              </td>
              <td className="py-2.5 text-right">
                <span className="text-green-400">{entry.filesAdded}</span>
              </td>
              <td className="py-2.5 text-right text-zinc-500">
                {entry.filesSkipped}
              </td>
              <td className="py-2.5 text-right text-zinc-500">
                {formatDuration(entry.duration)}
              </td>
              <td className="py-2.5">
                <Badge variant={getStatusBadgeVariant(entry.status)}>
                  {entry.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
