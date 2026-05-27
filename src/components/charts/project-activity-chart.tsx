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
import { chartColors, chartTooltipStyles } from "./_chart-helpers";

interface ProjectActivityDatum {
  project: string;
  count: number;
}

interface ProjectActivityChartProps {
  data: ProjectActivityDatum[];
}

function truncate(label: string, max: number) {
  if (label.length <= max) return label;
  return label.slice(0, max - 3) + "...";
}

export function ProjectActivityChart({ data }: ProjectActivityChartProps) {
  const formattedData = data.map((d) => ({
    ...d,
    displayProject: truncate(d.project || "No project", 18),
  }));

  const tooltipStyles = chartTooltipStyles();

  return (
    <div className="h-[240px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formattedData} layout="vertical" margin={{ left: 10, right: 10 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="displayProject"
            axisLine={false}
            tickLine={false}
            width={110}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
            formatter={(value) => [`${value}`, "Prompts"]}
          />
          <Bar dataKey="count" fill={chartColors.primary} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
