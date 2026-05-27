"use client";

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

interface WeekdayActivityChartProps {
  data: Array<{ day: string; count: number }>;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Tooltip series label (e.g. "Count"). */
  tooltipLabel?: string;
  /** Format the raw value into the tooltip's value text (e.g. "{n} prompts"). */
  formatTooltipValue?: (value: number | string | undefined) => string;
}

const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LABELS: Record<string, string> = {
  Sun: "Sun",
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
};

export function WeekdayActivityChart({
  data,
  isLoading,
  emptyMessage = "No weekday activity data",
  tooltipLabel = "Count",
  formatTooltipValue,
}: WeekdayActivityChartProps) {
  if (isLoading) {
    return (
      <div className="h-[280px] w-full">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return <ChartEmpty message={emptyMessage} />;
  }

  // Normalize day names and fill missing days
  const dataMap = new Map<string, number>();
  for (const d of data) {
    const normalized = d.day.trim().slice(0, 3);
    dataMap.set(normalized, (dataMap.get(normalized) ?? 0) + d.count);
  }

  const filledData = DAY_ORDER.map((day) => ({
    day,
    label: DAY_LABELS[day] ?? day,
    count: dataMap.get(day) ?? 0,
  }));

  const tooltipStyles = chartTooltipStyles();

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={filledData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
            formatter={(value: number | string | undefined) => [
              formatTooltipValue ? formatTooltipValue(value) : `${value ?? 0} prompts`,
              tooltipLabel,
            ]}
          />
          <Bar dataKey="count" fill={chartColors.primary} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
