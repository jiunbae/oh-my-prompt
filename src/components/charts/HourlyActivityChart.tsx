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

interface HourlyActivityChartProps {
  data: Array<{ hour: number; count: number }>;
  isLoading?: boolean;
}

function formatHour(hour: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h} ${ampm}`;
}

export function HourlyActivityChart({ data, isLoading }: HourlyActivityChartProps) {
  if (isLoading) {
    return (
      <div className="h-[280px] w-full">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="h-[280px] w-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No hourly activity data</p>
      </div>
    );
  }

  // Fill all 24 hours
  const dataMap = new Map(data.map((d) => [d.hour, d.count]));
  const filledData = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: dataMap.get(i) ?? 0,
    label: formatHour(i),
  }));

  // Only show every 3rd label to avoid crowding
  const tickHours = [0, 3, 6, 9, 12, 15, 18, 21];

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={filledData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="hour"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
            ticks={tickHours}
            tickFormatter={(hour: number) => formatHour(hour)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
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
          />
          <Bar dataKey="count" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
