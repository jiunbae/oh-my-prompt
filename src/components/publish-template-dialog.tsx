"use client";

import { useState } from "react";
import { Dialog, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MARKETPLACE_CATEGORIES = [
  { value: "development", label: "Development" },
  { value: "debugging", label: "Debugging" },
  { value: "refactoring", label: "Refactoring" },
  { value: "learning", label: "Learning" },
  { value: "other", label: "Other" },
];

interface PublishTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  templateId: string;
  templateTitle: string;
  onPublished: () => void;
}

export function PublishTemplateDialog({
  open,
  onClose,
  templateId,
  templateTitle,
  onPublished,
}: PublishTemplateDialogProps) {
  const [category, setCategory] = useState("development");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handlePublish = async () => {
    setLoading(true);
    setError("");

    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);

      const res = await fetch("/api/marketplace/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          category,
          tags: tagList,
          isPublic,
        }),
      });

      if (res.ok) {
        onPublished();
        onClose();
        setCategory("development");
        setTags("");
        setIsPublic(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to publish template");
      }
    } catch {
      setError("An error occurred while publishing.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Publish to Marketplace</DialogTitle>
      <DialogDescription>
        Share <strong>{templateTitle}</strong> with the community.
      </DialogDescription>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-secondary-foreground">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {MARKETPLACE_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-secondary-foreground">
            Tags
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g., react, typescript, best-practices"
            className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Separate tags with commas (max 10)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="h-4 w-4 border-border bg-input-bg text-primary focus:ring-ring rounded"
            />
            <span className="text-sm text-secondary-foreground">
              Public (visible to all users)
            </span>
          </label>
        </div>

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handlePublish} disabled={loading}>
          {loading ? "Publishing..." : "Publish"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
