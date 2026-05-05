"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ShareRecord {
  id: string;
  token: string;
  access: "read" | "clone";
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
}

interface SharePromptDialogProps {
  promptId: string;
  open: boolean;
  onClose: () => void;
}

export function SharePromptDialog({ promptId, open, onClose }: SharePromptDialogProps) {
  const [access, setAccess] = useState<"read" | "clone">("read");
  const [expiry, setExpiry] = useState<string>("168"); // 7 days default
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${promptId}/shares`);
      if (!res.ok) throw new Error("Failed to fetch shares");
      const data = await res.json();
      setShares(data.shares ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch shares");
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    if (open) {
      fetchShares();
      setLastCreatedUrl(null);
      setAccess("read");
      setExpiry("168");
    }
  }, [open, fetchShares]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const expiresInHours = expiry === "never" ? undefined : parseInt(expiry, 10);
      const res = await fetch(`/api/prompts/${promptId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access, expiresInHours }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create share link");
      }
      const data = await res.json();
      setLastCreatedUrl(data.shareUrl);
      await fetchShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      const res = await fetch(`/api/prompts/${promptId}/shares/${shareId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke share");
      await fetchShares();
      // If the revoked share matches the last created URL, clear it
      const revoked = shares.find((s) => s.id === shareId);
      if (revoked && lastCreatedUrl?.includes(revoked.token)) {
        setLastCreatedUrl(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share");
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  const expiryOptions = [
    { value: "1", label: "1 hour" },
    { value: "24", label: "1 day" },
    { value: "168", label: "7 days" },
    { value: "720", label: "30 days" },
    { value: "never", label: "Never" },
  ];

  const shareUrl = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/share/${token}`;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogTitle>Share this prompt</DialogTitle>
      <DialogDescription>
        Create a shareable link that others can use to view or clone this prompt.
      </DialogDescription>

      <div className="mt-4 space-y-4">
        {/* Access level */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Access level</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAccess("read")}
              className={`flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                access === "read"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-accent"
              }`}
            >
              <span className="font-medium">View only</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Recipients can read but cannot clone
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAccess("clone")}
              className={`flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                access === "clone"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-accent"
              }`}
            >
              <span className="font-medium">Clone allowed</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Recipients can view and clone to their account
              </span>
            </button>
          </div>
        </div>

        {/* Expiry */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Link expires</label>
          <select
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-input-bg px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {expiryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Create button */}
        <Button onClick={handleCreate} disabled={creating} className="w-full">
          {creating ? "Creating..." : "Create share link"}
        </Button>

        {/* Last created link */}
        {lastCreatedUrl && (
          <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">Share link created</p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={lastCreatedUrl}
                className="flex-1 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCopy(lastCreatedUrl)}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        {/* Existing shares */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Active shares</h4>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active share links for this prompt.</p>
          ) : (
            <div className="space-y-2">
              {shares.map((share) => {
                const url = shareUrl(share.token);
                const isExpired = share.expiresAt && new Date(share.expiresAt) < new Date();
                return (
                  <div
                    key={share.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <code className="text-xs text-muted-foreground truncate block">
                        {url}
                      </code>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            share.access === "clone"
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary text-secondary-foreground"
                          }`}
                        >
                          {share.access === "clone" ? "Clone" : "View only"}
                        </span>
                        <span>{share.viewCount} views</span>
                        {share.expiresAt && (
                          <span className={isExpired ? "text-destructive" : ""}>
                            Expires: {new Date(share.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                        {isExpired && (
                          <span className="text-destructive font-medium">Expired</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleCopy(url)}
                        title="Copy link"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-destructive hover:text-destructive/80"
                        onClick={() => handleRevoke(share.id)}
                        title="Revoke"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
