"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SessionNameEditorProps {
  sessionId: string;
  initialDisplayName?: string | null;
  fallbackName: string;
  editable?: boolean;
}

export function SessionNameEditor({
  sessionId,
  initialDisplayName,
  fallbackName,
  editable = true,
}: SessionNameEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null);
  const [draft, setDraft] = useState(initialDisplayName?.trim() ?? "");
  const [error, setError] = useState<string | null>(null);
  const savedName = localDisplayName ?? initialDisplayName?.trim() ?? "";

  async function persistName(nextDisplayName: string) {
    setError(null);

    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName: nextDisplayName || null,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update session name");
    }

    setLocalDisplayName(nextDisplayName);
    setDraft(nextDisplayName);
    setIsEditing(false);
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await persistName(draft.trim());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update session name");
    }
  }

  async function handleClear() {
    try {
      await persistName("");
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Failed to clear session name");
    }
  }

  const currentName = savedName || fallbackName;

  return (
    <div className="space-y-3">
      {isEditing ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={fallbackName}
              maxLength={120}
              disabled={isPending}
              aria-label="Session display name"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                Save
              </Button>
              {savedName ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={handleClear}
                >
                  Clear
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  setDraft(savedName);
                  setError(null);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Dashboard label only. Underlying session IDs from Codex, Claude, tmux, or zellij are unchanged.
          </p>
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground line-clamp-2">{currentName}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {savedName
                ? "Custom session name shown in the dashboard"
                : "No custom session name set"}
            </p>
          </div>
          {editable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(savedName);
                setError(null);
                setIsEditing(true);
              }}
            >
              {savedName ? "Rename" : "Name session"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
