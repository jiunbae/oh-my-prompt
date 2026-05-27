"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartEmpty, chartColors, chartTooltipStyles } from "./_chart-helpers";

interface QualityScoreChartProps {
  data: Array<{ date: string; avgQuality: number }>;
  isLoading?: boolean;
}

export function QualityScoreChart({ data, isLoading }: QualityScoreChartProps) {
  if (isLoading) {
    return (
      <div className="h-[280px] w-full">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  const hasData = data.some((d) => d.avgQuality > 0);

  if (data.length === 0 || !hasData) {
    return <ChartEmpty message="No quality score data" />;
  }

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  const tooltipStyles = chartTooltipStyles();

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formattedData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
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
            domain={[0, 100]}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
            formatter={(value: number | string | undefined) => [`${Number(value ?? 0).toFixed(1)} / 100`, "Avg Quality"]}
          />
          <Line
            type="monotone"
            dataKey="avgQuality"
            stroke={chartColors.primary}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: chartColors.primary }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
