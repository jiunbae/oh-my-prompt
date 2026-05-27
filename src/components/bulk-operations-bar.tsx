"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface BulkOperationsBarProps {
  selectedCount: number;
  onDelete: () => Promise<void>;
  onTag: (tagName: string) => Promise<void>;
  onClear: () => void;
}

export function BulkOperationsBar({
  selectedCount,
  onDelete,
  onTag,
  onClear,
}: BulkOperationsBarProps) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagName, setTagName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [existingTags, setExistingTags] = useState<{ id: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagInput]);

  // Fetch existing tags for autocomplete
  useEffect(() => {
    if (showTagInput) {
      fetch("/api/trpc/tags.list", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      })
        .then((res) => res.json())
        .then((data) => {
          // tRPC's superjson transformer wraps plain JSON under data.json.
          const tags = data?.result?.data?.json ?? data?.result?.data ?? [];
          setExistingTags(tags);
        })
        .catch(() => {
          // Silently fail — suggestions are optional
        });
    }
  }, [showTagInput]);

  // Close suggestions when clicking outside
  useEffect(() => {
    if (!showSuggestions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        tagInputRef.current &&
        !tagInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSuggestions]);

  const filteredTags = tagName.trim()
    ? existingTags.filter((t) =>
        t.name.toLowerCase().includes(tagName.toLowerCase())
      )
    : existingTags;

  const handleDeleteConfirm = async () => {
    setConfirmOpen(false);
    setLoading(true);
    try {
      await onDelete();
    } finally {
      setLoading(false);
    }
  };

  const handleTagSubmit = async () => {
    const trimmed = tagName.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await onTag(trimmed);
      setTagName("");
      setShowTagInput(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (name: string) => {
    setTagName(name);
    setShowSuggestions(false);
    // Auto-submit with the selected tag
    setLoading(true);
    onTag(name).finally(() => {
      setTagName("");
      setShowTagInput(false);
      setLoading(false);
    });
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40",
          "border-t border-border bg-card/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.3)]",
          "safe-area-inset-bottom"
        )}
      >
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Selection count */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {selectedCount}
              </span>
              <span className="text-sm text-muted-foreground">
                {selectedCount === 1 ? "prompt" : "prompts"} selected
              </span>
            </div>

            <div className="flex-1" />

            {/* Tag input (inline expansion) */}
            {showTagInput && (
              <div className="relative" ref={suggestionsRef}>
                <Input
                  ref={tagInputRef}
                  value={tagName}
                  onChange={(e) => {
                    setTagName(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleTagSubmit();
                    }
                    if (e.key === "Escape") {
                      setShowTagInput(false);
                      setTagName("");
                      setShowSuggestions(false);
                    }
                  }}
                  placeholder="Tag name..."
                  className="h-8 w-40 text-sm"
                  disabled={loading}
                />
                {showSuggestions && filteredTags.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1 w-48 max-h-40 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-50">
                    {filteredTags.slice(0, 8).map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSuggestionClick(tag.name);
                        }}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {!showTagInput ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTagInput(true)}
                  disabled={loading}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                    />
                  </svg>
                  Tag selected
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTagSubmit}
                  disabled={loading || !tagName.trim()}
                >
                  {loading ? "Applying..." : "Apply tag"}
                </Button>
              )}

              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={loading}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete selected
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                disabled={loading}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer so content doesn't hide behind the bar */}
      <div className="h-20" />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDeleteConfirm}
        title={`Delete ${selectedCount} ${selectedCount === 1 ? "prompt" : "prompts"}`}
        description={`Are you sure you want to delete ${selectedCount === 1 ? "this prompt" : `these ${selectedCount} prompts`}? This action cannot be undone.`}
        confirmLabel={`Delete ${selectedCount}`}
        variant="destructive"
        loading={loading}
      />
    </>
  );
}
