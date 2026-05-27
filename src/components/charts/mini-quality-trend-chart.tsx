"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";
import { chartColors } from "./_chart-helpers";

interface MiniQualityTrendChartProps {
  data: Array<{ date: string; avg: number }>;
}

export function MiniQualityTrendChart({ data }: MiniQualityTrendChartProps) {
  return (
    <div className="h-20 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line
            type="monotone"
            dataKey="avg"
            stroke={chartColors.primary}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
