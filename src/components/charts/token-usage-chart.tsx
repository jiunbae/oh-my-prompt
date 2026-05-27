"use client";

import {
  Area,
  AreaChart,
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColors, chartTooltipStyles } from "./_chart-helpers";

interface TokenData {
  date: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface CompareUser {
  id: string;
  name: string;
  color: string;
  dailyStats: Array<{ date: string; tokens: number }>;
}

interface TokenUsageChartProps {
  data: TokenData[];
  compareUsers?: CompareUser[];
  highlightUserId?: string | null;
  height?: number;
}

export function TokenUsageChart({ data, compareUsers, highlightUserId, height = 200 }: TokenUsageChartProps) {
  const formatTick = (value: number) =>
    value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

  const tooltipStyles = chartTooltipStyles();

  // Multi-user comparison mode
  if (compareUsers && compareUsers.length > 0) {
    // Build merged date series
    const allDates = new Set<string>();
    for (const u of compareUsers) {
      for (const d of u.dailyStats) allDates.add(d.date);
    }
    const sortedDates = [...allDates].sort();

    const mergedData = sortedDates.map((date) => {
      const row: Record<string, string | number> = {
        date,
        displayDate: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      };
      for (const u of compareUsers) {
        const entry = u.dailyStats.find((d) => d.date === date);
        row[u.id] = entry?.tokens ?? 0;
      }
      return row;
    });

    return (
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={mergedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="displayDate"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              minTickGap={30}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickFormatter={formatTick}
            />
            <Tooltip
              contentStyle={tooltipStyles.contentStyle}
              labelStyle={tooltipStyles.labelStyle}
              itemStyle={tooltipStyles.itemStyle}
            />
            {compareUsers.map((u) => {
              const dimmed = highlightUserId != null && highlightUserId !== u.id;
              return (
                <Line
                  key={u.id}
                  type="monotone"
                  dataKey={u.id}
                  name={u.name}
                  stroke={u.color}
                  strokeWidth={highlightUserId === u.id ? 3 : 2}
                  strokeOpacity={dimmed ? 0.15 : 1}
                  dot={false}
                  activeDot={dimmed ? false : { r: 4 }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Default single-user area chart
  const hasIOSplit = data.some((d) => (d.inputTokens ?? 0) > 0 || (d.outputTokens ?? 0) > 0);

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  // Input keeps the primary accent; output uses the positive/green semantic
  // colour to read as "value produced".
  const inputColor = chartColors.primary;
  const outputColor = chartColors.semantic.positive;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formattedData}>
          <defs>
            <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={inputColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={inputColor} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={outputColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={outputColor} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={inputColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={inputColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            minTickGap={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickFormatter={formatTick}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
          />
          {hasIOSplit ? (
            <>
              <Area
                type="monotone"
                dataKey="inputTokens"
                name="Input"
                stroke={inputColor}
                fillOpacity={1}
                fill="url(#colorInput)"
                stackId="1"
              />
              <Area
                type="monotone"
                dataKey="outputTokens"
                name="Output"
                stroke={outputColor}
                fillOpacity={1}
                fill="url(#colorOutput)"
                stackId="1"
              />
            </>
          ) : (
            <Area
              type="monotone"
              dataKey="tokens"
              stroke={inputColor}
              fillOpacity={1}
              fill="url(#colorTokens)"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
