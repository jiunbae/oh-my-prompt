"use client";

import { useLocale } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartEmpty, chartColors, chartTooltipStyles } from "./_chart-helpers";

interface TokenUsageChartProps {
  data: Array<{ date: string; tokens: number }>;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Tooltip series label (e.g. "Tokens"). */
  tooltipLabel?: string;
  /**
   * Format the already-shortened tick string ("4.2k") into the tooltip's
   * value text (e.g. "{value} tokens"). Receives the formatted string.
   */
  formatTooltipValue?: (formatted: string) => string;
}

function formatTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function TokenUsageChart({
  data,
  isLoading,
  emptyMessage = "No token usage data",
  tooltipLabel = "Tokens",
  formatTooltipValue,
}: TokenUsageChartProps) {
  const locale = useLocale();

  if (isLoading) {
    return (
      <div className="h-[280px] w-full">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  if (data.length === 0 || data.every((d) => d.tokens === 0)) {
    return <ChartEmpty message={emptyMessage} />;
  }

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date + "T12:00:00Z").toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    }),
  }));

  const tooltipStyles = chartTooltipStyles();

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formattedData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            minTickGap={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickFormatter={formatTick}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
            formatter={(value: number | string | undefined) => {
              const formatted = formatTick(Number(value ?? 0));
              return [
                formatTooltipValue ? formatTooltipValue(formatted) : `${formatted} tokens`,
                tooltipLabel,
              ];
            }}
          />
          <Bar dataKey="tokens" fill={chartColors.primary} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
