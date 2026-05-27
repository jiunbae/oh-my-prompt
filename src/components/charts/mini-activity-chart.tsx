"use client";

import { Bar, BarChart, ResponsiveContainer } from "recharts";
import { chartColors } from "./_chart-helpers";

interface MiniActivityChartProps {
  data: Array<{ date: string; count: number }>;
}

export function MiniActivityChart({ data }: MiniActivityChartProps) {
  return (
    <div className="h-20 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Bar dataKey="count" fill={chartColors.primary} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
