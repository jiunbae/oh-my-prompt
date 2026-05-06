"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface ExperimentChartProps {
  baselineMetric: number;
  challengerMetric: number;
  baselineSamples: number;
  challengerSamples: number;
  isLoading?: boolean;
}

export function ExperimentChart({
  baselineMetric,
  challengerMetric,
  baselineSamples,
  challengerSamples,
  isLoading,
}: ExperimentChartProps) {
  if (isLoading) {
    return (
      <div className="h-[280px] w-full">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  const data = [
    {
      name: "Baseline",
      metric: baselineMetric,
      samples: baselineSamples,
    },
    {
      name: "Challenger",
      metric: challengerMetric,
      samples: challengerSamples,
    },
  ];

  const hasData = baselineMetric > 0 || challengerMetric > 0;

  if (!hasData) {
    return (
      <div className="h-[280px] w-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No metric data yet</p>
      </div>
    );
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
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
            formatter={(value, _name, props) => {
              const sampleSize =
                (props?.payload as Record<string, number> | undefined)?.samples ?? 0;
              return [`${Number(value ?? 0).toFixed(1)} (${sampleSize} samples)`, "Avg Metric"];
            }}
          />
          <Legend />
          <Bar dataKey="metric" name="Avg Metric" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
