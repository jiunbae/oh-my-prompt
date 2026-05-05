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
    return (
      <div className="h-[280px] w-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No quality score data</p>
      </div>
    );
  }

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formattedData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            minTickGap={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            domain={[0, 100]}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              borderColor: "var(--color-border)",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--color-foreground)",
            }}
            labelStyle={{ color: "var(--color-muted-foreground)" }}
            formatter={(value: number | string | undefined) => [`${Number(value ?? 0).toFixed(1)} / 100`, "Avg Quality"]}
          />
          <Line
            type="monotone"
            dataKey="avgQuality"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--chart-2)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
