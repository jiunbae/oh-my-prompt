"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SharedSession {
  id: string;
  sessionId: string;
  shareToken: string;
  expiresAt: string | null;
  viewCount: number;
  isActive: boolean;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatRelative(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function SharedSessionsList() {
  const [shares, setShares] = useState<SharedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    fetchShares();
  }, []);

  const fetchShares = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/share/sessions");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setShares(data.shares || []);
    } catch {
      setError("Failed to load shared sessions");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (shareToken: string, id: string) => {
    try {
      const url = `${window.location.origin}/share/session/${shareToken}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard may not be available
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this share link? It will no longer be accessible.")) return;
    try {
      setRevokingId(id);
      const res = await fetch(`/api/share/sessions?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      // silently fail
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-skeleton animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
        {error}
      </div>
    );
  }

  if (shares.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <svg className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        <p>No shared sessions yet.</p>
        <p className="text-sm mt-1">Share a session from its detail page to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {shares.length} active share link{shares.length !== 1 ? "s" : ""}
      </p>
      {shares.map((share) => {
        const expired = isExpired(share.expiresAt);
        return (
          <div
            key={share.id}
            className="rounded-lg border border-border bg-card p-4 transition-all hover:border-border-strong/30"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {/* Session link */}
                <Link
                  href={`/sessions/${share.sessionId}`}
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                >
                  Session {share.sessionId.slice(0, 12)}...
                </Link>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Shared {formatRelative(share.createdAt)}
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {share.viewCount} view{share.viewCount !== 1 ? "s" : ""}
                  </span>
                  {share.expiresAt && (
                    <span>
                      {expired ? "Expired" : `Expires ${formatDate(share.expiresAt)}`}
                    </span>
                  )}
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 mt-2">
                  {expired ? (
                    <Badge variant="error">Expired</Badge>
                  ) : share.expiresAt ? (
                    <Badge variant="warning">Expiring</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {/* View shared page */}
                <Link
                  href={`/share/session/${share.shareToken}`}
                  target="_blank"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Open shared link"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </Link>

                {/* Copy link */}
                <button
                  onClick={() => handleCopy(share.shareToken, share.id)}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Copy share link"
                >
                  {copiedId === share.id ? (
                    <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>

                {/* Revoke */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRevoke(share.id)}
                  disabled={revokingId === share.id}
                  className="text-muted-foreground hover:text-destructive"
                  title="Revoke share link"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
