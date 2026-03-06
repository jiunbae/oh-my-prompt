"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";

interface QualityDistributionChartProps {
  data: Array<{ range: string; count: number }>;
}

export function QualityDistributionChart({ data }: QualityDistributionChartProps) {
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="range"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              borderColor: "var(--color-border)",
              fontSize: "12px",
              color: "var(--color-foreground)",
            }}
          />
          <Bar dataKey="count" fill="#a78bfa" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
