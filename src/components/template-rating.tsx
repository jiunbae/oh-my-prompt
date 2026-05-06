"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface TemplateRatingProps {
  rating: number;
  count?: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  value?: number;
  onChange?: (value: number) => void;
}

function Star({
  filled,
  half,
  size = 16,
  onClick,
  onMouseEnter,
}: {
  filled: boolean;
  half?: boolean;
  size?: number;
  onClick?: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "relative inline-flex",
        onClick && "cursor-pointer hover:scale-110 transition-transform"
      )}
      disabled={!onClick}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.5}
        className={cn(
          filled ? "text-chart-4" : "text-muted-foreground/40"
        )}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
        />
      </svg>
      {half && (
        <svg
          width={size / 2}
          height={size}
          viewBox="0 0 12 24"
          fill="currentColor"
          className="absolute left-0 text-chart-4"
          style={{ clipPath: "inset(0 50% 0 0)" }}
        >
          <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      )}
    </button>
  );
}

export function TemplateRating({
  rating,
  count,
  size = "md",
  interactive = false,
  value,
  onChange,
}: TemplateRatingProps) {
  const starSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
  const [hoverValue, setHoverValue] = useState<number>(0);

  const displayRating = interactive && hoverValue > 0 ? hoverValue : rating;
  const fullStars = Math.floor(displayRating);
  const hasHalf = displayRating - fullStars >= 0.5 && displayRating - fullStars < 1;

  if (interactive) {
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            filled={i < (hoverValue > 0 ? hoverValue : value || 0)}
            size={starSize}
            onClick={() => onChange?.(i + 1)}
            onMouseEnter={() => setHoverValue(i + 1)}
          />
        ))}
        {count !== undefined && (
          <span className="text-xs text-muted-foreground ml-1">({count})</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          filled={i < fullStars || (i === fullStars && hasHalf)}
          half={i === fullStars && hasHalf}
          size={starSize}
        />
      ))}
      <span className="text-xs text-muted-foreground ml-1">
        {rating.toFixed(1)}
        {count !== undefined && ` (${count})`}
      </span>
    </div>
  );
}
