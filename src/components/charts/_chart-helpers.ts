/**
 * Shared helpers for chart components.
 *
 * Centralizes tooltip styling, the categorical/semantic colour split, an
 * empty-state component, and a "did this metric move in the right direction?"
 * helper for KPI deltas.
 *
 * Charts under src/components/charts/ should import from this module rather
 * than redefining inline tooltip styles or hard-coding palette colours.
 */

import { createElement, type CSSProperties, type ReactElement } from "react";

/**
 * Standard contentStyle for every recharts <Tooltip>. Uses --surface-elevated
 * so the floating panel reads as raised against --card backgrounds, plus a
 * soft shadow for clarity on light themes where border alone is too subtle.
 */
export function chartTooltipStyles(): {
  contentStyle: CSSProperties;
  labelStyle: CSSProperties;
  itemStyle: CSSProperties;
} {
  return {
    contentStyle: {
      backgroundColor: "var(--color-surface-elevated)",
      border: "1px solid var(--color-border)",
      borderRadius: "8px",
      fontSize: "12px",
      color: "var(--color-foreground)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
      padding: "8px 12px",
    },
    labelStyle: {
      color: "var(--color-muted-foreground)",
      marginBottom: "4px",
      fontSize: "11px",
    },
    itemStyle: {
      color: "var(--color-foreground)",
    },
  };
}

/**
 * Chart palette split into:
 *   - categorical: distinct hues for one-bar/slice-per-category charts
 *   - primary: a single stable accent for single-series time trends
 *   - semantic: positive/negative/neutral roles for metric deltas etc.
 *
 * Keep these references symbolic (CSS variables) so theme switches Just Work.
 */
export const chartColors = {
  // Use for categorical (project distribution, breakdown by source, etc.)
  // Hue-rotated so adjacent categories are visually distinct.
  categorical: [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
  ] as const,
  // Use for single-series (prompt volume over time): one stable accent.
  primary: "var(--color-chart-1)",
  // Use for semantic metrics
  semantic: {
    positive: "var(--color-chart-3)", // green-ish
    negative: "var(--color-destructive)",
    neutral: "var(--color-muted-foreground)",
  },
} as const;

/**
 * Color for a metric delta. `betterDirection: 'up'` means a higher value is good
 * (e.g. prompts/day), `'down'` means lower is good (e.g. avg tokens consumed per
 * prompt). Return tailwind class string ready to drop into className.
 */
export function deltaColorClass(
  delta: number,
  betterDirection: "up" | "down" = "up",
): string {
  if (delta === 0) return "text-muted-foreground";
  const good = betterDirection === "up" ? delta > 0 : delta < 0;
  return good ? "text-chart-3" : "text-destructive";
}

/**
 * Standardized empty state for charts. Use instead of bespoke "No X data"
 * markup so heights and typography stay consistent.
 *
 * Implemented with `createElement` so this file can stay `.ts` (no JSX).
 */
export function ChartEmpty({
  message,
  height = 280,
}: {
  message: string;
  height?: number;
}): ReactElement {
  return createElement(
    "div",
    {
      className: "flex items-center justify-center",
      style: { height },
    },
    createElement(
      "p",
      { className: "text-sm text-muted-foreground" },
      message,
    ),
  );
}
