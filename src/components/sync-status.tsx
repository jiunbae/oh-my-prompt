"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SyncStatusData {
  lastSync: {
    id: number;
    startedAt: string | null;
    completedAt: string | null;
    status: "running" | "completed" | "failed";
    filesProcessed: number;
    filesAdded: number;
    filesSkipped: number;
    syncType: "manual" | "auto" | "cron";
    errorMessage?: string | null;
  } | null;
  isRunning: boolean;
}

interface SyncStatusProps {
  className?: string;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never";

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
    return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  }
}

export function SyncStatus({ className = "" }: SyncStatusProps) {
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      if (!res.ok) {
        throw new Error("Failed to fetch sync status");
      }
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh every 5 seconds when sync is running
  useEffect(() => {
    if (status?.isRunning || syncing) {
      const interval = setInterval(fetchStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [status?.isRunning, syncing, fetchStatus]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ syncType: "manual" }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Sync failed");
      }

      // Refresh status after sync completes
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="h-5 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-10 w-32 bg-zinc-800 rounded animate-pulse" />
      </div>
    );
  }

  const lastSync = status?.lastSync;
  const isRunning = status?.isRunning || syncing;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Last Sync Info */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">Last sync:</span>
          <span className="text-sm text-zinc-200">
            {lastSync ? formatRelativeTime(lastSync.completedAt || lastSync.startedAt) : "Never synced"}
          </span>
          {lastSync && (
            <Badge
              variant={
                lastSync.status === "completed"
                  ? "success"
                  : lastSync.status === "failed"
                  ? "error"
                  : "warning"
              }
            >
              {lastSync.status}
            </Badge>
          )}
        </div>

        {lastSync && lastSync.status === "completed" && (
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>
              <span className="text-green-400">{lastSync.filesAdded}</span> added
            </span>
            <span>
              <span className="text-zinc-400">{lastSync.filesSkipped}</span> skipped
            </span>
            <span>
              <span className="text-zinc-400">{lastSync.filesProcessed}</span> processed
            </span>
          </div>
        )}

        {lastSync?.errorMessage && (
          <p className="text-xs text-red-400">{lastSync.errorMessage}</p>
        )}
      </div>

      {/* Sync Button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSync}
          disabled={isRunning}
          className="min-w-[120px]"
        >
          {isRunning ? (
            <>
              <svg
                className="animate-spin h-4 w-4 mr-2"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Syncing...
            </>
          ) : (
            <>
              <svg
                className="h-4 w-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Sync Now
            </>
          )}
        </Button>

        {isRunning && (
          <span className="text-sm text-zinc-500">
            Syncing prompts from MinIO...
          </span>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
