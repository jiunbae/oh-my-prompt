"use client";

import { useId } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectDistributionChartProps {
  data: Array<{ name: string; count: number }>;
  isLoading?: boolean;
}

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

export function ProjectDistributionChart({ data, isLoading }: ProjectDistributionChartProps) {
  const id = useId();

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
        <p className="text-sm text-muted-foreground">No project distribution data</p>
      </div>
    );
  }

  // Top 8 projects, group rest as "Other"
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, 8);
  const otherCount = sorted.slice(8).reduce((sum, d) => sum + d.count, 0);
  const chartData = otherCount > 0 ? [...top, { name: "Other", count: otherCount }] : top;

  const total = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="count"
            nameKey="name"
            stroke="var(--color-border)"
            strokeWidth={1}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${id}-${index}`}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              borderColor: "var(--color-border)",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--color-foreground)",
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: "11px", color: "var(--color-muted-foreground)" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
