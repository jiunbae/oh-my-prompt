"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { chartColors } from "./_chart-helpers";

interface MiniTokenTrendChartProps {
  data: Array<{ date: string; tokens: number }>;
}

export function MiniTokenTrendChart({ data }: MiniTokenTrendChartProps) {
  const id = useId();
  const gradientId = `colorTokenMini-${id}`;

  return (
    <div className="h-20 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="tokens"
            stroke={chartColors.primary}
            strokeWidth={1.5}
            fillOpacity={1}
            fill={`url(#${gradientId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
