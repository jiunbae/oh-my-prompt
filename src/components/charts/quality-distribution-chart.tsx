"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { chartColors, chartTooltipStyles } from "./_chart-helpers";

interface QualityDistributionChartProps {
  data: Array<{ range: string; count: number }>;
}

export function QualityDistributionChart({ data }: QualityDistributionChartProps) {
  const tooltipStyles = chartTooltipStyles();

  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="range"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
          />
          <Bar dataKey="count" fill={chartColors.primary} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
