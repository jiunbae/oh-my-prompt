"use client";

import { useState, type KeyboardEventHandler } from "react";
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
  ariaLabel,
  checked,
  tabIndex,
  onKeyDown,
}: {
  filled: boolean;
  half?: boolean;
  size?: number;
  onClick?: () => void;
  onMouseEnter?: () => void;
  ariaLabel?: string;
  checked?: boolean;
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}) {
  const icon = (
    <>
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
    </>
  );

  if (!onClick) {
    return <span className="relative inline-flex" aria-hidden="true">{icon}</span>;
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onKeyDown={onKeyDown}
      className="relative inline-flex cursor-pointer rounded-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      {icon}
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
    const selectedValue = value ?? 0;
    const selectRating = (next: number) => onChange?.(Math.min(5, Math.max(1, next)));

    return (
      <div
        role="radiogroup"
        aria-label="Rate this template"
        className="flex items-center gap-1"
        onMouseLeave={() => setHoverValue(0)}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            filled={i < (hoverValue > 0 ? hoverValue : selectedValue)}
            size={starSize}
            ariaLabel={`${i + 1} star${i === 0 ? "" : "s"}`}
            checked={selectedValue === i + 1}
            tabIndex={selectedValue === i + 1 || (selectedValue === 0 && i === 0) ? 0 : -1}
            onClick={() => selectRating(i + 1)}
            onMouseEnter={() => setHoverValue(i + 1)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                selectRating((selectedValue || 1) + 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                selectRating((selectedValue || 1) - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                selectRating(1);
              } else if (event.key === "End") {
                event.preventDefault();
                selectRating(5);
              }
            }}
          />
        ))}
        {count !== undefined && (
          <span className="text-xs text-muted-foreground ml-1">({count})</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={`Rating ${rating.toFixed(1)} out of 5${count !== undefined ? ` from ${count} ratings` : ""}`}
    >
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
