"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FavoritePromptButton } from "@/components/favorite-prompt-button";

interface FavoritePromptItem {
  id: string;
  promptId: string;
  prompt: {
    id: string;
    timestamp: string;
    promptText: string;
    projectName: string | null;
    promptType: string | null;
  };
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

export default function FavoritePromptsPage() {
  const [items, setItems] = useState<FavoritePromptItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/prompts/favorites")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.prompts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Favorite Prompts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prompts you&apos;ve bookmarked for quick access.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No favorite prompts yet.</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Star prompts from search results or session detail pages.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id} className="group">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/prompts/${item.prompt.id}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors line-clamp-2"
                  >
                    {item.prompt.promptText.slice(0, 200)}
                    {item.prompt.promptText.length > 200 && "..."}
                  </Link>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(item.prompt.timestamp)}</span>
                    {item.prompt.projectName && (
                      <Badge variant="secondary" className="text-xs">
                        {item.prompt.projectName}
                      </Badge>
                    )}
                    {item.prompt.promptType && (
                      <Badge variant="outline" className="text-xs">
                        {item.prompt.promptType}
                      </Badge>
                    )}
                  </div>
                </div>
                <FavoritePromptButton
                  promptId={item.prompt.id}
                  isFavorited={true}
                  onToggle={(fav) => {
                    if (!fav) {
                      setItems((prev) => prev.filter((i) => i.prompt.id !== item.prompt.id));
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
