"use client";

import { useState } from "react";

interface FavoriteSessionButtonProps {
  sessionId: string;
  initialFavorited: boolean;
}

export function FavoriteSessionButton({
  sessionId,
  initialFavorited,
}: FavoriteSessionButtonProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (loading) return;

    setLoading(true);
    const prev = favorited;
    setFavorited(!prev); // Optimistic update

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/favorite`, {
        method: "POST",
      });

      if (!res.ok) {
        setFavorited(prev); // Revert on failure
        return;
      }

      const data = await res.json();
      setFavorited(data.favorited);
    } catch {
      setFavorited(prev); // Revert on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={loading}
      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
    >
      {favorited ? (
        <svg className="h-4 w-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      )}
    </button>
  );
}
